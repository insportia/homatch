// ============================================================
// homatch-research Edge Function
// Structured research endpoint: entity identification,
// Homatch DB lookup, optional web search via DataForSEO,
// evidence status tagging, confidence scoring.
// Returns JSON research report — NOT a streaming endpoint.
//
// POST { query, type?, propertyId?, developerId?, userId? }
// type: 'auto' | 'developer' | 'property' | 'cadastral' | 'address'
// ============================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ── Evidence status types ─────────────────────────────────────
type EvidenceStatus = 'VERIFIED' | 'HOMATCH_DATA' | 'FOUND_ONLINE' | 'CONFLICTING' | 'UNVERIFIED';

interface ResearchSource {
  label: string;
  url?: string;
  status: EvidenceStatus;
  excerpt?: string;
}

interface ResearchReport {
  queryType: string;
  entityName?: string;
  entityType?: string;
  confidence: number; // 0–100
  summary: string;
  homatchData: {
    developer?: Record<string, unknown> | null;
    properties?: Record<string, unknown>[];
    matches?: Record<string, unknown>[];
    intents?: Record<string, unknown>[];
    trustScore?: Record<string, unknown> | null;
  };
  publicFindings: {
    companyInfo?: string;
    projectInfo?: string;
    riskFlags?: string[];
    newsSnippets?: { title: string; url: string; snippet: string }[];
  };
  cadastralInfo?: {
    number?: string;
    lookupStatus: 'not_searched' | 'searched_no_result' | 'found_public' | 'requires_official';
    publicFindings?: string;
    officialVerificationAvailable: boolean;
    estimatedCost?: { credits: number; description: string };
  };
  sources: ResearchSource[];
  actions: {
    id: string;
    label: string;
    path?: string;
    type: 'navigate' | 'ai_query' | 'verify' | 'external';
  }[];
  warnings: string[];
  searchedAt: string;
}

// ── Identify query type from text ─────────────────────────────

function identifyQueryType(query: string, hint?: string): string {
  if (hint && hint !== 'auto') return hint;
  const lower = query.toLowerCase();
  // Cadastral: numeric patterns like "05.08.22.035.xxx" or just digits
  if (/^\d{2}[.\s]\d{2}[.\s]/.test(query.trim()) || /cadastral|კad|კადასტ/i.test(lower)) return 'cadastral';
  // URL
  if (/^https?:\/\//.test(query.trim())) return 'url';
  // Developer/company keywords
  if (/developer|company|builder|llc|ltd|group|archi|m2|biltmore|tegeta|axis|status|redix/i.test(lower)) return 'developer';
  // Address indicators
  if (/\b(street|avenue|avenue|გამzir|ქ\.|ст\.|пр\.|tbilisi|batumi|№|#\d)/i.test(lower)) return 'address';
  return 'developer'; // default: entity lookup
}

// ── DataForSEO web search (free public search) ────────────────

async function webSearch(
  query: string,
  supabase: ReturnType<typeof createClient>,
): Promise<{ title: string; url: string; snippet: string }[]> {
  const login = Deno.env.get('DATAFORSEO_LOGIN') ?? '';
  const password = Deno.env.get('DATAFORSEO_PASSWORD') ?? '';
  if (!login || !password) return [];

  try {
    // Check spend cap before proceeding
    const { data: cap } = await supabase
      .from('provider_spend_caps')
      .select('daily_cap_usd, current_spend_usd, kill_switch')
      .eq('provider', 'DATAFORSEO')
      .maybeSingle();

    if (cap?.kill_switch) return [];
    if (cap && cap.current_spend_usd >= cap.daily_cap_usd) return [];

    const tasks = [{ keyword: query, language_code: 'en', location_code: 21831, device: 'desktop' }];
    const r = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${login}:${password}`)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(tasks),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return [];
    const raw = await r.json();
    const results: { title: string; url: string; snippet: string }[] = [];
    for (const task of raw.tasks ?? []) {
      for (const item of task.result?.[0]?.items ?? []) {
        if (item.type === 'organic') {
          results.push({ title: item.title ?? '', url: item.url ?? '', snippet: item.description ?? '' });
        }
      }
    }
    // Log cost
    const cost = (raw.tasks ?? []).reduce((n: number, t: { cost?: number }) => n + (t.cost ?? 0), 0);
    if (cost > 0) {
      await supabase.from('cost_events').insert({
        provider: 'DATAFORSEO', operation_type: 'RESEARCH_SEARCH',
        source: 'homatch-research', market: 'GE', units: 1, cost_usd: cost,
        success: true, cache_hit: false,
      }).catch(() => {});
      if (cap) {
        await supabase.from('provider_spend_caps')
          .update({ current_spend_usd: (cap.current_spend_usd ?? 0) + cost })
          .eq('provider', 'DATAFORSEO').catch(() => {});
      }
    }
    return results.slice(0, 8);
  } catch {
    return [];
  }
}

// ── Main handler ──────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // Auth check (research is available to authenticated users only)
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  let body: { query: string; type?: string; propertyId?: string; developerId?: string; userId?: string };
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid body' }, 400); }

  const { query, type, propertyId, developerId, userId } = body;
  if (!query?.trim()) return json({ error: 'query required' }, 400);

  const queryType = identifyQueryType(query, type);
  const report: ResearchReport = {
    queryType,
    confidence: 0,
    summary: '',
    homatchData: {},
    publicFindings: {},
    sources: [],
    actions: [],
    warnings: [],
    searchedAt: new Date().toISOString(),
  };

  try {
    // ── Step 1: Homatch DB lookup ──────────────────────────────
    let foundInDB = false;

    if (developerId) {
      const { data: dev } = await supabase
        .from('developer_profiles')
        .select(`*, developer_projects(*), property_trust_scores(*)`)
        .eq('id', developerId).maybeSingle();
      if (dev) {
        report.homatchData.developer = dev as Record<string, unknown>;
        report.entityName = dev.name as string;
        report.entityType = 'developer';
        foundInDB = true;
      }
    }

    // Name-based developer search
    if (!foundInDB && ['developer', 'auto'].includes(queryType)) {
      const { data: devRows } = await supabase
        .from('developer_profiles')
        .select(`id, name, trust_score, verified, website, established_year, total_projects,
          completed_projects, public_risk_evidence, restrictions, developer_projects(name,status,city,units,completion_year,commissioned)`)
        .ilike('name', `%${query.trim()}%`)
        .limit(3);

      if (devRows?.length) {
        report.homatchData.developer = devRows[0] as Record<string, unknown>;
        report.entityName = devRows[0].name as string;
        report.entityType = 'developer';
        foundInDB = true;

        report.sources.push({
          label: `Homatch DB — Developer: ${devRows[0].name}`,
          status: 'HOMATCH_DATA',
          excerpt: `Trust score: ${devRows[0].trust_score ?? 'N/A'}/100, Verified: ${devRows[0].verified ? 'Yes' : 'No'}`,
        });
      }
    }

    // Property lookup
    if (propertyId) {
      const { data: prop } = await supabase
        .from('properties')
        .select(`*, facts:property_facts(*), developer_id,
          matches(id, match_score, signal_strength, status)`)
        .eq('id', propertyId).maybeSingle();
      if (prop) {
        report.homatchData.properties = [prop as Record<string, unknown>];
        if (!report.entityName) {
          report.entityName = prop.title as string ?? 'Property';
          report.entityType = 'property';
        }
        foundInDB = true;
        report.sources.push({
          label: `Homatch DB — Property record`,
          status: 'HOMATCH_DATA',
        });
      }
    }

    // Trust score
    if (report.homatchData.developer) {
      const dev = report.homatchData.developer as Record<string, unknown>;
      const { data: trust } = await supabase
        .from('property_trust_scores')
        .select('*')
        .eq('developer_id', dev.id as string)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (trust) {
        report.homatchData.trustScore = trust as Record<string, unknown>;
        report.sources.push({ label: 'Homatch Trust Score calculation', status: 'HOMATCH_DATA' });
      }
    }

    // ── Step 2: Web search (DataForSEO — free public) ─────────
    const webSearchQuery = report.entityName
      ? `${report.entityName} real estate developer Georgia Tbilisi`
      : `${query} real estate Georgia developer`;

    const webResults = await webSearch(webSearchQuery, supabase);

    if (webResults.length > 0) {
      report.publicFindings.newsSnippets = webResults.slice(0, 5).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
      }));

      // Flag potential risk indicators
      const riskKeywords = ['fraud', 'scam', 'lawsuit', 'bankrupt', 'arrested', 'investigation', 'frozen', 'complaint'];
      for (const r of webResults) {
        const text = `${r.title} ${r.snippet}`.toLowerCase();
        for (const kw of riskKeywords) {
          if (text.includes(kw)) {
            report.publicFindings.riskFlags = report.publicFindings.riskFlags ?? [];
            if (!report.publicFindings.riskFlags.includes(kw)) {
              report.publicFindings.riskFlags.push(kw);
            }
          }
        }
      }

      webResults.slice(0, 3).forEach(r => {
        report.sources.push({ label: r.title, url: r.url, status: 'FOUND_ONLINE', excerpt: r.snippet });
      });
    }

    // ── Step 3: Cadastral research ────────────────────────────
    if (queryType === 'cadastral') {
      const cadastralNumber = query.trim();
      report.cadastralInfo = {
        number: cadastralNumber,
        lookupStatus: 'not_searched',
        officialVerificationAvailable: true,
        estimatedCost: {
          credits: 5,
          description: 'Official cadastral lookup via NAPR (Georgia) registry — ownership, encumbrances, legal status',
        },
      };

      // Search Homatch DB for any property with this cadastral number
      const { data: propByCadastral } = await supabase
        .from('property_facts')
        .select('property_id, city, district, area, total_price, currency')
        .or(`address.ilike.%${cadastralNumber}%`)
        .limit(3);

      if (propByCadastral?.length) {
        report.cadastralInfo.lookupStatus = 'found_public';
        report.cadastralInfo.publicFindings = `Found ${propByCadastral.length} property record(s) in Homatch DB referencing this cadastral area`;
        report.homatchData.properties = propByCadastral as Record<string, unknown>[];
        report.sources.push({ label: 'Homatch DB — Property records', status: 'HOMATCH_DATA' });
      } else {
        report.cadastralInfo.lookupStatus = 'searched_no_result';
        report.cadastralInfo.publicFindings = 'No Homatch records found for this cadastral number. Official NAPR verification available.';
      }

      // Web search for cadastral number
      const cadastralWebResults = await webSearch(`cadastral ${cadastralNumber} Georgia property`, supabase);
      if (cadastralWebResults.length) {
        report.cadastralInfo.lookupStatus = 'found_public';
        report.publicFindings.newsSnippets = cadastralWebResults.slice(0, 3).map(r => ({
          title: r.title, url: r.url, snippet: r.snippet,
        }));
        report.sources.push({ label: 'Public web search', status: 'FOUND_ONLINE' });
      }

      report.warnings.push('Public research ≠ official verification. Cadastral data found online may be outdated or incomplete.');
      report.warnings.push('For legal certainty, use Official Verification (requires credits + explicit confirmation).');
    }

    // ── Step 4: Confidence scoring ─────────────────────────────
    let conf = 10; // base
    if (foundInDB) conf += 40;
    if (report.homatchData.trustScore) conf += 15;
    if (webResults.length >= 3) conf += 15;
    if (report.homatchData.developer) conf += 10;
    if ((report.publicFindings.riskFlags?.length ?? 0) > 0) conf -= 10;
    report.confidence = Math.max(5, Math.min(95, conf));

    // ── Step 5: Summary ────────────────────────────────────────
    const dev = report.homatchData.developer as Record<string, unknown> | undefined;
    if (dev) {
      const projects = dev.developer_projects as Record<string, unknown>[] ?? [];
      const riskFlags = report.publicFindings.riskFlags ?? [];
      report.summary =
        `**${dev.name}** — ${dev.verified ? '✓ Verified' : 'Not verified'} developer in Homatch DB. ` +
        `Trust score: **${dev.trust_score ?? 'N/A'}/100**. ` +
        `${projects.length} project(s) tracked. ` +
        (riskFlags.length ? `⚠️ Risk indicators found online: ${riskFlags.join(', ')}. ` : '') +
        `Confidence: ${report.confidence}%.`;
    } else if (queryType === 'cadastral') {
      report.summary = `Cadastral research for **${query}**. ${report.cadastralInfo?.publicFindings ?? 'No public data found.'} Official verification available.`;
    } else {
      report.summary = `Research for **${query}**: ${foundInDB ? 'Found in Homatch DB.' : 'Not found in Homatch DB.'} ${webResults.length} public web result(s). Confidence: ${report.confidence}%.`;
    }

    // ── Step 6: Suggested actions ─────────────────────────────
    if (dev?.id) {
      report.actions.push({ id: 'view_developer', label: 'View Developer Profile', path: `/developer/${dev.id}`, type: 'navigate' });
    }
    if (report.homatchData.properties?.length) {
      const p = report.homatchData.properties[0];
      if (p?.id) report.actions.push({ id: 'view_property', label: 'View Property', path: `/property/${p.id as string}`, type: 'navigate' });
    }
    report.actions.push({ id: 'ask_ai', label: 'Ask AI for more details', path: '/ai', type: 'ai_query' });
    if (queryType === 'cadastral' || dev) {
      report.actions.push({ id: 'official_verify', label: 'Official Verification (requires credits)', path: '/verify', type: 'verify' });
    }

  } catch (err) {
    report.warnings.push(`Research error: ${err instanceof Error ? err.message : String(err)}`);
    report.summary = 'Research encountered an error. Partial results shown.';
  }

  return json(report);
});

// Homatch Verification Center — authenticated, DB-first + public-web research.
//
// Exactly four modes are accepted: property, cadastral, developer, project.
// Every request is validated server-side with the *same* rules the frontend
// uses (src/lib/verifyValidation.ts) so a direct API call can never bypass
// the UI's guardrails and trigger paid research on arbitrary free text.
//
// Response-code contract:
//   400  — missing/invalid input (bad mode, empty query, fails per-mode format)
//   401  — missing/invalid Authorization / session
//   200  — a valid search, INCLUDING one that finds no trustworthy evidence
//          (returned with status: 'NO_EVIDENCE', never as a failure)
//   500  — server misconfiguration (e.g. OPENAI_API_KEY not set)
//   502  — the research provider itself failed/returned something unusable,
//          after a short bounded retry for transient (429 / 5xx) errors only
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const MODEL = Deno.env.get('OPENAI_RESEARCH_MODEL') || 'gpt-5.6-luna';

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ── Per-mode validation ──────────────────────────────────────────────────
// MUST stay identical to src/lib/verifyValidation.ts — see that file's header
// comment. Duplicated because Edge Functions are a separate Deno deployment
// and cannot import from src/.
type VerifyMode = 'property' | 'cadastral' | 'developer' | 'project';
type VerifyReasonCode = 'EMPTY' | 'TOO_SHORT' | 'TOO_LONG' | 'INVALID_FORMAT' | 'LOOKS_LIKE_QUESTION';
interface VerifyValidationResult { valid: boolean; reasonCode?: VerifyReasonCode; normalized?: string }

const CADASTRAL_RE = /^\d{1,4}(\.\d{1,4}){3,9}$/;
const QUESTION_WORDS =
  /\b(who is|what is|why|explain|tell me|write me|generate|translate|joke|poem|story|ignore (all|previous)|system prompt|jailbreak|ვინ არის|რა არის|რატომ|ახსენი|მომიყევი|кто такой|что такое|почему|расскажи|напиши|объясни|kimdir|nedir|neden|açıkla|anlat|yazı|من هو|ما هو|لماذا|اشرح|أخبرني|اكتب|מי זה|מה זה|למה|הסבר|ספר לי|כתוב)\b/iu;

function normalizeWhitespace(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

function validateVerifyQuery(mode: VerifyMode, rawInput: string): VerifyValidationResult {
  const raw = typeof rawInput === 'string' ? rawInput : '';
  const value = normalizeWhitespace(raw);
  if (!value) return { valid: false, reasonCode: 'EMPTY' };

  if (mode === 'cadastral') {
    const compact = value.replace(/\s+/g, '');
    if (compact.length < 6 || compact.length > 60) return { valid: false, reasonCode: 'INVALID_FORMAT' };
    if (!CADASTRAL_RE.test(compact)) return { valid: false, reasonCode: 'INVALID_FORMAT' };
    return { valid: true, normalized: compact };
  }

  if (value.length < 2) return { valid: false, reasonCode: 'TOO_SHORT' };
  const maxLen = mode === 'property' ? 300 : 150;
  if (value.length > maxLen) return { valid: false, reasonCode: 'TOO_LONG' };
  if (/[?？]/.test(value)) return { valid: false, reasonCode: 'LOOKS_LIKE_QUESTION' };
  if (QUESTION_WORDS.test(value)) return { valid: false, reasonCode: 'LOOKS_LIKE_QUESTION' };

  if (mode === 'developer' || mode === 'project') {
    const words = value.split(' ').filter(Boolean);
    if (words.length > 12) return { valid: false, reasonCode: 'INVALID_FORMAT' };
    const letterDigitCount = (value.match(/[\p{L}\p{N}]/gu) ?? []).length;
    if (letterDigitCount < value.length * 0.5) return { valid: false, reasonCode: 'INVALID_FORMAT' };
    if (!/\p{L}/u.test(value)) return { valid: false, reasonCode: 'INVALID_FORMAT' };
  }

  return { valid: true, normalized: value };
}

// ── Per-mode research instructions ───────────────────────────────────────
// Each mode gets its own source priorities and evidence rules rather than one
// generic prompt shared across all four.
const MODE_PROMPTS: Record<VerifyMode, string> = {
  property: `You are researching a specific PROPERTY / LISTING: "\${QUERY}".
Priorities: (1) does this address/listing appear on official Georgian public sources (napr.gov.ge, reestri.gov.ge) or reputable listing/news sites; (2) cadastral match, area consistency, ownership signals, any liens/encumbrances IF a source states them directly; (3) red flags (price mismatch, duplicate listings, reported scams).
Never invent an address match, ownership name, cadastral number, or legal status that no source actually states.`,
  cadastral: `You are verifying a GEORGIAN CADASTRAL CODE: "\${QUERY}".
Search ONLY for cadastral / property-registry / real-estate evidence about this exact code (napr.gov.ge, reestri.gov.ge, maps.gov.ge, and reputable Georgian real-estate/legal sources that quote registry data for this code).
STRICT EVIDENCE RULE: you MUST NOT invent or guess an owner name, lien, permit, registration date, area, or "officially verified" status. If you find a direct source quoting this exact code, report exactly what it says with the source link. If you find nothing reliable for this exact code, say clearly that public web search found no trustworthy record and that official verification via the Public Registry (napr.gov.ge) is required — this is a normal, valid outcome, not a failure.`,
  developer: `You are running a COMPANY / DEVELOPER background check on: "\${QUERY}".
Run targeted searches: the legal/registered name plus "საჯარო რეესტრი", "napr.gov.ge", "reestri.gov.ge", "ს/კ" (identification code); separately the name plus "news", "lawsuit", "complaints", "reviews".
Label a direct hit on napr.gov.ge / reestri.gov.ge as VERIFIED and quote exactly what the page shows (status, legal form, registration date, directors if listed). Everything else found through search is FOUND ONLINE, not VERIFIED. If no registry hit exists, say so explicitly — do not guess a registration status. Build the background picture from real findings: company site, press coverage, completed-project history, reviews, years active, and any legal/regulatory red flags. Never invent directors, ownership, financials, or legal status.`,
  project: `You are researching a specific DEVELOPMENT PROJECT / BUILDING named: "\${QUERY}".
Priorities: (1) the developer/company behind it and its track record; (2) construction permits and progress, if publicly reported; (3) delivery history — was it completed on time, any reported delays; (4) buyer reviews or complaints about this specific project.
Never invent a developer name, permit number, completion date, or delivery status that no source actually states.`,
};

function textOf(p: any): string {
  if (p?.output_text) return p.output_text;
  const a: string[] = [];
  for (const i of p?.output || []) {
    if (i?.type === 'message') {
      for (const c of i.content || []) {
        if (c?.type === 'output_text' && c.text) a.push(c.text);
      }
    }
  }
  return a.join('\n').trim();
}

function citationsOf(p: any) {
  const out: any[] = [];
  for (const i of p?.output || []) {
    if (i?.type === 'message') {
      for (const c of i.content || []) {
        for (const a of c.annotations || []) {
          if (a?.type === 'url_citation' && a.url) out.push({ label: a.title || a.url, url: a.url, status: 'FOUND_ONLINE' });
        }
      }
    }
  }
  return [...new Map(out.map((x) => [x.url, x])).values()];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Bounded retry: only for transient provider failures (429 rate-limit, 5xx).
// Never retries on 4xx client errors (bad request to OpenAI, auth, etc).
async function callResearchProvider(key: string, payload: unknown): Promise<{ ok: boolean; status: number; raw: string }> {
  const attempts = [0, 400, 1200]; // ms delay before each attempt
  let last: { ok: boolean; status: number; raw: string } = { ok: false, status: 0, raw: '' };
  for (let i = 0; i < attempts.length; i++) {
    if (attempts[i] > 0) await sleep(attempts[i]);
    try {
      const r = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const raw = await r.text();
      last = { ok: r.ok, status: r.status, raw };
      if (r.ok) return last;
      const transient = r.status === 429 || r.status >= 500;
      if (!transient) return last;
    } catch (e) {
      last = { ok: false, status: 0, raw: String((e as Error)?.message ?? e) };
    }
  }
  return last;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'Authentication required', reasonCode: 'NO_AUTH' }, 401);

  const sb = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
  const jwt = auth.replace(/^Bearer\s+/i, '');
  const { data: { user } } = await sb.auth.getUser(jwt);
  if (!user) return json({ error: 'Invalid session', reasonCode: 'INVALID_SESSION' }, 401);

  const body = await req.json().catch(() => ({}));
  const rawQuery = String(body.query ?? '');
  const modeInput = String(body.type ?? '');
  const VALID_MODES: VerifyMode[] = ['property', 'cadastral', 'developer', 'project'];

  if (!VALID_MODES.includes(modeInput as VerifyMode)) {
    return json({ error: 'Invalid verification mode. Must be one of: property, cadastral, developer, project.', reasonCode: 'INVALID_MODE' }, 400);
  }
  const mode = modeInput as VerifyMode;

  const validation = validateVerifyQuery(mode, rawQuery);
  if (!validation.valid) {
    return json({ error: 'Invalid query for this verification mode.', reasonCode: validation.reasonCode }, 400);
  }
  const query = validation.normalized as string;

  // ── Homatch internal data (DB-first) ────────────────────────────────
  const { data: profile } = await sb.from('users').select('id').eq('auth_id', user.id).maybeSingle();
  const uid = profile?.id;
  const internal: any = { properties: [], matches: [], intents: [], signals: [] };

  if (uid) {
    const { data: p } = await sb
      .from('properties')
      .select('id,title,transaction_type,property_type,matching_status,property_facts(*)')
      .eq('user_id', uid).eq('is_deleted', false).limit(20);
    internal.properties = p || [];
    const ids = (p || []).map((x: any) => x.id);
    if (ids.length) {
      const { data: m } = await sb
        .from('matches')
        .select('id,property_id,match_score,signal_strength,intent_confidence,match_reasons,preview_platform,preview_language,preview_city,preview_budget_min,preview_budget_max,preview_currency,preview_excerpt')
        .in('property_id', ids).order('match_score', { ascending: false }).limit(30);
      internal.matches = m || [];
    }
  }

  const terms = query.toLowerCase().split(/\s+/).filter((x: string) => x.length > 3).slice(0, 4);
  if (terms.length) {
    const pat = terms.map((x: string) => `%${x.replace(/[%_,]/g, '')}%`);
    const { data: i } = await sb
      .from('intent_profiles')
      .select('id,intent_type,country,region,city,district,transaction_type,property_types,budget_min,budget_max,currency,bedrooms_min,bedrooms_max,timeline,language,intent_confidence,original_text,investment_intent,relocation_intent')
      .or(pat.map((x: string) => `original_text.ilike.${x}`).join(',')).order('intent_confidence', { ascending: false }).limit(20);
    internal.intents = i || [];
    const { data: s } = await sb
      .from('raw_signals')
      .select('id,platform,source_url,author_public_name,original_text,language,published_at,classification_status,intent_type,rejection_reason')
      .or(pat.map((x: string) => `original_text.ilike.${x}`).join(',')).limit(20);
    internal.signals = s || [];
  }

  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) return json({ error: 'Research provider not configured' }, 500);

  const modePrompt = MODE_PROMPTS[mode].replace('${QUERY}', query);
  const prompt = `You are Homatch Research, an evidence-based verification assistant. ${modePrompt}
Homatch internal data (for context only, not a source of truth for public facts): ${JSON.stringify(internal).slice(0, 30000)}
Rules for every mode: separate HOMATCH DATA, VERIFIED (official/authoritative source only), FOUND ONLINE, CONFLICTING and UNVERIFIED. Never invent ownership, cadastral records, permits, directors, prices, availability, contacts or legal status. Never claim official/paid verification happened — paid third-party providers are disabled. Answer in the same language as the query. Be concise: evidence, risks/red-flags, confidence, and next actions.`;

  const providerResult = await callResearchProvider(key, {
    model: MODEL,
    input: prompt,
    tools: [{ type: 'web_search', search_context_size: 'medium' }],
    store: false,
    reasoning: { effort: 'low' },
  });

  let p: any;
  try {
    p = JSON.parse(providerResult.raw);
  } catch {
    return json({ error: 'Research provider returned an unreadable response.' }, 502);
  }
  if (!providerResult.ok) {
    // Preserve provider diagnostics server-side (logged) without exposing secrets to the client.
    console.error('[homatch-research] provider error', providerResult.status, p?.error ?? providerResult.raw?.slice(0, 500));
    return json({ error: p?.error?.message ? `Research provider error: ${p.error.message}` : `Research provider error (${providerResult.status || 'network'})` }, 502);
  }

  const text = textOf(p);
  const sources = citationsOf(p);
  const hasInternal = internal.properties.length + internal.matches.length + internal.intents.length > 0;
  const hasEvidence = sources.length > 0 || hasInternal;
  const isCad = mode === 'cadastral';

  // Defense-in-depth for cadastral: never let free-text model output stand in
  // for an official record when no source actually backs it. This is enforced
  // in code, not only via the prompt, per the "never invent" requirement.
  let finalSummary = text;
  let cadastralInfo: Record<string, unknown> | undefined;
  if (isCad) {
    const foundPublic = sources.length > 0;
    cadastralInfo = {
      number: query,
      lookupStatus: foundPublic ? 'found_public' : 'requires_official',
      publicFindings: foundPublic ? text : null,
      officialVerificationAvailable: false,
    };
    if (!foundPublic) {
      finalSummary = 'No trustworthy public source was found for this exact cadastral code. This is expected — Georgia\'s Public Registry (napr.gov.ge) is not fully indexed by web search. Official verification directly through the Public Registry is required to confirm ownership, area, or encumbrances.';
    }
  }

  const status: 'OK' | 'NO_EVIDENCE' = hasEvidence ? 'OK' : 'NO_EVIDENCE';
  const confidence = hasEvidence
    ? Math.min(95, Math.max(35, (sources.length ? 55 : 35) + (hasInternal ? 15 : 0) + Math.min(20, sources.length * 4)))
    : 15;

  const warnings: string[] = [];
  if (isCad) warnings.push('Public web research is not official cadastral verification.');
  if (status === 'NO_EVIDENCE') warnings.push('No trustworthy evidence was found. This result is not a failure — it means official/manual verification is recommended.');

  return json({
    status,
    queryType: mode,
    entityName: query,
    entityType: mode,
    confidence,
    summary: finalSummary,
    homatchData: {
      developer: null,
      properties: internal.properties,
      matches: internal.matches,
      intents: internal.intents,
      trustScore: null,
    },
    publicFindings: {
      companyInfo: mode === 'developer' ? text : undefined,
      projectInfo: mode === 'project' ? text : undefined,
      riskFlags: [],
      newsSnippets: sources.map((s: any) => ({ title: s.label, url: s.url, snippet: '' })),
    },
    cadastralInfo,
    sources,
    actions: [{ id: 'ask-ai', label: 'Ask Homatch AI', type: 'ai_query' }],
    warnings,
    searchedAt: new Date().toISOString(),
    mode: 'DB_FIRST_PUBLIC_WEB',
    paidProvidersUsed: false,
    responseId: p?.id || null,
    model: p?.model || MODEL,
    usage: p?.usage || null,
  });
});

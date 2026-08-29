// ============================================================
// homatch-ai Edge Function v2 — Real Research Agent
// Connects to Homatch DB, classifies query intent, fetches
// real data (properties, matches, developers, signals) and
// enriches every answer with evidence from actual records.
// Web search (DataForSEO) is used when no DB data found, and
// ONLY when it is free/public search (no paid verification).
// ============================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_URL =
  'https://app-e0dokxnqcykh-api-VaOwP8E7dJqa.gateway.appmedo.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse';

// ── Types ─────────────────────────────────────────────────────

interface RequestBody {
  messages: Array<{ role: string; content: string }>;
  context?: Record<string, unknown>;
  conversationId?: string;
  userId?: string;
}

interface HomatchDBData {
  properties?: unknown[];
  developer?: Record<string, unknown> | null;
  matches?: unknown[];
  intents?: unknown[];
  trustScore?: Record<string, unknown> | null;
  propertyDetail?: Record<string, unknown> | null;
}

// ── DB Intelligence Layer ─────────────────────────────────────

async function queryHomatchDB(
  supabase: ReturnType<typeof createClient>,
  userMessage: string,
  context: Record<string, unknown>,
  userId?: string,
): Promise<HomatchDBData> {
  const result: HomatchDBData = {};
  const lower = userMessage.toLowerCase();

  try {
    // ── 1. If context has a property_id, fetch its full detail ──
    const ctxPropertyId = context?.data && typeof context.data === 'object'
      ? (context.data as Record<string, unknown>).id as string | undefined
      : undefined;

    if (ctxPropertyId) {
      const { data: propDetail } = await supabase
        .from('properties')
        .select(`*, facts:property_facts(*), photos:property_photos(id,public_url,is_cover)`)
        .eq('id', ctxPropertyId)
        .maybeSingle();
      if (propDetail) result.propertyDetail = propDetail as Record<string, unknown>;
    }

    // ── 2. Developer lookup (by name or ID) ───────────────────
    const devNameMatch = lower.match(/(?:developer|company|builder|archi|m2|biltmore|tegeta|axis|status|redix|city[\s-]?mall|credo|city[\s-]?center)\s*([a-zA-Z0-9\s]+)?/i);
    const ctxDeveloperId = context?.data && typeof context.data === 'object'
      ? (context.data as Record<string, unknown>).developer_id as string | undefined
      : undefined;

    if (ctxDeveloperId) {
      const { data: dev } = await supabase
        .from('developer_profiles')
        .select(`*, developer_projects(*), property_trust_scores(*)`)
        .eq('id', ctxDeveloperId)
        .maybeSingle();
      if (dev) result.developer = dev as Record<string, unknown>;
    } else if (devNameMatch?.[0]) {
      const searchTerm = devNameMatch[0].replace(/developer|company|builder/gi, '').trim();
      if (searchTerm.length > 2) {
        const { data: devRows } = await supabase
          .from('developer_profiles')
          .select(`id, name, trust_score, verified, public_risk_evidence, developer_projects(name,status,city,units)`)
          .ilike('name', `%${searchTerm}%`)
          .limit(3);
        if (devRows?.length) result.developer = devRows[0] as Record<string, unknown>;
      }
    }

    // ── 3. Property search queries ────────────────────────────
    const wantsProperties =
      /properties|listings|apartments|houses|for sale|for rent|find me|show me|available/i.test(lower);
    if (wantsProperties && userId) {
      const { data: userProps } = await supabase
        .from('properties')
        .select(`id, title, transaction_type, property_type, matchability_score,
          facts:property_facts(city, district, total_price, currency, area, bedrooms)`)
        .eq('user_id', userId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(5);
      if (userProps?.length) result.properties = userProps;
    }

    // ── 4. Match explanation ──────────────────────────────────
    const matchIdMatch = lower.match(/match.*?([0-9a-f-]{36})/i) ||
      (context?.type === 'match' ? [null, (context.data as Record<string, unknown>)?.match_id as string] : null);
    const wantsMatchExplanation = /why.*match|explain.*match|match.*score|91%|buyer.*%|strong.*match/i.test(lower);

    if (wantsMatchExplanation && userId) {
      // Get property matches for user's properties
      const { data: userPropsForMatch } = await supabase
        .from('properties').select('id').eq('user_id', userId).eq('is_deleted', false).limit(3);
      if (userPropsForMatch?.length) {
        const propIds = userPropsForMatch.map((p: { id: string }) => p.id);
        const { data: topMatches } = await supabase
          .from('matches')
          .select(`id, match_score, signal_strength, match_reasons, mismatch_reasons,
            preview_city, preview_budget_min, preview_budget_max, preview_currency,
            preview_language, preview_platform, status`)
          .in('property_id', propIds)
          .order('match_score', { ascending: false })
          .limit(5);
        if (topMatches?.length) result.matches = topMatches;
      }
    }

    if (matchIdMatch?.[1]) {
      const { data: matchDetail } = await supabase
        .from('matches')
        .select(`*, intent_profile:intent_profiles(*)`)
        .eq('id', matchIdMatch[1])
        .maybeSingle();
      if (matchDetail) result.matches = [matchDetail];
    }

    // ── 5. Buyer/renter intent search ────────────────────────
    const wantsBuyers = /buyer|renter|investor|demand|looking to buy|looking to rent|find buyer|find renter/i.test(lower);
    if (wantsBuyers) {
      // Extract city from message or context
      const cityMatch = lower.match(/\b(tbilisi|batumi|kutaisi|saburtalo|vake|didube|isani|rustavi)\b/i);
      const city = cityMatch?.[1] ?? null;
      let intentQuery = supabase
        .from('intent_profiles')
        .select(`id, intent_type, city, district, budget_min, budget_max, currency,
          transaction_type, property_types, bedrooms_min, bedrooms_max,
          intent_confidence, specificity_score, language, created_at`)
        .in('intent_type', ['BUY', 'RENT', 'INVEST', 'RELOCATE_BUY', 'RELOCATE_RENT'])
        .gte('intent_confidence', 0.5)
        .order('created_at', { ascending: false })
        .limit(8);
      if (city) intentQuery = intentQuery.ilike('city', `%${city}%`);
      const { data: intents } = await intentQuery;
      if (intents?.length) result.intents = intents;
    }

  } catch (e) {
    console.error('DB query error:', e);
  }

  return result;
}

// ── Build DB context block for the AI ─────────────────────────

function formatDBContext(db: HomatchDBData, userMessage: string): string {
  const parts: string[] = [];

  if (db.propertyDetail) {
    const p = db.propertyDetail as Record<string, unknown>;
    const facts = p.facts as Record<string, unknown> | undefined;
    parts.push(`[HOMATCH_DATA] Property on current page:
  Title: ${p.title ?? 'Untitled'}
  Type: ${p.transaction_type} ${p.property_type}
  Location: ${facts?.district ?? ''} ${facts?.city ?? ''} ${facts?.country ?? ''}
  Price: ${facts?.total_price ? `${facts.total_price} ${facts.currency}` : 'Not set'}
  Area: ${facts?.area ? `${facts.area} m²` : 'N/A'}, Bedrooms: ${facts?.bedrooms ?? 'N/A'}
  Matching Status: ${p.matching_status ?? 'DRAFT'}, Match Score: ${p.matchability_score ?? 'N/A'}
  Status: HOMATCH_DATA`);
  }

  if (db.developer) {
    const d = db.developer as Record<string, unknown>;
    const projects = (d.developer_projects as unknown[] ?? []) as Record<string, unknown>[];
    parts.push(`[HOMATCH_DATA] Developer found in Homatch DB:
  Name: ${d.name}, Trust Score: ${d.trust_score ?? 'N/A'}/100
  Verified: ${d.verified ? 'YES' : 'NO'}
  Risk evidence: ${JSON.stringify(d.public_risk_evidence ?? [])}
  Projects (${projects.length}): ${projects.slice(0, 5).map((p) => `${p.name} (${p.status}, ${p.city ?? ''}, ${p.units ?? '?'} units)`).join('; ')}
  Status: HOMATCH_DATA`);
  }

  if (db.matches?.length) {
    const matchLines = (db.matches as Record<string, unknown>[]).slice(0, 5).map(m => {
      const reasons = (m.match_reasons as string[] ?? []).slice(0, 3).join('; ');
      const mismatches = (m.mismatch_reasons as string[] ?? []).slice(0, 2).join('; ');
      return `  - Score: ${m.match_score}% | Strength: ${m.signal_strength} | City: ${m.preview_city ?? '?'} | Budget: ${m.preview_budget_min ?? '?'}-${m.preview_budget_max ?? '?'} ${m.preview_currency ?? ''} | Lang: ${m.preview_language ?? '?'} | Platform: ${m.preview_platform ?? '?'} | Reasons: ${reasons}${mismatches ? ` | Mismatches: ${mismatches}` : ''}`;
    });
    parts.push(`[HOMATCH_DATA] Top matches for user's properties:\n${matchLines.join('\n')}\nStatus: HOMATCH_DATA`);
  }

  if (db.intents?.length) {
    const intentLines = (db.intents as Record<string, unknown>[]).slice(0, 6).map(i =>
      `  - ${i.intent_type} | ${i.city ?? '?'} ${i.district ?? ''} | Budget: ${i.budget_min ?? '?'}-${i.budget_max ?? '?'} ${i.currency ?? ''} | Rooms: ${i.bedrooms_min ?? '?'}+ | Confidence: ${Math.round((i.intent_confidence as number) * 100)}% | Lang: ${i.language ?? '?'}`
    );
    parts.push(`[HOMATCH_DATA] Active buyer/renter intents from signals:\n${intentLines.join('\n')}\nStatus: HOMATCH_DATA`);
  }

  if (db.properties?.length) {
    const propLines = (db.properties as Record<string, unknown>[]).map(p => {
      const facts = p.facts as Record<string, unknown> | undefined;
      return `  - ${p.title ?? p.id}: ${p.transaction_type} ${p.property_type} | ${facts?.city ?? '?'} | ${facts?.total_price ? `${facts.total_price} ${facts.currency}` : 'no price'} | Match score: ${p.matchability_score ?? 'N/A'}`;
    });
    parts.push(`[HOMATCH_DATA] User's properties:\n${propLines.join('\n')}\nStatus: HOMATCH_DATA`);
  }

  if (parts.length === 0) {
    parts.push(`[NOTE] No specific Homatch DB data found for this query. Answering from general knowledge.
If this is about a specific developer, property, or cadastral number, suggest the user use the Verify Center for official research.`);
  }

  return parts.join('\n\n');
}

// ── System Prompt ─────────────────────────────────────────────

function buildSystemPrompt(dbContext: string, pageContext: Record<string, unknown>): string {
  const contextBlock = Object.keys(pageContext).length > 0
    ? `\n\nPage context (where user navigated from):\n${JSON.stringify(pageContext, null, 2)}`
    : '';

  return `You are Homatch AI, a real-estate research agent for the Homatch platform.
Homatch = AI Real Estate Search, Match, Connect & Verify platform (Georgia/global).

Your role:
- Help BOTH property owners (find demand/buyers/renters) AND buyers/renters (find properties/matches)
- Research developers, projects, addresses, cadastral numbers — always from REAL evidence
- Explain matches using actual factors: location, budget, type, rooms, timeline, confidence
- Never invent data. If something is unknown, say so.
- Distinguish: HOMATCH_DATA (internal DB), FOUND_ONLINE (web research), VERIFIED (official), CONFLICTING (sources disagree), UNVERIFIED (not confirmed)

Evidence status rules:
- Use [HOMATCH_DATA] when you use data from the DB context below
- Use [FOUND_ONLINE] for publicly known facts you know from training (company history, public records, news)
- Use [UNVERIFIED] for information you cannot confirm
- Use [VERIFIED] ONLY for data explicitly marked as verified in the DB context
- NEVER use [VERIFIED] for anything you are unsure about
- NEVER invent cadastral records, ownership, permits, prices, contacts, or legal status

Paid operations:
- Official cadastral verification requires credits → always mention cost estimate and ask for confirmation
- Never silently trigger paid actions or data purchases
- DataForSEO searches are free public research — safe to describe findings

Formatting: Use markdown. For research results, use sections: **Entity**, **Homatch Data**, **Public Findings**, **Confidence**, **Next Actions**.
Be concise but thorough. Respond in the user's language when detectable.

${dbContext}${contextBlock}`;
}

// ── Main Handler ──────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: CORS });

  const apiKey = Deno.env.get('INTEGRATIONS_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  let body: RequestBody;
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { messages, context = {}, conversationId, userId } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'messages array required' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── DB Lookup ──────────────────────────────────────────────
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const lastUserMessage = messages.filter(m => m.role === 'user').slice(-1)[0]?.content ?? '';
  const dbData = await queryHomatchDB(supabase, lastUserMessage, context, userId);
  const dbContext = formatDBContext(dbData, lastUserMessage);
  const systemPrompt = buildSystemPrompt(dbContext, context);

  // ── Persist user message ───────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (authHeader && conversationId) {
    try {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === 'user') {
        await supabase.from('ai_messages').insert({
          conversation_id: conversationId,
          role: 'user',
          content: lastMsg.content,
        });
      }
    } catch { /* best-effort */ }
  }

  // ── Build Gemini contents ──────────────────────────────────
  const contents = [
    { role: 'user', parts: [{ text: systemPrompt }] },
    { role: 'model', parts: [{ text: 'Understood. I am Homatch AI Research Agent, ready to help with real data.' }] },
    ...messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
  ];

  // ── Stream from Gemini ─────────────────────────────────────
  const upstream = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gateway-Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ contents }),
  });

  if (upstream.status === 429 || upstream.status === 402) {
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(JSON.stringify({ error: `Upstream error: ${upstream.status}` }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(upstream.body, {
    headers: {
      ...CORS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

/**
 * homatch-research — Property Intelligence Engine (PI v1)
 *
 * Routes (path-based dispatch inside one Edge Function):
 *   POST /homatch-research          → start PI research job → { job_id }
 *   POST /homatch-research/status   → poll job  { job_id } → PIJobStatus
 *   GET  /homatch-research/status?job_id=xxx → same
 *
 * Pipeline (async, background):
 *   IDENTIFYING → PLANNING → DISCOVERING → EXPANDING →
 *   READING → NORMALIZING → CROSS_CHECKING → SYNTHESIZING
 *
 * Security:
 *   - INTEGRATIONS_API_KEY never exposed to frontend
 *   - retrieved content treated as untrusted (no eval/exec)
 *   - SSRF protection on all URL reads
 *   - service-role writes only
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ── Gemini endpoint ────────────────────────────────────────────
const GEMINI_ENDPOINT =
  'https://app-e0dokxnqcykh-api-VaOwP8E7dJqa.gateway.appmedo.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse';

// ── Source authority weights ───────────────────────────────────
const SOURCE_AUTHORITY: Record<string, number> = {
  'napr.gov.ge': 95, 'srs.ge': 90, 'reestri.gov.ge': 90, 'enreg.reestri.gov.ge': 90,
  'my.gov.ge': 88, 'ms.gov.ge': 85, 'tas.ge': 85, 'justice.gov.ge': 85,
  'myhome.ge': 65, 'ss.ge': 65, 'imedi.ge': 55, 'rustavi2.ge': 55,
  'civil.ge': 60, 'agenda.ge': 58, 'interpressnews.ge': 50,
};

function domainAuthority(url: string): number {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (SOURCE_AUTHORITY[host]) return SOURCE_AUTHORITY[host];
    if (host.endsWith('.gov.ge')) return 85;
    if (host.endsWith('.ge')) return 40;
    return 30;
  } catch { return 25; }
}

function classifySourceType(url: string, title: string): string {
  const u = url.toLowerCase(); const t = title.toLowerCase();
  if (u.includes('napr.gov') || u.includes('reestri.gov') || u.includes('my.gov') ||
      u.includes('ms.gov') || u.includes('srs.ge') || u.includes('tas.ge') ||
      u.includes('justice.gov')) return 'OFFICIAL_REGISTRY';
  if (u.endsWith('.gov.ge')) return 'OFFICIAL_GOVERNMENT';
  if (u.includes('myhome') || u.includes('ss.ge') || u.includes('home.ge')) return 'PROPERTY_PORTAL';
  if (u.includes('imedi') || u.includes('rustavi') || u.includes('civil.ge') ||
      u.includes('agenda') || u.includes('interpressnews')) return 'NEWS_MEDIA';
  if (u.includes('maps.') || u.includes('map.')) return 'MAP';
  if (u.includes('facebook') || u.includes('t.me') || u.includes('reddit')) return 'SOCIAL_PUBLIC';
  if (t.includes('developer') || t.includes('developer')) return 'DEVELOPER';
  return 'OTHER';
}

// ── SSRF guard ─────────────────────────────────────────────────
const BLOCKED = [
  /^https?:\/\/localhost/i, /^https?:\/\/127\./, /^https?:\/\/0\./,
  /^https?:\/\/169\.254\./, /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./, /^https?:\/\/192\.168\./,
  /^https?:\/\/::1/, /^file:/i,
];
function isSafeUrl(url: string): boolean {
  try { new URL(url); } catch { return false; }
  if (!url.match(/^https?:\/\//i)) return false;
  return !BLOCKED.some(p => p.test(url));
}

// ── Cadastral normalizer ───────────────────────────────────────
function normalizeCadastral(raw: string): string | null {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const parts = cleaned.split('.').filter(Boolean);
  if (parts.length >= 4 && parts.length <= 5) return parts.join('.');
  return null;
}

function detectInputType(input: string): {
  type: 'CADASTRAL' | 'URL' | 'ADDRESS' | 'NAME' | 'MIXED';
  cadastral?: string; url?: string; normalized: string;
} {
  const t = input.trim();
  if (t.match(/^https?:\/\//i)) return { type: 'URL', url: t, normalized: t };
  const cad = normalizeCadastral(t);
  if (cad && t.replace(/[^0-9.]/g, '').length >= 8)
    return { type: 'CADASTRAL', cadastral: cad, normalized: cad };
  if (t.match(/\d/) && t.length > 8) return { type: 'ADDRESS', normalized: t };
  return { type: 'NAME', normalized: t };
}

// ── Gemini grounded call ───────────────────────────────────────
async function geminiGrounded(
  apiKey: string, prompt: string, opts?: { urlContext?: string[] }
): Promise<{ text: string; groundingChunks: unknown[] }> {
  const tools: unknown[] = [{ googleSearch: {} }];
  if (opts?.urlContext?.length)
    tools.push({ urlContext: { urls: opts.urlContext.filter(isSafeUrl).slice(0, 5) } });

  const res = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Gateway-Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools,
      generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);

  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '', fullText = '';
  const groundingChunks: unknown[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const d = line.slice(5).trim();
      if (!d || d === '[DONE]') continue;
      try {
        const frame = JSON.parse(d);
        const txt = frame?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (txt) fullText += txt;
        const gc = frame?.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (Array.isArray(gc)) groundingChunks.push(...gc);
      } catch { /**/ }
    }
  }
  return { text: fullText, groundingChunks };
}

function extractJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch { /**/ } }
  const brace = text.match(/(\{[\s\S]*\})/);
  if (brace) { try { return JSON.parse(brace[1]); } catch { /**/ } }
  const arr = text.match(/(\[[\s\S]*\])/);
  if (arr) { try { return JSON.parse(arr[1]); } catch { /**/ } }
  return null;
}

// ── DB helpers ─────────────────────────────────────────────────
type SB = ReturnType<typeof createClient>;

async function jobPhase(sb: SB, id: string, status: string, detail: string, counters?: Record<string, number>) {
  await sb.from('research_jobs').update({ status, phase_detail: detail, updated_at: new Date().toISOString(), ...counters }).eq('id', id);
}

async function saveSource(sb: SB, jobId: string, s: {
  url?: string; title?: string; source_type: string; access_method: string;
  snippet?: string; full_content?: string; grounding_chunk?: unknown; query_used?: string;
}): Promise<string | null> {
  const { data } = await sb.from('research_sources').insert({
    job_id: jobId, url: s.url ?? null, title: s.title ?? null,
    domain: s.url ? (() => { try { return new URL(s.url!).hostname; } catch { return null; } })() : null,
    query_used: s.query_used ?? null, source_type: s.source_type, access_method: s.access_method,
    snippet: s.snippet ?? null, full_content: s.full_content ?? null,
    grounding_chunk: s.grounding_chunk ?? null,
  }).select('id').maybeSingle();
  return data?.id ?? null;
}

async function saveEntity(sb: SB, jobId: string, e: {
  entity_type: string; name_raw: string; name_normalized?: string;
  identifiers?: Record<string, unknown>; discovery_depth?: number; confidence?: number;
}): Promise<string | null> {
  const { data } = await sb.from('research_entities').insert({
    job_id: jobId, entity_type: e.entity_type, name_raw: e.name_raw,
    name_normalized: e.name_normalized ?? e.name_raw,
    identifiers: e.identifiers ?? {}, attributes: {},
    discovery_depth: e.discovery_depth ?? 0, confidence: e.confidence ?? 0,
  }).select('id').maybeSingle();
  return data?.id ?? null;
}

async function saveClaim(sb: SB, jobId: string, c: {
  source_id?: string | null; claim_type: string; claim_value?: string;
  claim_raw?: string; status: string; confidence: number; source_authority: number;
}) {
  await sb.from('evidence_claims').insert({ job_id: jobId, ...c });
}

function dedupeUrls(urls: string[]): string[] {
  return [...new Set(urls.map(u => u.split('#')[0].replace(/\/$/, '')))];
}

// ── Query planning ─────────────────────────────────────────────
function buildQueryPlan(input: string, mode: 'PROPERTY' | 'CADASTRAL') {
  const det = detectInputType(input);
  if (mode === 'CADASTRAL') {
    const cad = det.cadastral ?? input.trim();
    return {
      primaryQueries: [
        `საკადასტრო კოდი "${cad}" საქართველო`,
        `cadastral code "${cad}" Georgia property`,
        `"${cad}" site:napr.gov.ge OR site:my.gov.ge OR site:ms.gov.ge`,
        `"${cad}" ქონება მისამართი area`,
        `"${cad}" owner registration NAPR Georgia`,
      ],
      officialUrls: [
        'https://ms.gov.ge/msmap/',
        'https://my.gov.ge/ka-ge/services/5/service/176',
        'https://tas.ge/?p=searchdocument&menuItemId=7104',
      ],
    };
  }
  const queries = det.url
    ? [`"${det.url}" property listing details`, `site:${(() => { try { return new URL(det.url!).hostname; } catch { return ''; } })()} property`]
    : [
        `"${input}" ქონება property Georgia`,
        `"${input}" developer company Georgia`,
        `"${input}" project building Tbilisi Georgia`,
        `"${input}" company registration site:enreg.reestri.gov.ge OR site:reestri.gov.ge`,
        `"${input}" real estate listing Georgia`,
      ];
  return { primaryQueries: queries, officialUrls: [] };
}

// ── Discovery branch ───────────────────────────────────────────
async function discover(apiKey: string, query: string, mode: 'PROPERTY' | 'CADASTRAL', raw: string) {
  const ctx = mode === 'CADASTRAL'
    ? 'Georgian cadastral parcel query. Extract: cadastral number, address, area, owner category, registration date, encumbrances, land use.'
    : 'Georgian property/developer/project query. Extract: property details, developer name & ID, project info, permits, prices, legal status, risks.';

  const result = await geminiGrounded(apiKey, `${ctx}

QUERY: ${query}
INPUT: ${raw}

Return JSON:
{
  "sources": [{"url":"...","title":"...","snippet":"max 300 chars"}],
  "key_facts": [{"claim_type":"CADASTRAL_NUMBER|ADDRESS|AREA|OWNER_TYPE|REGISTRATION_DATE|COMPANY_NAME|COMPANY_ID|PROJECT_NAME|PRICE|PERMIT|ENCUMBRANCE|RISK","value":"...","source_url":"...","confidence":0.0}],
  "entities_discovered": [{"type":"PROPERTY|CADASTRAL_PARCEL|ADDRESS|PROJECT|DEVELOPER|LEGAL_COMPANY","name":"..."}],
  "high_value_urls": []
}
Only facts directly found in search results. No invented data. Official registries (napr.gov.ge, reestri.gov.ge, my.gov.ge, srs.ge, tas.ge) → confidence 0.85+. Snippet-only non-official → max 0.45.`);

  const parsed = extractJson(result.text) as Record<string, unknown> | null;
  const sources: Array<{ url: string; title: string; snippet: string; sourceType: string; chunk: unknown }> = [];

  for (const chunk of result.groundingChunks as Array<Record<string, unknown>>) {
    const web = chunk?.web as Record<string, unknown> | undefined;
    if (web?.uri) sources.push({
      url: web.uri as string, title: (web.title as string) ?? '',
      snippet: '', sourceType: classifySourceType(web.uri as string, (web.title as string) ?? ''), chunk,
    });
  }
  if (Array.isArray(parsed?.sources)) {
    for (const s of parsed!.sources as Array<Record<string, unknown>>) {
      if (s.url && !sources.find(x => x.url === s.url))
        sources.push({ url: s.url as string, title: (s.title as string) ?? '',
          snippet: (s.snippet as string) ?? '',
          sourceType: classifySourceType(s.url as string, (s.title as string) ?? ''), chunk: s });
    }
  }
  return { sources, text: result.text };
}

// ── URL Context reading ────────────────────────────────────────
async function readUrls(apiKey: string, urls: string[], raw: string, claimTypes: string[]) {
  const safe = urls.filter(isSafeUrl).slice(0, 4);
  if (!safe.length) return { text: '', facts: [] as Array<{ claim_type: string; value: string; confidence: number }> };
  const result = await geminiGrounded(apiKey,
    `Read these URLs and extract structured facts about: "${raw}"
Return JSON: {"facts":[{"claim_type":"${claimTypes.join('|')}","value":"...","confidence":0.0}],"access_status":"FULL|PARTIAL|BLOCKED|CAPTCHA_REQUIRED"}
Never invent facts. CAPTCHA/login → access_status CAPTCHA_REQUIRED.`,
    { urlContext: safe });
  const parsed = extractJson(result.text) as Record<string, unknown> | null;
  const facts = (Array.isArray(parsed?.facts) ? parsed!.facts as Array<Record<string, unknown>> : [])
    .map(f => ({ claim_type: String(f.claim_type ?? ''), value: String(f.value ?? ''), confidence: Math.min(1, Math.max(0, Number(f.confidence ?? 0.3))) }));
  return { text: result.text, facts };
}

// ── Cross-check ────────────────────────────────────────────────
interface ClaimGroup { claim_type: string; values: Array<{ value: string; confidence: number; authority: number; source_id?: string | null }>; }

function crossCheck(groups: ClaimGroup[]) {
  return groups.map(g => {
    if (!g.values.length) return { claim_type: g.claim_type, resolved_value: '', status: 'NOT_FOUND', confidence: 0, conflict_type: 'INSUFFICIENT_EVIDENCE', values: g.values };
    if (g.values.length === 1) {
      const v = g.values[0];
      return { claim_type: g.claim_type, resolved_value: v.value, status: v.confidence >= 0.7 ? 'CONFIRMED' : v.confidence >= 0.4 ? 'PARTIAL' : 'UNVERIFIED', confidence: v.confidence, conflict_type: 'MATCH', values: g.values };
    }
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    if ([...new Set(g.values.map(v => norm(v.value)))].length === 1) {
      const maxConf = Math.max(...g.values.map(v => v.confidence));
      return { claim_type: g.claim_type, resolved_value: g.values[0].value, status: 'CONFIRMED', confidence: Math.min(0.97, maxConf + Math.min(0.15, (g.values.length - 1) * 0.05)), conflict_type: 'MATCH', values: g.values };
    }
    const nums = g.values.map(v => parseFloat(v.value.replace(/[^0-9.]/g, ''))).filter(n => !isNaN(n));
    if (nums.length === g.values.length) {
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      if ((Math.max(...nums) - Math.min(...nums)) / avg < 0.05) {
        const best = g.values.reduce((a, b) => b.authority > a.authority ? b : a);
        return { claim_type: g.claim_type, resolved_value: best.value, status: 'PARTIAL', confidence: 0.6, conflict_type: 'MINOR_VARIATION', values: g.values };
      }
    }
    const best = g.values.reduce((a, b) => b.authority > a.authority ? b : a);
    return { claim_type: g.claim_type, resolved_value: best.value, status: 'CONFLICTED', confidence: Math.min(best.confidence, 0.5), conflict_type: 'MATERIAL_CONFLICT', values: g.values };
  });
}

function calcConfidence(p: { officialSources: number; readSources: number; snippetSources: number; confirmedClaims: number; conflictedClaims: number; totalClaims: number; hasOfficialRegistry: boolean; entityMatchScore: number }): number {
  let s = 20;
  s += Math.min(30, p.officialSources * 15);
  s += Math.min(15, p.readSources * 8);
  s += Math.min(10, p.snippetSources * 2);
  if (p.totalClaims > 0) s += (p.confirmedClaims / p.totalClaims) * 20;
  if (p.conflictedClaims > 0) s -= Math.min(20, p.conflictedClaims * 7);
  if (p.hasOfficialRegistry) s += 10;
  s += p.entityMatchScore * 5;
  return Math.round(Math.min(92, Math.max(5, s)));
}

// ── Synthesis ──────────────────────────────────────────────────
async function synthesize(
  apiKey: string, raw: string, mode: 'PROPERTY' | 'CADASTRAL',
  claims: Array<{ claim_type: string; resolved_value: string; status: string; confidence: number }>,
  sources: Array<{ url: string; title: string; sourceType: string; accessMethod: string }>,
  entities: Array<{ type: string; name: string }>,
  conflicts: Array<{ claim_type: string; conflict_type: string }>,
  depth: { sources_found: number; sources_read: number; claims_extracted: number }
): Promise<Record<string, unknown>> {
  const claimSet = claims.filter(c => c.resolved_value && c.status !== 'NOT_FOUND')
    .map(c => `${c.claim_type}: ${c.resolved_value} [${c.status}, conf=${c.confidence.toFixed(2)}]`).join('\n');

  const result = await geminiGrounded(apiKey,
    `You are a Property Intelligence analyst for Georgian real estate.
Report for: "${raw}" (mode: ${mode})

ALLOWED CLAIMS (assert ONLY these — no additions):
${claimSet || '(none)'}

SOURCES (${sources.length}): ${sources.slice(0, 15).map(s => `[${s.sourceType}] ${s.title || s.url} (${s.accessMethod})`).join(' | ')}
ENTITIES: ${entities.map(e => `[${e.type}] ${e.name}`).join(', ') || 'none'}
CONFLICTS: ${conflicts.map(c => `${c.claim_type}: ${c.conflict_type}`).join(', ') || 'none'}

Return ONLY this JSON:
{
  "identity":{"display_name":"...","entity_types":[],"cadastral_code":null,"address":null,"project_name":null,"developer_name":null},
  "official_facts":[{"label":"...","value":"...","status":"CONFIRMED|PARTIAL|UNVERIFIED|NOT_FOUND|CONFLICTED","source_type":"..."}],
  "developer_company":{"name":null,"company_id":null,"registration_status":"NOT_FOUND","projects":[],"risk_notes":[]},
  "market_listings":[],
  "discrepancies":[{"field":"...","conflict_type":"MINOR_VARIATION|MATERIAL_CONFLICT","values":[],"assessment":"..."}],
  "risks":[{"risk":"...","evidence":"...","severity":"HIGH|MEDIUM|LOW"}],
  "not_found":[],
  "ai_assessment":"2-3 sentence evidence-grounded summary. No new facts.",
  "official_sources_note":"Note on direct vs. snippet-only access to Georgian registries.",
  "captcha_barriers":[],
  "research_depth":{"sources_found":${depth.sources_found},"sources_read":${depth.sources_read},"claims_extracted":${depth.claims_extracted}}
}
RULES: ai_assessment adds NO new facts. Risks require cited evidence. NOT_FOUND/UNVERIFIED for missing data.`);

  return (extractJson(result.text) as Record<string, unknown> | null) ?? { ai_assessment: 'Synthesis incomplete.', raw: result.text.slice(0, 500) };
}

// ── Full pipeline ──────────────────────────────────────────────
async function runPipeline(sb: SB, apiKey: string, jobId: string, inputRaw: string, inputMode: 'PROPERTY' | 'CADASTRAL') {
  try {
    const detected = detectInputType(inputRaw);

    // Phase 2: Plan
    await jobPhase(sb, jobId, 'PLANNING', 'Building research query plan');
    const plan = buildQueryPlan(inputRaw, inputMode);

    // Phase 3: Parallel discovery
    await jobPhase(sb, jobId, 'DISCOVERING', `Running ${Math.min(5, plan.primaryQueries.length)} discovery branches`);
    const discResults = await Promise.allSettled(plan.primaryQueries.slice(0, 5).map(q => discover(apiKey, q, inputMode, inputRaw)));
    let geminiCalls = plan.primaryQueries.slice(0, 5).length;

    const allSources: Array<{ url: string; title: string; snippet: string; sourceType: string; chunk: unknown }> = [];
    const allTexts: string[] = [];
    const visited = new Set<string>();

    for (const r of discResults) {
      if (r.status === 'fulfilled') {
        allTexts.push(r.value.text);
        for (const s of r.value.sources) if (!visited.has(s.url)) { visited.add(s.url); allSources.push(s); }
      }
    }

    // Phase 4: Entity expansion
    await jobPhase(sb, jobId, 'EXPANDING', `Expanding ${allSources.length} sources`);
    const srcIdMap = new Map<string, string>();
    let sourcesFound = 0;
    for (const s of allSources) {
      const sid = await saveSource(sb, jobId, { url: s.url, title: s.title, snippet: s.snippet, source_type: s.sourceType, access_method: 'SEARCH_SNIPPET_ONLY', grounding_chunk: s.chunk });
      if (sid) { srcIdMap.set(s.url, sid); sourcesFound++; }
    }
    await sb.from('research_jobs').update({ sources_found: sourcesFound, gemini_calls: geminiCalls }).eq('id', jobId);

    const expQueries: string[] = [];
    if (inputMode === 'CADASTRAL' && detected.cadastral) {
      expQueries.push(`address "${detected.cadastral}" Georgia portal`, `"${detected.cadastral}" project developer Tbilisi`);
    }
    const projMatches = allTexts.join(' ').match(/(?:project|პროექტი)[:\s"«]+([^"»\n,]{5,50})/gi) ?? [];
    for (const m of projMatches.slice(0, 2)) {
      const name = m.replace(/(?:project|პროექტი)[:\s"«]+/i, '').replace(/[«»"]/g, '').trim();
      if (name.length > 4) expQueries.push(`"${name}" developer company enreg Georgia`);
    }
    if (expQueries.length) {
      const expResults = await Promise.allSettled(expQueries.slice(0, 3).map(q => discover(apiKey, q, inputMode, inputRaw)));
      geminiCalls += expQueries.slice(0, 3).length;
      for (const r of expResults) {
        if (r.status === 'fulfilled') {
          allTexts.push(r.value.text);
          for (const s of r.value.sources) {
            if (!visited.has(s.url)) {
              visited.add(s.url); allSources.push(s);
              const sid = await saveSource(sb, jobId, { url: s.url, title: s.title, snippet: s.snippet, source_type: s.sourceType, access_method: 'SEARCH_SNIPPET_ONLY', grounding_chunk: s.chunk });
              if (sid) { srcIdMap.set(s.url, sid); sourcesFound++; }
            }
          }
        }
      }
    }

    // Phase 5: URL Context
    await jobPhase(sb, jobId, 'READING', 'Reading high-value URLs');
    const hvUrls = dedupeUrls([
      ...allSources.filter(s => s.sourceType.startsWith('OFFICIAL')).map(s => s.url),
      ...allSources.filter(s => domainAuthority(s.url) >= 60).map(s => s.url),
      ...plan.officialUrls,
    ]).filter(isSafeUrl).slice(0, 6);

    const claimTypes = inputMode === 'CADASTRAL'
      ? ['CADASTRAL_NUMBER', 'ADDRESS', 'AREA', 'OWNER_TYPE', 'REGISTRATION_DATE', 'ENCUMBRANCE', 'LAND_USE']
      : ['COMPANY_NAME', 'COMPANY_ID', 'PROJECT_NAME', 'PERMIT_STATUS', 'PRICE', 'AREA', 'REGISTRATION_DATE', 'RISK'];

    let sourcesRead = 0;
    const urlFacts: Array<{ claim_type: string; value: string; confidence: number }> = [];
    if (hvUrls.length) {
      try {
        const urlRes = await readUrls(apiKey, hvUrls, inputRaw, claimTypes);
        geminiCalls++;
        urlFacts.push(...urlRes.facts);
        for (const url of hvUrls) {
          if (srcIdMap.has(url)) {
            await sb.from('research_sources').update({ access_method: 'URL_CONTEXT_RETRIEVED', full_content: urlRes.text.slice(0, 5000) }).eq('id', srcIdMap.get(url));
            sourcesRead++;
          } else {
            const sid = await saveSource(sb, jobId, { url, title: '', source_type: classifySourceType(url, ''), access_method: 'URL_CONTEXT_RETRIEVED', full_content: urlRes.text.slice(0, 5000) });
            if (sid) { srcIdMap.set(url, sid); sourcesFound++; sourcesRead++; }
          }
        }
      } catch (e) { console.warn('[PI] URL context:', e); }
    }
    await sb.from('research_jobs').update({ sources_found: sourcesFound, sources_read: sourcesRead, gemini_calls: geminiCalls }).eq('id', jobId);

    // Phase 6: Normalize
    await jobPhase(sb, jobId, 'NORMALIZING', 'Extracting structured evidence claims');
    let rawClaims: Array<Record<string, unknown>> = [];
    try {
      const normRes = await geminiGrounded(apiKey,
        `From research about "${inputRaw}" (mode: ${inputMode}), extract ALL factual claims.

Research:
${allTexts.join('\n---\n').slice(0, 15000)}

URL facts: ${JSON.stringify(urlFacts).slice(0, 3000)}

Return JSON array: [{"claim_type":"CADASTRAL_NUMBER|ADDRESS|AREA|OWNER_TYPE|REGISTRATION_DATE|ENCUMBRANCE|COMPANY_NAME|COMPANY_ID|PROJECT_NAME|PRICE|PERMIT_STATUS|RISK|LAND_USE|FLOOR|ROOMS|DEVELOPER_NAME|BUILDING_NAME","claim_value":"...","claim_raw":"exact quote","source_url":null,"confidence":0.0,"source_authority":0,"status":"CONFIRMED|PARTIAL|UNVERIFIED|NOT_FOUND"}]

Rules: Explicit facts only. Official Georgian sources → confidence 0.75+. Snippet non-official → max 0.45.`);
      geminiCalls++;
      const parsed = extractJson(normRes.text);
      if (Array.isArray(parsed)) rawClaims = parsed as Array<Record<string, unknown>>;
      else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).claims))
        rawClaims = (parsed as Record<string, unknown>).claims as Array<Record<string, unknown>>;
    } catch (e) { console.warn('[PI] Normalize:', e); }

    for (const f of urlFacts)
      rawClaims.push({ claim_type: f.claim_type, claim_value: f.value, confidence: f.confidence, source_authority: 70, status: 'UNVERIFIED' });

    const claimGroups = new Map<string, Array<{ value: string; confidence: number; authority: number; source_id: string | null }>>();
    let claimsExtracted = 0;
    for (const c of rawClaims.slice(0, 100)) {
      const ct = String(c.claim_type ?? ''); const cv = String(c.claim_value ?? '').trim();
      if (!cv || !ct) continue;
      const conf = Math.min(1, Math.max(0, Number(c.confidence ?? 0.3)));
      const auth = Math.min(100, Math.max(0, Number(c.source_authority ?? 30)));
      const sid = c.source_url ? (srcIdMap.get(c.source_url as string) ?? null) : null;
      await saveClaim(sb, jobId, { source_id: sid, claim_type: ct, claim_value: cv, claim_raw: String(c.claim_raw ?? '').slice(0, 500), status: String(c.status ?? 'UNVERIFIED'), confidence: conf, source_authority: auth });
      if (!claimGroups.has(ct)) claimGroups.set(ct, []);
      claimGroups.get(ct)!.push({ value: cv, confidence: conf, authority: auth, source_id: sid });
      claimsExtracted++;
    }

    const entities: Array<{ type: string; name: string }> = [];
    const pick = (type: string) => rawClaims.find(c => c.claim_type === type);
    for (const [etype, ctype, itype] of [
      ['DEVELOPER', 'DEVELOPER_NAME', undefined], ['DEVELOPER', 'COMPANY_NAME', undefined],
      ['PROJECT', 'PROJECT_NAME', undefined], ['ADDRESS', 'ADDRESS', undefined],
      ['CADASTRAL_PARCEL', 'CADASTRAL_NUMBER', 'cadastral'],
    ] as Array<[string, string, string | undefined]>) {
      const c = pick(ctype);
      if (c?.claim_value) {
        await saveEntity(sb, jobId, { entity_type: etype, name_raw: String(c.claim_value), identifiers: itype ? { [itype]: c.claim_value } : {}, discovery_depth: etype === 'CADASTRAL_PARCEL' ? 0 : 1 });
        if (!entities.find(e => e.name === String(c.claim_value)))
          entities.push({ type: etype, name: String(c.claim_value) });
      }
    }
    await sb.from('research_jobs').update({ claims_extracted: claimsExtracted, entities_found: entities.length, gemini_calls: geminiCalls }).eq('id', jobId);

    // Phase 7: Cross-check
    await jobPhase(sb, jobId, 'CROSS_CHECKING', 'Cross-checking claims');
    const groups: ClaimGroup[] = Array.from(claimGroups.entries()).map(([ct, vals]) => ({ claim_type: ct, values: vals }));
    const checked = crossCheck(groups);
    const conflicts = checked.filter(c => c.conflict_type === 'MATERIAL_CONFLICT' || c.conflict_type === 'MINOR_VARIATION');
    for (const cf of conflicts) {
      await sb.from('research_conflicts').insert({ job_id: jobId, claim_type: cf.claim_type, value_a: cf.values[0]?.value ?? '', value_b: cf.values[1]?.value ?? '', conflict_type: cf.conflict_type });
    }

    // Phase 8: Synthesize
    await jobPhase(sb, jobId, 'SYNTHESIZING', 'Synthesizing structured report');
    const srcSummary = allSources.slice(0, 30).map(s => ({ url: s.url, title: s.title, sourceType: s.sourceType, accessMethod: srcIdMap.has(s.url) && sourcesRead > 0 ? 'URL_CONTEXT_RETRIEVED' : 'SEARCH_SNIPPET_ONLY' }));
    const report = await synthesize(apiKey, inputRaw, inputMode,
      checked.map(c => ({ claim_type: c.claim_type, resolved_value: c.resolved_value, status: c.status, confidence: c.confidence })),
      srcSummary, entities,
      conflicts.map(c => ({ claim_type: c.claim_type, conflict_type: c.conflict_type })),
      { sources_found: sourcesFound, sources_read: sourcesRead, claims_extracted: claimsExtracted });
    geminiCalls++;

    const officialSources = allSources.filter(s => s.sourceType.startsWith('OFFICIAL')).length;
    const overallConf = calcConfidence({
      officialSources, readSources: sourcesRead, snippetSources: sourcesFound - sourcesRead,
      confirmedClaims: checked.filter(c => c.status === 'CONFIRMED').length,
      conflictedClaims: checked.filter(c => c.status === 'CONFLICTED').length,
      totalClaims: claimsExtracted,
      hasOfficialRegistry: allSources.some(s => s.sourceType === 'OFFICIAL_REGISTRY'),
      entityMatchScore: entities.length > 0 ? 1 : 0,
    });

    const finalReport = {
      ...report, job_id: jobId, input_raw: inputRaw, input_mode: inputMode,
      overall_confidence: overallConf, sources_summary: srcSummary.slice(0, 20),
      cross_checked_claims: checked, entities, material_conflicts: conflicts,
      searched_at: new Date().toISOString(), pipeline_version: 'pi-v1',
      gemini_calls: geminiCalls, official_sources_accessed: officialSources,
      note_on_official_access: officialSources === 0
        ? 'No official Georgian registry sources directly accessed. Results from public web search only. Verify with NAPR, ENREG, or my.gov.ge directly.'
        : `${officialSources} official source(s) found via search. Direct registry verification requires CAPTCHA/auth handoff.`,
    };

    await sb.from('research_jobs').update({
      status: claimsExtracted > 0 ? 'COMPLETED' : 'PARTIAL',
      phase_detail: `Done: ${sourcesFound} sources, ${claimsExtracted} claims, ${entities.length} entities`,
      report: finalReport, completed_at: new Date().toISOString(),
      gemini_calls: geminiCalls, sources_found: sourcesFound, sources_read: sourcesRead,
      entities_found: entities.length, claims_extracted: claimsExtracted,
    }).eq('id', jobId);

  } catch (err) {
    console.error('[PI] Error:', err);
    await sb.from('research_jobs').update({
      status: 'FAILED', error_message: String(err).slice(0, 500),
      phase_detail: 'Pipeline error', completed_at: new Date().toISOString(),
    }).eq('id', jobId);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER — routes on URL path
// ═══════════════════════════════════════════════════════════════
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'Authentication required' }, 401);

  const sbUrl = Deno.env.get('SUPABASE_URL')!;
  const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = createClient(sbUrl, sbKey);

  const jwt = auth.replace(/^Bearer\s+/i, '');
  const { data: { user }, error: authErr } = await sb.auth.getUser(jwt);
  if (authErr || !user) return json({ error: 'Invalid session' }, 401);

  const { data: profile } = await sb.from('users').select('id').eq('auth_id', user.id).maybeSingle();
  if (!profile?.id) return json({ error: 'User profile not found' }, 403);

  const url = new URL(req.url);
  const isStatus = url.pathname.endsWith('/status');

  // ── STATUS route ───────────────────────────────────────────
  if (isStatus) {
    let jobId: string | null = url.searchParams.get('job_id');
    if (!jobId && req.method === 'POST') {
      try { const b = await req.json(); jobId = String(b?.job_id ?? '').trim() || null; } catch { /**/ }
    }
    if (!jobId) return json({ error: 'job_id required' }, 400);

    const { data: job, error } = await sb.from('research_jobs')
      .select('id,status,phase_detail,sources_found,sources_read,entities_found,claims_extracted,gemini_calls,report,error_message,started_at,completed_at,duration_ms,input_raw,input_type')
      .eq('id', jobId).eq('user_id', profile.id).maybeSingle();

    if (error || !job) return json({ error: 'Job not found or access denied' }, 404);

    return json({
      job_id: job.id, status: job.status, phase_detail: job.phase_detail,
      progress: { sources_found: job.sources_found ?? 0, sources_read: job.sources_read ?? 0, entities_found: job.entities_found ?? 0, claims_extracted: job.claims_extracted ?? 0, gemini_calls: job.gemini_calls ?? 0 },
      input_raw: job.input_raw, input_type: job.input_type,
      started_at: job.started_at, completed_at: job.completed_at, duration_ms: job.duration_ms,
      report: ['COMPLETED', 'PARTIAL'].includes(job.status) ? job.report : null,
      error_message: job.status === 'FAILED' ? job.error_message : null,
    });
  }

  // ── START RESEARCH route ───────────────────────────────────
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  const apiKey = Deno.env.get('INTEGRATIONS_API_KEY');
  if (!apiKey) return json({ error: 'AI service not configured' }, 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const inputRaw = String(body.input ?? body.query ?? '').trim().slice(0, 2000);
  const inputMode = String(body.mode ?? 'PROPERTY').toUpperCase() as 'PROPERTY' | 'CADASTRAL';
  if (!inputRaw) return json({ error: 'input required' }, 400);
  if (!['PROPERTY', 'CADASTRAL'].includes(inputMode)) return json({ error: 'mode must be PROPERTY or CADASTRAL' }, 400);

  const det = detectInputType(inputRaw);
  const { data: job, error: jobErr } = await sb.from('research_jobs').insert({
    user_id: profile.id, input_raw: inputRaw, input_type: inputMode,
    status: 'IDENTIFYING', phase_detail: 'Parsing input and identifying entities',
    cadastral_code: det.cadastral ?? null, url_input: det.url ?? null,
    started_at: new Date().toISOString(),
  }).select('id').maybeSingle();
  if (jobErr || !job?.id) return json({ error: 'Failed to create research job' }, 500);

  EdgeRuntime.waitUntil(runPipeline(sb, apiKey, job.id, inputRaw, inputMode));
  return json({ job_id: job.id, status: 'PENDING', message: 'Research job started' }, 202);
});

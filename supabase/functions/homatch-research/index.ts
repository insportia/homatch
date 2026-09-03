// Homatch Verification Center — authenticated, DB-first + public-web research.
//
// Exactly TWO modes are accepted: cadastral, property.
// ("developer"/"project" used to be separate modes; they are both "identify
// and research this entity" and are now handled by the property mode's
// entity-resolution pipeline.)
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
//
// Evidence persistence: every successful lookup is cached in research_cache,
// keyed by a fingerprint of (mode, normalized query, language). A cache hit
// is served without calling the model again, with hit_count/last_verified_at
// updated so repeated verification of the same entity/code is free and fast.
//
// Cadastral research is document-first: it explicitly directs the model's
// web_search tool at TAS.ge's public document register (Tbilisi), the
// Georgian Public Registry (napr.gov.ge / my.gov.ge) and the national
// geoportal (maps.gov.ge / ms.gov.ge) rather than a generic open-ended
// search, and asks for a structured, dated timeline of filings so an old
// resolved issue is never presented as a current risk. A direct, real-time
// automated scrape of TAS.ge was investigated (its search UI is a Sencha
// ExtJS single-page app calling a Java DWR/AJAX-RPC backend on
// docs.tbilisi.gov.ge, not a plain HTML form) and is NOT implemented here:
// reproducing its exact call sequence would require reverse-engineering the
// SPA's dynamically-loaded controller/store classes, and whether a CAPTCHA
// gates the actual search submission (as opposed to the static resources
// inspected) could not be confirmed without attempting to automate around
// it, which this project's own rules (and ours) forbid. Per that boundary,
// this function does the complete, real, non-fake part — document-first web
// research plus structured, deduped evidence — and always also returns the
// official deep links so the user can complete an authoritative lookup
// themselves in one click. That is reported here plainly, not hidden.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { type Locale, LANGUAGE_NAMES, resolveLocaleFromBody, languageDirective } from '../_shared/locale.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const MODEL = Deno.env.get('OPENAI_RESEARCH_MODEL') || 'gpt-5.6-luna';

// ── UI language handling ─────────────────────────────────────────────────
type UiLang = Locale;
const LANG_NAMES = LANGUAGE_NAMES;

// Fixed, code-generated safety strings (never model output) must still be
// localized — small hand-maintained dictionaries rather than a runtime
// translation call, since these are safety/compliance-critical and must
// never depend on an external service being available.
const CADASTRAL_NO_SOURCE_MSG: Record<UiLang, string> = {
  en: 'No trustworthy public source was found for this exact cadastral code. This is expected — Georgia\'s Public Registry (napr.gov.ge) and the Tbilisi municipal document register (tas.ge) are not fully indexed by web search. Use the official links below to search directly.',
  ka: 'ამ ზუსტი საკადასტრო კოდისთვის სანდო საჯარო წყარო ვერ მოიძებნა. ეს ჩვეულებრივი შედეგია — საქართველოს საჯარო რეესტრი (napr.gov.ge) და თბილისის მუნიციპალური დოკუმენტბრუნვის სისტემა (tas.ge) სრულად არ არის ინდექსირებული ვებ-ძიებაში. გამოიყენეთ ქვემოთ მოცემული ოფიციალური ბმულები პირდაპირი ძიებისთვის.',
  ru: 'Достоверный публичный источник для этого кадастрового кода не найден. Это ожидаемо — Публичный реестр Грузии (napr.gov.ge) и муниципальный документооборот Тбилиси (tas.ge) не полностью индексируются веб-поиском. Используйте официальные ссылки ниже для прямого поиска.',
  tr: 'Bu tapu kodu için güvenilir kamuya açık bir kaynak bulunamadı. Bu beklenen bir durumdur — Gürcistan Kamu Sicili (napr.gov.ge) ve Tiflis belediye belge kayıt sistemi (tas.ge) web aramasında tam olarak dizine alınmamıştır. Doğrudan arama için aşağıdaki resmi bağlantıları kullanın.',
  ar: 'لم يُعثر على مصدر عام موثوق لهذا الرمز المساحي بالتحديد. هذا أمر متوقع — السجل العام لجورجيا (napr.gov.ge) وسجل الوثائق البلدي في تبليسي (tas.ge) غير مفهرسين بالكامل في نتائج البحث. استخدم الروابط الرسمية أدناه للبحث المباشر.',
  he: 'לא נמצא מקור ציבורי מהימן עבור קוד הגוש/חלקה המדויק הזה. זו תוצאה צפויה — המרשם הציבורי של גאורגיה (napr.gov.ge) ומרשם המסמכים העירוני של טביליסי (tas.ge) אינם מאונדקסים במלואם בחיפוש ברשת. השתמשו בקישורים הרשמיים למטה לחיפוש ישיר.',
};
const CADASTRAL_NOT_OFFICIAL_WARNING: Record<UiLang, string> = {
  en: 'Public web research is not official cadastral verification.',
  ka: 'საჯარო ვებ-კვლევა არ წარმოადგენს საკადასტრო მონაცემების ოფიციალურ გადამოწმებას.',
  ru: 'Публичный веб-поиск не является официальной кадастровой проверкой.',
  tr: 'Kamuya açık web araştırması resmi tapu doğrulaması değildir.',
  ar: 'البحث العام على الويب لا يُعد تحققاً مساحياً رسمياً.',
  he: 'מחקר ציבורי ברשת אינו מהווה אימות רשמי של נתוני גוש/חלקה.',
};

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ── Per-mode validation ──────────────────────────────────────────────────
// MUST stay identical to src/lib/verifyValidation.ts — see that file's header
// comment. Duplicated because Edge Functions are a separate Deno deployment
// and cannot import from src/.
type VerifyMode = 'property' | 'cadastral';
type VerifyReasonCode = 'EMPTY' | 'TOO_SHORT' | 'TOO_LONG' | 'INVALID_FORMAT' | 'LOOKS_LIKE_QUESTION';
interface VerifyValidationResult { valid: boolean; reasonCode?: VerifyReasonCode; normalized?: string }

const CADASTRAL_RE = /^\d{1,6}(\.\d{1,6}){3,11}$/;
const URL_RE = /^https?:\/\/\S+$/i;
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

  // mode === 'property'
  if (value.length < 2) return { valid: false, reasonCode: 'TOO_SHORT' };
  const maxLen = 500;
  if (value.length > maxLen) return { valid: false, reasonCode: 'TOO_LONG' };

  const isUrl = URL_RE.test(value);
  if (!isUrl) {
    if (/[?？]/.test(value)) return { valid: false, reasonCode: 'LOOKS_LIKE_QUESTION' };
    if (QUESTION_WORDS.test(value)) return { valid: false, reasonCode: 'LOOKS_LIKE_QUESTION' };
    if (!/\p{L}/u.test(value)) return { valid: false, reasonCode: 'INVALID_FORMAT' };
    const letterDigitCount = (value.match(/[\p{L}\p{N}]/gu) ?? []).length;
    if (letterDigitCount < value.length * 0.4) return { valid: false, reasonCode: 'INVALID_FORMAT' };
  }

  return { valid: true, normalized: value };
}

// ── Official deep links (always returned — human-in-the-loop, never a
// CAPTCHA bypass or a faked "official" result) ───────────────────────────
const OFFICIAL_LINKS: Record<VerifyMode, Array<{ label: string; url: string }>> = {
  cadastral: [
    { label: 'TAS.ge — Tbilisi municipal public document search', url: 'https://tas.ge/?p=searchdocument&menuItemId=7104' },
    { label: 'napr.gov.ge — National Agency of Public Registry', url: 'https://napr.gov.ge' },
    { label: 'my.gov.ge — public e-services portal', url: 'https://my.gov.ge' },
    { label: 'maps.gov.ge — national geoportal (parcel/zoning map)', url: 'https://maps.gov.ge' },
  ],
  property: [
    { label: 'enreg.reestri.gov.ge — Entrepreneurial & Non-Entrepreneurial (NGO) Registry', url: 'https://enreg.reestri.gov.ge' },
    { label: 'napr.gov.ge — National Agency of Public Registry', url: 'https://napr.gov.ge' },
  ],
};

// ── Per-mode research instructions ───────────────────────────────────────
const STRUCTURED_JSON_INSTRUCTION = `
After your prose analysis, append ONE fenced code block, exactly \`\`\`json ... \`\`\`, containing a single JSON object with this exact shape (use null / [] for anything you did not find — never fabricate a value to fill a field):
{
  "entity": {"name": string, "type": "LAND_PARCEL"|"APARTMENT"|"BUILDING"|"COMPANY"|"PROJECT"|"LISTING"|"UNKNOWN", "confidence": "HIGH"|"MEDIUM"|"LOW"},
  "cadastralFacts": {"address": string|null, "areaSqm": number|null, "zoneK1": string|null, "zoneK2": string|null, "zoneK3": string|null, "applicantName": string|null} | null,
  "timeline": [{"date": string|null, "documentType": string, "applicationNumber": string|null, "description": string, "sourceUrl": string, "sourceName": string, "status": "RESOLVED"|"SUPERSEDED"|"CURRENT"|"STILL_OPEN"|"UNKNOWN"}],
  "registry": {"companyName": string, "idCode": string|null, "legalForm": string|null, "registrationStatus": string|null, "registrationDate": string|null, "sourceUrl": string|null} | null,
  "reputation": {"positive": [{"title": string, "url": string, "snippet": string}], "negative": [{"title": string, "url": string, "snippet": string}]},
  "riskFlags": [{"severity": "LOW"|"MEDIUM"|"HIGH", "description": string, "sourceUrl": string|null, "status": "CURRENT"|"RESOLVED"|"UNKNOWN"}],
  "summary": string
}
IMPORTANT for "timeline": order it chronologically and set "status" by checking whether a LATER item in your own research supersedes or resolves an earlier one — never leave an old negative/refusal item looking like the current status if you found anything more recent about the same parcel/document. If you are not sure a later record exists, use "UNKNOWN", not "CURRENT".
IMPORTANT for "reputation": search for BOTH positive and negative public sentiment deliberately — do not stop after finding only complaints, and do not stop after finding only marketing material. Deduplicate by URL.`;

const MODE_PROMPTS: Record<VerifyMode, (query: string, isUrl: boolean) => string> = {
  cadastral: (query) => `You are running a DOCUMENT-FIRST verification of the GEORGIAN CADASTRAL CODE: "${query}".
Search, in priority order: (1) TAS.ge's public document register for Tbilisi (https://tas.ge/?p=searchdocument&menuItemId=7104) and docs.tbilisi.gov.ge — architectural/construction permit filings, approvals, refusals and amendments referencing this exact code; (2) napr.gov.ge / my.gov.ge (Georgia's Public Registry) for ownership/registration status; (3) maps.gov.ge / ms.gov.ge for parcel geometry, zoning (K1/K2/K3) and area.
For every filing/document/decision you find, record its date, source URL, and what it actually says — never merge two different documents into one summary.
STRICT EVIDENCE RULE: you MUST NOT invent or guess an owner name, lien, permit, registration date, area, or "officially verified" status. If you find a direct source quoting this exact code, report exactly what it says with the source link. If you find nothing reliable for this exact code, say clearly that public web search found no trustworthy record and that official verification is required — this is a normal, valid outcome, not a failure.
${STRUCTURED_JSON_INSTRUCTION}`,
  property: (query, isUrl) => `You are running ENTITY RESOLUTION + BACKGROUND RESEARCH on: "${query}"${isUrl ? ' (this input is a URL — open/analyze that specific page as your primary source)' : ''}.
First, resolve what this actually is: a specific property listing, a development project/building, a development or real-estate company, an individual agent, or a street address — and separately how confident you are.
If it resolves to a COMPANY or a project's developer, search specifically for it in Georgia's Entrepreneurial & Non-Entrepreneurial (NGO) Registry (enreg.reestri.gov.ge) and napr.gov.ge / reestri.gov.ge, and report the legal registration facts (status, legal form, identification code, registration date) ONLY if a registry page actually shows them — label that VERIFIED. Anything else found through general search is FOUND ONLINE, not VERIFIED.
Then run BALANCED public reputation research — deliberately search for both positive coverage (completed projects, praise, press) and negative coverage (complaints, disputes, reported delays, lawsuits, scam reports) about this entity. Do not stop after finding only one side. Deduplicate results by URL.
Never invent an address match, ownership name, cadastral number, registration status, financials, or legal status that no source actually states.
${STRUCTURED_JSON_INSTRUCTION}`,
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

// Deterministic, code-level (never model-claimed) evidence-source
// classification, based on the domain a citation actually points to.
function classifyDomain(url: string): 'REGISTRY' | 'MUNICIPAL' | 'OFFICIAL' | 'WEB_INDEXED' {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return 'WEB_INDEXED'; }
  if (host.endsWith('napr.gov.ge') || host.endsWith('reestri.gov.ge')) return 'REGISTRY';
  if (host.endsWith('tas.ge') || host.endsWith('tbilisi.gov.ge')) return 'MUNICIPAL';
  if (host.endsWith('.gov.ge') || host === 'gov.ge') return 'OFFICIAL';
  return 'WEB_INDEXED';
}

function citationsOf(p: any) {
  const out: any[] = [];
  for (const i of p?.output || []) {
    if (i?.type === 'message') {
      for (const c of i.content || []) {
        const fullText: string = typeof c?.text === 'string' ? c.text : '';
        for (const a of c.annotations || []) {
          if (a?.type === 'url_citation' && a.url) {
            let excerpt = '';
            if (
              fullText &&
              typeof a.start_index === 'number' &&
              typeof a.end_index === 'number' &&
              a.end_index > a.start_index
            ) {
              excerpt = fullText.slice(a.start_index, a.end_index).trim();
            }
            out.push({ label: a.title || a.url, url: a.url, status: 'FOUND_ONLINE', evidenceLevel: classifyDomain(a.url), excerpt });
          }
        }
      }
    }
  }
  return [...new Map(out.map((x) => [x.url, x])).values()];
}

// Extracts the trailing ```json ... ``` block the prompt asks for. Returns
// null (never a guessed/partial object) if the model didn't produce valid
// JSON — callers must treat null as "no structured data available" and fall
// back to the plain-text summary, never fabricate the missing structure.
function parseStructured(text: string): Record<string, unknown> | null {
  const m = text.match(/```json\s*([\s\S]*?)```/i);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

async function fingerprintOf(mode: string, query: string, lang: string): Promise<string> {
  const enc = new TextEncoder().encode(`${mode}:${query.toLowerCase()}:${lang}`);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
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
  const lang = resolveLocaleFromBody(body);
  const VALID_MODES: VerifyMode[] = ['property', 'cadastral'];

  if (!VALID_MODES.includes(modeInput as VerifyMode)) {
    return json({ error: 'Invalid verification mode. Must be one of: property, cadastral.', reasonCode: 'INVALID_MODE' }, 400);
  }
  const mode = modeInput as VerifyMode;

  const validation = validateVerifyQuery(mode, rawQuery);
  if (!validation.valid) {
    return json({ error: 'Invalid query for this verification mode.', reasonCode: validation.reasonCode }, 400);
  }
  const query = validation.normalized as string;
  const isUrl = mode === 'property' && URL_RE.test(query);

  // ── Cache lookup (dedup by canonical fingerprint) ──────────────────────
  const fingerprint = await fingerprintOf(mode, query, lang);
  const { data: cached } = await sb
    .from('research_cache')
    .select('*')
    .eq('fingerprint', fingerprint)
    .eq('freshness_status', 'FRESH')
    .maybeSingle();

  if (cached?.result_json) {
    // Fire-and-forget hit-count bump; never block the response on it.
    sb.from('research_cache')
      .update({ hit_count: (cached.hit_count ?? 0) + 1, last_verified_at: new Date().toISOString() })
      .eq('id', cached.id)
      .then(() => {}, () => {});
    return json({ ...(cached.result_json as Record<string, unknown>), fromCache: true, cachedAt: cached.acquired_at });
  }

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

  const modePrompt = MODE_PROMPTS[mode](query, isUrl);
  const prompt = `You are Homatch Research, an evidence-based verification assistant. ${modePrompt}
Homatch internal data (for context only, not a source of truth for public facts): ${JSON.stringify(internal).slice(0, 30000)}
Rules for every mode: separate HOMATCH DATA, VERIFIED (official/authoritative source only), FOUND ONLINE, CONFLICTING and UNVERIFIED. Never invent ownership, cadastral records, permits, directors, prices, availability, contacts or legal status. Never claim official/paid verification happened — paid third-party providers are disabled. Be concise: evidence, risks/red-flags, confidence, and next actions.
${languageDirective(lang)}`;

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
    console.error('[homatch-research] provider error', providerResult.status, p?.error ?? providerResult.raw?.slice(0, 500));
    return json({ error: p?.error?.message ? `Research provider error: ${p.error.message}` : `Research provider error (${providerResult.status || 'network'})` }, 502);
  }

  const text = textOf(p);
  const sources = citationsOf(p);
  const hasInternal = internal.properties.length + internal.matches.length + internal.intents.length > 0;
  const hasEvidence = sources.length > 0 || hasInternal;
  const isCad = mode === 'cadastral';

  // Structured extraction is only trusted when there is at least one real
  // web citation behind it — with zero sources, any "facts" the model wrote
  // into the JSON block are unsourced and must not reach the user as if
  // they were findings. This is enforced here in code, not only by prompt.
  const structured = sources.length > 0 ? parseStructured(text) : null;
  const proseSummary = text.replace(/```json[\s\S]*?```/i, '').trim();

  let finalSummary = structured?.summary && typeof structured.summary === 'string' ? structured.summary : (proseSummary || text);
  let cadastralInfo: Record<string, unknown> | undefined;
  if (isCad) {
    const foundPublic = sources.length > 0;
    cadastralInfo = {
      number: query,
      lookupStatus: foundPublic ? 'found_public' : 'requires_official',
      publicFindings: foundPublic ? (proseSummary || text) : null,
      officialVerificationAvailable: false,
      cadastralFacts: structured?.cadastralFacts ?? null,
    };
    if (!foundPublic) {
      finalSummary = CADASTRAL_NO_SOURCE_MSG[lang];
    }
  }

  const status: 'OK' | 'NO_EVIDENCE' = hasEvidence ? 'OK' : 'NO_EVIDENCE';
  const confidence = hasEvidence
    ? Math.min(95, Math.max(35, (sources.length ? 55 : 35) + (hasInternal ? 15 : 0) + Math.min(20, sources.length * 4)))
    : 15;

  const warnings: string[] = [];
  if (isCad) warnings.push(CADASTRAL_NOT_OFFICIAL_WARNING[lang]);
  if (sources.length > 0 && !structured) {
    // Honest, visible degrade: the model gave real sourced findings but not
    // in the requested structured shape, so the UI shows prose instead of
    // the structured timeline/registry/reputation sections. Never silently
    // presented as if structure were available.
    warnings.push('structured-extraction-unavailable');
  }

  const responseBody = {
    status,
    queryType: mode,
    entityName: (structured?.entity as any)?.name || query,
    entityType: (structured?.entity as any)?.type || mode,
    entityConfidence: (structured?.entity as any)?.confidence || null,
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
      companyInfo: mode === 'property' ? (proseSummary || text) : undefined,
      projectInfo: undefined,
      riskFlags: Array.isArray(structured?.riskFlags) ? structured!.riskFlags : [],
      newsSnippets: sources.map((s: any) => ({ title: s.label, url: s.url, snippet: s.excerpt || '', evidenceLevel: s.evidenceLevel })),
    },
    registry: structured?.registry ?? null,
    timeline: Array.isArray(structured?.timeline) ? structured!.timeline : [],
    reputation: structured?.reputation && typeof structured.reputation === 'object'
      ? structured.reputation
      : { positive: [], negative: [] },
    cadastralInfo,
    sources,
    officialLinks: OFFICIAL_LINKS[mode],
    requiresManualVerification: isCad ? true : sources.length === 0,
    actions: [{ id: 'ask-ai', label: 'Ask Homatch AI', type: 'ai_query' }],
    warnings,
    searchedAt: new Date().toISOString(),
    mode: 'DB_FIRST_PUBLIC_WEB',
    paidProvidersUsed: false,
    responseId: p?.id || null,
    model: p?.model || MODEL,
    usage: p?.usage || null,
  };

  // Persist for caching/dedup — best-effort, never blocks the response.
  sb.from('research_cache')
    .upsert(
      {
        fingerprint,
        provider: 'openai_web_search',
        source_platform: mode,
        source_reference: query,
        query_json: { mode, query, lang },
        market: 'GE',
        language: lang,
        result_json: responseBody,
        confidence,
        freshness_status: 'FRESH',
        created_by_user_id: uid ?? null,
        acquired_at: new Date().toISOString(),
        last_verified_at: new Date().toISOString(),
        // Cadastral/registry facts move faster and matter more when stale —
        // keep those cached for less time than general property research.
        retention_expires_at: new Date(Date.now() + (isCad ? 1000 * 60 * 60 * 24 * 3 : 1000 * 60 * 60 * 24 * 14)).toISOString(),
      },
      { onConflict: 'fingerprint' },
    )
    .then(() => {}, (e: unknown) => console.error('[homatch-research] cache write failed', e));

  return json(responseBody);
});

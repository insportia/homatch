// research_agent_pure_logic.node-test.mjs — regression tests for the
// deterministic (non-LLM, non-Deno-API) logic inside the `research-agent`
// Supabase Edge Function, v25.
//
// IMPORTANT — why this file is Node, not Deno, unlike its neighbors in this
// directory: research-agent's actual source is a Deno.serve() handler using
// `jsr:` imports and Gemini/Playwright network calls, and — per this
// project's own operating history — its real, authoritative source lives
// ONLY in the deployed Supabase Edge Function (project ptxajsjhobhvsfhmutjn,
// function slug `research-agent`); the checked-in
// supabase/functions/research-agent/index.ts is a changelog-only stub. A
// Deno-based end-to-end test would need a live Gemini key, live
// official-worker browser sessions, and CAPTCHA solving, none of which are
// available in most CI/dev environments. What CAN be verified without any
// of that is the function's deterministic, pure-logic pieces — the code that
// decides confidence tiers, source categories, and deduplication with no
// LLM/network call involved. Each function below is copied verbatim from the
// deployed v25 source; keep it in sync whenever those functions change in
// the live function (see the function's own version-history comment block).
// Run with: node --test supabase/functions/tests/research_agent_pure_logic.node-test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

function normalizeLoose(s) {
  return String(s || '').toLowerCase().replace(/["'«»„"]/g, '').replace(/\s+/g, ' ').trim();
}
function dedupe(a, k) {
  return [...new Map(a.map((x) => [k(x), x])).values()];
}

const OFFICIAL_HOST_RE = /(?:^|\.)(gov\.ge|tas\.ge|napr\.gov\.ge|ms\.gov\.ge|reestri\.gov\.ge|my\.gov\.ge|enreg\.reestri\.gov\.ge)$/i;
const PROPERTY_PORTAL_HOST_RE = /(?:^|\.)(myhome\.ge|ss\.ge|home\.ss\.ge|korter\.ge|mymarket\.ge|adjaranet\.com|livo\.ge|place\.ge)$/i;
const SOCIAL_HOST_RE = /(?:^|\.)(facebook\.com|fb\.com|instagram\.com|tiktok\.com|youtube\.com|youtu\.be|t\.me|telegram\.me|twitter\.com|x\.com|linkedin\.com)$/i;
const MEDIA_HOST_RE = /(?:^|\.)(civil\.ge|netgazeti\.ge|publika\.ge|1tv\.ge|imedinews\.ge|interpressnews\.ge|rustavi2\.ge|bpn\.ge|forbes\.ge|business-media\.ge)$/i;
const FORUM_HOST_RE = /(?:^|\.)(reddit\.com|forum\.ge|forums\.ge)$/i;
function sourceCategory(url, hint) {
  if (!url) return 'OTHER_PUBLIC';
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return 'OTHER_PUBLIC';
  }
  if (OFFICIAL_HOST_RE.test(host)) {
    if (hint?.isMap || /ms\.gov\.ge$/i.test(host)) return 'OFFICIAL_MAP';
    if (hint?.isDocument) return 'OFFICIAL_DOCUMENT';
    return 'OFFICIAL_REGISTRY';
  }
  if (hint?.isDeveloperPrimary) return 'DEVELOPER_PRIMARY';
  if (PROPERTY_PORTAL_HOST_RE.test(host)) return 'MARKET_LISTING';
  if (SOCIAL_HOST_RE.test(host)) return /facebook\.com\/groups|t\.me\/joinchat|t\.me\/\+/i.test(url) ? 'PUBLIC_GROUP' : 'SOCIAL';
  if (MEDIA_HOST_RE.test(host)) return 'MEDIA';
  if (FORUM_HOST_RE.test(host)) return 'PUBLIC_FORUM';
  return 'OTHER_PUBLIC';
}

const STOPWORDS = new Set(['this','that','with','from','have','been','were','into','than','their','there','which','about','could','would','should','the','and','for','not','was','are','its']);
function tokenSet(s) {
  return new Set(
    normalizeLoose(s)
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 3 && !STOPWORDS.has(t))
  );
}
function overlapCoefficient(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}
const SEMANTIC_DEDUPE_THRESHOLD = 0.6;
function semanticDedupe(items, textOf) {
  const kept = [];
  for (const item of items) {
    const text = textOf(item);
    const tokens = tokenSet(text);
    if (!tokens.size) {
      if (!kept.some((k) => k.tokens.size === 0 && normalizeLoose(k.text) === normalizeLoose(text))) kept.push({ tokens, text, item });
      continue;
    }
    const matchIdx = kept.findIndex((k) => k.tokens.size > 0 && overlapCoefficient(tokens, k.tokens) >= SEMANTIC_DEDUPE_THRESHOLD);
    if (matchIdx === -1) kept.push({ tokens, text, item });
    else if (text.length > kept[matchIdx].text.length) kept[matchIdx] = { tokens, text, item };
  }
  return kept.map((k) => k.item);
}

function reconcileIdentity(i, o, mr) {
  const candidates = [];
  const proj = i?.project;
  if (proj && (proj.name || proj.address || proj.developer)) candidates.push({ project: proj.name || null, address: proj.address || null, developer: proj.developer || proj.developerCompany || null, source: 'identity', url: null });
  const cp = o?.companyProfile;
  if (cp && cp.name) candidates.push({ project: null, address: null, developer: cp.name, source: 'official', url: null });
  for (const c of mr?.market?.comparables || []) {
    if (!c || (!c.project && !c.address)) continue;
    let host = 'market';
    try {
      host = c.url ? new URL(c.url).hostname.replace(/^www\./i, '') : 'market';
    } catch {}
    candidates.push({ project: c.project || null, address: c.address || null, developer: null, source: host, url: c.url || null });
  }
  if (!candidates.length) return null;
  const byIndependentSource = (pick) => {
    const groups = new Map();
    for (const c of candidates) {
      const v = pick(c);
      if (!v) continue;
      const key = normalizeLoose(v);
      if (!key) continue;
      const g = groups.get(key) || { value: v, sources: new Set(), items: [] };
      g.sources.add(c.source); g.items.push(c); groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => b.sources.size - a.sources.size)[0] || null;
  };
  const projectGroup = byIndependentSource((c) => c.project);
  const addressGroup = byIndependentSource((c) => c.address);
  const developerGroup = byIndependentSource((c) => c.developer);
  const directFromGatedStage = !!(proj?.name || proj?.address || proj?.developer || (cp && cp.name));
  const bothAgree = (projectGroup?.sources.size || 0) >= 2 && (addressGroup?.sources.size || 0) >= 2;
  const independentAgreementCount = Math.max(projectGroup?.sources.size || 0, addressGroup?.sources.size || 0, developerGroup?.sources.size || 0);
  let confidence = 'LOW';
  if (directFromGatedStage || (bothAgree && independentAgreementCount >= 2) || independentAgreementCount >= 3) confidence = 'HIGH';
  else if (independentAgreementCount >= 2) confidence = 'MEDIUM';
  const provenanceOf = (g) => (g ? dedupe(g.items.map((it) => ({ source: it.source, url: it.url })).filter((p) => p.source), (p) => `${p.source}:${p.url || ''}`) : []);
  return { project: projectGroup?.value || proj?.name || null, address: addressGroup?.value || proj?.address || null, developer: developerGroup?.value || cp?.name || proj?.developer || null, confidence, independentSourceCount: independentAgreementCount, provenance: { project: provenanceOf(projectGroup), address: provenanceOf(addressGroup), developer: provenanceOf(developerGroup) } };
}

// ---- sourceCategory tests ----

test('sourceCategory: property portals are MARKET_LISTING, never SOCIAL (the mandate\'s named socialSources bug)', () => {
  assert.equal(sourceCategory('https://www.myhome.ge/listing/123'), 'MARKET_LISTING');
  assert.equal(sourceCategory('https://ss.ge/en/real-estate/123'), 'MARKET_LISTING');
  assert.equal(sourceCategory('https://korter.ge/project/villion'), 'MARKET_LISTING');
});
test('sourceCategory: real social platforms are SOCIAL, Facebook groups are PUBLIC_GROUP', () => {
  assert.equal(sourceCategory('https://www.facebook.com/somepage/posts/123'), 'SOCIAL');
  assert.equal(sourceCategory('https://www.instagram.com/p/abc'), 'SOCIAL');
  assert.equal(sourceCategory('https://www.facebook.com/groups/homebuyersgeorgia'), 'PUBLIC_GROUP');
});
test('sourceCategory: government/registry hosts are OFFICIAL_*, ms.gov.ge is specifically OFFICIAL_MAP', () => {
  assert.equal(sourceCategory('https://tas.ge/?p=searchdocument'), 'OFFICIAL_REGISTRY');
  assert.equal(sourceCategory('https://ms.gov.ge/map'), 'OFFICIAL_MAP');
  assert.equal(sourceCategory('https://some.gov.ge/doc.pdf', { isDocument: true }), 'OFFICIAL_DOCUMENT');
});
test('sourceCategory: an unrecognized host is OTHER_PUBLIC, never guessed into SOCIAL', () => {
  assert.equal(sourceCategory('https://random-blog.example/post'), 'OTHER_PUBLIC');
});

// ---- reconcileIdentity tests (includes the mandate's mandatory Villion fixture) ----

test('reconcileIdentity: VILLION REGRESSION FIXTURE — 2 independent market sources agreeing on project+address -> HIGH, with provenance', () => {
  const mr = { market: { comparables: [
    { project: 'Villion', address: 'Krtsanisi St 6', url: 'https://www.myhome.ge/listing/1' },
    { project: 'Villion', address: 'Krtsanisi St 6', url: 'https://ss.ge/en/real-estate/2' },
  ] } };
  const r = reconcileIdentity({}, {}, mr);
  assert.equal(r.project, 'Villion');
  assert.equal(r.address, 'Krtsanisi St 6');
  assert.equal(r.confidence, 'HIGH');
  assert.equal(r.independentSourceCount, 2);
  assert.equal(r.provenance.project.length, 2);
});
test('reconcileIdentity: a company OFFICIAL already confirmed (e.g. Millennio Group) is HIGH directly, no market agreement needed', () => {
  const r = reconcileIdentity({}, { companyProfile: { name: 'Millennio Group' } }, {});
  assert.equal(r.developer, 'Millennio Group');
  assert.equal(r.confidence, 'HIGH');
});
test('reconcileIdentity: a single unconfirmed market mention is LOW — must not license the narrative to state it as fact', () => {
  const mr = { market: { comparables: [{ project: 'SomeProject', address: 'Some St 1', url: 'https://www.myhome.ge/listing/1' }] } };
  const r = reconcileIdentity({}, {}, mr);
  assert.equal(r.confidence, 'LOW');
});
test('reconcileIdentity: two sources agreeing on address only (differently-worded project) is MEDIUM, not HIGH', () => {
  const mr = { market: { comparables: [
    { project: 'Villion Residence', address: 'Krtsanisi St 6', url: 'https://www.myhome.ge/listing/1' },
    { project: 'Villion Homes', address: 'Krtsanisi St 6', url: 'https://ss.ge/en/real-estate/2' },
  ] } };
  const r = reconcileIdentity({}, {}, mr);
  assert.equal(r.address, 'Krtsanisi St 6');
  assert.equal(r.confidence, 'MEDIUM');
});
test('reconcileIdentity: no candidates at all returns null — never a guessed identity', () => {
  assert.equal(reconcileIdentity({}, {}, {}), null);
});

// ---- semanticDedupe tests ----

test('semanticDedupe: three differently-worded commissioning findings collapse to one, the longest/most detailed kept', () => {
  const items = [
    { description: 'Official commissioning is not confirmed.' },
    { description: 'The official commissioning status was not confirmed by any authoritative source.' },
    { description: 'Commissioning not confirmed.' },
  ];
  const out = semanticDedupe(items, (x) => x.description);
  assert.equal(out.length, 1);
  assert.equal(out[0].description, 'The official commissioning status was not confirmed by any authoritative source.');
});
test('semanticDedupe: unrelated findings (different subject matter) are kept separate', () => {
  const items = [{ description: 'Official commissioning not confirmed.' }, { description: 'Seizure/attachment status not confirmed.' }];
  const out = semanticDedupe(items, (x) => x.description);
  assert.equal(out.length, 2);
});

// ---- customerSourceStatus / officialSourceCoverage / dueDiligenceCoverage
// (new) tests — v26, "HOMATCH VERIFY — FIX THE ACTUAL BROKEN RUNTIME
// WORKFLOW, NOT THE PROMPT". These verify the fix for the confirmed
// production bug where a job that dispatched 3 official adapters (TAS/
// MSMAP/My.gov) with 1 success and 2 technical failures reported
// "officialSourcesChecked: 1" with the other 2 completely invisible —
// copied verbatim from the deployed v26 source.

function customerSourceStatus(rawStatus) {
  switch (rawStatus) {
    case 'SEARCH_CONFIRMED':
      return 'SUCCESS';
    case 'NO_RESULT_CONFIRMED':
      return 'NO_RESULT';
    case 'SKIPPED_HUMAN_VERIFICATION':
    case 'WAITING_HUMAN':
      return 'CAPTCHA_REQUIRED';
    case 'BLOCKED':
      return 'BLOCKED';
    case 'SUBMIT_FAILED':
    case 'AUTH_REQUIRED':
    case 'SEARCH_CONTROL_NOT_FOUND':
    case 'WRONG_SEARCH_CONTEXT':
    case 'SUBMITTED_UNCONFIRMED':
    case 'FAILED':
    case 'TIMEOUT':
    case 'PARSE_FAILED':
      return 'TECHNICAL_FAILED';
    default:
      return 'NOT_CONFIRMED';
  }
}
function officialSourceCoverage(browserOfficial) {
  const results = browserOfficial?.results || [];
  return results.map((r) => ({ source: r.source, sourceName: r.sourceName || r.source, customerStatus: customerSourceStatus(r.status) }));
}
function dueDiligenceCoverageOfficialCounts(browserOfficial) {
  const officialResults = browserOfficial?.results || [];
  return {
    officialSourcesAttempted: officialResults.length,
    officialSourcesRetrieved: officialResults.filter((r) => r.status === 'SEARCH_CONFIRMED').length,
    technicalFailures: officialResults.filter((r) => customerSourceStatus(r.status) === 'TECHNICAL_FAILED').length,
  };
}

test('customerSourceStatus: maps every real worker terminal status to one of the 6 mandated customer-safe categories, never passing a raw enum through', () => {
  assert.equal(customerSourceStatus('SEARCH_CONFIRMED'), 'SUCCESS');
  assert.equal(customerSourceStatus('NO_RESULT_CONFIRMED'), 'NO_RESULT');
  assert.equal(customerSourceStatus('SKIPPED_HUMAN_VERIFICATION'), 'CAPTCHA_REQUIRED');
  assert.equal(customerSourceStatus('WAITING_HUMAN'), 'CAPTCHA_REQUIRED');
  assert.equal(customerSourceStatus('BLOCKED'), 'BLOCKED');
  for (const raw of ['SUBMIT_FAILED', 'AUTH_REQUIRED', 'SEARCH_CONTROL_NOT_FOUND', 'WRONG_SEARCH_CONTEXT', 'SUBMITTED_UNCONFIRMED', 'FAILED']) {
    assert.equal(customerSourceStatus(raw), 'TECHNICAL_FAILED', `expected ${raw} -> TECHNICAL_FAILED`);
  }
  assert.equal(customerSourceStatus(undefined), 'NOT_CONFIRMED');
  assert.equal(customerSourceStatus('SOME_FUTURE_UNKNOWN_STATUS'), 'NOT_CONFIRMED');
});

test('REGRESSION FIXTURE — 3 dispatched adapters, 1 success + 2 technical failures: attempted=3, retrieved=1, technicalFailures=2 (the exact production bug this pass fixes: officialSourcesChecked alone reported only 1, with zero visibility into the other 2)', () => {
  const browserOfficial = {
    results: [
      { source: 'msmap', sourceName: 'MS Map', status: 'SEARCH_CONFIRMED' },
      { source: 'tas', sourceName: 'TAS', status: 'SEARCH_CONTROL_NOT_FOUND' },
      { source: 'mygov', sourceName: 'My.gov / NAPR', status: 'SUBMIT_FAILED' },
    ],
  };
  const counts = dueDiligenceCoverageOfficialCounts(browserOfficial);
  assert.equal(counts.officialSourcesAttempted, 3);
  assert.equal(counts.officialSourcesRetrieved, 1);
  assert.equal(counts.technicalFailures, 2);
  const coverage = officialSourceCoverage(browserOfficial);
  assert.deepEqual(
    coverage.map((c) => c.customerStatus),
    ['SUCCESS', 'TECHNICAL_FAILED', 'TECHNICAL_FAILED']
  );
  // Every entry must carry ONLY the neutral enum + display name — never the
  // raw internal status string leaking through (mandate: "A source URL
  // being known or displayed MUST NEVER equal SUCCESS", and no internal
  // FSM state may reach the customer).
  for (const c of coverage) assert.equal(Object.prototype.hasOwnProperty.call(c, 'status'), false);
});

test('officialSourceCoverage: a source that was never dispatched never appears at all (never fabricated as NOT_CONFIRMED filler)', () => {
  const coverage = officialSourceCoverage({ results: [{ source: 'msmap', sourceName: 'MS Map', status: 'SEARCH_CONFIRMED' }] });
  assert.equal(coverage.length, 1);
  assert.equal(coverage.some((c) => c.source === 'tas'), false);
});

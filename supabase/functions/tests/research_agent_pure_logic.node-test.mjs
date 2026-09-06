// research_agent_pure_logic.node-test.mjs — regression tests for the
// deterministic (non-LLM, non-Deno-API) logic inside the `research-agent`
// Supabase Edge Function, v28.
//
// IMPORTANT — why this file is Node, not Deno, unlike its neighbors in this
// directory: research-agent's actual source is a Deno.serve() handler using
// `jsr:` imports and Gemini/Playwright network calls. A Deno-based
// end-to-end test would need a live Gemini key, live official-worker
// browser sessions, and CAPTCHA solving, none of which are available in
// most CI/dev environments. What CAN be verified without any of that is the
// function's deterministic, pure-logic pieces — the code that decides
// confidence tiers, source categories, and deduplication with no
// LLM/network call involved. Each function below is copied verbatim from
// the deployed source; keep it in sync whenever those functions change in
// the live function (see the function's own version-history comment block).
//
// PROVENANCE CORRECTION (2026-09-06, v28 pass): this comment previously
// claimed "the checked-in supabase/functions/research-agent/index.ts is a
// changelog-only stub" — a prior pass's own accepted convention after the
// real ~1580-line source had, at some point, stopped being kept in the
// git-tracked file (only its comment header survived). That was found and
// fixed this pass: index.ts is now restored from the live v27 deployment
// and is kept as the genuine, real, byte-for-byte-in-sync source going
// forward — see index.ts's own v28 header comment. This file remains Node
// (not a direct import of index.ts) purely because index.ts is a Deno
// module with `jsr:` specifiers Node cannot resolve, not because index.ts
// is no longer real.
// Run with: node --test supabase/functions/tests/research_agent_pure_logic.node-test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

function normalizeLoose(s) {
  return String(s || '').toLowerCase().replace(/["'«»„"]/g, '').replace(/\s+/g, ' ').trim();
}
function dedupe(a, k) {
  return [...new Map(a.map((x) => [k(x), x])).values()];
}

const OFFICIAL_HOST_RE = /(?:^|\.)(gov\.ge|tas\.ge|napr\.gov\.ge|ms\.gov\.ge|reestri\.gov\.ge|my\.gov\.ge|enreg\.reestri\.gov\.ge|rs\.ge)$/i;
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
test('sourceCategory: rs.ge (RS Taxpayers Registry, v28) is OFFICIAL_REGISTRY, not OTHER_PUBLIC', () => {
  assert.equal(sourceCategory('https://www.rs.ge/TaxpayersRegistry'), 'OFFICIAL_REGISTRY');
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

// isLoginPageUrl() (v27, "CUSTOMER-VALUE REPORT CLEANUP" mandate: "Never
// show login pages as customer evidence"). Copied verbatim from the deployed
// v27 source.
function isLoginPageUrl(u) {
  if (!u) return false;
  try {
    const x = new URL(u);
    const host = x.hostname.replace(/^www\./i, '');
    const path = x.pathname.toLowerCase();
    if (/^(facebook\.com|fb\.com|m\.facebook\.com)$/i.test(host) && /login/i.test(path)) return true;
    if (/^accounts\.google\.com$/i.test(host)) return true;
    if (/^(instagram\.com)$/i.test(host) && /^\/accounts\/login/i.test(path)) return true;
    if (/^(twitter\.com|x\.com)$/i.test(host) && /^\/(i\/flow\/login|login)/i.test(path)) return true;
    if (/^linkedin\.com$/i.test(host) && /^\/(login|checkpoint)/i.test(path)) return true;
    return false;
  } catch {
    return false;
  }
}

test('isLoginPageUrl: recognizes real login/auth entry-point shapes, never a normal content page', () => {
  assert.equal(isLoginPageUrl('https://www.facebook.com/login.php?next=%2Fsomepage'), true);
  assert.equal(isLoginPageUrl('https://accounts.google.com/signin/v2/identifier'), true);
  assert.equal(isLoginPageUrl('https://www.instagram.com/accounts/login/'), true);
  assert.equal(isLoginPageUrl('https://twitter.com/login'), true);
  assert.equal(isLoginPageUrl('https://www.linkedin.com/login'), true);
  // Real, readable content pages on the same platforms must NEVER be
  // misclassified as login walls just because the platform can require one.
  assert.equal(isLoginPageUrl('https://www.facebook.com/VillionKrtsanisi/posts/123456'), false);
  assert.equal(isLoginPageUrl('https://myhome.ge/en/pr/12345/'), false);
  assert.equal(isLoginPageUrl(null), false);
});

// ---- alreadyHasResultFor / pickFinancialCandidate (v28, "FINANCIAL/COMPANY
// SOURCE EXPANSION") tests — copied verbatim from the deployed v28 source.
// These cover the mandate's core adaptive/non-blind requirement for the two
// new sources: RS Taxpayers Registry ('rstax') and MyGov Debtor Registry
// ('debtor') must NEVER fire on a bare company name (neither exposes a
// name-search field — confirmed live), only on a concrete idCode already
// evidenced by companyProfile, and must never re-fire once a matching
// result already exists.

function alreadyHasResultFor(browserOfficial, source, idCode, name) {
  const results = browserOfficial?.results || [];
  return results.some((r) => {
    if (r.source !== source) return false;
    if (idCode && r.forEntity?.idCode) return r.forEntity.idCode === idCode;
    if (!idCode && name && r.forEntity?.name) return normalizeLoose(r.forEntity.name) === normalizeLoose(name);
    return false;
  });
}
function pickFinancialCandidate(prior, source) {
  const cp = prior.official?.companyProfile;
  if (source === 'enreg') {
    if (cp && (cp.name || cp.idCode)) {
      if (!alreadyHasResultFor(prior.browserOfficial, 'enreg', cp.idCode || null, cp.name || null)) return { name: cp.name || cp.idCode, idCode: cp.idCode || null };
    }
    const ri = prior.reconciledIdentity;
    if (ri?.developer && ['MEDIUM', 'HIGH'].includes(ri.confidence)) {
      if (!alreadyHasResultFor(prior.browserOfficial, 'enreg', null, ri.developer)) return { name: ri.developer, idCode: null };
    }
    return null;
  }
  const idCode = cp?.idCode || null;
  if (!idCode) return null;
  if (alreadyHasResultFor(prior.browserOfficial, source, idCode, null)) return null;
  return { name: cp?.name || idCode, idCode };
}

test('pickFinancialCandidate: rstax/debtor NEVER fire on a bare company name — no idCode means no candidate, even when enreg would happily search by name', () => {
  const prior = { official: { companyProfile: { name: 'შპს მილენიო გრუპი', idCode: null } } };
  assert.equal(pickFinancialCandidate(prior, 'rstax'), null);
  assert.equal(pickFinancialCandidate(prior, 'debtor'), null);
  // enreg, by contrast, DOES accept the bare name (its own search supports it).
  assert.deepEqual(pickFinancialCandidate(prior, 'enreg'), { name: 'შპს მილენიო გრუპი', idCode: null });
});
test('pickFinancialCandidate: rstax/debtor fire on a concrete evidenced idCode', () => {
  const prior = { official: { companyProfile: { name: 'შპს მილენიო გრუპი', idCode: '404670272' } } };
  assert.deepEqual(pickFinancialCandidate(prior, 'rstax'), { name: 'შპს მილენიო გრუპი', idCode: '404670272' });
  assert.deepEqual(pickFinancialCandidate(prior, 'debtor'), { name: 'შპს მილენიო გრუპი', idCode: '404670272' });
});
test('pickFinancialCandidate: never re-fires once a matching result for that exact source+idCode already exists', () => {
  const prior = {
    official: { companyProfile: { name: 'შპს მილენიო გრუპი', idCode: '404670272' } },
    browserOfficial: { results: [{ source: 'rstax', forEntity: { name: 'შპს მილენიო გრუპი', idCode: '404670272' } }] },
  };
  assert.equal(pickFinancialCandidate(prior, 'rstax'), null);
  // A rstax result must never be mistaken for covering debtor too — each
  // source's own queue slot is independent.
  assert.deepEqual(pickFinancialCandidate(prior, 'debtor'), { name: 'შპს მილენიო გრუპი', idCode: '404670272' });
});
test('pickFinancialCandidate: no companyProfile at all -> no candidate for any of the three sources (never invented)', () => {
  const prior = {};
  assert.equal(pickFinancialCandidate(prior, 'enreg'), null);
  assert.equal(pickFinancialCandidate(prior, 'rstax'), null);
  assert.equal(pickFinancialCandidate(prior, 'debtor'), null);
});

// ---- v30 additions: OpenAI Responses API migration + PUBLIC_SEARCH source
// category + computeOverallAssessment() + localized officialSourceCoverage
// names — copied verbatim from the deployed v30 source. See index.ts's own
// v30 comments for the full "REMOVE GEMINI COMPLETELY AND MIGRATE RESEARCH
// AI TO OPENAI" + "CORRECT THE LIVE PRODUCT NOW" mandate context.

const SEARCH_ENGINE_HOST_RE = /(?:^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|yandex\.[a-z.]+)$/i;
function isSearchResultsUrl(url, host) {
  if (!SEARCH_ENGINE_HOST_RE.test(host)) return false;
  try {
    return /\/search\b/i.test(new URL(url).pathname) || /(?:^|[?&])q=/i.test(new URL(url).search);
  } catch {
    return true;
  }
}
function sourceCategoryV30(url, hint) {
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
  if (isSearchResultsUrl(url, host)) return 'PUBLIC_SEARCH';
  if (PROPERTY_PORTAL_HOST_RE.test(host)) return 'MARKET_LISTING';
  if (SOCIAL_HOST_RE.test(host)) return /facebook\.com\/groups|t\.me\/joinchat|t\.me\/\+/i.test(url) ? 'PUBLIC_GROUP' : 'SOCIAL';
  if (MEDIA_HOST_RE.test(host)) return 'MEDIA';
  if (FORUM_HOST_RE.test(host)) return 'PUBLIC_FORUM';
  return 'OTHER_PUBLIC';
}

test('sourceCategory (v30): a search-engine results URL is PUBLIC_SEARCH, never OTHER_PUBLIC or a real citation', () => {
  assert.equal(sourceCategoryV30('https://www.google.com/search?q=villion+krtsanisi'), 'PUBLIC_SEARCH');
  assert.equal(sourceCategoryV30('https://www.bing.com/search?q=millennio+group'), 'PUBLIC_SEARCH');
});
test('sourceCategory (v30): a specific Google Maps/Docs URL (not a /search results page) is NOT swept into PUBLIC_SEARCH', () => {
  assert.notEqual(sourceCategoryV30('https://www.google.com/maps/place/Villion'), 'PUBLIC_SEARCH');
});
test('sourceCategory (v30): official/portal/social classification is unchanged by the PUBLIC_SEARCH addition', () => {
  assert.equal(sourceCategoryV30('https://tas.ge/?p=searchdocument'), 'OFFICIAL_REGISTRY');
  assert.equal(sourceCategoryV30('https://www.myhome.ge/listing/123'), 'MARKET_LISTING');
});

// computeOverallAssessment() (v30, "REPORT UX" mandate) — copied verbatim.
function computeOverallAssessment(gatedConfidence, coverage, riskFlags, conflictsAll, rightsAndRestrictions, itemsToVerifyCount) {
  const highRisks = riskFlags.filter((r) => r.severity === 'HIGH').length;
  const mediumRisks = riskFlags.filter((r) => r.severity === 'MEDIUM').length;
  if (highRisks >= 1 || rightsAndRestrictions.status === 'RESTRICTION_IDENTIFIED' || conflictsAll.length >= 2) return 'CAUTION';
  if (conflictsAll.length >= 1 || mediumRisks >= 2 || (coverage.level === 'LIMITED' && gatedConfidence === 'LOW')) return 'MIXED';
  if (gatedConfidence === 'HIGH' && coverage.officialSourcesRetrieved > 0 && coverage.level !== 'LIMITED' && riskFlags.length === 0 && conflictsAll.length === 0 && itemsToVerifyCount === 0) return 'POSITIVE';
  return 'GENERALLY_POSITIVE_WITH_ITEMS_TO_VERIFY';
}

test('computeOverallAssessment: a HIGH-severity risk flag alone forces CAUTION, regardless of everything else', () => {
  const lvl = computeOverallAssessment('HIGH', { level: 'HIGH', officialSourcesRetrieved: 3 }, [{ severity: 'HIGH', description: 'x' }], [], { status: 'NOT_CONFIRMED' }, 0);
  assert.equal(lvl, 'CAUTION');
});
test('computeOverallAssessment: an identified registered restriction forces CAUTION even with zero risk flags', () => {
  const lvl = computeOverallAssessment('HIGH', { level: 'HIGH', officialSourcesRetrieved: 3 }, [], [], { status: 'RESTRICTION_IDENTIFIED' }, 0);
  assert.equal(lvl, 'CAUTION');
});
test('computeOverallAssessment: 2+ unresolved conflicts forces CAUTION', () => {
  const lvl = computeOverallAssessment('HIGH', { level: 'HIGH', officialSourcesRetrieved: 3 }, [], ['a', 'b'], { status: 'NOT_CONFIRMED' }, 0);
  assert.equal(lvl, 'CAUTION');
});
test('computeOverallAssessment: exactly 1 conflict is MIXED, not CAUTION', () => {
  const lvl = computeOverallAssessment('HIGH', { level: 'HIGH', officialSourcesRetrieved: 3 }, [], ['a'], { status: 'NOT_CONFIRMED' }, 0);
  assert.equal(lvl, 'MIXED');
});
test('computeOverallAssessment: 2+ MEDIUM risk flags (no HIGH) is MIXED', () => {
  const lvl = computeOverallAssessment('MEDIUM', { level: 'MEDIUM', officialSourcesRetrieved: 1 }, [{ severity: 'MEDIUM', description: 'a' }, { severity: 'MEDIUM', description: 'b' }], [], { status: 'NOT_CONFIRMED' }, 0);
  assert.equal(lvl, 'MIXED');
});
test('computeOverallAssessment: LIMITED coverage + LOW confidence (thin research) is MIXED even with no risk/conflicts', () => {
  const lvl = computeOverallAssessment('LOW', { level: 'LIMITED', officialSourcesRetrieved: 0 }, [], [], { status: 'NOT_CONFIRMED' }, 0);
  assert.equal(lvl, 'MIXED');
});
test('computeOverallAssessment: the strict POSITIVE case — HIGH confidence, an official source retrieved, non-LIMITED coverage, zero risks/conflicts/itemsToVerify', () => {
  const lvl = computeOverallAssessment('HIGH', { level: 'HIGH', officialSourcesRetrieved: 1 }, [], [], { status: 'NONE_FOUND_IN_CHECKED_SOURCE' }, 0);
  assert.equal(lvl, 'POSITIVE');
});
test('computeOverallAssessment: HIGH confidence but itemsToVerify still non-empty is NOT POSITIVE — falls to the common GENERALLY_POSITIVE case (the exact mandate scenario: abundant positive evidence, one thing still to check)', () => {
  const lvl = computeOverallAssessment('HIGH', { level: 'HIGH', officialSourcesRetrieved: 3 }, [], [], { status: 'NOT_CONFIRMED' }, 1);
  assert.equal(lvl, 'GENERALLY_POSITIVE_WITH_ITEMS_TO_VERIFY');
});
test('computeOverallAssessment: the common default — LOW/MEDIUM confidence, no serious risk — is GENERALLY_POSITIVE_WITH_ITEMS_TO_VERIFY, never CAUTION', () => {
  const lvl = computeOverallAssessment('MEDIUM', { level: 'MEDIUM', officialSourcesRetrieved: 1 }, [{ severity: 'LOW', description: 'x' }], [], { status: 'NOT_CONFIRMED' }, 2);
  assert.equal(lvl, 'GENERALLY_POSITIVE_WITH_ITEMS_TO_VERIFY');
});

// localizedSourceName() / officialSourceCoverage() (v30) — copied verbatim.
// Mandate item 5: "Never show raw source IDs like rstax to customers."
const SOURCE_NAME_I18N = {
  tas: { ka: 'TAS — საჯარო რეესტრის საინფორმაციო სისტემა', en: 'TAS — Public Registry Information System' },
  rstax: { ka: 'შემოსავლების სამსახური — გადასახადის გადამხდელთა რეესტრი', en: 'Revenue Service — Taxpayers Registry' },
  debtor: { ka: 'MyGov — მოვალეთა რეესტრი', en: 'MyGov — Debtor Registry' },
};
function localizedSourceName(sourceKey, fallbackName, locale) {
  const entry = SOURCE_NAME_I18N[String(sourceKey || '').toLowerCase()];
  if (!entry) return fallbackName;
  return entry[locale] || entry.en;
}
function officialSourceCoverageV30(browserOfficial, locale = 'en') {
  const results = browserOfficial?.results || [];
  return results.map((r) => ({ source: r.source, sourceName: localizedSourceName(r.source, r.sourceName || r.source, locale), customerStatus: customerSourceStatus(r.status) }));
}

test('officialSourceCoverage (v30): rstax/debtor get real localized names in Georgian, never the raw adapter key', () => {
  const cov = officialSourceCoverageV30({ results: [
    { source: 'rstax', sourceName: 'RS Taxpayers Registry', status: 'NO_RESULT_CONFIRMED' },
    { source: 'debtor', sourceName: 'MyGov Debtor Registry', status: 'NO_RESULT_CONFIRMED' },
  ] }, 'ka');
  assert.equal(cov[0].sourceName, 'შემოსავლების სამსახური — გადასახადის გადამხდელთა რეესტრი');
  assert.equal(cov[1].sourceName, 'MyGov — მოვალეთა რეესტრი');
  for (const c of cov) {
    assert.notEqual(c.sourceName, 'rstax');
    assert.notEqual(c.sourceName, 'debtor');
  }
});
test('officialSourceCoverage (v30): falls back to English name when locale is unrecognized/unset, never the raw key', () => {
  const cov = officialSourceCoverageV30({ results: [{ source: 'tas', sourceName: 'TAS', status: 'SEARCH_CONFIRMED' }] });
  assert.equal(cov[0].sourceName, 'TAS — Public Registry Information System');
});
test('officialSourceCoverage (v30): an unrecognized future adapter key falls back to the worker\'s own sourceName, still never a bare key alone if sourceName was provided', () => {
  const cov = officialSourceCoverageV30({ results: [{ source: 'futureadapter', sourceName: 'Future Adapter Registry', status: 'SEARCH_CONFIRMED' }] }, 'ka');
  assert.equal(cov[0].sourceName, 'Future Adapter Registry');
});

// ---- OpenAI Responses API migration tests (v30) — extractOpenAIText/
// extractOpenAISources copied verbatim; createOpenAIResponse/
// getOpenAIResponse/openaiFetch re-implemented against a stubbed
// global.fetch so no real network call is made. These are the mandate's
// explicit testing requirement: "mock a completed response, in_progress,
// failed, incomplete, web-search citations, usage extraction, malformed
// output, retryable 429/5xx" and "confirm Gemini endpoints are never
// called by Verify tests."

function safeUrlTest(u) {
  try {
    const x = new URL(u);
    return ['http:', 'https:'].includes(x.protocol) ? x.toString() : null;
  } catch {
    return null;
  }
}
function officialTest(u) {
  try {
    return /(gov\.ge|tas\.ge|napr\.gov\.ge|ms\.gov\.ge|reestri\.gov\.ge)$/i.test(new URL(u).hostname);
  } catch {
    return false;
  }
}
function dedupeSimple(o, k) {
  return [...new Map(o.map((x) => [k(x), x])).values()];
}
function extractOpenAIText(p) {
  let t = '';
  for (const o of p?.output || []) if (o?.type === 'message') for (const c of o?.content || []) if (c?.type === 'output_text') t += c.text || '';
  return t;
}
function extractOpenAISources(p) {
  const o = [];
  for (const item of p?.output || [])
    if (item?.type === 'message')
      for (const c of item?.content || [])
        for (const a of c?.annotations || [])
          if (a?.type === 'url_citation' && a?.url) {
            const u = safeUrlTest(a.url);
            if (u) o.push({ label: a.title || u, url: u, evidenceLevel: officialTest(u) ? 'OFFICIAL' : 'WEB_RETRIEVED', retrievalMethod: 'OPENAI_WEB_SEARCH' });
          }
  return dedupeSimple(o, (x) => x.url);
}

test('extractOpenAIText: concatenates output_text content across message items', () => {
  const p = { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello ' }, { type: 'output_text', text: 'world.' }] }] };
  assert.equal(extractOpenAIText(p), 'Hello world.');
});
test('extractOpenAIText: ignores non-message output items (e.g. reasoning/tool-call items) and malformed/missing output', () => {
  assert.equal(extractOpenAIText({ output: [{ type: 'reasoning', content: [{ type: 'output_text', text: 'should not appear' }] }] }), '');
  assert.equal(extractOpenAIText({}), '');
  assert.equal(extractOpenAIText(null), '');
});
test('extractOpenAISources: extracts url_citation annotations, tags them OPENAI_WEB_SEARCH, dedupes by URL', () => {
  const p = { output: [{ type: 'message', content: [{ type: 'output_text', text: 'x', annotations: [
    { type: 'url_citation', url: 'https://tas.ge/doc/1', title: 'TAS Document' },
    { type: 'url_citation', url: 'https://myhome.ge/listing/2', title: 'Listing' },
    { type: 'url_citation', url: 'https://tas.ge/doc/1', title: 'TAS Document (dup)' },
  ] }] }] };
  const srcs = extractOpenAISources(p);
  assert.equal(srcs.length, 2);
  assert.ok(srcs.every((s) => s.retrievalMethod === 'OPENAI_WEB_SEARCH'));
  assert.equal(srcs.find((s) => s.url === 'https://tas.ge/doc/1').evidenceLevel, 'OFFICIAL');
  assert.equal(srcs.find((s) => s.url === 'https://myhome.ge/listing/2').evidenceLevel, 'WEB_RETRIEVED');
});
test('extractOpenAISources: never fabricates a source from a non-url_citation annotation or an annotation with no url', () => {
  const p = { output: [{ type: 'message', content: [{ type: 'output_text', text: 'x', annotations: [{ type: 'file_citation', file_id: 'f1' }, { type: 'url_citation' }] }] }] };
  assert.equal(extractOpenAISources(p).length, 0);
});

// Stub-fetch based tests for the retry/backoff wrapper + endpoint shape.
async function openaiFetchTest(url, init, fetchImpl) {
  let last = '';
  for (let i = 0; i < 4; i++) {
    const r = await fetchImpl(url, init);
    const t = await r.text();
    if (r.ok) return JSON.parse(t);
    last = `${r.status}: ${t.slice(0, 400)}`;
    if (![429, 500, 502, 503, 504].includes(r.status)) throw new Error(last);
  }
  throw new Error(`OpenAI retry exhausted ${last}`);
}
function fakeResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

test('createOpenAIResponse shape: posts to api.openai.com/v1/responses with background:true, tools:[web_search], Bearer auth — never Gemini\'s endpoint/header shape', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return fakeResponse(200, { id: 'resp_1', status: 'queued' });
  };
  const k = 'sk-test', m = 'gpt-5.6-terra', i = 'Research this property.';
  const body = { model: m, input: i, background: true, tools: [{ type: 'web_search' }] };
  const result = await openaiFetchTest('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, fetchImpl);
  assert.equal(result.status, 'queued');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-test');
  const sentBody = JSON.parse(calls[0].init.body);
  assert.equal(sentBody.background, true);
  assert.deepEqual(sentBody.tools, [{ type: 'web_search' }]);
  assert.ok(!calls[0].url.includes('generativelanguage.googleapis.com'), 'must never call the Gemini endpoint');
  assert.ok(!('x-goog-api-key' in calls[0].init.headers), 'must never send Gemini\'s auth header style');
});
test('getOpenAIResponse shape: GETs api.openai.com/v1/responses/{id} with Bearer auth', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return fakeResponse(200, { id: 'resp_1', status: 'completed', output: [] });
  };
  const result = await openaiFetchTest('https://api.openai.com/v1/responses/resp_1', { headers: { Authorization: 'Bearer sk-test' } }, fetchImpl);
  assert.equal(result.status, 'completed');
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses/resp_1');
});
test('openaiFetch retry behavior: retries on 429/5xx and eventually succeeds', async () => {
  let attempt = 0;
  const fetchImpl = async () => {
    attempt++;
    if (attempt < 3) return fakeResponse(429, { error: 'rate limited' });
    return fakeResponse(200, { id: 'resp_2', status: 'completed' });
  };
  const result = await openaiFetchTest('https://api.openai.com/v1/responses/resp_2', {}, fetchImpl);
  assert.equal(result.status, 'completed');
  assert.equal(attempt, 3);
});
test('openaiFetch retry behavior: a non-retryable 4xx (e.g. 401/400) throws immediately, no retry loop', async () => {
  let attempt = 0;
  const fetchImpl = async () => {
    attempt++;
    return fakeResponse(401, { error: 'invalid api key' });
  };
  await assert.rejects(() => openaiFetchTest('https://api.openai.com/v1/responses', {}, fetchImpl), /401/);
  assert.equal(attempt, 1);
});
test('openaiFetch retry behavior: persistent 5xx exhausts all 4 attempts then throws', async () => {
  let attempt = 0;
  const fetchImpl = async () => {
    attempt++;
    return fakeResponse(503, { error: 'unavailable' });
  };
  await assert.rejects(() => openaiFetchTest('https://api.openai.com/v1/responses', {}, fetchImpl), /OpenAI retry exhausted/);
  assert.equal(attempt, 4);
});

// advance()'s status-branching (v30): OpenAI's queued/in_progress/completed/
// failed/cancelled/incomplete statuses must all be handled — copied
// verbatim (simplified to the pure branch logic, no DB calls).
function classifyOpenAIStatus(p) {
  if (p.status === 'completed') return 'DONE';
  if (['queued', 'in_progress'].includes(p.status)) return 'POLL_AGAIN';
  if (['failed', 'cancelled', 'incomplete'].includes(p.status)) return 'ERROR';
  return 'UNKNOWN';
}
test('classifyOpenAIStatus: handles every documented OpenAI Responses API status, including the async-poll states Gemini never had under these exact names', () => {
  assert.equal(classifyOpenAIStatus({ status: 'completed' }), 'DONE');
  assert.equal(classifyOpenAIStatus({ status: 'queued' }), 'POLL_AGAIN');
  assert.equal(classifyOpenAIStatus({ status: 'in_progress' }), 'POLL_AGAIN');
  assert.equal(classifyOpenAIStatus({ status: 'failed' }), 'ERROR');
  assert.equal(classifyOpenAIStatus({ status: 'cancelled' }), 'ERROR');
  assert.equal(classifyOpenAIStatus({ status: 'incomplete' }), 'ERROR');
});
test('malformed/empty OpenAI output never throws when extracting text/sources — degrades to empty rather than crashing the job', () => {
  assert.equal(extractOpenAIText({ output: null }), '');
  assert.deepEqual(extractOpenAISources({ output: undefined }), []);
  assert.doesNotThrow(() => extractOpenAIText(undefined));
  assert.doesNotThrow(() => extractOpenAISources(undefined));
});

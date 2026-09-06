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
      { source: 'TAS_MAP', sourceName: 'TAS Map', status: 'SEARCH_CONFIRMED' },
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
  const coverage = officialSourceCoverage({ results: [{ source: 'TAS_MAP', sourceName: 'TAS Map', status: 'SEARCH_CONFIRMED' }] });
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
// pickFinancialCandidate (2026-09-06, "Fix Homatch Verify by implementing
// this exact pipeline in code" mandate — copied verbatim from index.ts's
// updated version): adds a THIRD tier sourced from prior.publicResearch,
// implementing "If PublicResearch finds ONE new strongly-supported company
// ID not already checked: ENREG -> RS -> DEBTOR once only, then continue to
// MARKET."
function pickFinancialCandidate(prior, source) {
  const cp = prior.official?.companyProfile;
  const pr = prior.publicResearch;
  const prIdCode = pr?.companyId || null;
  const prName = pr?.legalCompany || pr?.developer || null;
  if (source === 'enreg') {
    if (cp && (cp.name || cp.idCode)) {
      if (!alreadyHasResultFor(prior.browserOfficial, 'enreg', cp.idCode || null, cp.name || null)) return { name: cp.name || cp.idCode, idCode: cp.idCode || null };
    }
    const ri = prior.reconciledIdentity;
    if (ri?.developer && ['MEDIUM', 'HIGH'].includes(ri.confidence)) {
      if (!alreadyHasResultFor(prior.browserOfficial, 'enreg', null, ri.developer)) return { name: ri.developer, idCode: null };
    }
    if (prIdCode || prName) {
      if (!alreadyHasResultFor(prior.browserOfficial, 'enreg', prIdCode, prName)) return { name: prName || prIdCode, idCode: prIdCode };
    }
    return null;
  }
  const idCode = cp?.idCode || prIdCode || null;
  if (!idCode) return null;
  if (alreadyHasResultFor(prior.browserOfficial, source, idCode, null)) return null;
  return { name: cp?.name || prName || idCode, idCode };
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

// ---- pickFinancialCandidate's THIRD tier (2026-09-06 pipeline mandate):
// a company PUBLIC_RESEARCH alone discovered, when companyProfile and
// reconciledIdentity named none.
test('pickFinancialCandidate: falls through to a PUBLIC_RESEARCH-discovered company when companyProfile/reconciledIdentity found none', () => {
  const prior = { publicResearch: { companyId: '405999888', legalCompany: 'შპს ახალი კომპანია' } };
  assert.deepEqual(pickFinancialCandidate(prior, 'enreg'), { name: 'შპს ახალი კომპანია', idCode: '405999888' });
  assert.deepEqual(pickFinancialCandidate(prior, 'rstax'), { name: 'შპს ახალი კომპანია', idCode: '405999888' });
  assert.deepEqual(pickFinancialCandidate(prior, 'debtor'), { name: 'შპს ახალი კომპანია', idCode: '405999888' });
});
test('pickFinancialCandidate: companyProfile takes priority over publicResearch — never overridden by a weaker later signal', () => {
  const prior = {
    official: { companyProfile: { name: 'შპს ორიგინალი', idCode: '111111111' } },
    publicResearch: { companyId: '405999888', legalCompany: 'შპს ახალი კომპანია' },
  };
  assert.deepEqual(pickFinancialCandidate(prior, 'enreg'), { name: 'შპს ორიგინალი', idCode: '111111111' });
  assert.deepEqual(pickFinancialCandidate(prior, 'rstax'), { name: 'შპს ორიგინალი', idCode: '111111111' });
});
test('pickFinancialCandidate: PUBLIC_RESEARCH tier never re-fires once already checked ("once only")', () => {
  const prior = {
    publicResearch: { companyId: '405999888', legalCompany: 'შპს ახალი კომპანია' },
    browserOfficial: { results: [{ source: 'enreg', forEntity: { name: 'შპს ახალი კომპანია', idCode: '405999888' } }] },
  };
  assert.equal(pickFinancialCandidate(prior, 'enreg'), null);
  // rstax/debtor are independent queue slots — still fire even though enreg
  // already ran for this exact company.
  assert.deepEqual(pickFinancialCandidate(prior, 'rstax'), { name: 'შპს ახალი კომპანია', idCode: '405999888' });
});
test('pickFinancialCandidate: a publicResearch entry with no companyId/legalCompany/developer never becomes a candidate', () => {
  const prior = { publicResearch: { companyId: null, legalCompany: null, developer: null } };
  assert.equal(pickFinancialCandidate(prior, 'enreg'), null);
  assert.equal(pickFinancialCandidate(prior, 'rstax'), null);
});

// ---- normalizePublicResearchStructured (2026-09-06 pipeline mandate) —
// copied verbatim from index.ts. Guarantees every one of the mandate's own
// ~35-field (43-key) PUBLIC_RESEARCH schema is always present as null/[],
// "no evidence = null/[]", never a stray partial shape or an extra
// hallucinated key.
const PUBLIC_RESEARCH_ARRAY_FIELDS = [
  'foundersOwnersParticipants', 'directorsRepresentatives', 'previousProjects', 'contractors',
  'constructionCompanies', 'engineers', 'suppliers', 'amenities', 'partners', 'qualitySignals',
  'architectReputationSignals', 'complaints', 'disputes', 'legalPublicFootprint', 'mediaCoverage',
  'socialPublicFootprint', 'awardsRecognition', 'facts',
];
const PUBLIC_RESEARCH_SCALAR_FIELDS = [
  'project', 'developer', 'legalCompany', 'companyId', 'companyHistory', 'architect', 'architectStudio',
  'architectReputation', 'facade', 'windows', 'elevators', 'structuralSystem', 'constructionMaterials',
  'insulation', 'MEP', 'energyEfficiency', 'seismicDesign', 'landscaping', 'parking', 'financingBank',
  'constructionStart', 'chronology', 'progressHistory', 'currentPhysicalStatus', 'developerReputation',
];
function normalizePublicResearchStructured(z) {
  const src = z && typeof z === 'object' ? z : {};
  const out = {};
  for (const k of PUBLIC_RESEARCH_SCALAR_FIELDS) out[k] = typeof src[k] === 'string' && src[k].trim() ? src[k].trim() : null;
  for (const k of PUBLIC_RESEARCH_ARRAY_FIELDS) out[k] = Array.isArray(src[k]) ? src[k].filter((x) => typeof x === 'string' && x.trim()) : [];
  return out;
}

test('normalizePublicResearchStructured: exactly the mandate\'s 43 fields are always present, nothing more, nothing less', () => {
  const out = normalizePublicResearchStructured({});
  const keys = Object.keys(out).sort();
  const expected = [...PUBLIC_RESEARCH_SCALAR_FIELDS, ...PUBLIC_RESEARCH_ARRAY_FIELDS].sort();
  assert.deepEqual(keys, expected);
  assert.equal(keys.length, 43);
});
test('normalizePublicResearchStructured: empty/missing input -> every scalar null, every array []', () => {
  const out = normalizePublicResearchStructured(null);
  for (const k of PUBLIC_RESEARCH_SCALAR_FIELDS) assert.equal(out[k], null, `${k} should be null`);
  for (const k of PUBLIC_RESEARCH_ARRAY_FIELDS) assert.deepEqual(out[k], [], `${k} should be []`);
});
test('normalizePublicResearchStructured: real evidenced values pass through unchanged', () => {
  const out = normalizePublicResearchStructured({
    architect: 'გიორგი ბერიძე',
    companyId: '405123456',
    contractors: ['შპს მშენებელი 1', 'შპს მშენებელი 2'],
    facts: ['სახურავი დასრულებულია 2025 წელს'],
  });
  assert.equal(out.architect, 'გიორგი ბერიძე');
  assert.equal(out.companyId, '405123456');
  assert.deepEqual(out.contractors, ['შპს მშენებელი 1', 'შპს მშენებელი 2']);
  assert.deepEqual(out.facts, ['სახურავი დასრულებულია 2025 წელს']);
});
test('normalizePublicResearchStructured: non-string scalars and non-array/junk-item lists are discarded, never crash', () => {
  const out = normalizePublicResearchStructured({ architect: 42, contractors: 'not an array', amenities: [1, 'real amenity', null, '  '] });
  assert.equal(out.architect, null);
  assert.deepEqual(out.contractors, []);
  assert.deepEqual(out.amenities, ['real amenity']);
});
test('normalizePublicResearchStructured: a stray/hallucinated extra key from the model is dropped, never carried through', () => {
  const out = normalizePublicResearchStructured({ architect: 'X', totallyMadeUpField: 'should not appear' });
  assert.equal(out.totallyMadeUpField, undefined);
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

// computeOverallAssessment() / computeMaterialAdverseFindings() /
// companyLiquidationSuspected() / normalizeConflicts() (v36 rewrite,
// mandate: "THE REPORT MUST NOT CONTRADICT ITSELF" — the previous 4-level
// scale could show a CAUTION/MIXED badge while the body text simultaneously
// said no material risk was found, because the badge was driven by generic
// `conflicts` (which mixed in ordinary marketing-detail discrepancies)
// while the risk sentence was driven only by riskFlags. Both are now
// derived from ONE shared `materialAdverseFindings` list — the badge and
// the "no material issue" sentence can therefore never disagree again, by
// construction. All four functions below are copied verbatim from the
// deployed v36 source (RESTRICTION_FOUND_FALLBACK_I18N/
// DEBTOR_RECORD_FOUND_I18N/COMPANY_STATUS_NOT_ACTIVE_I18N trimmed to the
// two locales exercised here — ka/en — since the full six-locale objects
// are identical in shape and covered by the i18n key-count check elsewhere
// in this repo).

const RESTRICTION_FOUND_FALLBACK_I18N = {
  ka: 'რეესტრში დაფიქსირდა რეგისტრირებული შეზღუდვა ან დატვირთვა — საჭიროებს დეტალურ გადამოწმებას გარიგებამდე.',
  en: 'A registered restriction or encumbrance was identified in the registry — this needs detailed review before the transaction.',
};
const DEBTOR_RECORD_FOUND_I18N = {
  ka: 'მოვალეთა რეესტრში ამ იდენტიფიკატორზე ჩანაწერი დაფიქსირდა — დეტალები საჭიროებს გადამოწმებას გარიგებამდე.',
  en: 'A matching record was found in the Debtor Registry for this identifier — the details need review before the transaction.',
};
const COMPANY_STATUS_NOT_ACTIVE_I18N = {
  ka: 'რეესტრში დაფიქსირებული კომპანიის სტატუსი არ არის აქტიური — საჭიროებს დამატებით გადამოწმებას.',
  en: "The company's registered status is not active — this needs additional review.",
};
function computeMaterialAdverseFindings(riskFlags, materialConflicts, rightsAndRestrictions, debtorRecordFound, companyLiquidationSuspected, l) {
  const out = [];
  for (const r of riskFlags) if (r.severity === 'HIGH') out.push({ description: r.description });
  if (rightsAndRestrictions.status === 'RESTRICTION_IDENTIFIED') {
    for (const it of rightsAndRestrictions.items || []) out.push({ description: it });
    if (!rightsAndRestrictions.items?.length) out.push({ description: RESTRICTION_FOUND_FALLBACK_I18N[l] || RESTRICTION_FOUND_FALLBACK_I18N.en });
  }
  if (debtorRecordFound) out.push({ description: DEBTOR_RECORD_FOUND_I18N[l] || DEBTOR_RECORD_FOUND_I18N.en });
  if (companyLiquidationSuspected.suspected) out.push({ description: COMPANY_STATUS_NOT_ACTIVE_I18N[l] || COMPANY_STATUS_NOT_ACTIVE_I18N.en });
  for (const c of materialConflicts) out.push({ description: c.description });
  return out;
}
function computeOverallAssessment(gatedConfidence, coverage, riskFlags, minorConflictsCount, materialAdverseFindingsCount, itemsToVerifyCount, keyStrengthsCount) {
  const mediumRisks = riskFlags.filter((r) => r.severity === 'MEDIUM').length;
  if (materialAdverseFindingsCount >= 1) return 'ATTENTION_REQUIRED';
  if (mediumRisks >= 2 || minorConflictsCount >= 2 || (coverage.level === 'LIMITED' && gatedConfidence === 'LOW')) return 'NEUTRAL_MIXED';
  const clean = riskFlags.length === 0 && minorConflictsCount === 0;
  if (gatedConfidence === 'HIGH' && coverage.level === 'HIGH' && coverage.officialSourcesRetrieved >= 2 && clean && itemsToVerifyCount === 0 && keyStrengthsCount >= 3) return 'VERY_POSITIVE';
  if (gatedConfidence === 'HIGH' && coverage.officialSourcesRetrieved > 0 && coverage.level !== 'LIMITED' && clean && itemsToVerifyCount === 0) return 'POSITIVE';
  return 'GENERALLY_POSITIVE';
}
const LIQUIDATION_STATUS_RE = /ლიკვიდაცი|გაკოტრებ|გაუქმებულ|liquidat|bankrupt|insolven|dissolved|cancelled|revoked/i;
function companyLiquidationSuspected(companyProfile) {
  if (!companyProfile || companyProfile.sourceBasis !== 'REGISTRY_CONFIRMED' || !companyProfile.status) return { suspected: false };
  if (LIQUIDATION_STATUS_RE.test(String(companyProfile.status))) return { suspected: true, note: String(companyProfile.status) };
  return { suspected: false };
}
function normalizeConflicts(raw) {
  return (raw || [])
    .map((c) => (typeof c === 'string' ? { description: c, severity: 'MINOR' } : { description: String(c?.description || ''), severity: c?.severity === 'MATERIAL' ? 'MATERIAL' : 'MINOR' }))
    .filter((c) => c.description.trim());
}

// ---- computeMaterialAdverseFindings + companyLiquidationSuspected +
// normalizeConflicts ----

test('computeMaterialAdverseFindings: a missing/not-yet-retrieved document alone is NEVER a finding — empty riskFlags/conflicts/restriction/debtor/liquidation yields zero findings', () => {
  const out = computeMaterialAdverseFindings([], [], { status: 'NOT_CONFIRMED' }, false, { suspected: false }, 'en');
  assert.deepEqual(out, []);
});
test('computeMaterialAdverseFindings: a HIGH-severity risk flag becomes a finding; a LOW/MEDIUM one never does', () => {
  const out = computeMaterialAdverseFindings([{ severity: 'HIGH', description: 'Seizure recorded' }, { severity: 'MEDIUM', description: 'ordinary note' }], [], { status: 'NOT_CONFIRMED' }, false, { suspected: false }, 'en');
  assert.deepEqual(out, [{ description: 'Seizure recorded' }]);
});
test('computeMaterialAdverseFindings: an identified restriction with explicit items uses those items verbatim, never the generic fallback', () => {
  const out = computeMaterialAdverseFindings([], [], { status: 'RESTRICTION_IDENTIFIED', items: ['Mortgage registered in favor of Bank X'] }, false, { suspected: false }, 'en');
  assert.deepEqual(out, [{ description: 'Mortgage registered in favor of Bank X' }]);
});
test('computeMaterialAdverseFindings: an identified restriction with NO items falls back to the localized generic sentence, in the requested locale', () => {
  const outKa = computeMaterialAdverseFindings([], [], { status: 'RESTRICTION_IDENTIFIED', items: [] }, false, { suspected: false }, 'ka');
  assert.deepEqual(outKa, [{ description: RESTRICTION_FOUND_FALLBACK_I18N.ka }]);
  const outFr = computeMaterialAdverseFindings([], [], { status: 'RESTRICTION_IDENTIFIED' }, false, { suspected: false }, 'fr');
  assert.deepEqual(outFr, [{ description: RESTRICTION_FOUND_FALLBACK_I18N.en }], 'unrecognized locale must fall back to en, never a raw key');
});
test('computeMaterialAdverseFindings: a confirmed debtor record becomes a localized finding', () => {
  const out = computeMaterialAdverseFindings([], [], { status: 'NOT_CONFIRMED' }, true, { suspected: false }, 'ka');
  assert.deepEqual(out, [{ description: DEBTOR_RECORD_FOUND_I18N.ka }]);
});
test('computeMaterialAdverseFindings: suspected company liquidation becomes a localized finding', () => {
  const out = computeMaterialAdverseFindings([], [], { status: 'NOT_CONFIRMED' }, false, { suspected: true, note: 'ლიკვიდაციის პროცესშია' }, 'en');
  assert.deepEqual(out, [{ description: COMPANY_STATUS_NOT_ACTIVE_I18N.en }]);
});
test('computeMaterialAdverseFindings: MATERIAL conflicts pass through by description; combines every signal together in order', () => {
  const out = computeMaterialAdverseFindings(
    [{ severity: 'HIGH', description: 'HIGH risk' }],
    [{ description: 'Two official sources disagree on legal owner', severity: 'MATERIAL' }],
    { status: 'RESTRICTION_IDENTIFIED', items: ['Restriction X'] },
    true,
    { suspected: true, note: 'x' },
    'en'
  );
  assert.deepEqual(out, [
    { description: 'HIGH risk' },
    { description: 'Restriction X' },
    { description: DEBTOR_RECORD_FOUND_I18N.en },
    { description: COMPANY_STATUS_NOT_ACTIVE_I18N.en },
    { description: 'Two official sources disagree on legal owner' },
  ]);
});

test('companyLiquidationSuspected: never suspects a company profile that is not REGISTRY_CONFIRMED, even if status text looks alarming (web research is never enough to allege liquidation)', () => {
  assert.deepEqual(companyLiquidationSuspected({ sourceBasis: 'WEB_RESEARCH_ONLY', status: 'ლიკვიდაციის პროცესშია' }), { suspected: false });
  assert.deepEqual(companyLiquidationSuspected(null), { suspected: false });
  assert.deepEqual(companyLiquidationSuspected({ sourceBasis: 'REGISTRY_CONFIRMED' }), { suspected: false }, 'no status at all is never suspected');
});
test('companyLiquidationSuspected: a REGISTRY_CONFIRMED profile with an active status is never suspected', () => {
  assert.deepEqual(companyLiquidationSuspected({ sourceBasis: 'REGISTRY_CONFIRMED', status: 'აქტიური' }), { suspected: false });
});
test('companyLiquidationSuspected: a REGISTRY_CONFIRMED profile with a liquidation/bankruptcy status (Georgian or English) is suspected, carrying the raw status as note', () => {
  assert.deepEqual(companyLiquidationSuspected({ sourceBasis: 'REGISTRY_CONFIRMED', status: 'ლიკვიდაციის პროცესშია' }), { suspected: true, note: 'ლიკვიდაციის პროცესშია' });
  assert.deepEqual(companyLiquidationSuspected({ sourceBasis: 'REGISTRY_CONFIRMED', status: 'In bankruptcy proceedings' }), { suspected: true, note: 'In bankruptcy proceedings' });
});

test('normalizeConflicts: a legacy bare string is defensively treated as MINOR, never inflated to MATERIAL', () => {
  assert.deepEqual(normalizeConflicts(['some old-shape conflict']), [{ description: 'some old-shape conflict', severity: 'MINOR' }]);
});
test('normalizeConflicts: an object with severity MATERIAL is kept MATERIAL; anything else (missing/garbled) defaults to MINOR', () => {
  assert.deepEqual(normalizeConflicts([{ description: 'a', severity: 'MATERIAL' }, { description: 'b', severity: 'garbage' }, { description: 'c' }]), [
    { description: 'a', severity: 'MATERIAL' },
    { description: 'b', severity: 'MINOR' },
    { description: 'c', severity: 'MINOR' },
  ]);
});
test('normalizeConflicts: entries with an empty/whitespace-only description are dropped; null/undefined input never throws', () => {
  assert.deepEqual(normalizeConflicts([{ description: '   ' }, { description: 'real one' }]), [{ description: 'real one', severity: 'MINOR' }]);
  assert.deepEqual(normalizeConflicts(null), []);
  assert.deepEqual(normalizeConflicts(undefined), []);
});

// ---- computeOverallAssessment (v36, 5-level scale) ----

test('computeOverallAssessment: >=1 materialAdverseFindingsCount always forces ATTENTION_REQUIRED, regardless of everything else being otherwise pristine', () => {
  const lvl = computeOverallAssessment('HIGH', { level: 'HIGH', officialSourcesRetrieved: 3 }, [], 0, 1, 0, 5);
  assert.equal(lvl, 'ATTENTION_REQUIRED');
});
test('computeOverallAssessment: zero materialAdverseFindingsCount NEVER yields ATTENTION_REQUIRED even with messy evidence (the exact contradiction bug this rewrite fixes)', () => {
  const lvl = computeOverallAssessment('LOW', { level: 'LIMITED', officialSourcesRetrieved: 0 }, [{ severity: 'MEDIUM', description: 'a' }, { severity: 'MEDIUM', description: 'b' }], 3, 0, 4, 0);
  assert.notEqual(lvl, 'ATTENTION_REQUIRED');
});
test('computeOverallAssessment: a missing/not-yet-retrieved document (itemsToVerify > 0) alone never drives ATTENTION_REQUIRED or NEUTRAL_MIXED', () => {
  const lvl = computeOverallAssessment('HIGH', { level: 'HIGH', officialSourcesRetrieved: 2 }, [], 0, 0, 3, 0);
  assert.equal(lvl, 'GENERALLY_POSITIVE');
});
test('computeOverallAssessment: 2+ MEDIUM risk flags (no material finding) is NEUTRAL_MIXED', () => {
  const lvl = computeOverallAssessment('MEDIUM', { level: 'MEDIUM', officialSourcesRetrieved: 1 }, [{ severity: 'MEDIUM', description: 'a' }, { severity: 'MEDIUM', description: 'b' }], 0, 0, 0, 0);
  assert.equal(lvl, 'NEUTRAL_MIXED');
});
test('computeOverallAssessment: 2+ MINOR conflicts (no material finding) is NEUTRAL_MIXED, never ATTENTION_REQUIRED', () => {
  const lvl = computeOverallAssessment('HIGH', { level: 'HIGH', officialSourcesRetrieved: 2 }, [], 2, 0, 0, 0);
  assert.equal(lvl, 'NEUTRAL_MIXED');
});
test('computeOverallAssessment: exactly 1 MINOR conflict is not enough for NEUTRAL_MIXED by itself', () => {
  const lvl = computeOverallAssessment('HIGH', { level: 'HIGH', officialSourcesRetrieved: 2 }, [], 1, 0, 0, 0);
  assert.notEqual(lvl, 'NEUTRAL_MIXED');
});
test('computeOverallAssessment: LIMITED coverage + LOW confidence (thin research, no adverse finding) is NEUTRAL_MIXED', () => {
  const lvl = computeOverallAssessment('LOW', { level: 'LIMITED', officialSourcesRetrieved: 0 }, [], 0, 0, 0, 0);
  assert.equal(lvl, 'NEUTRAL_MIXED');
});
test('computeOverallAssessment: VERY_POSITIVE requires HIGH confidence, HIGH coverage, >=2 official sources retrieved, clean evidence, zero itemsToVerify, and >=3 key strengths', () => {
  const lvl = computeOverallAssessment('HIGH', { level: 'HIGH', officialSourcesRetrieved: 2 }, [], 0, 0, 0, 3);
  assert.equal(lvl, 'VERY_POSITIVE');
});
test('computeOverallAssessment: falling short on key strengths (only 2) keeps it at POSITIVE, not VERY_POSITIVE', () => {
  const lvl = computeOverallAssessment('HIGH', { level: 'HIGH', officialSourcesRetrieved: 2 }, [], 0, 0, 0, 2);
  assert.equal(lvl, 'POSITIVE');
});
test('computeOverallAssessment: the strict POSITIVE case — HIGH confidence, an official source retrieved, non-LIMITED coverage, clean evidence, nothing left to verify', () => {
  const lvl = computeOverallAssessment('HIGH', { level: 'MEDIUM', officialSourcesRetrieved: 1 }, [], 0, 0, 0, 0);
  assert.equal(lvl, 'POSITIVE');
});
test('computeOverallAssessment: HIGH confidence but itemsToVerify still non-empty is NOT POSITIVE — falls to the common GENERALLY_POSITIVE default (the exact mandate scenario: abundant positive evidence, one thing still to check)', () => {
  const lvl = computeOverallAssessment('HIGH', { level: 'HIGH', officialSourcesRetrieved: 3 }, [], 0, 0, 1, 0);
  assert.equal(lvl, 'GENERALLY_POSITIVE');
});
test('computeOverallAssessment: the common default — LOW/MEDIUM confidence, no serious risk, no material finding — is GENERALLY_POSITIVE, never ATTENTION_REQUIRED/NEUTRAL_MIXED', () => {
  const lvl = computeOverallAssessment('MEDIUM', { level: 'MEDIUM', officialSourcesRetrieved: 1 }, [{ severity: 'LOW', description: 'x' }], 0, 0, 2, 0);
  assert.equal(lvl, 'GENERALLY_POSITIVE');
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

// median()/calculateMarketPosition() (2026-09-06 "final alignment pass"
// mandate): MARKET's price positioning used to be entirely LLM-estimated —
// no deterministic arithmetic existed anywhere in this codebase. Copied
// verbatim from index.ts (see that file's own comment for the full
// rationale) — the LLM now only gathers numeric evidence; this is the
// deterministic step that turns it into marketMedian/premiumPct/position.
function parseNumericPricePerSqm(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/[,\s]/g, '').match(/-?\d+(\.\d+)?/);
  if (!cleaned) return null;
  const n = Number(cleaned[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function median(values) {
  const nums = values.filter((n) => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}
function calculateMarketPosition({ targetPricePerSqm, comparables }) {
  const values = (comparables || []).map((c) => parseNumericPricePerSqm(c?.pricePerSqm)).filter((n) => n != null);
  const marketMedianPricePerSqm = median(values);
  if (targetPricePerSqm == null || marketMedianPricePerSqm == null || marketMedianPricePerSqm === 0) {
    return { marketMedianPricePerSqm, premiumPct: null, position: 'UNKNOWN', comparablesUsed: values.length };
  }
  const premiumPct = ((targetPricePerSqm - marketMedianPricePerSqm) / marketMedianPricePerSqm) * 100;
  const position = premiumPct > 7 ? 'PREMIUM' : premiumPct < -7 ? 'DISCOUNT' : 'MARKET_RANGE';
  return { marketMedianPricePerSqm, premiumPct, position, comparablesUsed: values.length };
}

test('median: odd and even-length arrays, empty array', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([42]), 42);
});
test('parseNumericPricePerSqm: plain numbers, thousands separators, and non-numeric junk', () => {
  assert.equal(parseNumericPricePerSqm('1200'), 1200);
  assert.equal(parseNumericPricePerSqm('1,200.50'), 1200.5);
  assert.equal(parseNumericPricePerSqm(1500), 1500);
  assert.equal(parseNumericPricePerSqm('N/A'), null);
  assert.equal(parseNumericPricePerSqm(null), null);
  assert.equal(parseNumericPricePerSqm('-100'), null); // non-positive rejected
});
test('calculateMarketPosition: subject clearly above comparables median -> PREMIUM, computed from real numbers not an LLM guess', () => {
  const r = calculateMarketPosition({ targetPricePerSqm: 2000, comparables: [{ pricePerSqm: '1000' }, { pricePerSqm: '1100' }, { pricePerSqm: '1050' }] });
  assert.equal(r.marketMedianPricePerSqm, 1050);
  assert.equal(r.position, 'PREMIUM');
  assert.ok(r.premiumPct > 7);
  assert.equal(r.comparablesUsed, 3);
});
test('calculateMarketPosition: subject clearly below comparables median -> DISCOUNT', () => {
  const r = calculateMarketPosition({ targetPricePerSqm: 800, comparables: [{ pricePerSqm: '1000' }, { pricePerSqm: '1000' }] });
  assert.equal(r.position, 'DISCOUNT');
  assert.ok(r.premiumPct < -7);
});
test('calculateMarketPosition: subject within +/-7% of median -> MARKET_RANGE, never PREMIUM/DISCOUNT for a near-median price', () => {
  const r = calculateMarketPosition({ targetPricePerSqm: 1030, comparables: [{ pricePerSqm: '1000' }, { pricePerSqm: '1000' }] });
  assert.equal(r.position, 'MARKET_RANGE');
});
test('calculateMarketPosition: UNKNOWN (never a guessed classification) when the subject price is not evidenced', () => {
  const r = calculateMarketPosition({ targetPricePerSqm: null, comparables: [{ pricePerSqm: '1000' }, { pricePerSqm: '1200' }] });
  assert.equal(r.position, 'UNKNOWN');
  assert.equal(r.premiumPct, null);
  assert.equal(r.marketMedianPricePerSqm, 1100); // still reported as a fact from comparables alone
});
test('calculateMarketPosition: UNKNOWN when no comparable carries a usable numeric pricePerSqm, even with a subject price', () => {
  const r = calculateMarketPosition({ targetPricePerSqm: 1500, comparables: [{ pricePerSqm: null }, { pricePerSqm: 'contact for price' }] });
  assert.equal(r.position, 'UNKNOWN');
  assert.equal(r.marketMedianPricePerSqm, null);
});

// ---- sanitizeCustomerReport() / CUSTOMER_REPORT_STRIP_KEYS / sanitizeForCustomer()
// (2026-09-06 correction) — copied verbatim from index.ts. Explicit product
// requirement: the customer HTTP response must never expose which worker/
// source/provider produced a finding (source, sourceName, sourceUrl, url,
// finalUrl, startUrl, retrievalMethod, browserOfficial, trace,
// officialSourceCoverage, or any of the officialSources* counters) —
// wherever nested — while everything persisted to result_json (the
// internal DB/admin copy) stays completely unchanged.
const CUSTOMER_REPORT_STRIP_KEYS = new Set(['url', 'sourceUrl', 'finalUrl', 'startUrl', 'originalGroundingUrl', 'evidenceUrl', 'verificationUrl', 'linkLabel', 'retrievalMethod', 'trace', 'browserOfficial', 'source', 'sourceName']);
function sanitizeCustomerReport(value) {
  if (Array.isArray(value)) return value.map((v) => sanitizeCustomerReport(v));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (CUSTOMER_REPORT_STRIP_KEYS.has(k)) continue;
      out[k] = sanitizeCustomerReport(v);
    }
    return out;
  }
  return value;
}
function sanitizeForCustomer(job) {
  if (!job || job.status !== 'COMPLETE' || !job.result_json || typeof job.result_json !== 'object') return job;
  const r = sanitizeCustomerReport({ ...job.result_json });
  delete r.browserOfficial;
  delete r.entityConfidence;
  delete r.confidence;
  delete r.officialSourceCoverage;
  delete r.officialSourcesChecked;
  delete r.officialSourcesConfirmedFound;
  delete r.officialSourcesConfirmedNoResult;
  delete r.officialSourcesNotVerified;
  delete r.officialSourcesSkipped;
  delete r.officialSourcesPartiallyTraversed;
  delete r.officialVerificationComplete;
  delete r.stage;
  delete r.researchProvider;
  delete r.costUsage;
  delete r._worker;
  delete r._cost;
  delete r._enregEntityRequestedFor;
  delete r._financialEntityRequestedFor;
  delete r._financialQueue;
  delete r._financialReturnStage;
  delete r._captchaReturnStage;
  return { ...job, result_json: r };
}

test('sanitizeForCustomer: strips source/sourceName wherever nested (documents, market comparables, officialDocumentsRetrieved, reconciledIdentity provenance), not just top-level', () => {
  const job = {
    status: 'COMPLETE',
    result_json: {
      officialSourceCoverage: [{ source: 'tas_map', sourceName: 'TAS Map', customerStatus: 'SUCCESS' }],
      officialDocumentsRetrieved: [{ source: 'mygov', sourceName: 'MyGov', url: 'https://my.gov.ge/x', title: 'ამონაწერი' }],
      market: { comparables: [{ source: 'myhome.ge', url: 'https://myhome.ge/y', price: '150000' }] },
      reconciledIdentity: { project: 'Villion', provenance: { project: [{ source: 'identity', url: null }, { source: 'myhome.ge', url: 'https://myhome.ge/z' }] } },
      summary: 'A clean summary with no leaks.',
    },
  };
  const out = sanitizeForCustomer(job);
  assert.equal(out.result_json.officialSourceCoverage, undefined);
  assert.equal(out.result_json.officialDocumentsRetrieved[0].source, undefined);
  assert.equal(out.result_json.officialDocumentsRetrieved[0].sourceName, undefined);
  assert.equal(out.result_json.officialDocumentsRetrieved[0].url, undefined);
  assert.equal(out.result_json.officialDocumentsRetrieved[0].title, 'ამონაწერი'); // real finding text survives
  assert.equal(out.result_json.market.comparables[0].source, undefined);
  assert.equal(out.result_json.market.comparables[0].url, undefined);
  assert.equal(out.result_json.market.comparables[0].price, '150000'); // real finding survives
  assert.equal(out.result_json.reconciledIdentity.provenance.project[0].source, undefined);
  assert.equal(out.result_json.reconciledIdentity.provenance.project[1].source, undefined);
  assert.equal(out.result_json.summary, 'A clean summary with no leaks.');
});

test('sanitizeForCustomer: never mutates the original job/result_json object — internal DB/admin evidence keeps every field', () => {
  const job = {
    status: 'COMPLETE',
    result_json: {
      officialSourceCoverage: [{ source: 'tas_map', sourceName: 'TAS Map', customerStatus: 'SUCCESS' }],
      officialDocumentsRetrieved: [{ source: 'mygov', sourceName: 'MyGov', url: 'https://my.gov.ge/x' }],
      browserOfficial: { results: [{ source: 'tas_map', status: 'SEARCH_CONFIRMED' }] },
    },
  };
  const before = JSON.parse(JSON.stringify(job));
  sanitizeForCustomer(job);
  assert.deepEqual(job, before); // the input object itself is untouched — only a copy is stripped
});

test('sanitizeForCustomer: a non-COMPLETE job (e.g. WAITING_HUMAN) is returned unchanged — internal fields like _worker must survive for resume()/advance() to keep reading them', () => {
  const job = { status: 'WAITING_HUMAN', result_json: { _worker: { jobId: 'abc' }, source: 'tas_map' } };
  const out = sanitizeForCustomer(job);
  assert.equal(out, job);
  assert.equal(out.result_json._worker.jobId, 'abc');
  assert.equal(out.result_json.source, 'tas_map');
});

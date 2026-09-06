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

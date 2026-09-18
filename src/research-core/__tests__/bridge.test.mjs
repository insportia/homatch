// The bridges are where the core stops being its own world.
//
// Three Homatch types are MIRRORED inside src/research-core rather than
// imported: EvidenceItem (official-worker is a separate Node service with its
// own tsconfig) and ExecutionGrant / ActualUsage (_shared/billing.ts is Deno
// code with URL imports the Vite build cannot resolve). Mirroring is the right
// call — importing across those boundaries would couple three deployment units
// — but a mirror drifts silently, and the drift only surfaces at runtime in
// production.
//
// So the tests below READ THE REAL FILES and fail if the shapes diverge.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { toEvidenceItem, sourceClassFor, supportAnnotation, duplicateTrail } from '../bridge/evidence.ts';
import { toActualUsage, toCostEventRow, avoidedProviderCalls } from '../bridge/cost.ts';
import { budgetFor, backgroundBudget, narrow } from '../bridge/budget.ts';
import { noProviderAccess, isDenied } from '../bridge/provider-port.ts';
import { judgeDocumentAge, alwaysRecheck } from '../bridge/freshness.ts';
import { emptyUsage } from '../core/types.ts';
import { MARKET_COMPARABLES } from '../profiles/investment.ts';

const ROOT = process.cwd();
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

const EVIDENCE_TYPES_SRC = read('official-worker', 'src', 'evidence', 'EvidenceTypes.ts');
const BILLING_SRC = read('supabase', 'functions', '_shared', 'billing.ts');
const CORE_EVIDENCE_SRC = read('src', 'research-core', 'bridge', 'evidence.ts');
const CORE_COST_SRC = read('src', 'research-core', 'bridge', 'cost.ts');
const CORE_BUDGET_SRC = read('src', 'research-core', 'bridge', 'budget.ts');

/** Pull a union type's members out of a TypeScript source file. */
function unionMembers(source, name) {
  const match = source.match(new RegExp(`export type ${name} =([\\s\\S]*?);`));
  assert.ok(match, `could not find "export type ${name}" `);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

/** Pull the property names out of an interface declaration. */
function interfaceFields(source, name) {
  const start = source.indexOf(`interface ${name} {`);
  assert.ok(start >= 0, `could not find "interface ${name}"`);
  let depth = 0;
  let end = start;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  const body = source
    .slice(source.indexOf('{', start) + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  // Top-level `name?: type` declarations only.
  return [...body.matchAll(/^\s{2}([A-Za-z_][\w]*)\??\s*:/gm)].map((m) => m[1]).sort();
}

/* ── EvidenceItem ─────────────────────────────────────────────────────── */

test('the mirrored EvidenceType union matches official-worker exactly', () => {
  assert.deepEqual(
    unionMembers(CORE_EVIDENCE_SRC, 'EvidenceType'),
    unionMembers(EVIDENCE_TYPES_SRC, 'EvidenceType'),
  );
});

test('the mirrored SourceClass union matches official-worker exactly', () => {
  assert.deepEqual(
    unionMembers(CORE_EVIDENCE_SRC, 'SourceClass'),
    unionMembers(EVIDENCE_TYPES_SRC, 'SourceClass'),
  );
});

test('the mirrored VerificationState union matches official-worker exactly', () => {
  assert.deepEqual(
    unionMembers(CORE_EVIDENCE_SRC, 'VerificationState'),
    unionMembers(EVIDENCE_TYPES_SRC, 'VerificationState'),
  );
});

test('the mirrored EvidenceItem carries every field the real one does', () => {
  const real = interfaceFields(EVIDENCE_TYPES_SRC, 'EvidenceItem');
  const mirror = interfaceFields(CORE_EVIDENCE_SRC, 'EvidenceItem');
  assert.deepEqual(mirror, real);
});

test('nothing the HTTP tier fetches can claim to be OFFICIAL', () => {
  // Official evidence means a registry read through official-worker's recorded
  // workflows, with a screenshot and a traversal trace behind it. A page on
  // gov.ge fetched over plain HTTP is not that artefact, and must not wear its
  // badge — otherwise the cheapest path in the system gets the highest class.
  const httpKinds = ['PROPERTY_PORTAL', 'DEVELOPER_SITE', 'MEDIA', 'FORUM', 'SOCIAL', 'SEARCH_PROVIDER', 'OTHER'];
  for (const kind of httpKinds) {
    assert.notEqual(sourceClassFor(kind), 'OFFICIAL', kind);
  }
  assert.equal(sourceClassFor('OFFICIAL_REGISTRY'), 'OFFICIAL');
});

function entry(over = {}) {
  return {
    observation: {
      id: over.id ?? 'obs_1',
      requestedUrl: 'https://p.test/a?sid=secret',
      fetchUrl: 'https://p.test/a?sid=secret',
      canonicalIdentityUrl: 'https://p.test/a',
      source: { sourceKey: 'p', sourceFamily: 'p', kind: over.kind ?? 'PROPERTY_PORTAL' },
      evidenceLevel: 'SAME_PROPERTY',
      observedAt: over.observedAt ?? null,
      retrievedAt: '2026-09-18T12:00:00.000Z',
      contentHash: 'h',
      nearDuplicateFingerprint: null,
      structuredSourceId: null,
      payload: {},
      fieldOrigins: {},
      supportingText: 'supportingText' in over ? over.supportingText : 'the exact sentence',
    },
    independent: over.independent ?? true,
    duplicateOf: over.duplicateOf ?? null,
    duplicateReason: over.duplicateReason ?? null,
  };
}

test('an evidence item stores the identity URL, never the fetch URL', () => {
  // A fetch URL can carry a session parameter, and sourceUrl is stored and
  // shown.
  const item = toEvidenceItem({
    entry: entry(),
    claim: 'listing price: $145,000',
    source: 'myhome.ge listing #12345',
    type: 'MARKET_COMPARABLE',
    confidence: 0.8,
  });
  assert.equal(item.sourceUrl, 'https://p.test/a');
  assert.ok(!item.sourceUrl.includes('secret'));
});

test('`date` stays null when the source stated none, and retrievedAt is separate', () => {
  const item = toEvidenceItem({
    entry: entry(),
    claim: 'x',
    source: 's',
    type: 'WEB_CLAIM',
    confidence: 0.5,
  });
  assert.equal(item.date, null);
  assert.equal(item.retrievedAt, '2026-09-18T12:00:00.000Z');
});

test('confidence is clamped but never rounded up', () => {
  const low = toEvidenceItem({ entry: entry(), claim: 'x', source: 's', type: 'WEB_CLAIM', confidence: 0.12 });
  assert.equal(low.confidence, 0.12);
  const negative = toEvidenceItem({ entry: entry(), claim: 'x', source: 's', type: 'WEB_CLAIM', confidence: -3 });
  assert.equal(negative.confidence, 0);
  const over = toEvidenceItem({ entry: entry(), claim: 'x', source: 's', type: 'WEB_CLAIM', confidence: 7 });
  assert.equal(over.confidence, 1);
});

test('no supporting text means UNVERIFIED, exactly as EvidenceTypes.ts requires', () => {
  const item = toEvidenceItem({
    entry: entry({ supportingText: null }),
    claim: 'x',
    source: 's',
    type: 'WEB_CLAIM',
    confidence: 0.9,
  });
  assert.equal(item.verificationState, 'UNVERIFIED');
});

test('a contradiction makes the item DISPUTED and keeps the references', () => {
  const item = toEvidenceItem({
    entry: entry(),
    claim: 'x',
    source: 's',
    type: 'PROPERTY_FACT',
    confidence: 0.9,
    contradiction: { evidenceIds: ['a', 'b'], description: 'two owners named' },
  });
  assert.equal(item.verificationState, 'DISPUTED');
  assert.deepEqual(item.contradiction.evidenceIds, ['a', 'b']);
});

test('a folded-in duplicate is UNVERIFIED and appears in the audit trail', () => {
  const duplicate = entry({ id: 'dup', independent: false, duplicateOf: 'obs_1', duplicateReason: 'CONTENT_HASH' });
  const item = toEvidenceItem({ entry: duplicate, claim: 'x', source: 's', type: 'WEB_CLAIM', confidence: 0.9 });
  assert.equal(item.verificationState, 'UNVERIFIED');
  assert.deepEqual(duplicateTrail([entry(), duplicate]), [
    { id: 'dup', duplicateOf: 'obs_1', reason: 'CONTENT_HASH' },
  ]);
});

test('the support annotation keeps the two counts labelled and separate', () => {
  const text = supportAnnotation({
    observationCount: 9,
    independentSourceCount: 3,
    effectiveSourceCount: 1.6,
    familyCounts: {},
  });
  assert.equal(text, 'obs=9 ind=3 eff=1.6');
  assert.ok(!/^\d+ sources$/.test(text));
});

test('the core never composes customer prose — claim is a required input', () => {
  assert.match(CORE_EVIDENCE_SRC, /claim: string;/);
  // There must be no default value or template for it anywhere in the bridge.
  assert.ok(!/claim\s*[:=]\s*`/.test(CORE_EVIDENCE_SRC), 'the bridge builds claim text');
  assert.ok(!/claim\s*\?\?\s*'/.test(CORE_EVIDENCE_SRC), 'the bridge defaults claim text');
});

/* ── Cost ─────────────────────────────────────────────────────────────── */

test('the mirrored ActualUsage fields all exist on the real one', () => {
  const real = interfaceFields(BILLING_SRC, 'ActualUsage');
  const mirror = interfaceFields(CORE_COST_SRC, 'ActualUsageLike');
  for (const field of mirror) {
    assert.ok(real.includes(field), `ActualUsageLike.${field} is not on the real ActualUsage`);
  }
});

test('the mirrored ExecutionGrant fields all exist on the real one', () => {
  const real = interfaceFields(BILLING_SRC, 'ExecutionGrant');
  const mirror = interfaceFields(CORE_BUDGET_SRC, 'ExecutionGrantLike');
  for (const field of mirror) {
    assert.ok(real.includes(field), `ExecutionGrantLike.${field} is not on the real ExecutionGrant`);
  }
});

test('an unknown provider cost is absent, never zero', () => {
  // "A zero meaning 'no rate for this' must never be read as a zero meaning
  // 'free'" — src/verify/cogs.ts. Same rule, enforced at the row level.
  const usage = { ...emptyUsage('DATAFORSEO', 'search'), networkRequests: 3, billableRequests: 1 };

  const withoutCost = toActualUsage(usage);
  assert.equal('rawProviderCostCents' in withoutCost, false);

  const row = toCostEventRow(usage, { operationType: 'RESEARCH_SEARCH' });
  assert.equal(row.cost_usd, null);
  assert.match(row.source, /unpriced=PROVIDER_CALL/);
});

test('a genuine zero cost is recorded as zero', () => {
  const usage = { ...emptyUsage('FREE_WEB', 'fetch'), networkRequests: 1 };
  const withCost = toActualUsage(usage, { rawProviderCostCents: 0 });
  assert.equal(withCost.rawProviderCostCents, 0);
  const row = toCostEventRow(usage, { operationType: 'RESEARCH_FETCH', costUsd: 0 });
  assert.equal(row.cost_usd, 0);
  assert.ok(!row.source.includes('unpriced'));
});

test('redirect hops and retries are not billed as provider units', () => {
  // A slow source that redirects four times must not cost four times as much.
  const usage = { ...emptyUsage('P', 'search'), networkRequests: 5, billableRequests: 1 };
  const actual = toActualUsage(usage);
  assert.equal(actual.searchCount, 1);
  assert.equal(actual.metadata.network_requests, 5);
});

test('cache hits and coalesced joins are counted as avoided calls', () => {
  const usage = { ...emptyUsage('P', 'fetch'), cacheHits: 4, coalescedRequests: 95 };
  assert.equal(avoidedProviderCalls(usage), 99);
  const row = toCostEventRow(usage, { operationType: 'X' });
  assert.equal(row.cache_hit, true);
});

/* ── Budget ───────────────────────────────────────────────────────────── */

const grant = (over = {}) => ({
  ok: true,
  funding: 'PAYG',
  productCode: 'MARKET_COMPARABLES',
  qualityTier: 'MAXIMUM',
  resultCeiling: null,
  providerBudgetCeilingCents: 500,
  priorityLevel: 5,
  partialBudget: false,
  authorizedMaxCredits: 10,
  estimateMaxCredits: 10,
  ...over,
});

test('a paid interactive run gets the high interactive class', () => {
  assert.equal(budgetFor(MARKET_COMPARABLES, grant()).workClass, 'INTERACTIVE_HIGH');
});

test('an included-allowance run is still interactive, just lower', () => {
  // The customer is still watching a spinner. It yields under pressure; it is
  // not background work.
  assert.equal(
    budgetFor(MARKET_COMPARABLES, grant({ funding: 'INCLUDED' })).workClass,
    'INTERACTIVE_NORMAL',
  );
});

test('a non-interactive run is BACKGROUND whatever it paid', () => {
  assert.equal(
    budgetFor(MARKET_COMPARABLES, grant(), { interactive: false }).workClass,
    'BACKGROUND',
  );
});

test('a lower quality tier buys less depth', () => {
  const max = budgetFor(MARKET_COMPARABLES, grant({ qualityTier: 'MAXIMUM' }));
  const standard = budgetFor(MARKET_COMPARABLES, grant({ qualityTier: 'STANDARD' }));
  assert.ok(standard.maxDocuments < max.maxDocuments);
  assert.ok(standard.maxSources <= max.maxSources);
});

test('a partial budget scales the PLAN, it does not cut the run off part way', () => {
  // billing.ts is explicit that the worker "must scope the search to the
  // budget rather than running a full one and being cut off part way".
  const full = budgetFor(MARKET_COMPARABLES, grant());
  const partial = budgetFor(
    MARKET_COMPARABLES,
    grant({ partialBudget: true, authorizedMaxCredits: 4, estimateMaxCredits: 10 }),
  );
  assert.equal(partial.scaledToPartialBudget, true);
  assert.ok(partial.maxDocuments < full.maxDocuments);
  assert.ok(partial.maxDocuments >= 1, 'a partial budget planned zero work');
});

test('the provider spend ceiling comes from the grant and is never widened', () => {
  const budget = budgetFor(MARKET_COMPARABLES, grant({ providerBudgetCeilingCents: 200 }));
  assert.equal(budget.providerBudgetCeilingCents, 200);

  const narrowed = narrow(budget, { providerBudgetCeilingCents: 50, maxDocuments: 3 });
  assert.equal(narrowed.providerBudgetCeilingCents, 50);
  assert.equal(narrowed.maxDocuments, 3);

  const attemptedWidening = narrow(budget, { providerBudgetCeilingCents: 9999, maxDocuments: 9999 });
  assert.equal(attemptedWidening.providerBudgetCeilingCents, 200);
  assert.equal(attemptedWidening.maxDocuments, budget.maxDocuments);
});

test('background work gets a provider ceiling of zero unless raised deliberately', () => {
  // "Nobody is waiting" is not "spend freely".
  assert.equal(backgroundBudget(MARKET_COMPARABLES).providerBudgetCeilingCents, 0);
  assert.equal(
    backgroundBudget(MARKET_COMPARABLES, { providerBudgetCeilingCents: 100 }).providerBudgetCeilingCents,
    100,
  );
});

/* ── Provider port and freshness ──────────────────────────────────────── */

test('the default provider port refuses everything', () => {
  // The HTTP tier fetches free public pages and needs no provider at all, so a
  // caller that wants a paid one has to pass a real port in.
  return Promise.all([
    noProviderAccess.search({ provider: 'DATAFORSEO', queries: ['x'], budgetCeilingCents: null }),
    noProviderAccess.available('DATAFORSEO'),
  ]).then(([search, available]) => {
    assert.equal(isDenied(search), true);
    assert.equal(search.reason, 'NOT_CONFIGURED');
    assert.equal(isDenied(available), true);
  });
});

test('document freshness and fact freshness are different questions', () => {
  const policy = { cacheTtlMs: 3_600_000, cacheStaleMs: 3_600_000 };
  const now = Date.parse('2026-09-18T12:00:00.000Z');

  assert.equal(judgeDocumentAge('2026-09-18T11:59:30.000Z', policy, now).status, 'LIVE');
  assert.equal(judgeDocumentAge('2026-09-18T11:30:00.000Z', policy, now).status, 'FRESH');
  assert.equal(judgeDocumentAge('2026-09-18T10:30:00.000Z', policy, now).status, 'AGING');
  assert.equal(judgeDocumentAge('2026-09-18T09:00:00.000Z', policy, now).status, 'STALE');

  // An unparseable timestamp is not evidence of freshness.
  assert.equal(judgeDocumentAge('not a date', policy, now).usable, false);
});

test('the default fact-freshness port says everything needs re-checking', () => {
  // Costs money; never reports a stale fact as current. A caller that wants
  // reuse has to wire the real DB-driven policy in, which is a visible
  // omission rather than a silent one.
  return alwaysRecheck
    .needsRecheck({ entityId: null, factKey: 'ownership.owner', lastVerifiedAt: new Date().toISOString() })
    .then((needs) => assert.equal(needs, true));
});

test('the freshness bridge delegates the fact question rather than answering it', () => {
  const src = read('src', 'research-core', 'bridge', 'freshness.ts');
  assert.match(src, /intelligence_freshness_policy/);
  assert.ok(!/max_age_hours\s*[:=]\s*\d/.test(src), 'the core holds a fact TTL of its own');
});

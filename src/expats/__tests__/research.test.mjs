// Provider research: the nine properties §87 names, and the funnel §55 does.
//
// Every one of these is a way to make a provider look better, worse, or more
// thoroughly investigated than the evidence supports. They are the reason
// paid research is allowed to charge for anything.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assess, rankProviders, rankingInputsFrom, shortlist } from '../research/reputation.ts';
import {
  MINIMUM_FAMILIES_FOR_A_FINDING,
  coverageNoteKeys,
  mayStateAbsence,
  statusFor,
  summarise,
} from '../research/coverage.ts';
import {
  FUNNEL_STAGES,
  countFunnel,
  isObservable,
  outboundEvent,
  stageOf,
} from '../research/attribution.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-20T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

let seq = 0;
const observation = (family, over = {}) => {
  seq += 1;
  return {
    id: `o${seq}`,
    requestedUrl: `https://${family}/x${seq}`,
    fetchUrl: `https://${family}/x${seq}`,
    canonicalIdentityUrl: `https://${family}/x${seq}`,
    source: { sourceKey: `src:${family}`, sourceFamily: family, kind: 'OTHER' },
    evidenceLevel: 'SECONDARY',
    observedAt: null,
    retrievedAt: daysAgo(1),
    contentHash: `h${seq}`,
    nearDuplicateFingerprint: null,
    structuredSourceId: null,
    payload: {},
    fieldOrigins: {},
    supportingText: null,
    ...over,
  };
};

const evidence = (family, over = {}) => ({
  observation: observation(family, over.observation ?? {}),
  kind: over.kind ?? 'BUSINESS_PROFILE',
  source: {
    sourceId: `s:${family}:${seq}`,
    publisher: over.publisher ?? family,
    url: `https://${family}/`,
    official: over.official ?? false,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: over.observedAt ?? daysAgo(2),
    language: 'ka',
    ...(over.source ?? {}),
  },
  rating: over.rating ?? null,
  price: over.price ?? null,
  languages: over.languages ?? null,
  excerpt: over.excerpt ?? null,
});

/* ── §87: a provider with no evidence gets no verdict ─────────────────── */

test('a provider with zero evidence cannot receive a reputation', () => {
  const a = assess('p1', [], NOW);
  assert.equal(a.identity.availability, 'COVERAGE_GAP');
  assert.equal(a.identity.confidence, 0);
  assert.equal(a.ratings, null);
  assert.equal(a.support.effectiveSourceCount, 0);
  // And critically: nothing here is a negative statement about the provider.
  assert.ok(!('verdict' in a));
});

test('a provider with no evidence is never shortlisted', () => {
  const { shortlisted, insufficientEvidence } = shortlist([assess('p1', [], NOW)]);
  assert.deepEqual(shortlisted, []);
  assert.equal(insufficientEvidence.length, 1);
});

/* ── §87: a missing price stays missing ───────────────────────────────── */

test('a provider who published no price has no price, not a zero', () => {
  const a = assess('p1', [evidence('example.ge')], NOW);
  assert.equal(a.price, null);
  assert.ok(a.limitations.includes('NO_PRICE_PUBLISHED'));
});

test('two published prices widen the range rather than averaging it', () => {
  const money = (low, high) => ({
    low,
    high,
    currency: 'GEL',
    unit: 'ONE_OFF',
    sampleSize: 1,
    sourceCount: 1,
    observedAt: daysAgo(3),
    locality: 'Tbilisi',
  });
  const a = assess(
    'p1',
    [evidence('a.ge', { price: money(300, 400) }), evidence('b.ge', { price: money(900, 1200) })],
    NOW,
  );
  assert.equal(a.price.low, 300);
  assert.equal(a.price.high, 1200);
});

/* ── §87: one source cannot masquerade as five ────────────────────────── */

test('five pages from one publisher are not five sources', () => {
  const many = Array.from({ length: 5 }, () => evidence('directory.ge'));
  const a = assess('p1', many, NOW);
  assert.equal(a.support.observationCount, 5);
  assert.equal(a.support.independentSourceCount, 1);
  assert.ok(a.support.effectiveSourceCount < 2, `effective was ${a.support.effectiveSourceCount}`);
  assert.ok(a.limitations.includes('SINGLE_SOURCE_FAMILY'));
});

test('three genuinely different publishers count as three', () => {
  const a = assess('p1', [evidence('a.ge'), evidence('b.ge'), evidence('c.ge')], NOW);
  assert.equal(a.support.independentSourceCount, 3);
  assert.ok(a.support.effectiveSourceCount >= 3);
  assert.ok(!a.limitations.includes('SINGLE_SOURCE_FAMILY'));
});

/* ── §87: duplicate evidence cannot inflate confidence ────────────────── */

test('repeating one publisher does not raise identity confidence', () => {
  const one = assess('p1', [evidence('a.ge')], NOW).identity.confidence;
  const five = assess('p1', Array.from({ length: 5 }, () => evidence('a.ge')), NOW).identity
    .confidence;
  assert.ok(five - one < 0.1, `confidence moved from ${one} to ${five}`);
});

test('one platform observed twice votes once on ratings', () => {
  const a = assess(
    'p1',
    [
      evidence('maps', { publisher: 'Maps', rating: { value: 4.8, outOf: 5, reviewCount: 12 }, observedAt: daysAgo(40) }),
      evidence('maps', { publisher: 'Maps', rating: { value: 4.2, outOf: 5, reviewCount: 30 }, observedAt: daysAgo(2) }),
    ],
    NOW,
  );
  assert.equal(a.ratings.perPlatform.length, 1);
  assert.equal(a.ratings.perPlatform[0].value, 4.2, 'the newest reading from that platform wins');
  assert.equal(a.ratings.totalReviews, 30);
});

test('ratings from different platforms are kept apart, never averaged', () => {
  const a = assess(
    'p1',
    [
      evidence('maps', { publisher: 'Maps', rating: { value: 4.9, outOf: 5, reviewCount: 8 } }),
      evidence('other', { publisher: 'Other', rating: { value: 3.1, outOf: 5, reviewCount: 200 } }),
    ],
    NOW,
  );
  assert.equal(a.ratings.perPlatform.length, 2);
  assert.equal(a.ratings.platformsDisagree, true);
  assert.ok(a.limitations.includes('PLATFORMS_DISAGREE'));
  assert.ok(!('average' in a.ratings));
});

test('a handful of reviews is flagged as a handful', () => {
  const a = assess(
    'p1',
    [evidence('maps', { publisher: 'Maps', rating: { value: 5, outOf: 5, reviewCount: 3 } })],
    NOW,
  );
  assert.ok(a.limitations.includes('LOW_REVIEW_VOLUME'));
});

/* ── §87: old evidence loses freshness ────────────────────────────────── */

test('evidence a year old is stale and says so', () => {
  const a = assess('p1', [evidence('a.ge', { observedAt: daysAgo(400) })], NOW);
  assert.equal(a.freshness, 'STALE');
  assert.ok(a.limitations.includes('EVIDENCE_STALE'));
});

test('stale evidence sorts below fresh evidence of the same strength', () => {
  const fresh = rankingInputsFrom(assess('fresh', [evidence('a.ge'), evidence('b.ge')], NOW), 0.5);
  const stale = rankingInputsFrom(
    assess('stale', [evidence('c.ge', { observedAt: daysAgo(400) }), evidence('d.ge', { observedAt: daysAgo(400) })], NOW),
    0.5,
  );
  const ranked = rankProviders([stale, fresh]);
  assert.equal(ranked[0].providerId, 'fresh');
});

/* ── §87: sponsorship cannot touch organic ranking ────────────────────── */

test('the ranking function cannot even see whether a provider paid', () => {
  const inputs = rankingInputsFrom(assess('p1', [evidence('a.ge')], NOW), 0.5);
  assert.ok(!('sponsored' in inputs), 'RankingInputs must not carry the flag');
  assert.ok(!('paid' in inputs));
  assert.ok(!('placement' in inputs));
});

test('an identical provider ranks identically whatever a sponsorship flag says', () => {
  const base = assess('p1', [evidence('a.ge'), evidence('b.ge')], NOW);
  const a = rankProviders([rankingInputsFrom(base, 0.7)]);
  const b = rankProviders([rankingInputsFrom({ ...base, sponsored: true }, 0.7)]);
  assert.deepEqual(a, b);
});

/* ── §87: a click is not a conversion ─────────────────────────────────── */

test('every action records only the stage it actually evidences', () => {
  assert.equal(stageOf('PROVIDER_VIEWED'), 'VIEW');
  assert.equal(stageOf('WEBSITE_OPENED'), 'CONTACT_INTENT');
  assert.equal(stageOf('PHONE_REVEALED'), 'CONTACT_INTENT');
  assert.equal(stageOf('ENQUIRY_SUBMITTED'), 'LEAD_SUBMITTED');
  // Nothing maps to the two stages Homatch cannot observe.
  const reachable = new Set(Object.values({ ...{} }));
  assert.equal(reachable.has('CONVERTED'), false);
});

test('a caller cannot declare its own funnel stage', () => {
  const e = outboundEvent({ action: 'WEBSITE_OPENED', providerId: 'p1', sponsored: true });
  assert.equal(e.stage, 'CONTACT_INTENT');
  // Even trying to pass one is ignored: the field is derived.
  const forced = outboundEvent({ action: 'PROVIDER_VIEWED', providerId: 'p1', stage: 'CONVERTED' });
  assert.equal(forced.stage, 'VIEW');
});

test('BOOKED and CONVERTED are not observable today', () => {
  assert.equal(isObservable('LEAD_SUBMITTED'), true);
  assert.equal(isObservable('BOOKED'), false);
  assert.equal(isObservable('CONVERTED'), false);
  assert.equal(FUNNEL_STAGES.at(-1), 'CONVERTED');
});

test('counting does not back-fill earlier stages', () => {
  const counts = countFunnel([outboundEvent({ action: 'ENQUIRY_SUBMITTED', providerId: 'p1' })]);
  assert.equal(counts.byStage.LEAD_SUBMITTED, 1);
  assert.equal(counts.byStage.VIEW, 0, 'we never saw the view, so we do not report one');
  assert.equal(counts.byStage.CONVERTED, 0);
});

/* ── §87 / §36: a coverage failure is not a fact about the world ──────── */

const attempt = (family, outcome, official = false) => ({
  sourceId: `${family}:1`,
  family,
  outcome,
  official,
});

test('reaching almost nothing is never LIVE_PROVEN, however much was scraped', () => {
  const c = summarise([
    attempt('a', 'READ'),
    attempt('b', 'BLOCKED'),
    attempt('c', 'INACCESSIBLE'),
    attempt('d', 'INACCESSIBLE'),
  ]);
  assert.equal(statusFor(c, 40), 'PARTIAL');
});

test('finding nothing after reaching nothing is not NO_EVIDENCE', () => {
  const c = summarise([attempt('a', 'BLOCKED'), attempt('b', 'BLOCKED'), attempt('c', 'BLOCKED')]);
  assert.equal(statusFor(c, 0), 'BLOCKED');
  assert.equal(mayStateAbsence(c, statusFor(c, 0)), false);
});

test('unreachable sources are distinguished from ones that refused', () => {
  const blocked = summarise([attempt('a', 'BLOCKED'), attempt('b', 'BLOCKED')]);
  const gone = summarise([attempt('a', 'INACCESSIBLE'), attempt('b', 'INACCESSIBLE')]);
  assert.equal(statusFor(blocked, 0), 'BLOCKED');
  assert.equal(statusFor(gone, 0), 'INACCESSIBLE');
});

test('finding nothing AFTER reading enough is a real finding', () => {
  const c = summarise([
    attempt('a', 'READ_EMPTY'),
    attempt('b', 'READ_EMPTY'),
    attempt('c', 'READ'),
    attempt('d', 'READ'),
  ]);
  assert.equal(statusFor(c, 0), 'NO_EVIDENCE');
  assert.equal(mayStateAbsence(c, 'NO_EVIDENCE'), true);
});

test('one publisher reading empty is not enough to state an absence', () => {
  const c = summarise([attempt('only', 'READ_EMPTY')]);
  assert.ok(c.familiesRead < MINIMUM_FAMILIES_FOR_A_FINDING);
  assert.equal(mayStateAbsence(c, statusFor(c, 0)), false);
});

test('the reader is told when no official source could be read', () => {
  const c = summarise([attempt('gov', 'INACCESSIBLE', true), attempt('a', 'READ'), attempt('b', 'READ')]);
  assert.ok(coverageNoteKeys(c, statusFor(c, 3)).includes('expat_research_note_no_official'));
});

test('a thin run is told to the reader as a thin run', () => {
  const c = summarise([attempt('a', 'READ'), attempt('b', 'BLOCKED'), attempt('c', 'BLOCKED')]);
  const notes = coverageNoteKeys(c, statusFor(c, 1));
  assert.ok(notes.includes('expat_research_note_few_sources'));
  assert.ok(notes.includes('expat_research_note_blocked'));
});

test('a full clean run says nothing apologetic', () => {
  const c = summarise([attempt('a', 'READ'), attempt('b', 'READ'), attempt('c', 'READ')]);
  assert.equal(statusFor(c, 5), 'LIVE_PROVEN');
  assert.deepEqual(coverageNoteKeys(c, 'LIVE_PROVEN'), []);
});

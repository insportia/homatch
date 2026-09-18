// Three numbers that must never become one.
//
//   observationCount        how many times we saw it
//   independentSourceCount  how many distinct publishers said it
//   effectiveSourceCount    what the agreement is actually worth
//
// Reporting "9 sources" when nine portals republish one agency feed is the
// single easiest way to make a syndicated figure look better attested than a
// registry record. The tests below are mostly about refusing to merge things,
// because every bug in this area is a merge that should not have happened.

import test from 'node:test';
import assert from 'node:assert/strict';

import { dedupeObservations } from '../score/document-dedupe.ts';
import { computeIndependence, supportFor } from '../score/independence.ts';

let counter = 0;
function observation(over = {}) {
  counter += 1;
  const id = over.id ?? `obs_${counter}`;
  const url = over.url ?? `https://example.test/${id}`;
  return {
    id,
    requestedUrl: url,
    fetchUrl: url,
    canonicalIdentityUrl: over.canonicalIdentityUrl ?? url,
    source: {
      sourceKey: over.sourceKey ?? 'portal:a',
      sourceFamily: over.family ?? 'family-a',
      kind: over.kind ?? 'PROPERTY_PORTAL',
    },
    evidenceLevel: over.evidenceLevel ?? 'SAME_PROPERTY',
    observedAt: over.observedAt ?? null,
    retrievedAt: '2026-09-18T10:00:00.000Z',
    contentHash: over.contentHash ?? `hash_${id}`,
    nearDuplicateFingerprint: null,
    structuredSourceId: over.structuredSourceId ?? null,
    payload: over.payload ?? {},
    fieldOrigins: {},
    supportingText: over.supportingText ?? 'text',
  };
}

const independentOf = (obs) => computeIndependence(dedupeObservations(obs).observations);

/* ── Dedupe ───────────────────────────────────────────────────────────── */

test('the same document reached two ways is one observation', () => {
  const result = dedupeObservations([
    observation({ id: 'a', canonicalIdentityUrl: 'https://portal.test/flat/1' }),
    observation({ id: 'b', canonicalIdentityUrl: 'https://portal.test/flat/1' }),
  ]);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.observations.filter((o) => o.independent).length, 1);
});

test('a duplicate is marked, never deleted', () => {
  // "No evidence = no fact" cuts both ways: quietly dropping an observation
  // because it looked redundant destroys the audit trail.
  const result = dedupeObservations([
    observation({ id: 'a', contentHash: 'same' }),
    observation({ id: 'b', contentHash: 'same' }),
  ]);
  assert.equal(result.observations.length, 2, 'an observation was dropped');
  const folded = result.observations.find((o) => !o.independent);
  assert.equal(folded.duplicateReason, 'CONTENT_HASH');
  assert.ok(folded.duplicateOf);
});

test('a registry record and a portal listing about one flat are NOT merged', () => {
  // They share an entity id and are two organisations making two independent
  // claims. Merging them silently deletes one of the two prices we are trying
  // to compare — the exact bug the family scoping exists for.
  const result = dedupeObservations(
    [
      observation({ id: 'registry', family: 'napr.gov.ge', kind: 'OFFICIAL_REGISTRY' }),
      observation({ id: 'portal', family: 'myhome.ge' }),
    ],
    { entityIdOf: () => 'cadastral:01.18.06.019.055' },
  );
  assert.equal(result.duplicateCount, 0);
  assert.equal(result.observations.every((o) => o.independent), true);
});

test('one source listing the same flat twice IS merged', () => {
  const result = dedupeObservations(
    [
      observation({ id: 'first', family: 'myhome.ge' }),
      observation({ id: 'second', family: 'myhome.ge' }),
    ],
    { entityIdOf: () => 'cadastral:01.18.06.019.055' },
  );
  assert.equal(result.duplicateCount, 1);
});

test('the same listing id on two unrelated portals is a coincidence, not a duplicate', () => {
  const result = dedupeObservations([
    observation({ id: 'a', family: 'myhome.ge', structuredSourceId: '4471' }),
    observation({ id: 'b', family: 'ss.ge', structuredSourceId: '4471' }),
  ]);
  assert.equal(result.duplicateCount, 0);
});

test('the highest-ranked member of a group is kept as the primary', () => {
  const result = dedupeObservations(
    [
      observation({ id: 'weak', contentHash: 'same' }),
      observation({ id: 'strong', contentHash: 'same' }),
    ],
    { rank: (o) => (o.id === 'strong' ? 10 : 0) },
  );
  assert.equal(result.groups[0].primaryObservationId, 'strong');
});

/* ── Independence ─────────────────────────────────────────────────────── */

test('nine observations from one family are nine observations and ONE source', () => {
  const observations = Array.from({ length: 9 }, (_, i) =>
    observation({ id: `syn_${i}`, family: 'syndicate' }),
  );
  const result = independentOf(observations);
  assert.equal(result.observationCount, 9);
  assert.equal(result.independentSourceCount, 1);
  assert.ok(result.effectiveSourceCount < 9, 'nine copies counted as nine');
});

test('a pure mirror network contributes exactly one observation of weight', () => {
  const observations = Array.from({ length: 5 }, (_, i) =>
    observation({ id: `m_${i}`, family: 'mirror' }),
  );
  const result = computeIndependence(dedupeObservations(observations).observations, {
    weights: { siblingWeight: { mirror: 0 }, defaultSiblingWeight: 0.25 },
    subjectOf: () => 'one-flat',
  });
  assert.equal(result.effectiveSourceCount, 1);
  assert.equal(result.independentSourceCount, 1);
});

test('three comparables on one portal do not discount each other', () => {
  // The discount is scoped to (family, SUBJECT). Three listings on one portal
  // are three observations of three DIFFERENT properties. Getting this wrong
  // deleted a primary listing's price because a comparable sorted above it.
  const observations = [
    observation({ id: 'c1', family: 'myhome.ge' }),
    observation({ id: 'c2', family: 'myhome.ge' }),
    observation({ id: 'c3', family: 'myhome.ge' }),
  ];
  const result = computeIndependence(dedupeObservations(observations).observations, {
    subjectOf: (o) => o.id, // three different properties
  });
  assert.equal(result.effectiveSourceCount, 3);
  for (const o of observations) assert.equal(result.weights.get(o.id), 1);
});

test('three claims about ONE property from one portal do discount each other', () => {
  const observations = [
    observation({ id: 'p1', family: 'myhome.ge' }),
    observation({ id: 'p2', family: 'myhome.ge' }),
    observation({ id: 'p3', family: 'myhome.ge' }),
  ];
  const result = computeIndependence(dedupeObservations(observations).observations, {
    subjectOf: () => 'the-same-flat',
  });
  assert.ok(result.effectiveSourceCount < 3);
  assert.equal(result.independentSourceCount, 1);
});

test('two genuinely different publishers count as two independent sources', () => {
  const result = independentOf([
    observation({ id: 'a', family: 'napr.gov.ge' }),
    observation({ id: 'b', family: 'myhome.ge' }),
  ]);
  assert.equal(result.independentSourceCount, 2);
  assert.equal(result.observationCount, 2);
});

test('a duplicate does not vote and does not inflate any count', () => {
  const deduped = dedupeObservations([
    observation({ id: 'a', contentHash: 'same', family: 'f1' }),
    observation({ id: 'b', contentHash: 'same', family: 'f2' }),
  ]);
  const result = computeIndependence(deduped.observations);
  assert.equal(result.observationCount, 1);
  assert.equal(result.independentSourceCount, 1, 'a duplicate added a second family');
  const folded = deduped.observations.find((o) => !o.independent);
  assert.equal(result.weights.get(folded.observation.id), 0);
});

test('supportFor narrows an existing computation rather than recomputing it', () => {
  // Recomputing per claim would let one member of a family look fully
  // independent because its siblings happened to talk about something else.
  const observations = [
    observation({ id: 's1', family: 'syndicate' }),
    observation({ id: 's2', family: 'syndicate' }),
    observation({ id: 'ind', family: 'independent' }),
  ];
  const deduped = dedupeObservations(observations);
  const independence = computeIndependence(deduped.observations, { subjectOf: () => 'one' });

  const both = supportFor([observations[0], observations[1]], independence);
  assert.equal(both.independentSourceCount, 1);
  assert.equal(both.observationCount, 2);
  assert.ok(both.effectiveSourceCount < 2);

  const all = supportFor(observations, independence);
  assert.equal(all.independentSourceCount, 2);
});

test('the per-family breakdown is carried out so the discount is auditable', () => {
  const result = independentOf([
    observation({ id: 'a', family: 'f1' }),
    observation({ id: 'b', family: 'f1' }),
    observation({ id: 'c', family: 'f2' }),
  ]);
  assert.deepEqual(result.familyCounts, { f1: 2, f2: 1 });
});

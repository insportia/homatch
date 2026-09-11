// The regression suite for the crash that started this work.
//
// `Cannot read properties of undefined (reading 'filter')` was thrown when a
// v3 payload reached a renderer written for v1. Every test below is really
// asking one question: can a component downstream of this call `.filter`,
// `.map` and `.length` without checking anything first?
//
// The fixtures are shaped from real production rows (research_jobs.
// synthesis_json on 2026-09-11), reduced to the fields that matter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeVerifyResult,
  normalizeVerifyPayload,
  detectPayloadVersion,
  normalizeLabel,
  jobStatusToState,
} from '../resultNormalizer.ts';

/* ------------------------------------------------------------------ *
 * Fixtures                                                            *
 * ------------------------------------------------------------------ */

/** The shape verify-synthesis emits today. */
const V3 = {
  report: {
    summary: {
      label: 'BALANCED',
      statement: 'Comparable listings in the same project sit at 950-970 USD per sqm.',
      highlights: [
        { dimension: 'MARKET_POSITION', sentiment: 'BALANCED', headline: 'In-project price is clear', detail: 'Three active listings.', cites: ['e69', 'e70'] },
        { dimension: 'LEGAL_CONTEXT', sentiment: 'ATTENTION', headline: 'Still under construction', cites: ['e4'] },
      ],
    },
    keyFindings: [
      { finding: 'The unit is registered as under construction.', whyItMatters: 'Completion risk sits with the buyer.', sentiment: 'ATTENTION', cites: ['e4'] },
    ],
    sections: [
      { key: 'MARKET', title: 'Market', body: 'Three same-project listings.', metrics: [{ label: 'Median', value: '970 USD/sqm' }], cites: ['e69'] },
      { key: 'PROJECT', title: 'Project', body: 'Seven floors, 48 apartments.', cites: ['e3'] },
    ],
    attentionPoints: [{ point: 'Construction status', why: 'Not yet commissioned.', cites: ['e6'] }],
    finalView: 'Reasonable, subject to the contract.',
    contractUpload: { recommend: true, text: 'Upload the sale agreement.' },
  },
  evidence: [{ id: 'e69', claim: 'Listing at 970/sqm', provenance: 'estatehub.ge', certainty: 'REPORTED', url: 'https://example.test/a' }],
  snapshot: { cadastralCode: '01.72.14.040.030.01.01.004', area: '79.5' },
  market: { currency: 'USD', median: 970, count: 3 },
  location: { city: 'Tbilisi', nearby: [] },
  people: { people: [{ name: 'A. Person', role: 'DIRECTOR' }], representationNote: 'Sole signature.' },
  selfChecks: [{ kind: 'PROPERTY_EXTRACT', url: 'https://napr.gov.ge', copyValue: '01.72', copyLabel: 'code' }],
  participants: [{ name: 'A. Person' }],
  mode: 'MODEL',
  propertyType: 'APARTMENT',
  evidenceCounts: { REGISTRY: 4 },
  empty: false,
};

/** The shape before "Buyer Intelligence v3: delete the checklist". */
const V2 = {
  report: {
    overallView: { label: 'MOSTLY_POSITIVE', statement: 'Broadly sound.' },
    executiveSummary: 'The registry extract matches the listing in area and floor.',
    sections: [{ key: 'OWNERSHIP', title: 'Ownership', body: 'Two registered owners.', cites: ['e1'] }],
    attentionPoints: [{ point: 'Mortgage', why: 'One active charge.', cites: ['e2'] }],
    buyerActions: [{ action: 'Request a fresh extract', why: 'The one held is four months old.', cites: [] }],
    finalView: 'Proceed with the usual checks.',
    contractUpload: { recommend: true, text: 'Upload it.' },
  },
  evidence: [{ id: 'e1', claim: 'Two owners', provenance: 'NAPR', certainty: 'REGISTRY' }],
  snapshot: { area: '88.0' },
  mode: 'MODEL',
  propertyType: 'APARTMENT',
  empty: false,
};

/** The original synthesis contract, and the one SynthesisSummary still spoke. */
const V1 = {
  verdict: 'MODERATELY_POSITIVE',
  verdictReasons: ['One active mortgage', 'Area matches the registry'],
  sections: [
    { sectionKey: 'OWNERSHIP', text: 'Two registered owners appear on the extract.' },
    { sectionKey: 'MARKET', text: 'Asking price is within the district band.' },
  ],
  incompleteSources: ['the debtors registry'],
  mode: 'DETERMINISTIC',
  propertyType: 'APARTMENT',
  empty: false,
};

/** Every array a renderer might touch, on a fully normalised result. */
function assertAllArraysPresent(t, r) {
  assert.ok(Array.isArray(r.evidence), 'evidence');
  assert.ok(Array.isArray(r.selfChecks), 'selfChecks');
  assert.ok(Array.isArray(r.participants), 'participants');
  assert.ok(Array.isArray(r.incompleteSources), 'incompleteSources');
  if (r.report) {
    assert.ok(Array.isArray(r.report.sections), 'report.sections');
    assert.ok(Array.isArray(r.report.keyFindings), 'report.keyFindings');
    assert.ok(Array.isArray(r.report.attentionPoints), 'report.attentionPoints');
    assert.ok(Array.isArray(r.report.nextSteps), 'report.nextSteps');
    assert.ok(Array.isArray(r.report.summary.highlights), 'summary.highlights');
    for (const s of r.report.sections) {
      assert.ok(Array.isArray(s.cites), 'section.cites');
      assert.ok(Array.isArray(s.metrics), 'section.metrics');
    }
  }
  if (r.people) assert.ok(Array.isArray(r.people.people), 'people.people');
}

/* ------------------------------------------------------------------ *
 * Version detection                                                   *
 * ------------------------------------------------------------------ */

test('detects each payload version by its structure, not a version field', () => {
  assert.equal(detectPayloadVersion(V1), 'V1');
  assert.equal(detectPayloadVersion(V2), 'V2');
  assert.equal(detectPayloadVersion(V3), 'V3');
  assert.equal(detectPayloadVersion({ report: null, empty: true }), 'V3');
  assert.equal(detectPayloadVersion({ error: 'internal_error' }), 'ERROR');
  assert.equal(detectPayloadVersion(null), 'NONE');
  assert.equal(detectPayloadVersion(undefined), 'NONE');
  assert.equal(detectPayloadVersion({}), 'NONE');
  assert.equal(detectPayloadVersion('not an object'), 'NONE');
});

/* ------------------------------------------------------------------ *
 * THE CRASH                                                           *
 * ------------------------------------------------------------------ */

test('THE BUG: a v3 payload read by the old top-level contract has no sections', () => {
  // This is the exact expression SynthesisSummary evaluated, and the exact
  // reason it threw. Pinned so nobody reintroduces a top-level reader.
  assert.equal(V3.sections, undefined);
  assert.throws(() => V3.sections.filter(Boolean), TypeError);

  // After normalisation the same question has a safe answer.
  const { result } = normalizeVerifyPayload(V3);
  assert.equal(result.report.sections.filter(Boolean).length, 2);
});

test('every version yields arrays a renderer can filter without guarding', () => {
  for (const [name, fixture] of [['v1', V1], ['v2', V2], ['v3', V3]]) {
    const { result } = normalizeVerifyPayload(fixture);
    assertAllArraysPresent(name, result);
  }
});

test('null, undefined, a string and an empty object all normalise instead of throwing', () => {
  for (const bad of [null, undefined, '', 'text', 0, [], {}, { unrelated: 1 }]) {
    const { result } = normalizeVerifyPayload(bad);
    assert.equal(result.report, null);
    assert.equal(result.empty, true);
    assertAllArraysPresent('bad', result);
  }
});

/* ------------------------------------------------------------------ *
 * Backwards compatibility (PART A §2)                                 *
 * ------------------------------------------------------------------ */

test('v1: sectionKey/text map onto key/body and the report survives', () => {
  const { result, payloadVersion } = normalizeVerifyPayload(V1);
  assert.equal(payloadVersion, 'V1');
  assert.deepEqual(result.report.sections.map((s) => s.key), ['OWNERSHIP', 'MARKET']);
  assert.equal(result.report.sections[0].body, 'Two registered owners appear on the extract.');
});

test('v1: the verdict reasons are preserved as highlights, not invented into prose', () => {
  const { result } = normalizeVerifyPayload(V1);
  assert.deepEqual(
    result.report.summary.highlights.map((h) => h.headline),
    ['One active mortgage', 'Area matches the registry']
  );
  // Nothing was fabricated to fill v3's richer fields.
  assert.deepEqual(result.report.keyFindings, []);
  for (const h of result.report.summary.highlights) assert.equal(h.dimension, '');
  // v1 never had a summary statement, so the opening is BORROWED from the
  // report's own first section rather than written here — and says so.
  assert.equal(result.report.summary.statementSource, 'SECTION');
  assert.equal(result.report.summary.statement, 'Two registered owners appear on the extract.');
});

/* ------------------------------------------------------------------ *
 * The opening sentence (PART A §4)                                    *
 * ------------------------------------------------------------------ */

test('a report that HAS a summary keeps it, and is marked as the real thing', () => {
  const { result } = normalizeVerifyPayload(V3);
  assert.equal(result.report.summary.statementSource, 'MODEL');
  assert.match(result.report.summary.statement, /950-970 USD/);
});

test('24 of 58 production reports have no summary: the opening falls back to finalView', () => {
  // Measured against the real persisted rows on 2026-09-12. 16 of those 24
  // carry a finalView the pipeline wrote and grounded for that property.
  const { result } = normalizeVerifyPayload({
    report: {
      summary: { label: 'BALANCED', statement: '', highlights: [] },
      sections: [{ key: 'MARKET', title: 'Market', body: 'Three listings.' }],
      finalView: 'Reasonable, subject to the contract.',
    },
  });
  assert.equal(result.report.summary.statement, 'Reasonable, subject to the contract.');
  assert.equal(result.report.summary.statementSource, 'FINAL_VIEW');
});

test('with no finalView either, the opening is the first section opening sentence', () => {
  const { result } = normalizeVerifyPayload({
    report: {
      summary: { label: 'POSITIVE' },
      sections: [
        { key: 'PROJECT', title: 'Project', body: '  ' },
        { key: 'MARKET', title: 'Market', body: 'Comparable flats sit at 970 per sqm. A second sentence follows.' },
      ],
    },
  });
  assert.equal(result.report.summary.statement, 'Comparable flats sit at 970 per sqm.');
  assert.equal(result.report.summary.statementSource, 'SECTION');
});

test('the fallback RELOCATES a sentence and never composes one', () => {
  const source = 'The registry lists two owners.';
  const { result } = normalizeVerifyPayload({
    report: { summary: { label: 'BALANCED' }, sections: [{ key: 'A', title: 'A', body: source }] },
  });
  // Every word of the opening came from the report. Nothing was joined,
  // derived or written here — an assembled summary would be an unvalidated
  // claim wearing the report's authority.
  assert.ok(source.includes(result.report.summary.statement));
});

test('a report with nothing to borrow says so rather than inventing an opening', () => {
  const { result } = normalizeVerifyPayload({
    report: { summary: { label: 'BALANCED', highlights: [{ headline: 'Only a highlight' }] }, sections: [] },
  });
  assert.equal(result.report.summary.statement, '');
  assert.equal(result.report.summary.statementSource, 'NONE');
});

test('v1: incompleteSources survive, because no later version carried them', () => {
  const { result } = normalizeVerifyPayload(V1);
  assert.deepEqual(result.incompleteSources, ['the debtors registry']);
});

test('v2: overallView.statement and executiveSummary are joined, never one dropped', () => {
  const { result, payloadVersion } = normalizeVerifyPayload(V2);
  assert.equal(payloadVersion, 'V2');
  assert.match(result.report.summary.statement, /Broadly sound\./);
  assert.match(result.report.summary.statement, /registry extract matches/);
});

test('v2: buyerActions become nextSteps', () => {
  const { result } = normalizeVerifyPayload(V2);
  assert.deepEqual(result.report.nextSteps.map((s) => s.step), ['Request a fresh extract']);
});

test('the three label vocabularies collapse onto the three current states', () => {
  assert.equal(normalizeLabel('POSITIVE'), 'POSITIVE');
  assert.equal(normalizeLabel('MOSTLY_POSITIVE'), 'BALANCED');
  assert.equal(normalizeLabel('MODERATELY_POSITIVE'), 'BALANCED');
  assert.equal(normalizeLabel('MIXED'), 'BALANCED');
  assert.equal(normalizeLabel('NEGATIVE'), 'NEEDS_ATTENTION');
  assert.equal(normalizeLabel('NEEDS_ATTENTION'), 'NEEDS_ATTENTION');
  // An unknown or absent label is ordinary, not alarming.
  assert.equal(normalizeLabel('WHATEVER'), 'BALANCED');
  assert.equal(normalizeLabel(undefined), 'BALANCED');
  assert.equal(normalizeLabel(null), 'BALANCED');
});

/* ------------------------------------------------------------------ *
 * Missing newer fields on an older report (PART A §2)                 *
 * ------------------------------------------------------------------ */

test('a v3 report missing every optional array still renders its sections', () => {
  const sparse = { report: { summary: { label: 'POSITIVE', statement: 'Fine.' }, sections: [{ key: 'X', title: 'X', body: 'Body.' }] } };
  const { result } = normalizeVerifyPayload(sparse);
  assertAllArraysPresent('sparse', result);
  assert.deepEqual(result.report.keyFindings, []);
  assert.deepEqual(result.report.attentionPoints, []);
  assert.deepEqual(result.report.summary.highlights, []);
  assert.equal(result.report.contractUpload.recommend, false);
  assert.equal(result.report.sections[0].body, 'Body.');
});

test('nulls inside arrays are dropped rather than reaching the renderer', () => {
  const messy = {
    report: {
      summary: { label: 'BALANCED', statement: 'S', highlights: [null, { headline: 'Kept' }, { headline: '' }] },
      keyFindings: [null, { finding: 'Kept' }, { finding: '   ' }],
      sections: [null, { key: 'A', body: 'kept' }, { key: 'B', body: '' }],
      attentionPoints: [{ point: '' }, { point: 'Kept' }],
    },
  };
  const { result } = normalizeVerifyPayload(messy);
  assert.deepEqual(result.report.summary.highlights.map((h) => h.headline), ['Kept']);
  assert.deepEqual(result.report.keyFindings.map((f) => f.finding), ['Kept']);
  assert.deepEqual(result.report.sections.map((s) => s.key), ['A']);
  assert.deepEqual(result.report.attentionPoints.map((a) => a.point), ['Kept']);
});

test('a cites array that is a string, a number or absent becomes an empty array', () => {
  const { result } = normalizeVerifyPayload({
    report: { summary: { label: 'BALANCED' }, sections: [{ key: 'A', body: 'b', cites: 'e1' }, { key: 'B', body: 'b', cites: 7 }, { key: 'C', body: 'b' }] },
  });
  for (const s of result.report.sections) assert.deepEqual(s.cites, []);
});

/* ------------------------------------------------------------------ *
 * Explicit states (PART A §3)                                         *
 * ------------------------------------------------------------------ */

test('research_jobs status words map onto the shared job vocabulary', () => {
  assert.equal(jobStatusToState('CREATED'), 'QUEUED');
  assert.equal(jobStatusToState('RUNNING'), 'PROCESSING');
  assert.equal(jobStatusToState('WAITING_HUMAN'), 'PROCESSING');
  assert.equal(jobStatusToState('COMPLETE'), 'COMPLETED');
  assert.equal(jobStatusToState('FAILED'), 'FAILED');
  assert.equal(jobStatusToState('RUNNING', '2026-09-11T00:00:00Z'), 'CANCELLED');
});

test('a finished job with a full payload is COMPLETED with no error', () => {
  const n = normalizeVerifyResult({ raw: V3, jobStatus: 'COMPLETE' });
  assert.equal(n.state, 'COMPLETED');
  assert.equal(n.errorKey, null);
  assert.equal(n.payloadVersion, 'V3');
  assert.equal(n.result.report.sections.length, 2);
});

test('a running job with nothing written yet is PROCESSING, not a broken report', () => {
  const n = normalizeVerifyResult({ raw: null, jobStatus: 'RUNNING' });
  assert.equal(n.state, 'PROCESSING');
  assert.equal(n.result.report, null);
  assert.equal(n.errorKey, null);
});

test('PARTIAL: a running job that already has readable sections shows them', () => {
  // PART A §4 — do not leave a blank loading container when useful
  // information already exists.
  const n = normalizeVerifyResult({ raw: V3, jobStatus: 'RUNNING' });
  assert.equal(n.state, 'PARTIAL');
  assert.equal(n.result.report.sections.length, 2);
  assert.equal(n.errorKey, null);
});

test('a failed job that still produced sections shows them alongside the failure', () => {
  const n = normalizeVerifyResult({ raw: V3, jobStatus: 'FAILED' });
  assert.equal(n.state, 'FAILED');
  assert.equal(n.errorKey, 'verify_result_failed');
  assert.equal(n.result.report.sections.length, 2, 'the work that did complete is not thrown away');
});

test('a cancelled job is CANCELLED and carries no error message', () => {
  const n = normalizeVerifyResult({ raw: null, jobStatus: 'RUNNING', cancelledAt: '2026-09-11T10:00:00Z' });
  assert.equal(n.state, 'CANCELLED');
  assert.equal(n.errorKey, null);
});

/* ------------------------------------------------------------------ *
 * Never a raw runtime error (PART E §54)                              *
 * ------------------------------------------------------------------ */

test('an error envelope produces a translation key, never provider prose', () => {
  const n = normalizeVerifyResult({ raw: { error: 'internal_error' }, jobStatus: 'COMPLETE' });
  assert.equal(n.state, 'FAILED');
  assert.equal(n.errorKey, 'verify_result_unavailable');
  // The technical string is retained for the log, and is not the errorKey.
  assert.equal(n.technicalDetail, 'internal_error');
  assert.notEqual(n.errorKey, n.technicalDetail);
});

test('a fetch failure does not relabel a healthy job as a failed verification', () => {
  const n = normalizeVerifyResult({ raw: null, jobStatus: 'RUNNING', fetchFailed: true });
  assert.equal(n.state, 'PROCESSING', 'the job is still running; only our read of it failed');
  assert.equal(n.errorKey, 'verify_result_unavailable');
});

test('the error key is always a key, never a JavaScript message', () => {
  const n = normalizeVerifyResult({
    raw: { error: "Cannot read properties of undefined (reading 'filter')" },
    jobStatus: 'COMPLETE',
  });
  assert.ok(/^[a-z0-9_]+$/.test(n.errorKey), `${n.errorKey} is a translation key`);
  assert.doesNotMatch(n.errorKey, /undefined|Cannot read/);
});

/* ------------------------------------------------------------------ *
 * "No evidence at all" stays a real answer                            *
 * ------------------------------------------------------------------ */

test('report: null is preserved as an empty result, not upgraded into a clean bill of health', () => {
  const n = normalizeVerifyResult({
    raw: { report: null, mode: 'DETERMINISTIC', propertyType: 'APARTMENT', snapshot: { area: '50' }, selfChecks: [], empty: true },
    jobStatus: 'COMPLETE',
  });
  assert.equal(n.state, 'COMPLETED');
  assert.equal(n.result.report, null);
  assert.equal(n.result.empty, true);
  assert.equal(n.errorKey, null, 'no evidence is an outcome, not an error');
  assert.deepEqual(n.result.snapshot, { area: '50' }, 'what was known is still shown');
});

test('an empty people block becomes null rather than an object with no people', () => {
  const { result } = normalizeVerifyPayload({ report: { summary: { label: 'POSITIVE' }, sections: [{ key: 'A', body: 'b' }] }, people: { people: [] } });
  assert.equal(result.people, null);
});

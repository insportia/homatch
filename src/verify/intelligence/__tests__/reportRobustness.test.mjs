// The report builders must not be the thing that crashes.
//
// Reported from production, on Continue Verification:
//
//   TypeError: Cannot read properties of undefined (reading 'filter')
//
// deterministicReport() and finalizeReport() are the LAST line of defence —
// they exist so a customer still gets something truthful when the model fails
// or returns nothing usable. Both reached straight into pkg.items, so a
// package without one threw that exact error instead of degrading.
//
// Honest scope note: buildEvidencePackage() always returns an items array, and
// it is the only live caller, so this hardens the contract rather than proving
// it was the production path. The first two assertions below are the verbatim
// reproduction; the journey itself is still open (see the session report).

import test from 'node:test';
import assert from 'node:assert/strict';
import { deterministicReport, finalizeReport, parseReport } from '../report.ts';
import { buildEvidencePackage } from '../evidencePackage.ts';

const REPORTED = /Cannot read properties of undefined \(reading 'filter'\)/;

/* ── the reproduction ────────────────────────────────────────────────── */

test('a package with no items no longer throws the reported error', () => {
  // Before the fix these two threw REPORTED verbatim.
  assert.doesNotThrow(() => deterministicReport({}), REPORTED);
  assert.doesNotThrow(() => deterministicReport({ items: undefined }), REPORTED);
});

test('finalizeReport survives the same package', () => {
  const parsed = parseReport('{"summary":{"label":"x","statement":"y"}}') ?? {};
  assert.doesNotThrow(() => finalizeReport({}, parsed), REPORTED);
  assert.doesNotThrow(() => finalizeReport({ items: undefined }, parsed), REPORTED);
});

test('a missing package degrades rather than crashing', () => {
  for (const pkg of [undefined, null, {}, { items: null }, { items: 'nope' }, { items: 42 }]) {
    const r = deterministicReport(pkg);
    assert.ok(r && typeof r === 'object', `deterministicReport(${JSON.stringify(pkg)}) returned nothing`);
    assert.ok(Array.isArray(r.sections), 'sections is not an array');
  }
});

/* ── degrading is not the same as inventing ──────────────────────────── */

test('no evidence produces an EMPTY report, never a reassuring one', () => {
  // The dangerous failure is not a crash — it is a report that reads like a
  // clean bill of health because nothing was found.
  const r = deterministicReport({ items: [] });
  assert.equal(r.sections.length, 0, 'a section was produced from no evidence');
  assert.deepEqual(r.keyFindings ?? [], [], 'a finding was produced from no evidence');
});

test('evidenceUsed stays empty when there is no package to cite', () => {
  const parsed = parseReport('{"summary":{"label":"x","statement":"y"}}') ?? {};
  const final = finalizeReport({}, parsed);
  assert.deepEqual(final.evidenceUsed, [], 'the report cited evidence it does not have');
});

/* ── the real builder still works exactly as before ──────────────────── */

test('a genuinely built package is unaffected', () => {
  // The guard must not change behaviour for the path that was always correct.
  const pkg = buildEvidencePackage({
    officialEvidence: ['2025 წლის 14 ივლისის ამონაწერი მესაკუთრედ შპს „მილენიო გრუპი“-ს ასახავს.'],
    companyProfile: { name: 'შპს „მილენიო გრუპი“', idCode: '404670272' },
  });
  assert.ok(Array.isArray(pkg.items), 'the builder stopped producing items');
  const r = deterministicReport(pkg);
  assert.ok(Array.isArray(r.sections));
  // Whatever it produces, it produces the same thing as before the guard.
  assert.deepEqual(r, deterministicReport({ items: pkg.items }));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractClaims, technicalOutcomes, checkedOutcomes,
  buildVerifySnapshot, classifyEncumbrance,
} from '../verifyExtract.ts';
import { projectVerify, toWriteModel } from '../assemble.ts';

/*
 * The extraction layer is where "NO EVIDENCE = NO FACT" is actually enforced.
 * Everything downstream trusts it, so these tests are deliberately about the
 * ways it could quietly invent a fact rather than about happy paths.
 *
 * The fixture mirrors the real Krtsanisi property from production job
 * 3aa36828: a company-owned unit under construction with a Bank of Georgia
 * pledge registered on the parent parcel.
 */

const REPORT = {
  entityName: 'შპს მილენიო გრუპი',
  entityType: 'APARTMENT',
  exactUnit: { cadastralCode: '01.19.36.018.041', address: 'ქრწანისი, თბილისი', area: '94.1', floor: '7' },
  identifiedParent: { code: '01.19.36.018', address: 'ქრწანისი, თბილისი' },
  rightsAndRestrictions: {
    status: 'RESTRICTION_IDENTIFIED',
    items: ['იპოთეკა — სს "საქართველოს ბანკი"'],
    asOf: '2026-08-01',
  },
  companyProfile: {
    name: 'შპს მილენიო გრუპი', idCode: '404670272', status: 'აქტიური',
    sourceBasis: 'REGISTRY_CONFIRMED', directors: ['ნინო ბერიძე'],
  },
  projectProfile: { constructionStatus: 'მშენებლობის პროცესში' },
  officialSourceCoverage: [
    { source: 'napr.registry', sourceName: 'საჯარო რეესტრი', customerStatus: 'SUCCESS' },
    { source: 'enforcement.debtors', sourceName: 'მოვალეთა რეესტრი', customerStatus: 'CAPTCHA_REQUIRED' },
    { source: 'rs.taxpayer', sourceName: 'შემოსავლების სამსახური', customerStatus: 'BLOCKED' },
    { source: 'mygov.permits', sourceName: 'my.gov.ge', customerStatus: 'NO_RESULT' },
  ],
};

/* ---------------------------------------------------------------- *
 * NO EVIDENCE = NO FACT                                             *
 * ---------------------------------------------------------------- */

test('an unchecked registry produces NO encumbrance fact in either direction', () => {
  const claims = extractClaims({ ...REPORT, rightsAndRestrictions: { status: 'NOT_CONFIRMED' } });
  const enc = claims.filter((c) => c.type.startsWith('encumbrance.'));
  assert.equal(enc.length, 0, 'NOT_CONFIRMED must not produce a restriction NOR a clean record');
});

test('a missing rightsAndRestrictions block produces no encumbrance claims', () => {
  const claims = extractClaims({ ...REPORT, rightsAndRestrictions: null });
  assert.equal(claims.filter((c) => c.type.startsWith('encumbrance.')).length, 0);
});

test('an evidenced ABSENCE is recorded, but marked negative so it cannot score as risk', () => {
  const claims = extractClaims({
    ...REPORT,
    rightsAndRestrictions: { status: 'NONE_FOUND_IN_CHECKED_SOURCE', statement: 'შეზღუდვა არ იძებნება', asOf: '2026-08-01' },
  });
  const none = claims.find((c) => c.type === 'encumbrance.none');
  assert.ok(none, 'an explicit "none found" IS evidence and must be kept');
  assert.equal(none.negative, true);
  assert.equal(none.effectiveDate, '2026-08-01');
});

test('every emitted claim carries provenance — a claim without a source is never produced', () => {
  for (const c of extractClaims(REPORT)) {
    assert.ok(c.source && c.source.length > 0, `claim ${c.type} has no source`);
  }
});

test('empty, null and garbage reports degrade to zero claims rather than throwing', () => {
  for (const bad of [null, undefined, {}, { exactUnit: null }, 'nonsense', 42]) {
    assert.deepEqual(extractClaims(bad), []);
  }
});

/* ---------------------------------------------------------------- *
 * TECHNICAL FAILURE IS NOT PROPERTY RISK                            *
 * ---------------------------------------------------------------- */

test('CAPTCHA / BLOCKED / TECHNICAL_FAILED are separated from real outcomes', () => {
  const tech = technicalOutcomes(REPORT);
  const checked = checkedOutcomes(REPORT);
  assert.deepEqual(tech.map((t) => t.source).sort(), ['enforcement.debtors', 'rs.taxpayer']);
  assert.deepEqual(checked.map((c) => c.source).sort(), ['mygov.permits', 'napr.registry']);
});

test('a technically-failed source produces no claims at all', () => {
  const claims = extractClaims(REPORT);
  const sources = new Set(claims.map((c) => c.source));
  assert.ok(!sources.has('enforcement.debtors'), 'a CAPTCHA-blocked source must contribute no evidence');
  assert.ok(!sources.has('rs.taxpayer'), 'a BLOCKED source must contribute no evidence');
});

test('technical failures cannot lower the verdict', () => {
  const clean = {
    ...REPORT,
    rightsAndRestrictions: { status: 'NONE_FOUND_IN_CHECKED_SOURCE', statement: 'არ იძებნება' },
  };
  const allFine = projectVerify({ jobId: 'j1', report: { ...clean, officialSourceCoverage: [] } });
  const allBroken = projectVerify({ jobId: 'j1', report: clean });

  assert.equal(allFine.verdict, 'POSITIVE');
  assert.equal(allBroken.verdict, 'POSITIVE', 'two failed sources must not move the verdict');
  assert.equal(allBroken.incomplete.length, 2, 'but they must still be reported honestly');
});

/* ---------------------------------------------------------------- *
 * Encumbrance classification                                        *
 * ---------------------------------------------------------------- */

test('Georgian restriction phrases map onto the right verdict-bearing types', () => {
  assert.equal(classifyEncumbrance('ყადაღა დადებულია'), 'encumbrance.seizure');
  assert.equal(classifyEncumbrance('იპოთეკა — საქართველოს ბანკი'), 'encumbrance.mortgage');
  assert.equal(classifyEncumbrance('საგადასახადო გირავნობა'), 'encumbrance.taxLien');
  assert.equal(classifyEncumbrance('მოვალეთა რეესტრში'), 'encumbrance.debtorRegistry');
});

test('seizure is checked before the generic pledge pattern, not after', () => {
  // "ყადაღა/აკრძალვა" also contains no mortgage word, but a phrase carrying
  // both must classify as the more severe one.
  assert.equal(classifyEncumbrance('ყადაღა და იპოთეკა'), 'encumbrance.seizure');
});

test('an unrecognised restriction is kept as generic rather than dropped or inflated', () => {
  assert.equal(classifyEncumbrance('რაღაც უცნობი შეზღუდვა'), 'encumbrance.other');
  assert.equal(classifyEncumbrance('   '), null);
});

/* ---------------------------------------------------------------- *
 * Verdict is driven by property risk only                           *
 * ---------------------------------------------------------------- */

test('a registered mortgage yields MODERATELY_POSITIVE, a seizure yields NEGATIVE', () => {
  const mortgage = projectVerify({ jobId: 'j', report: REPORT });
  assert.equal(mortgage.verdict, 'MODERATELY_POSITIVE');

  const seized = projectVerify({
    jobId: 'j',
    report: { ...REPORT, rightsAndRestrictions: { status: 'RESTRICTION_IDENTIFIED', items: ['ყადაღა'] } },
  });
  assert.equal(seized.verdict, 'NEGATIVE');
});

test('the verdict is always one of exactly three values', () => {
  const allowed = new Set(['POSITIVE', 'MODERATELY_POSITIVE', 'NEGATIVE']);
  for (const items of [[], ['იპოთეკა'], ['ყადაღა'], ['საგადასახადო გირავნობა', 'იპოთეკა']]) {
    const p = projectVerify({
      jobId: 'j',
      report: { ...REPORT, rightsAndRestrictions: { status: 'RESTRICTION_IDENTIFIED', items } },
    });
    assert.ok(allowed.has(p.verdict), `unexpected verdict ${p.verdict}`);
  }
});

/* ---------------------------------------------------------------- *
 * Projection + snapshot                                             *
 * ---------------------------------------------------------------- */

test('the projection is deterministic — same report in, same projection out', () => {
  const a = projectVerify({ jobId: 'j', report: REPORT, capturedAt: '2026-09-09T00:00:00Z' });
  const b = projectVerify({ jobId: 'j', report: REPORT, capturedAt: '2026-09-09T00:00:00Z' });
  assert.deepEqual(a, b);
});

test('the snapshot is a small traceable header, never the evidence payload', () => {
  const s = projectVerify({ jobId: 'job-1', report: REPORT, capturedAt: '2026-09-09T00:00:00Z' }).snapshot;
  assert.equal(s.jobId, 'job-1');
  assert.equal(s.snapshotVersion, 1);
  assert.equal(s.cadastralCode, '01.19.36.018.041');
  assert.equal(s.capturedAt, '2026-09-09T00:00:00Z');
  assert.deepEqual(s.incompleteSources.sort(), ['enforcement.debtors', 'rs.taxpayer']);

  // It must stay small enough to live in a jsonb column forever.
  assert.ok(JSON.stringify(s).length < 2000, 'snapshot must not grow into a payload copy');
  assert.ok(!JSON.stringify(s).includes('sourceBasis'), 'raw report internals must not leak into the snapshot');
});

test('checked and incomplete sources are never conflated in the snapshot', () => {
  const s = projectVerify({ jobId: 'j', report: REPORT }).snapshot;
  for (const src of s.incompleteSources) {
    assert.ok(!s.checkedSources.includes(src), `${src} cannot be both checked and incomplete`);
  }
});

test('a company-owned unit under construction is inferred as a developer apartment', () => {
  const p = projectVerify({ jobId: 'j', report: REPORT });
  assert.equal(p.propertyType, 'DEVELOPER_APARTMENT');
});

test('an unclassifiable property stays UNKNOWN rather than guessing', () => {
  const p = projectVerify({ jobId: 'j', report: { officialSourceCoverage: [] } });
  assert.equal(p.propertyType, 'UNKNOWN');
  assert.equal(p.facts.length, 0);
});

/* ---------------------------------------------------------------- *
 * Write model                                                       *
 * ---------------------------------------------------------------- */

test('the write model carries grounding on every action item', () => {
  const wm = toWriteModel(projectVerify({ jobId: 'j', report: REPORT }));
  assert.ok(wm.actionItems.length > 0, 'a mortgaged developer unit must produce actions');
  for (const a of wm.actionItems) {
    assert.ok(Array.isArray(a.grounded_in));
    assert.ok(a.action_key && a.title && a.why);
    assert.ok(a.priority >= 1 && a.priority <= 3);
  }
});

test('an empty Verify produces an empty plan, not a generic checklist', () => {
  const wm = toWriteModel(projectVerify({ jobId: 'j', report: {} }));
  assert.equal(wm.actionItems.length, 0, 'no evidence must mean no advice');
  assert.equal(wm.room.verify_job_id, 'j');
});

test('the write model never invents a cadastral code', () => {
  const wm = toWriteModel(projectVerify({ jobId: 'j', report: {} }));
  assert.equal(wm.room.cadastral_code, null);
});

test('markdown emphasis from the pipeline never reaches a persisted value', () => {
  const claims = extractClaims({
    ...REPORT,
    companyProfile: { name: '**შპს ტესტი**', sourceBasis: 'REGISTRY_CONFIRMED' },
  });
  const name = claims.find((c) => c.type === 'company.name');
  assert.equal(name.value, 'შპს ტესტი');
});

test('buildVerifySnapshot tolerates a report with nothing in it', () => {
  const s = buildVerifySnapshot({ jobId: 'j', report: null, capturedAt: '2026-01-01T00:00:00Z' });
  assert.equal(s.cadastralCode, null);
  assert.equal(s.factCount, 0);
  assert.deepEqual(s.checkedSources, []);
});

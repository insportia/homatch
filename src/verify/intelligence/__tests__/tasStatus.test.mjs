// Current official status by AUTHORITY, not upload date; milestone selection;
// visual version honesty; the discovered → shown funnel on a large history;
// and the prompt-safe official payload.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTasIntelligence, officialHistoryView, tasDigest } from '../tasIntelligence.ts';
import { promptSafeBrowserOfficial } from '../officialPromptContext.ts';

const SHA = (c) => c.repeat(64);
const dec = (outcome, number = null, extra = {}) => ({ number, issueDate: null, outcome, evidence: `… ${outcome} …`, validUntil: null, ...extra });
const mot = (id, date, name, decision = null) => ({ motionId: id, date, name, status: null, response: decision ? 'PDF' : 'EMPTY', decision });
const kase = (documentId, date, docType, motions, extra = {}) => ({ documentId, registrationNumber: `AR1${documentId}`, title: docType, docType, status: null, date, parties: [], values: [], technicalFacts: [], motions, attachments: [], ...extra });
const report = (cases, extra = {}) => ({ browserOfficial: { results: [{ source: 'tas', documents: [], tasApi: { cases, accounting: { responses: { PDF: 3, HTML: 0, FAILED: 0, NOT_FETCHED: 0 } }, ledger: { incomplete: false, incompleteReasons: [] }, ...extra } }] } });
const NOW = '2026-10-08T00:00:00Z';

test('permit then a later refusal on a NEW application: the permit stays in force', () => {
  const t = buildTasIntelligence(report([
    kase('100', '2019-01-10', 'მშენებლობის ნებართვა', [mot('1', '2019-03-01', 'ნებართვა', dec('PERMIT_ISSUED', '111'))]),
    kase('200', '2023-05-10', 'ცვლილების განაცხადი', [mot('2', '2023-07-01', 'პასუხი', dec('REFUSED', '222'))]),
  ]), NOW);
  assert.equal(t.officialStatus.state, 'PERMITTED');
  assert.equal(t.officialStatus.basis.decisionNumber, '111');
  assert.equal(t.officialStatus.conclusive, true);
  // The refusal is a milestone even though it did not change the state.
  const ms = t.milestoneIds.map((id) => t.timeline.find((e) => e.id === id));
  assert.ok(ms.some((e) => e.decision?.outcome === 'REFUSED'));
});

test('cancellation outranks the permit; a later upload with no decision does not "supersede" it', () => {
  const t = buildTasIntelligence(report([
    kase('100', '2019-01-10', 'მშენებლობის ნებართვა', [mot('1', '2019-03-01', 'ნებართვა', dec('PERMIT_ISSUED', '111'))]),
    kase('300', '2024-02-01', 'ნებართვის გაუქმება', [mot('3', '2024-03-01', 'ბრძანება', dec('CANCELLED', '333'))]),
    kase('400', '2025-01-01', 'წერილი', [mot('4', '2025-01-05', 'კორესპონდენცია', dec('INFORMATIONAL'))]),
  ]), NOW);
  assert.equal(t.officialStatus.state, 'CANCELLED');
  assert.equal(t.officialStatus.basis.decisionNumber, '333');
});

test('an unread later decision and incomplete processing make the status NOT conclusive', () => {
  const t = buildTasIntelligence(report([
    kase('100', '2019-01-10', 'ნებართვა', [mot('1', '2019-03-01', 'ნებართვა', dec('PERMIT_ISSUED', '111'))]),
    kase('500', '2025-06-01', 'ცვლილება', [mot('5', '2025-06-20', 'პასუხი', dec('UNDETERMINED'))]),
  ], { ledger: { incomplete: true, incompleteReasons: ['ATTACHMENTS_DEFERRED_BY_BUDGET'] } }), NOW);
  assert.equal(t.officialStatus.state, 'PERMITTED');
  assert.equal(t.officialStatus.conclusive, false);
  assert.ok(t.officialStatus.caveats.includes('LATER_UNDETERMINED_DECISION'));
  assert.ok(t.officialStatus.caveats.includes('PROCESSING_INCOMPLETE'));
  assert.match(tasDigest(t, () => null).text, /NOT CONCLUSIVE/);
});

test('no decisions read: status is NOT_ESTABLISHED, never guessed from case titles', () => {
  const t = buildTasIntelligence(report([kase('100', '2019-01-10', 'მშენებლობის ნებართვა', [mot('1', '2019-03-01', 'ნებართვა')])]), NOW);
  assert.equal(t.officialStatus.state, 'NOT_ESTABLISHED');
  assert.equal(t.officialStatus.conclusive, false);
});

test('pending: a later application answered only with deficiencies is reported as pending', () => {
  const t = buildTasIntelligence(report([
    kase('100', '2019-01-10', 'ნებართვა', [mot('1', '2019-03-01', 'ნებართვა', dec('PERMIT_ISSUED', '111'))]),
    kase('600', '2026-01-10', 'ცვლილება', [mot('6', '2026-02-01', 'პასუხი', dec('DEFICIENCY', '666'))]),
  ]), NOW);
  assert.equal(t.officialStatus.state, 'PERMITTED');
  assert.equal(t.officialStatus.pending.length, 1);
});

test('visual version: "current approved" only for the case with the latest approving decision', () => {
  const r = report([
    kase('100', '2019-01-10', 'ნებართვა', [mot('1', '2019-03-01', 'ნებართვა', dec('PERMIT_ISSUED', '111'))]),
    kase('200', '2023-05-10', 'ცვლილება', [mot('2', '2023-07-01', 'პასუხი', dec('AMENDMENT_APPROVED', '222'))]),
    kase('300', '2025-05-10', 'ახალი განაცხადი', [mot('3', '2025-07-01', 'პასუხი', dec('INTERMEDIATE'))]),
  ]);
  r.officialVisuals = [
    { id: SHA('a'), role: 'EARLIEST_RENDER', kind: 'RENDER', date: '2019-01-10', documentId: '100' },
    { id: SHA('b'), role: 'SUPPORTING', kind: 'RENDER', date: '2023-05-10', documentId: '200' },
    { id: SHA('c'), role: 'LATEST_RENDER', kind: 'RENDER', date: '2025-05-10', documentId: '300' },
  ];
  const t = buildTasIntelligence(r, NOW);
  const v = Object.fromEntries(t.visuals.map((x) => [x.documentId, x.versionStatus]));
  assert.deepEqual(v, { 100: 'HISTORICAL_APPROVED', 200: 'CURRENT_APPROVED', 300: 'UNDETERMINED' });
});

test('large history: 300 cases × routine steps → a 5–10 milestone story, negatives always kept', () => {
  const cases = [];
  for (let i = 0; i < 300; i++) {
    const y = 2010 + Math.floor(i / 25);
    const motions = [mot(`m${i}a`, `${y}-0${(i % 9) + 1}-02`, 'რეგისტრაცია'), mot(`m${i}b`, `${y}-0${(i % 9) + 1}-10`, 'კორესპონდენცია', dec('INFORMATIONAL'))];
    if (i === 40) motions.push(mot('p', `${y}-05-01`, 'ნებართვა', dec('PERMIT_ISSUED', '4040')));
    if (i === 120) motions.push(mot('r', `${y}-06-01`, 'პასუხი', dec('REFUSED', '1200')));
    if (i === 280) motions.push(mot('x', `${y}-07-01`, 'ვადის გაგრძელება', dec('DEADLINE_EXTENDED', '2800', { validUntil: '2027-12-31' })));
    cases.push(kase(String(1000 + i), `${y}-0${(i % 9) + 1}-01`, 'განაცხადი', motions));
  }
  const t = buildTasIntelligence(report(cases, { ledger: { discovered: { documents: 300, motions: 603, attachments: 2400 }, processed: { responses: 603, attachmentsRead: 900 }, deferred: { attachmentsBudget: 1500 }, incomplete: true, incompleteReasons: ['ATTACHMENTS_DEFERRED_BY_BUDGET'] } }), NOW);
  assert.ok(t.timeline.length >= 600, 'everything retained internally');
  assert.ok(t.milestoneIds.length >= 3 && t.milestoneIds.length <= 10, `milestones ${t.milestoneIds.length}`);
  const ms = t.milestoneIds.map((id) => t.timeline.find((e) => e.id === id));
  assert.ok(ms.some((e) => e.decision?.outcome === 'REFUSED'), 'an old refusal is never suppressed');
  assert.ok(ms.some((e) => e.decision?.outcome === 'DEADLINE_EXTENDED'));
  assert.ok(!ms.some((e) => e.decision?.outcome === 'INFORMATIONAL'), 'routine correspondence never shown');
  assert.equal(t.officialStatus.state, 'PERMITTED');
  assert.equal(t.officialStatus.validUntil, '2027-12-31');
  const view = officialHistoryView(t);
  assert.deepEqual(
    [view.funnel.discoveredDocuments, view.funnel.discoveredAttachments, view.funnel.deferredAttachments, view.funnel.milestones],
    [300, 2400, 1500, t.milestoneIds.length],
  );
  assert.equal(view.funnel.incomplete, true);
  // The digest stays bounded however long the history is.
  const d = tasDigest(t, () => null, 9000);
  assert.ok(d.text.length < 20000, `digest ${d.text.length}`);
  assert.ok(d.archivedEvents > 400);
});

test('customer view carries case/decision numbers and dates — never internal ids, hashes or private names', () => {
  const r = report([kase('100', '2019-01-10', 'ნებართვა', [mot('1', '2019-03-01', 'ნებართვა', dec('PERMIT_ISSUED', '111'))], { parties: [{ role: 'APPLICANT', name: 'გიორგი ბერიძე', kind: 'PERSON' }] })]);
  r.officialVisuals = [{ id: SHA('a'), role: 'LATEST_RENDER', kind: 'RENDER', date: '2019-01-10', documentId: '100', attachedFileId: '777' }];
  const view = officialHistoryView(buildTasIntelligence(r, NOW));
  const s = JSON.stringify({ ...view, visuals: undefined });
  assert.ok(s.includes('AR1100') && s.includes('111'));
  assert.ok(!s.includes('"100"') && !s.includes('777') && !s.includes('გიორგი'));
});

test('prompt-safe official payload: TAS raw text replaced by the digest; other sources untouched', () => {
  const big = 'x'.repeat(50000);
  const bo = { results: [
    { source: 'TAS_MAP', status: 'SEARCH_CONFIRMED', documents: [{ rawText: 'map' }] },
    { source: 'tas', status: 'SEARCH_CONFIRMED', documents: [{ rawText: big }], tasApi: { cases: [kase('100', '2019-01-10', 'ნებართვა', [mot('1', '2019-03-01', 'ნებართვა', dec('PERMIT_ISSUED', '111'))])], accounting: {}, ledger: {} } },
  ] };
  const out = promptSafeBrowserOfficial(bo, NOW);
  const json = JSON.stringify(out.payload);
  assert.ok(!json.includes(big));
  assert.ok(json.includes('"map"'));
  assert.match(out.tasDigest, /CURRENT OFFICIAL STATUS .*PERMITTED/);
  // LEGACY results (no tasApi) pass through unchanged.
  const legacy = { results: [{ source: 'tas', documents: [{ rawText: 'legacy' }] }] };
  assert.deepEqual(promptSafeBrowserOfficial(legacy, NOW), { payload: legacy, tasDigest: null });
});

// tasPriority.test.mjs — TAS "two newest cases" FULL-FIDELITY rule:
// newest-two selection (Georgian/European dates, ties, parcel match), the
// AR11161121-like case (22 mixed attachments, nothing silently lost), full
// text retention, completeness gate, application-form capture (synthetic —
// NOT live-verified), bounded non-fatal discovery, deferral + continuation,
// result shaping (inline text + refs) and privacy masking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDwrReply } from '../.tstest-build/workflows/tas/api/dwr.js';
import { parseTasDateMs, toIsoDate, normalizeCaseDetail, extractLabelValuePairs } from '../.tstest-build/workflows/tas/api/tasModel.js';
import { selectPriorityCases, compareRegistrationDesc, parseDwrInterface, pickFormMethod, findInterfaceScripts, buildCompleteness } from '../.tstest-build/workflows/tas/api/priority.js';
import { redactPersonalData, containsPersonalData, sanitizeGraph } from '../.tstest-build/workflows/tas/api/privacy.js';
import { acquireTasApi, toLegacyTasResult, __resetTasApiCaches, tasEvidenceObjects, PRIORITY_INLINE_TEXT_MAX } from '../.tstest-build/workflows/tas/api/TasApiWorkflow.js';
import { compactResult, DOC_EXCERPT_CHARS } from '../.tstest-build/queue/evidence.js';
import { FLAT, PARCEL, NEWEST, SECOND, OLDER, OTHER_PARCEL, SHARED_FILE, IDS_1161121, FILES, priorityFetcher, priorityPdfParser, fakeRenderer } from './fixtures/tas/priorityFixture.mjs';

const OPTS = { parsePdf: priorityPdfParser, minGapMs: 0, concurrency: 3, budgetMs: 120_000 };
const day = (s) => new Date(parseTasDateMs(s)).toISOString();

test('dates: ISO, dd/mm/yyyy, dd.mm.yyyy with times, Georgian month names — deterministic UTC', () => {
  assert.equal(day('17.09.2026'), '2026-09-17T00:00:00.000Z');
  assert.equal(day('17/09/2026 11:05'), '2026-09-17T11:05:00.000Z');
  assert.equal(day('17-09-2026 11:05:42'), '2026-09-17T11:05:42.000Z');
  assert.equal(day('2026-09-17T11:05:00'), '2026-09-17T11:05:00.000Z', 'zone-less ISO is UTC, never local');
  assert.equal(day('2026-09-17T11:05:00+04:00'), '2026-09-17T07:05:00.000Z');
  assert.equal(day('2026.09.17'), '2026-09-17T00:00:00.000Z');
  assert.equal(day('17 სექტემბერი 2026'), '2026-09-17T00:00:00.000Z');
  assert.equal(day('17 სექტემბრის 2026 წ. 14:30'), '2026-09-17T14:30:00.000Z');
  assert.equal(day('1 თებერვალი 2025'), '2025-02-01T00:00:00.000Z');
  assert.equal(parseTasDateMs('31/02/2026'), null, '31 February never rolls into March');
  assert.equal(parseTasDateMs('12.13.2026'), null);
  assert.equal(parseTasDateMs('17 foo 2026'), null);
  assert.equal(toIsoDate(new Date(Date.UTC(2026, 8, 17))), '2026-09-17T00:00:00.000Z');
});

test('newest-two selection: application date, not list order; stable tie-break; other parcels never qualify', () => {
  const picks = selectPriorityCases([
    { documentId: '900', registrationNumber: 'AR1900', date: '01/01/2020', cadastralCodes: [] },
    { documentId: '1148112', registrationNumber: 'AR11148112', date: '17/06/2026', cadastralCodes: [PARCEL] },
    { documentId: '1199999', registrationNumber: 'AR11199999', date: '01.10.2026', cadastralCodes: ['01.18.06.019.099'] },
    { documentId: '1161121', registrationNumber: 'AR11161121', date: '17.09.2026 11:05', cadastralCodes: [`${PARCEL}.03.01.503`] },
    { documentId: '5', registrationNumber: null, date: null, cadastralCodes: [] },
  ], PARCEL);
  assert.deepEqual(picks.map((p) => [p.priority, p.documentId]), [[1, '1161121'], [2, '1148112']]);
  assert.equal(picks[0].parcelMatch, true);

  // Same date: registration number desc (numeric-aware), then documentId desc.
  const tie = selectPriorityCases([
    { documentId: '10', registrationNumber: 'AR1965637', date: '2023-03-01', cadastralCodes: [] },
    { documentId: '11', registrationNumber: 'AR11161121', date: '01.03.2023', cadastralCodes: [] },
    { documentId: '12', registrationNumber: 'AR11161121', date: '01/03/2023 00:00', cadastralCodes: [] },
  ], PARCEL);
  assert.deepEqual(tie.map((p) => p.documentId), ['12', '11']);
  assert.ok(compareRegistrationDesc('AR11161121', 'AR1965637') < 0);
  // Input order never matters.
  const shuffled = selectPriorityCases([
    { documentId: '12', registrationNumber: 'AR11161121', date: '01/03/2023', cadastralCodes: [] },
    { documentId: '10', registrationNumber: 'AR1965637', date: '2023-03-01', cadastralCodes: [] },
    { documentId: '11', registrationNumber: 'AR11161121', date: '01.03.2023', cadastralCodes: [] },
  ], PARCEL);
  assert.deepEqual(shuffled.map((p) => p.documentId), ['12', '11']);
  // Undated cases rank after every dated one.
  assert.deepEqual(selectPriorityCases([
    { documentId: '1', registrationNumber: null, date: null, cadastralCodes: [] },
    { documentId: '2', registrationNumber: null, date: '01.01.2001', cadastralCodes: [] },
  ], PARCEL).map((p) => p.documentId), ['2', '1']);
});

test('form label/value extraction from a synthetic detail graph: every pair, with paths; sensitive pairs counted, never kept', () => {
  const reply = parseDwrReply([
    'var s0={};s0.documentNo="AR1";s0.docName="ნებართვა";s0.docStatusName="განხილვის პროცესში";',
    'var a={};a.firstName="ნინო";a.lastName="კაპანაძე";a.personalNumber="01024012345";a.mobile="599123456";s0.docAuthor=a;',
    'var v=[];var v1={};v1.name="სართულიანობა";v1.value="14";v[0]=v1;var v2={};v2.label="ელ. ფოსტა";v2.value="x@y.ge";v[1]=v2;s0.docValues=v;',
    'var k={};k.kZ1="0.5";s0.docClassCalculatorValues=k;',
    'var m={};var g={};g.caption="მიწის ფართობი";g.displayValue="2450";var gs=[];gs[0]=g;m.groups=gs;s0.archDocMeta=m;',
    'var deep={};var d1={};d1.key="tech.height";d1.text="45.2 მ";deep.list=[d1];s0.whatever=deep;',
    'dwr.engine.remote.handleCallback("1","0",{isSuccess:true,source:s0});',
  ].join('\n'));
  const d = normalizeCaseDetail('1', reply.data);
  assert.equal(d.title, 'ნებართვა', 'the case object inside the {isSuccess, source} envelope is the root');
  assert.equal(d.status, 'განხილვის პროცესში');
  assert.equal(d.registrationNumber, 'AR1');
  const byLabel = Object.fromEntries(d.values.map((v) => [v.label, v]));
  assert.equal(byLabel['სართულიანობა'].value, '14');
  assert.equal(byLabel['სართულიანობა'].path, '$.source.docValues[0]');
  assert.equal(byLabel['kZ1'].value, '0.5');
  assert.equal(byLabel['firstName'].value, 'ნინო');
  assert.equal(byLabel['მიწის ფართობი'].value, '2450');
  assert.equal(byLabel['tech.height'].value, '45.2 მ');
  assert.ok(d.values.every((v) => typeof v.path === 'string' && v.path.startsWith('$')));
  const json = JSON.stringify(d);
  assert.ok(!json.includes('01024012345') && !json.includes('599123456') && !json.includes('x@y.ge'), 'personal id / phone / e-mail never kept');
  assert.ok(d.valuesDiscovered > d.values.length, 'discovered counts what privacy dropped');
  assert.deepEqual(Object.keys(d.unmapped), ['isSuccess']);
  const pairs = extractLabelValuePairs(reply.data, 'form');
  assert.equal(pairs.values.length, d.values.length);
});

test('privacy: personal numbers masked, phones and e-mails removed; names, org codes, cadastral codes and dates kept', () => {
  const t = 'მესაკუთრე ლევან ნოზაძე, პ/ნ 01024099999, ტელ: +995 599 12 34 56, ტელ 599123456, levan@example.ge, შპს 405123456, 01.18.06.019.055, 17.09.2026, ბრძანება N 4512345, (032) 2 12 34 56';
  const r = redactPersonalData(t);
  assert.ok(!/01024099999|599 12 34 56|599123456|levan@example\.ge/.test(r), r);
  assert.ok(r.includes('•••999') && r.includes('ლევან ნოზაძე') && r.includes('405123456') && r.includes('01.18.06.019.055') && r.includes('17.09.2026') && r.includes('4512345'));
  assert.equal(containsPersonalData(r), false);
  const g = sanitizeGraph({ docAuthor: { firstName: 'ნინო', personalNumber: '01024012345', email: 'a@b.ge', phone: '555123456' }, note: 'call +995 555 11 22 33' });
  assert.deepEqual(g.docAuthor, { firstName: 'ნინო', personalNumber: '•••345' });
  assert.ok(!JSON.stringify(g).includes('555 11 22 33'));
});

test('DWR interface discovery (pure): same-origin interface scripts only; read-only form method chosen by name', () => {
  const html = '<script src="dwr/interface/UserMethods.js"></script><script src="/architect/dwr/interface/PublicDocManager.js"></script><script src="https://evil.example/architect/dwr/interface/X.js"></script><script src="/architect/dwr/engine.js"></script>';
  const scripts = findInterfaceScripts(html, 'https://docs.tbilisi.gov.ge/architect/public.html?docId=1');
  assert.deepEqual(scripts, ['https://docs.tbilisi.gov.ge/architect/dwr/interface/UserMethods.js', 'https://docs.tbilisi.gov.ge/architect/dwr/interface/PublicDocManager.js']);
  const m3 = parseDwrInterface("p.saveDocValues = function(p0, callback) { return dwr.engine._execute(p._path, 'Doc', 'saveDocValues', arguments); };\np.getDocValuesById = function(p0, callback) { return dwr.engine._execute(p._path, 'Doc', 'getDocValuesById', arguments); };\np.getDocumentList = function(p0, callback) { return dwr.engine._execute(p._path, 'Doc', 'getDocumentList', arguments); };\np.getPublicDocument = function(p0, p1, callback) { return dwr.engine._execute(p._path, 'Doc', 'getPublicDocument', arguments); };");
  assert.deepEqual(m3.map((m) => `${m.method}/${m.arity}`), ['saveDocValues/1', 'getDocValuesById/1', 'getDocumentList/1', 'getPublicDocument/2']);
  assert.equal(pickFormMethod(m3).method, 'getDocValuesById', 'writes, lists and two-argument methods are never called');
  const m2 = parseDwrInterface("UserMethods.getUserDocumentLastMotion = function(p0, callback) { dwr.engine._execute(UserMethods._path, 'UserMethods', 'getUserDocumentLastMotion', p0, callback); }\nUserMethods.getPublicForm = function(p0, callback) { dwr.engine._execute(UserMethods._path, 'UserMethods', 'getPublicForm', p0, callback); }", 'UserMethods');
  assert.equal(pickFormMethod(m2).method, 'getPublicForm');
  assert.equal(pickFormMethod(m2.filter((m) => m.method !== 'getPublicForm')), null, 'the detail call is never re-chosen');
});

test('form discovery never picks the operator interface or field metadata (live run 2026-10-11: Administration.getDocFieldMimeTypes)', () => {
  const admin = parseDwrInterface("Administration.getDocFieldMimeTypes = function(p0, callback) { dwr.engine._execute(Administration._path, 'Administration', 'getDocFieldMimeTypes', p0, callback); }\nAdministration.getDocumentValues = function(p0, callback) { dwr.engine._execute(Administration._path, 'Administration', 'getDocumentValues', p0, callback); }", 'Administration');
  assert.equal(pickFormMethod(admin), null);
  const user = parseDwrInterface("ArchCommons.getDocFieldTypes = function(p0, callback) { dwr.engine._execute(ArchCommons._path, 'ArchCommons', 'getDocFieldTypes', p0, callback); }\nArchCommons.getDocumentFormValues = function(p0, callback) { dwr.engine._execute(ArchCommons._path, 'ArchCommons', 'getDocumentFormValues', p0, callback); }", 'ArchCommons');
  assert.equal(pickFormMethod([...admin, ...user]).method, 'getDocumentFormValues');
});

test('AR11161121-like case: 22 mixed attachments all accounted, full text, visuals classified, form captured, COMPLETE', async () => {
  __resetTasApiCaches();
  const { fetcher, calls } = priorityFetcher();
  const render = fakeRenderer();
  const r = await acquireTasApi(FLAT, { ...OPTS, fetcher, renderPdfPages: render.factory });
  assert.equal(r.error, null);
  assert.equal(r.searchCadastralCode, PARCEL);
  // Priority: by application date, parcel-matched; the newer other-parcel case never qualifies.
  assert.deepEqual(r.priority.map((p) => [p.priority, p.documentId]), [[1, NEWEST], [2, SECOND]]);
  assert.equal(r.priority[0].date, '2026-09-17T11:05:00.000Z');
  const newest = r.cases.find((c) => c.detail.documentId === NEWEST);
  const second = r.cases.find((c) => c.detail.documentId === SECOND);
  assert.equal(newest.priority, 1);
  assert.equal(second.priority, 2);
  assert.equal(r.cases.find((c) => c.detail.documentId === OTHER_PARCEL).priority, null);
  // The case form: title/status from the wrapped root, values with paths.
  assert.equal(newest.detail.status, 'განხილვის პროცესში');
  assert.ok(newest.detail.title);
  assert.ok(newest.detail.values.some((v) => v.label === 'პროექტის არქიტექტორი' && v.value === 'გიორგი ბერიძე' && v.path));
  assert.ok(newest.detail.values.some((v) => v.label === 'K-1' && v.value === '0.6'));

  // ── every one of the 22 attachments has an honest outcome; none budget-cut ──
  assert.equal(newest.attachments.length, 22);
  const allowed = new Set(['READ_TEXT', 'LOW_TEXT', 'SCAN_OR_IMAGE_ONLY', 'IMAGE', 'UNSUPPORTED_FORMAT']);
  for (const a of newest.attachments) assert.ok(allowed.has(a.outcome), `${a.fileName}: ${a.outcome}`);
  assert.equal(r.cases.filter((c) => c.priority).flatMap((c) => c.attachments).filter((a) => a.outcome === 'NOT_PROCESSED_BUDGET' || a.outcome === 'DEFERRED').length, 0);
  const by = Object.fromEntries(newest.attachments.map((a) => [a.fileName, a]));
  for (const n of ['project.dwg', 'project.pla', 'archive.rar']) {
    const a = by[n];
    assert.equal(a.outcome, 'UNSUPPORTED_FORMAT');
    assert.equal(a.format, n.split('.').pop());
    assert.match(a.url, /DownloadServlet\?downloadCase=2&attachedFileId=\d+$/);
    assert.ok(a.sizeBytes > 0);
    assert.equal(a.textChars, 0, 'never pretends content was read');
  }
  assert.equal(calls.filter((c) => c.path === '/DownloadServlet' && /attachedFileId=(9100019|9100020|9100021)$/.test(c.search)).length, 0, 'DWG/PLA/RAR are never downloaded');
  for (const n of ['1.jpg', '2.jpg', '3.jpg']) {
    assert.equal(by[n].outcome, 'IMAGE');
    assert.ok(by[n].visual && by[n].visual.assets === 1);
    assert.notEqual(by[n].visual.kind, 'PHOTO', 'an unlabelled image is never guessed a photograph');
  }
  // Photos PDF: embedded images extracted and classified as photos; scanned pages covered by them.
  assert.ok(['PHOTO', 'CONSTRUCTION_PHOTO'].includes(by['ფოტოები.pdf'].visual.kind), 'named photos stay photos (construction context allowed)');
  assert.equal(by['ფოტოები.pdf'].visual.assets, 3);
  assert.deepEqual(by['ფოტოები.pdf'].scanPages, [1, 2, 3]);
  assert.equal(by['ფოტოები.pdf'].scanPagesUnrendered, 0);
  // Drawings: rendered pages, classified by kind.
  assert.equal(by['ფასადები.pdf'].visual.category, 'ARCHITECTURE');
  assert.ok(by['ფასადები.pdf'].pagesRendered >= 1);
  assert.ok(['SECTION'].includes(by['ჭრილები.pdf'].visual.kind));
  assert.ok(['FLOOR_PLAN', 'UNIT_PLAN'].includes(by['გეგმები 16,09,2026.pdf'].visual.kind));
  assert.equal(by['გენგეგმა.pdf'].visual.kind, 'SITE_PLAN');
  // Scanned expert review: its exact pages rendered (no text layer to read).
  assert.deepEqual(by['გეოლ ექსპერტიზა.pdf'].scanPages, [1, 2, 3]);
  assert.equal(by['გეოლ ექსპერტიზა.pdf'].pagesRendered, 3);
  assert.ok(render.state.calls.some((c) => c.id === IDS_1161121[15] && c.pages.join() === '1,2,3'));
  // Paperwork never becomes a visual.
  assert.equal(by['განმარტებითი ბარათი.pdf'].visual, null);
  assert.equal(by['განმარტებითი ბარათი.pdf'].outcome, 'READ_TEXT');
  // Priority visuals: every asset from the newest cases, provenance + rank.
  assert.ok(r.priorityVisuals.length >= 10);
  assert.ok(r.priorityVisuals.every((v) => v.priority === 1 || v.priority === 2));
  assert.ok(r.visuals.length <= 24 && r.visuals.some((v) => v.priority), 'gallery offers the newest cases first');
  assert.equal(render.state.closed, 1);

  // ── text: complete, never sliced ──
  assert.equal(newest.textTruncated, false);
  assert.equal(second.textTruncated, false);
  for (const id of [IDS_1161121[16], IDS_1161121[12]]) for (const p of FILES.get(id).pages) assert.ok(newest.text.includes(p.slice(-200).replace(/[\s]+$/, '')), 'every page text present');
  assert.ok(newest.text.length > 200_000, `full text kept (${newest.text.length})`);
  assert.equal(newest.text, newest.fullText);
  // Older case: bounded, but its decision survives first.
  const older = r.cases.find((c) => c.detail.documentId === OLDER);
  assert.equal(older.textTruncated, true);
  assert.ok(older.text.length <= 8000 && /DECISION PERMIT_ISSUED/.test(older.text), 'decisions survive the older-case budget');

  // ── form capture (synthetic contract): CAPTURED, bounded ──
  assert.equal(newest.form.status, 'CAPTURED');
  assert.equal(newest.form.method, 'PublicDocManager.getPublicDocumentValues');
  assert.ok(newest.form.fields.some((f) => f.label === 'მიწის ნაკვეთის ფართობი' && f.value === '2450 მ²'));
  assert.ok(newest.form.fields.some((f) => f.label === 'განაცხადის სტატუსი' && f.value === 'განხილვის პროცესში'));
  assert.ok(!newest.form.fields.some((f) => /example\.ge/.test(f.value)), 'form e-mail never kept');
  assert.match(newest.form.rawSha256, /^[a-f0-9]{64}$/);
  assert.ok(r.formDiscovery.requests <= 3 * r.priority.length);
  assert.ok(r.formDiscovery.methods.includes('PublicDocManager.getPublicDocumentValues/1'));
  assert.ok(!calls.some((c) => c.path.includes('saveDocument')), 'write methods are never called');
  assert.equal(r.formDiscovery.verified, false);

  // ── completeness gate ──
  const cp = newest.completeness;
  assert.equal(cp.attachmentsDiscovered, 22);
  assert.equal(cp.attachmentsRead, 19);
  assert.equal(cp.attachmentsUnsupported, 3);
  assert.equal(cp.attachmentsDeferred, 0);
  assert.ok(cp.imagesProcessed >= 10);
  assert.ok(cp.pagesRendered >= 6);
  assert.ok(cp.fieldsDiscovered > cp.fieldsPersisted && cp.fieldsPersisted >= 8);
  assert.equal(cp.textComplete, true);
  assert.deepEqual(cp.reasons, []);
  assert.ok(cp.notes.includes('UNSUPPORTED_FORMATS_ACCOUNTED:3'));
  assert.equal(r.priorityCoverage, 'COMPLETE', r.priorityCoverageReasons.join());

  // ── dedupe: a file cited by both priority cases is downloaded once ──
  assert.equal(calls.filter((c) => c.path === '/DownloadServlet' && c.search.endsWith(`=${SHARED_FILE}`)).length, 1);
  assert.equal(second.attachments.find((a) => a.attachedFileId === SHARED_FILE).duplicateOf, NEWEST);
  // No attachment downloaded twice within a run.
  const dl = calls.filter((c) => c.path === '/DownloadServlet').map((c) => c.search);
  assert.equal(new Set(dl).size, dl.length);

  // ── timings ──
  const t = r.timings;
  for (const k of ['searchMs', 'detailMs', 'priorityCasesMs', 'attachmentDownloadsMs', 'pdfTextMs', 'pageRenderMs', 'visualClassifyMs', 'olderCasesMs', 'formDiscoveryMs', 'totalMs']) assert.equal(typeof t[k], 'number', k);
  assert.ok(Date.parse(t.startedAt) <= Date.parse(t.finishedAt));
  assert.equal(t.counts.priorityCases, 2);
  assert.equal(t.counts.priorityAttachments, 27);
  assert.ok(t.counts.pagesRendered >= 6 && t.counts.downloads > 0 && t.counts.pdfsParsed > 0);
});

test('privacy: nothing customer-bound carries a personal number, phone or e-mail', async () => {
  __resetTasApiCaches();
  const { fetcher } = priorityFetcher();
  const r = await acquireTasApi(FLAT, { ...OPTS, fetcher, renderPdfPages: fakeRenderer().factory });
  const legacy = toLegacyTasResult(r, { includeFullText: true });
  const json = JSON.stringify(legacy);
  for (const s of ['01024012345', '01024099999', '599 12 34 56', '555 12 34 56', '599123456', 'nino@example.ge', 'levan@example.ge', 'owner@example.ge']) assert.ok(!json.includes(s), s);
  assert.ok(json.includes('ლევან ნოზაძე'), 'names are kept');
  const author = legacy.tasApi.cases.find((c) => c.documentId === NEWEST).parties.find((p) => p.role === 'APPLICANT');
  assert.equal(author.personalIdMasked, '•••345');
  // Raw replies are sanitized before they become evidence.
  const ev = tasEvidenceObjects(r);
  assert.ok(ev.some((e) => e.kind === 'detail' && e.documentId === NEWEST) && ev.some((e) => e.kind === 'form'));
  for (const e of ev) assert.ok(!/01024012345|nino@example\.ge|555 12 34 56|owner@example\.ge/.test(e.json), e.kind);
});

test('result shaping: priority text inline in full + content-addressed ref; older cases stay bounded; tasApi carries the gate', async () => {
  __resetTasApiCaches();
  const { fetcher } = priorityFetcher();
  const r = await acquireTasApi(FLAT, { ...OPTS, fetcher, renderPdfPages: fakeRenderer().factory });
  const legacy = toLegacyTasResult(r, { includeFullText: true });
  const uploads = [];
  const c = await compactResult(legacy, async (sha, ct, body) => { uploads.push({ sha, ct, chars: body.length }); return `sha256/${sha}`; });
  const p1 = c.result.documents.find((d) => d.tasDocumentId === NEWEST);
  const p2 = c.result.documents.find((d) => d.tasDocumentId === SECOND);
  for (const d of [p1, p2]) {
    assert.ok(d.priority);
    assert.equal(d.textComplete, true);
    assert.equal(d.textTruncated, false);
    assert.equal(d.rawText.length, d.fullTextRef.chars, 'complete text inline');
    assert.equal(d.textSha256, d.fullTextRef.sha256);
    assert.deepEqual(d.textRef, d.fullTextRef);
    assert.ok(uploads.some((u) => u.sha === d.textSha256 && u.ct === 'text/plain'));
  }
  assert.ok(p1.rawText.length + p2.rawText.length <= PRIORITY_INLINE_TEXT_MAX);
  const older = c.result.documents.find((d) => d.tasDocumentId === OLDER);
  assert.ok(older.rawText.length <= DOC_EXCERPT_CHARS);
  assert.ok(JSON.stringify(c.result).length <= 1_500_000, 'within the queue result bound');
  const tc = c.result.tasApi.cases.find((x) => x.documentId === NEWEST);
  assert.equal(tc.priority, 1);
  assert.equal(tc.completeness.textComplete, true);
  assert.equal(tc.form.status, 'CAPTURED');
  assert.match(tc.rawDetailSha256, /^[a-f0-9]{64}$/);
  assert.ok(!('raw' in tc.form) && !('rawDetail' in tc));
  assert.equal(c.result.tasApi.priorityCoverage, 'COMPLETE');
  assert.ok(c.result.tasApi.timings && c.result.tasApi.priority.length === 2);
});

test('inline cap: priority text beyond PRIORITY_INLINE_TEXT_MAX travels by ref, flagged textComplete:false — never silently', async () => {
  __resetTasApiCaches();
  const { fetcher } = priorityFetcher();
  const r = await acquireTasApi(FLAT, { ...OPTS, fetcher, renderPdfPages: fakeRenderer().factory });
  // Make the second case's text exceed what is left of the inline cap.
  const second = r.cases.find((c) => c.detail.documentId === SECOND);
  second.text = second.fullText = second.text + 'x'.repeat(PRIORITY_INLINE_TEXT_MAX);
  const legacy = toLegacyTasResult(r, { includeFullText: true });
  const c = await compactResult(legacy, async (sha) => `sha256/${sha}`);
  const d = c.result.documents.find((x) => x.tasDocumentId === SECOND);
  assert.equal(d.textComplete, false);
  assert.equal(d.textTruncated, true);
  assert.equal(d.fullTextRef.chars, second.fullText.length, 'the complete text is stored');
  const all = c.result.documents.filter((x) => x.priority).reduce((n, x) => n + x.rawText.length, 0);
  assert.ok(all <= PRIORITY_INLINE_TEXT_MAX);
});

test('form discovery is bounded and never fatal: no scripts, network failure, discovery off', async () => {
  for (const [mode, status] of [['none', 'NOT_AVAILABLE'], ['throw', 'FAILED']]) {
    __resetTasApiCaches();
    const { fetcher, calls } = priorityFetcher({ form: mode });
    const r = await acquireTasApi(FLAT, { ...OPTS, fetcher, renderPdfPages: fakeRenderer().factory });
    assert.equal(r.error, null, mode);
    const newest = r.cases.find((c) => c.detail.documentId === NEWEST);
    assert.equal(newest.form.status, status, mode);
    assert.ok(newest.form.reason);
    assert.ok(calls.filter((c) => c.path === '/architect/public.html').length <= 1, 'the page is read once per run');
    assert.ok(r.formDiscovery.requests <= 3 * r.priority.length);
    assert.ok(newest.attachments.length === 22 && newest.completeness.attachmentsRead === 19, 'capture failure never touches the rest');
    if (status === 'FAILED') {
      assert.ok(newest.completeness.reasons.includes('FORM_CAPTURE_FAILED'));
      assert.equal(r.priorityCoverage, 'PARTIAL');
    } else {
      assert.ok(newest.completeness.notes.includes('FORM_NOT_AVAILABLE'));
      assert.equal(r.priorityCoverage, 'COMPLETE');
    }
  }
  __resetTasApiCaches();
  const { fetcher, calls } = priorityFetcher();
  const r = await acquireTasApi(FLAT, { ...OPTS, fetcher, renderPdfPages: fakeRenderer().factory, formDiscovery: false });
  assert.equal(calls.filter((c) => c.path.startsWith('/architect/') && !c.path.includes('/dwr/call/')).length, 0);
  assert.equal(r.cases.find((c) => c.detail.documentId === NEWEST).form.status, 'DISABLED');
});

test('deferral: a hard bound marks priority files DEFERRED with a reason (PARTIAL), and the next run continues where it stopped', async () => {
  __resetTasApiCaches();
  const a = priorityFetcher();
  // 20 bytes: every PDF/JPEG is "too large" — a bound, not a budget.
  const r1 = await acquireTasApi(FLAT, { ...OPTS, fetcher: a.fetcher, renderPdfPages: fakeRenderer().factory, priorityMaxBytes: 40 });
  const n1 = r1.cases.find((c) => c.detail.documentId === NEWEST);
  const deferred = n1.attachments.filter((x) => x.outcome === 'DEFERRED');
  assert.ok(deferred.length >= 1);
  for (const d of deferred) {
    assert.match(d.deferredReason, /^PAYLOAD_TOO_LARGE:\d+$/);
    assert.match(d.url, /DownloadServlet/);
  }
  assert.equal(n1.completeness.attachmentsDeferred, deferred.length);
  assert.deepEqual(n1.completeness.deferredAttachmentIds, deferred.map((d) => d.attachedFileId).sort((x, y) => x.length - y.length || x.localeCompare(y)));
  assert.equal(n1.completeness.textComplete, false);
  assert.ok(n1.completeness.reasons.some((x) => x.startsWith('ATTACHMENTS_DEFERRED:')));
  assert.equal(r1.priorityCoverage, 'PARTIAL');
  assert.ok(r1.priorityCoverageReasons.some((x) => x.startsWith('P1:ATTACHMENTS_DEFERRED')));
  assert.ok(r1.ledger.incompleteReasons.includes('PRIORITY_ATTACHMENTS_DEFERRED'));
  const legacy = toLegacyTasResult(r1);
  assert.equal(legacy.tasApi.priorityCoverage, 'PARTIAL');

  // Follow-up run: finished files come from the per-file cache; only the deferred ones are fetched.
  const done = n1.attachments.filter((x) => x.outcome !== 'DEFERRED' && x.outcome !== 'UNSUPPORTED_FORMAT').map((x) => x.attachedFileId);
  const b = priorityFetcher();
  const r2 = await acquireTasApi(FLAT, { ...OPTS, fetcher: b.fetcher, renderPdfPages: fakeRenderer().factory });
  const n2 = r2.cases.find((c) => c.detail.documentId === NEWEST);
  assert.equal(n2.attachments.filter((x) => x.outcome === 'DEFERRED').length, 0);
  assert.equal(n2.completeness.textComplete, true);
  assert.equal(r2.priorityCoverage, 'COMPLETE', r2.priorityCoverageReasons.join());
  const refetched = b.calls.filter((c) => c.path === '/DownloadServlet').map((c) => c.search.split('=').pop());
  for (const id of done) assert.ok(!refetched.includes(id), `finished file ${id} re-downloaded`);
});

test('run deadline: priority files not started are DEFERRED (RUN_DEADLINE) — never NOT_PROCESSED_BUDGET, never silent', async () => {
  __resetTasApiCaches();
  const { fetcher } = priorityFetcher();
  // The reserve exceeds the whole run: every priority download is deferred up front.
  const r = await acquireTasApi(FLAT, { ...OPTS, fetcher, priorityReserveMs: 10 * 60_000 });
  const pri = r.cases.filter((c) => c.priority).flatMap((c) => c.attachments);
  assert.ok(pri.some((x) => x.outcome === 'DEFERRED' && x.deferredReason === 'RUN_DEADLINE'));
  assert.equal(pri.filter((x) => x.outcome === 'NOT_PROCESSED_BUDGET').length, 0);
  assert.equal(r.priorityCoverage, 'PARTIAL');
});

test('completeness gate: never COMPLETE with anything deferred, failed or unread', () => {
  const base = { detailRead: true, fieldsDiscovered: 3, fieldsPersisted: 2, motions: [{ response: 'PDF' }], formStatus: 'CAPTURED', textInlineComplete: true, renderAvailable: true };
  const ok = buildCompleteness({ ...base, attachments: [{ attachedFileId: '1', outcome: 'READ_TEXT' }, { attachedFileId: '2', outcome: 'UNSUPPORTED_FORMAT' }] });
  assert.equal(ok.textComplete, true);
  assert.deepEqual(ok.reasons, []);
  for (const [patch, reason] of [
    [{ attachments: [{ attachedFileId: '1', outcome: 'DEFERRED' }] }, 'ATTACHMENTS_DEFERRED:1'],
    [{ attachments: [{ attachedFileId: '1', outcome: 'DOWNLOAD_FAILED' }] }, 'ATTACHMENTS_FAILED:1'],
    [{ attachments: [], motions: [{ response: 'NOT_FETCHED' }] }, 'MOTION_RESPONSES_NOT_READ:1'],
    [{ attachments: [{ attachedFileId: '1', outcome: 'SCAN_OR_IMAGE_ONLY', scanPages: [1], scanPagesUnrendered: 1 }] }, 'SCAN_PAGES_NOT_RENDERED:1'],
    [{ attachments: [{ attachedFileId: '1', outcome: 'READ_TEXT', renderFailed: true }] }, 'PAGE_RENDER_FAILED:1'],
    [{ attachments: [], formStatus: 'FAILED' }, 'FORM_CAPTURE_FAILED'],
    [{ attachments: [], detailRead: false }, 'DETAIL_NOT_READ'],
  ]) {
    const c = buildCompleteness({ ...base, ...patch });
    assert.ok(c.reasons.includes(reason), `${reason}: ${c.reasons}`);
  }
});

test('queue executor: priority visuals and sanitized raw detail/form replies are stored as content-addressed evidence', async () => {
  const { createVerifyExecutor } = await import('../.tstest-build/queue/executor.js');
  __resetTasApiCaches();
  const { fetcher } = priorityFetcher();
  const uploads = [];
  const gateway = { async upload(sha, ct, body) { uploads.push({ sha, ct, chars: body.length }); return `sha256/${sha}`; }, async captcha() { return {}; } };
  const exec = createVerifyExecutor({
    orchestrator: {}, launchBrowser: async () => { throw new Error('no browser'); }, closeBrowser: async () => {},
    tas: { probe: async () => ({ code: PARCEL, tried: [] }), acquire: (q, o) => acquireTasApi(q, { ...o, ...OPTS, fetcher, renderPdfPages: fakeRenderer().factory }) },
  });
  const out = await exec({ id: 't1', jobId: 'j1', source: 'tas', lane: 'HTTP', scopeKey: `tas:${PARCEL}`, input: { cadastral: PARCEL, resolved: true }, attempts: 1 }, { signal: new AbortController().signal, gateway, workerId: 'w' });
  assert.equal(out.type, 'complete');
  const json = uploads.filter((u) => u.ct === 'application/json');
  assert.ok(json.length >= 5, 'one sanitized detail reply per case + the form replies');
  assert.ok(out.evidenceRefs.some((r) => r.contentType === 'application/json' && r.documentId === `tas_${NEWEST}`));
  const pv = out.result.tasApi.priorityVisuals;
  assert.ok(pv.length > 0 && pv.every((v) => v.stored === true));
  assert.ok(pv.every((v) => uploads.some((u) => u.sha === v.id)));
  assert.equal(out.result.documents.find((d) => d.tasDocumentId === NEWEST).textComplete, true);
});

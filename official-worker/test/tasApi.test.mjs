// tasApi.test.mjs — TAS API_FIRST: DWR serialisation, full object-graph
// parsing, exhaustive pagination with reconciliation, case detail, the
// document 1161121 attachment regression, motion-response and attachment
// classification, visual selection budget, and implementation fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeDwrCall, parseDwrReply, dwr, walkObjects } from '../.tstest-build/workflows/tas/api/dwr.js';
import { normalizeCaseDetail, parseSearchPage, classifyPayload, classifyPdfText, maskPersonalId, toIsoDate, fileNameFromDisposition, repairGeorgianMojibake } from '../.tstest-build/workflows/tas/api/tasModel.js';
import { searchParams } from '../.tstest-build/workflows/tas/api/TasApiClient.js';
import { acquireTasApi, toLegacyTasResult, __resetTasApiCaches, getCachedVisual } from '../.tstest-build/workflows/tas/api/TasApiWorkflow.js';
import { rankVisualCandidates, selectVisualShortlist, extractImagesFromPdf, imageSize } from '../.tstest-build/workflows/tas/api/visuals.js';
import { parseTasConfig, shouldFallBack, recordTasRun, tasHealth, __resetTasHealth } from '../.tstest-build/workflows/tas/implementation.js';
import { candidateSequence } from '../.tstest-build/workflows/tas/cadastral.js';
import { BASE, FULL, DOC_IDS, buildDetails, fixtureFetcher, fixturePdfParser, fakeJpeg } from './fixtures/tas/tasFixture.mjs';

test('cadastral derivation: full apartment code → TAS base parcel first, derived not hardcoded', () => {
  assert.equal(candidateSequence(FULL)[0], BASE);
  assert.equal(candidateSequence('01.10.14.003.017.02.05.112')[0], '01.10.14.003.017');
  assert.ok(!candidateSequence(FULL).includes(FULL));
});

test('DWR serialisation: criteria object with applicationId, naprCadCode and the status id array', () => {
  const body = serializeDwrCall(
    { scriptName: 'DocumentManager', methodName: 'getDocsForPublicInfo', params: searchParams(BASE, 0, 50) },
    { page: '/architect/publicInformation.html', batchId: 3 },
  );
  assert.match(body, /c0-scriptName=DocumentManager/);
  assert.match(body, /c0-methodName=getDocsForPublicInfo/);
  assert.match(body, /naprCadCode:reference:c0-e\d+/);
  assert.match(body, /=string:01\.18\.06\.019\.055/);
  const arrLine = body.split('\n').find((l) => l.includes('=array:['));
  assert.equal(arrLine.match(/reference:/g).length, 14);
  for (const n of [1, 2, 5, 6, 7, 9, 11, 12, 20, 21, 25, 26, 27, 28]) assert.ok(body.includes(`=number:${n}\n`), `status ${n}`);
  assert.match(body, /batchId=3/);
  // every referenced element is declared
  for (const r of body.match(/reference:(c0-e\d+)/g)) assert.ok(body.includes(`\n${r.slice(10)}=`), r);
});

// The body the public TAS page sends, as recorded in the locally live-verified
// tas-worker contract (TASK.md, "DWR BODY"), for start=0, limit=25.
const VERIFIED_SEARCH_BODY = [
  'callCount=1', 'windowName=', 'c0-scriptName=DocumentManager', 'c0-methodName=getDocsForPublicInfo', 'c0-id=0',
  'c0-e1=string:', 'c0-e2=string:', 'c0-e3=string:', 'c0-e4=string:01.18.06.019.055', 'c0-e5=null:null', 'c0-e6=null:null',
  'c0-e7=null:null', 'c0-e8=null:null', 'c0-e9=string:', 'c0-e10=string:', 'c0-e11=string:', 'c0-e12=string:', 'c0-e13=number:2',
  'c0-e15=number:1', 'c0-e16=number:2', 'c0-e17=number:5', 'c0-e18=number:6', 'c0-e19=number:7', 'c0-e20=number:9', 'c0-e21=number:11',
  'c0-e22=number:12', 'c0-e23=number:20', 'c0-e24=number:21', 'c0-e25=number:25', 'c0-e26=number:26', 'c0-e27=number:27', 'c0-e28=number:28',
  'c0-e14=array:[reference:c0-e15,reference:c0-e16,reference:c0-e17,reference:c0-e18,reference:c0-e19,reference:c0-e20,reference:c0-e21,reference:c0-e22,reference:c0-e23,reference:c0-e24,reference:c0-e25,reference:c0-e26,reference:c0-e27,reference:c0-e28]',
  'c0-e29=number:0', 'c0-e30=number:25',
  'c0-param0=Object_Object:{documentNo:reference:c0-e1,responseMotionId:reference:c0-e2,commissionMotionId:reference:c0-e3,naprCadCode:reference:c0-e4,fromDate:reference:c0-e5,toDate:reference:c0-e6,responseFromDate:reference:c0-e7,responseToDate:reference:c0-e8,authorFirstName:reference:c0-e9,authorLastName:reference:c0-e10,architectName:reference:c0-e11,ext-gen1020:reference:c0-e12,applicationId:reference:c0-e13,docStatusIds:reference:c0-e14,start:reference:c0-e29,limit:reference:c0-e30}',
  'batchId=1', 'page=%2Farchitect%2FpublicInformation.html', 'httpSessionId=', 'scriptSessionId=',
].join('\n') + '\n';

test('DWR search body is IDENTICAL to the live-verified public page body', () => {
  const body = serializeDwrCall(
    { scriptName: 'DocumentManager', methodName: 'getDocsForPublicInfo', params: searchParams(BASE, 0, 25) },
    { page: '/architect/publicInformation.html', batchId: 1 },
  );
  assert.equal(body, VERIFIED_SEARCH_BODY);
});

test('DWR detail body matches the verified form: string document id, per-document page', () => {
  const body = serializeDwrCall(
    { scriptName: 'UserMethods', methodName: 'getUserDocumentLastMotion', params: [dwr.str('639208')] },
    { page: '/architect/public.html?docId=639208', batchId: 1 },
  );
  assert.equal(body, ['callCount=1', 'windowName=', 'c0-scriptName=UserMethods', 'c0-methodName=getUserDocumentLastMotion', 'c0-id=0',
    'c0-param0=string:639208', 'batchId=1', 'page=%2Farchitect%2Fpublic.html%3FdocId%3D639208', 'httpSessionId=', 'scriptSessionId='].join('\n') + '\n');
});

test('search reply in the verified shape: results under `source`, total in `sources[0]`', () => {
  const r = parseDwrReply('dwr.engine.remote.handleNewScriptSession("ABC");\nvar s0={};var s1=[];var s2={};s2.documentId=639208;s2.documentNo="AR1639208";s1[0]=s2;s0.isSuccess=true;s0.source=s1;s0.sources=[19];\ndwr.engine.remote.handleCallback("0","0",s0);');
  const page = parseSearchPage(r.data);
  assert.equal(page.total, 19);
  assert.equal(page.rows[0].documentId, '639208');
  assert.equal(page.rows[0].registrationNumber, 'AR1639208');
});

test('DWR graph parser: vars, assignments, shared references, Dates, escapes, guards', () => {
  const reply = [
    "throw 'allowScriptTagRemoting is false.';",
    '//#DWR-REPLY',
    'var s0={};var s1=[];var s2={a:"x;y=z \\u10D0",b:\'q\\\'t\'};',
    's0.list=s1;s1[0]=s2;s1[1]=s2;s0.when=new Date(1700000000000);s0.n=-1.5e2;s0.nil=null;',
    "dwr.engine._remoteHandleCallback('1','0',s0);",
  ].join('\n');
  const r = parseDwrReply(reply);
  assert.ok(r.ok);
  assert.equal(r.data.list.length, 2);
  assert.equal(r.data.list[0], r.data.list[1], 'shared reference preserved');
  assert.equal(r.data.list[0].a, 'x;y=z ა');
  assert.equal(r.data.list[0].b, "q't");
  assert.equal(r.data.n, -150);
  assert.equal(r.data.when.toISOString(), new Date(1700000000000).toISOString());
  let objects = 0;
  walkObjects(r.data, () => objects++);
  assert.equal(objects, 2, 'shared object visited once');
});

test('DWR graph parser: server exceptions are surfaced, never treated as data', () => {
  const r = parseDwrReply("dwr.engine._remoteHandleException('1','0',{javaClassName:'java.lang.SecurityException',message:'denied'});");
  assert.equal(r.ok, false);
  assert.equal(r.exception.javaClassName, 'java.lang.SecurityException');
  assert.throws(() => parseDwrReply('<html>gateway error</html>'));
});

test('DWR graph parser: prototype keys in untrusted replies are ignored', () => {
  const r = parseDwrReply("var s0={};s0.__proto__={polluted:1};var s1={'__proto__':{x:1}};dwr.engine._remoteHandleCallback('1','0',s0);");
  assert.equal(({}).polluted, undefined);
  assert.equal(r.data.polluted, undefined);
});

test('search page parsing: rows, ids, dates and the server total', () => {
  const r = parseDwrReply("var s0=[];var s1={};s1.docId=639208;s1.regNumber='AR1';s1.regDate=new Date(1420070400000);s0[0]=s1;dwr.engine._remoteHandleCallback('1','0',{data:s0,totalCount:19});");
  const page = parseSearchPage(r.data);
  assert.equal(page.total, 19);
  assert.equal(page.rows[0].documentId, '639208');
  assert.equal(page.rows[0].date, '2015-01-01T00:00:00.000Z');
});

test('document 1161121 regression: all 22 attachment objects survive, including case-level ones with motionId null', () => {
  const { details } = buildDetails();
  const reply = parseDwrReply(details.get('1161121'));
  const d = normalizeCaseDetail('1161121', reply.data, reply.objectCount);
  assert.equal(d.attachments.length, 22);
  assert.equal(d.attachments.filter((a) => a.motionId === null).length, 5);
  assert.equal(new Set(d.attachments.map((a) => a.attachedFileId)).size, 22, 'deduplicated by id, shared reference counted once');
  // The id assigned in a separate later statement is still found.
  assert.ok(d.attachments.some((a) => a.fileName === 'ფასადი; ხედი=1.pdf'));
  // A narrow regex over the reply text cannot see what the graph sees.
  const regexHits = new Set([...details.get('1161121').matchAll(/attachedFileId:(\d+),[^}]*motionId:(\d+)/g)].map((m) => m[1]));
  assert.ok(regexHits.size < 22, `regex found ${regexHits.size}`);
});

test('case detail: parties, values, archDocType, unmapped fields preserved, personal numbers never retained', () => {
  const { details } = buildDetails();
  const reply = parseDwrReply(details.get('639208'));
  const d = normalizeCaseDetail('639208', reply.data);
  const author = d.parties.find((p) => p.role === 'APPLICANT');
  assert.equal(author.name, 'გიორგი ბერიძე');
  assert.equal(author.kind, 'PERSON');
  assert.equal(author.personalIdMasked, '•••345');
  assert.ok(!JSON.stringify(d).includes('01024012345'));
  const org = d.parties.find((p) => p.kind === 'ORGANIZATION');
  assert.equal(org.organizationId, '405123456');
  assert.equal(org.role, 'დამკვეთი');
  assert.ok(d.values.some((v) => v.label === 'სართულიანობა' && v.value === '12'));
  assert.ok(d.values.some((v) => v.group === 'docClassCalculatorValues' && v.key === 'kZ2'));
  assert.equal(d.docType, 'მშენებლობის ნებართვა - III კლასი');
  assert.equal(d.unmapped.someFutureField, 'kept for audit');
  assert.deepEqual(d.cadastralCodes, [BASE]);
  assert.equal(d.motions.length, 7);
});

test('payload classification: status, content type, signature and size — never assumed', () => {
  const b = (s) => new Uint8Array(Buffer.from(s, 'latin1'));
  assert.equal(classifyPayload({ status: 200, contentType: 'text/html', bytes: b('%PDF-1.4 x') }).kind, 'PDF');
  assert.equal(classifyPayload({ status: 200, contentType: 'application/pdf', bytes: b('<html><body>Real decision text here, long enough</body></html>') }).kind, 'HTML');
  assert.equal(classifyPayload({ status: 200, contentType: 'text/html', bytes: b('<html><body>  </body></html>') }).kind, 'EMPTY');
  assert.equal(classifyPayload({ status: 200, contentType: 'text/html', bytes: new Uint8Array() }).kind, 'EMPTY');
  assert.equal(classifyPayload({ status: 500, bytes: b('x') }).kind, 'FAILED');
  assert.equal(classifyPayload({ status: 200, bytes: b('Rar!\x1a\x07') }).format, 'rar');
  assert.equal(classifyPayload({ status: 200, bytes: b('AC1027') }).kind, 'CAD');
  assert.equal(classifyPayload({ status: 200, bytes: b('random'), fileName: 'plan.pla' }).kind, 'CAD');
  assert.equal(classifyPayload({ status: 200, bytes: fakeJpeg(10, 10) }).format, 'jpeg');
  // Thresholds of the owner's live acceptance run: ≥50 / 1–49 / 0 chars.
  assert.equal(classifyPdfText('x'.repeat(50), 9), 'READ_TEXT');
  assert.equal(classifyPdfText('x'.repeat(49), 1), 'LOW_TEXT');
  assert.equal(classifyPdfText('   ', 3), 'SCAN_OR_IMAGE_ONLY');
  assert.equal(classifyPdfText(null, 1, true), 'FAILED');
  // ≤ 32 bytes is an empty answer (live inventory rule), unless it is a PDF.
  assert.equal(classifyPayload({ status: 200, contentType: 'text/html', bytes: b('<html></html>') }).kind, 'EMPTY');
});

test('dates: DD/MM/YYYY, epoch, ISO; impossible months rejected', () => {
  assert.equal(toIsoDate('31/12/2026'), '2026-12-31T00:00:00.000Z');
  assert.equal(toIsoDate('12.13.2026'), null);
  assert.equal(maskPersonalId('12'), null);
});

test('API_FIRST end-to-end over the fixture: exhaustive pagination, reconciliation and full accounting', async () => {
  __resetTasApiCaches();
  const { fetcher, calls } = fixtureFetcher();
  const r = await acquireTasApi(FULL, { fetcher, parsePdf: fixturePdfParser, pageSize: 10, minGapMs: 0, concurrency: 4, budgetMs: 120000 });
  assert.equal(r.error, null);
  assert.equal(r.searchCadastralCode, BASE);
  assert.equal(r.requestedCadastralCode, FULL, 'requested and search identifiers both preserved');
  assert.equal(r.accounting.documents, 19);
  assert.deepEqual(r.cases.map((c) => Number(c.detail.documentId)).sort((a, b) => a - b), DOC_IDS.slice().sort((a, b) => a - b));
  assert.equal(r.reconciliation.sourceTotal, 19);
  assert.equal(r.reconciliation.uniqueDocumentIds, 19);
  assert.equal(r.reconciliation.reconciled, true);
  assert.equal(r.reconciliation.duplicateRows, 1);
  assert.equal(r.reconciliation.stopReason, 'TOTAL_REACHED');
  assert.equal(r.accounting.motions, 133);
  assert.deepEqual({ ...r.accounting.responses }, { PDF: 67, HTML: 1, EMPTY: 65, OTHER: 0, FAILED: 0, NOT_FETCHED: 0 });
  assert.equal(r.accounting.attachments, 413);
  assert.equal(r.accounting.pdfAttachments, 326);
  assert.equal(r.accounting.nonPdfAttachments, 87);
  const o = r.accounting.attachmentOutcomes;
  assert.equal(o.READ_TEXT + o.LOW_TEXT + o.SCAN_OR_IMAGE_ONLY + o.FAILED, 326);
  assert.ok(o.SCAN_OR_IMAGE_ONLY > 0 && o.LOW_TEXT > 0);
  assert.equal(o.UNSUPPORTED_FORMAT, 69, 'DWG/PLA/RAR/DOCX accounted, never "interpreted"');
  assert.equal(o.IMAGE, 18);
  const sum = Object.values(o).reduce((a, b) => a + b, 0);
  assert.equal(sum, 413, 'every attachment has exactly one outcome');
  // Cases are ordered by real date, not by document id.
  const dates = r.cases.map((c) => c.detail.submittedAt);
  assert.deepEqual(dates, dates.slice().sort());
  // Visual budget respected; chosen bytes are cached for collection.
  assert.ok(r.visuals.length >= 1 && r.visuals.length <= 6);
  for (const v of r.visuals) assert.ok(getCachedVisual(v.id));
  assert.ok(calls.length > 0);
});

test('API_FIRST: unchanged evidence is served from cache on the next run (no re-download)', async () => {
  __resetTasApiCaches();
  const a = fixtureFetcher();
  await acquireTasApi(FULL, { fetcher: a.fetcher, parsePdf: fixturePdfParser, pageSize: 10, minGapMs: 0, concurrency: 4 });
  const b = fixtureFetcher();
  const r2 = await acquireTasApi(FULL, { fetcher: b.fetcher, parsePdf: fixturePdfParser, pageSize: 10, minGapMs: 0, concurrency: 4 });
  assert.ok(r2.accounting.cacheHits >= 133 + 400);
  assert.ok(b.calls.filter((c) => c.path === '/DownloadServlet').length <= 6, 'only shortlisted visuals re-fetched');
});

test('API_FIRST: attachment download budget is ACCOUNTED, not hidden', async () => {
  __resetTasApiCaches();
  const { fetcher } = fixtureFetcher();
  const r = await acquireTasApi(FULL, { fetcher, parsePdf: fixturePdfParser, pageSize: 10, minGapMs: 0, concurrency: 4, maxAttachmentDownloads: 50 });
  assert.equal(r.accounting.attachments, 413);
  assert.ok(r.accounting.attachmentOutcomes.NOT_PROCESSED_BUDGET >= 413 - 56);
});

test('legacy wire adapter: same LegacySourceResult shape, one bounded document per case, structured tasApi without text', async () => {
  __resetTasApiCaches();
  const { fetcher } = fixtureFetcher();
  const raw = await acquireTasApi(FULL, { fetcher, parsePdf: fixturePdfParser, pageSize: 10, minGapMs: 0, concurrency: 4, caseTextBudget: 5000 });
  const legacy = toLegacyTasResult(raw);
  assert.equal(legacy.source, 'tas');
  assert.equal(legacy.status, 'SEARCH_CONFIRMED');
  assert.equal(legacy.originalCadastralCode, FULL);
  assert.equal(legacy.resolvedSearchCadastralCode, BASE);
  assert.equal(legacy.documents.length, 19);
  assert.ok(legacy.documents.every((d) => d.rawText.length <= 5000 && d.complete));
  assert.ok(legacy.documents.some((d) => d.textTruncated));
  assert.equal(legacy.workflowResult.state, 'TAS_EXHAUSTED');
  const c = legacy.tasApi.cases.find((x) => x.documentId === '1161121');
  assert.equal(c.attachments.length, 22);
  assert.ok(!('text' in c));
  assert.ok(c.technicalFacts.length > 0, 'technical facts extracted from response/attachment text');
});

test('API_FIRST: an unreachable server yields FAILED (which triggers fallback), never an empty success', async () => {
  const fetcher = async () => new Response('bad gateway', { status: 502 });
  const raw = await acquireTasApi(FULL, { fetcher, parsePdf: fixturePdfParser, minGapMs: 0, budgetMs: 20000 });
  const legacy = toLegacyTasResult(raw);
  assert.equal(legacy.status, 'FAILED');
  assert.ok(shouldFallBack(legacy));
});

test('implementation config: default LEGACY, API_FIRST with LEGACY fallback, rollback', () => {
  assert.deepEqual(parseTasConfig(null), { active: 'LEGACY', fallback: null });
  assert.deepEqual(parseTasConfig({ active: 'API_FIRST', fallback: 'LEGACY' }), { active: 'API_FIRST', fallback: 'LEGACY' });
  assert.deepEqual(parseTasConfig({ active: 'API_FIRST', fallback: 'API_FIRST' }), { active: 'API_FIRST', fallback: null });
  assert.deepEqual(parseTasConfig({ active: 'V2_UPLOADED', fallback: 'x' }), { active: 'LEGACY', fallback: null });
  assert.equal(shouldFallBack({ status: 'SEARCH_CONFIRMED' }), false);
  assert.equal(shouldFallBack({ status: 'NO_RESULT_CONFIRMED' }), false);
  assert.equal(shouldFallBack({ status: 'FAILED' }), true);
});

test('implementation health ledger: runs, last success/failure, duration', () => {
  __resetTasHealth();
  recordTasRun('API_FIRST', true, 1200, null, '2026-10-08T10:00:00Z');
  recordTasRun('API_FIRST', false, 300, 'TAS_DWR_HTTP_502', '2026-10-08T11:00:00Z');
  const h = tasHealth().find((x) => x.implementation === 'API_FIRST');
  assert.equal(h.runs, 2);
  assert.equal(h.lastSuccessAt, '2026-10-08T10:00:00Z');
  assert.equal(h.lastFailure, 'TAS_DWR_HTTP_502');
  assert.equal(h.lastDurationMs, 300);
});

test('visual candidates: ranked by metadata before any download; paperwork excluded; budget 2–4, max 6', () => {
  const att = (id, name, date, ext = 'pdf', size = 500000) => ({ attachedFileId: id, documentId: 'd', motionId: null, fileName: name, extension: ext, contentType: null, sizeBytes: size, date, description: null, sourcePath: '$' });
  const ranked = rankVisualCandidates([
    att('1', 'ხელშეკრულება.pdf', '2020-01-01'),
    att('2', 'რენდერი_ძველი.jpg', '2016-01-01', 'jpg'),
    att('3', 'render_final.jpg', '2024-05-01', 'jpg'),
    att('4', 'გენგეგმა.pdf', '2019-01-01'),
    att('5', 'საძირკვლის გეგმა.pdf', '2019-03-01'),
    att('6', 'ფოტოფიქსაცია.jpg', '2025-01-01', 'jpg'),
    att('7', 'პროექტი.dwg', '2025-01-01', 'dwg'),
    att('8', 'stamp.jpg', '2025-01-01', 'jpg', 9000),
  ]);
  assert.ok(!ranked.some((c) => c.attachedFileId === '1'), 'contracts are not visuals');
  assert.ok(!ranked.some((c) => c.attachedFileId === '7'), 'DWG never on the critical path');
  const shortlist = selectVisualShortlist(ranked, 4, 6);
  assert.equal(shortlist[0].role, 'LATEST_RENDER');
  assert.equal(shortlist[0].candidate.attachedFileId, '3');
  assert.equal(shortlist[1].role, 'EARLIEST_RENDER');
  assert.equal(shortlist[1].candidate.attachedFileId, '2');
  assert.ok(shortlist.length <= 4);
  assert.ok(selectVisualShortlist(ranked, 10, 6).length <= 6);
});

test('PDF embedded image extraction: DCTDecode streams with size, small images skipped', () => {
  const jpg = fakeJpeg(1600, 900);
  const small = fakeJpeg(40, 40);
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /XObject /Subtype /Image /Width 1600 /Height 900 /Filter /DCTDecode /Length ' + jpg.length + ' >>\nstream\n', 'latin1'),
    jpg,
    Buffer.from('\nendstream\nendobj\n2 0 obj\n<< /Subtype /Image /Width 40 /Height 40 /Filter /DCTDecode /Length ' + small.length + ' >>\nstream\n', 'latin1'),
    small,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);
  const imgs = extractImagesFromPdf(new Uint8Array(pdf));
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0].width, 1600);
  assert.deepEqual(imageSize(imgs[0].bytes), { width: 1600, height: 900, mime: 'image/jpeg' });
});

test('Content-Disposition names the attachment (RFC 5987 first) and drives PLA typing', () => {
  assert.equal(fileNameFromDisposition("attachment; filename*=UTF-8''%E1%83%A2%E1%83%9D%E1%83%9E%E1%83%9D.pla"), 'ტოპო.pla');
  assert.equal(fileNameFromDisposition('attachment; filename="topo.pdf"'), 'topo.pdf');
  assert.equal(fileNameFromDisposition('inline; filename=photos gapi.pdf'), 'photos gapi.pdf');
  assert.equal(fileNameFromDisposition(null), null);
  const b = (s) => new Uint8Array(Buffer.from(s, 'latin1'));
  assert.equal(classifyPayload({ status: 200, bytes: b('x'.repeat(64)), fileName: 'ტოპო.pla' }).kind, 'CAD');
});

test('Georgian mojibake (UTF-8 read as CP1252) is repaired; clean text is untouched', () => {
  const georgian = 'მშენებლობის ნებართვა';
  const broken = Buffer.from(georgian, 'utf8').toString('latin1')
    .replace(/\x83/g, '\u0192'); // CP1252 shows 0x83 as ƒ
  assert.equal(repairGeorgianMojibake(broken), georgian);
  assert.equal(repairGeorgianMojibake(georgian), georgian);
  assert.equal(repairGeorgianMojibake('Plain ASCII áƒ but nothing else'), 'Plain ASCII áƒ but nothing else');
});

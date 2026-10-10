// priorityFixture.mjs — a SYNTHETIC parcel shaped on production job 220ed087
// (cadastral 01.18.06.019.055.03.01.503, TAS parcel 01.18.06.019.055):
//   AR11161121 (documentId 1161121, 17.09.2026, 0 motions, 22 attachments of
//   mixed formats — the file names production reported), AR11148112
//   (17/06/2026), an older case with a decision, and a NEWER case whose own
//   cadastral code names a different parcel (must never become priority).
//
// NOT captured TAS bytes: replies follow the documented DWR reply form
// (CONTRACT.md); the 1161121 detail is wrapped in {isSuccess, source} — the
// envelope production's `unmappedKeys:['isSuccess']` points to. The public
// form page / interface script / form method are SYNTHETIC (form discovery is
// not live-verified).

import { fakeJpeg } from './tasFixture.mjs';

export const PARCEL = '01.18.06.019.055';
export const FLAT = '01.18.06.019.055.03.01.503';
const q = (s) => JSON.stringify(s);

/** A PDF carrying JPEG image streams (photos / montages). */
export function pdfWithJpegs(marker, n, salt = 0) {
  const parts = [Buffer.from(`%PDF-1.4\n% ${marker}\n`, 'latin1')];
  for (let i = 0; i < n; i++) {
    const jpg = fakeJpeg(1600, 1000 + i, salt * 100 + i);
    parts.push(Buffer.from(`${i + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width 1600 /Height ${1000 + i} /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, 'latin1'), jpg, Buffer.from('\nendstream\nendobj\n', 'latin1'));
  }
  return Buffer.concat(parts);
}

const long = (seed, chars) => {
  const unit = `${seed}: საძირკველი ფილისებრი, კონსტრუქციული სისტემა რკინაბეტონის კარკასი, სართულიანობა 14, სიმაღლე 45.2 მ. `;
  return unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars - 7) + ' [END]';
};

/** fileId → spec. `pages` = per-page text (the parser returns them), `kind` = served bytes. */
export const FILES = new Map();
let seq = 9100000;
const add = (docId, name, spec) => {
  const id = String(++seq);
  FILES.set(id, { docId, name, ...spec });
  return id;
};

// ── AR11161121: the 22 attachments production reported ──
export const NEWEST = '1161121';
const n = (name, spec) => add(NEWEST, name, spec);
export const IDS_1161121 = [
  n('გენგეგმა.pdf', { kind: 'pdf', pages: [long('გენგეგმა', 3526)] }),
  n('ფოტოები.pdf', { kind: 'pdfJpeg', images: 3, pages: ['', '', ''] }),
  n('გეგმები 16,09,2026.pdf', { kind: 'pdf', pages: ['სართულის გეგმა 1 '.repeat(6), 'სართულის გეგმა 2 '.repeat(6), 'ტიპიური სართულის გეგმა '.repeat(4)] }),
  n('ჭრილები.pdf', { kind: 'pdf', pages: ['ჭრილი 1-1 '.repeat(8), 'ჭრილი 2-2 '.repeat(8)] }),
  n('ფასადები.pdf', { kind: 'pdf', pages: ['ფასადი A-B კორპუსი 3 '.repeat(4), 'ფასადი C-D '.repeat(6)] }),
  n('სიმაღლის სქემა.pdf', { kind: 'pdf', pages: ['სიმაღლის სქემა: შენობის სიმაღლე 45.2 მ, ნიშნული +0.00 '.repeat(2)] }),
  n('ძველი მონტაჟი.pdf', { kind: 'pdfJpeg', images: 2, pages: ['', ''] }),
  n('ახალი მონტაჟი.pdf', { kind: 'pdfJpeg', images: 2, pages: ['', ''] }),
  n('momijnave.pdf', { kind: 'pdf', pages: ['მომიჯნავე მესაკუთრის თანხმობა. მესაკუთრე: ლევან ნოზაძე, პ/ნ 01024099999, ტელ: +995 599 12 34 56, levan@example.ge. თანხმობას ვაცხადებ.'] }),
  n('1.jpg', { kind: 'jpg' }),
  n('2.jpg', { kind: 'jpg' }),
  n('3.jpg', { kind: 'jpg' }),
  n('არქიტექტურული ექსპერტიზა.pdf', { kind: 'pdf', pages: [long('არქიტექტურული ექსპერტიზა', 30_000), long('დასკვნა', 12_000)] }),
  n('კონსტრუქციული ექსპერტიზა.pdf', { kind: 'pdf', pages: [long('კონსტრუქციული ექსპერტიზა', 25_000)] }),
  n('ხანძარსაწინააღმდეგო ექსპერტიზა.pdf', { kind: 'pdf', pages: [long('ხანძარსაწინააღმდეგო', 9_000)] }),
  n('გეოლ ექსპერტიზა.pdf', { kind: 'pdf', pages: ['', '', ''] }), // scanned: no text layer
  n('საექსპერტო დასკვნები.pdf', { kind: 'pdf', pages: [long('საექსპერტო დასკვნა I', 60_000), long('საექსპერტო დასკვნა II', 60_000)] }),
  n('xazovnebis Tanxmobebi.pdf', { kind: 'pdf', pages: [long('ხაზოვანი ნაგებობების თანხმობები', 8_000)] }),
  n('project.dwg', { kind: 'dwg', size: 18_000_000 }),
  n('project.pla', { kind: 'pla', size: 240_000_000 }),
  n('archive.rar', { kind: 'rar', size: 95_000_000 }),
  n('განმარტებითი ბარათი.pdf', { kind: 'pdf', pages: [long('განმარტებითი ბარათი', 15_000)] }),
];

// ── AR11148112 (second newest) — re-cites momijnave.pdf (same file id) ──
export const SECOND = '1148112';
export const SHARED_FILE = IDS_1161121[8];
export const IDS_1148112 = [
  add(SECOND, 'კონსტრუქციული პროექტი.pdf', { kind: 'pdf', pages: [long('კონსტრუქციული პროექტი', 40_000), long('კონსტრუქციული პროექტი 2', 20_000)] }),
  add(SECOND, 'რენდერი.jpg', { kind: 'jpg' }),
  add(SECOND, 'ფასადი.pdf', { kind: 'pdf', pages: ['ფასადი '.repeat(10)] }),
  add(SECOND, 'model.dwg', { kind: 'dwg', size: 5_000_000 }),
];

// ── older case with a decision buried after long, non-material text ──
export const OLDER = '1101896';
export const IDS_OLDER = [add(OLDER, 'ტექნიკური პირობები.pdf', { kind: 'pdf', pages: [long('ტექნიკური პირობები', 30_000)] })];

// ── newest by date, but filed for a DIFFERENT parcel ──
export const OTHER_PARCEL = '1199999';
export const IDS_OTHER = [add(OTHER_PARCEL, 'სხვა.pdf', { kind: 'pdf', pages: [long('სხვა ნაკვეთი', 2_000)] })];

const DOCS = [
  { id: NEWEST, no: 'AR11161121', search: '17.09.2026 11:05', detailDate: '17.09.2026 11:05:00', cad: PARCEL, wrap: true, motions: [] },
  { id: SECOND, no: 'AR11148112', search: '17/06/2026', detailDate: '17/06/2026 09:30', cad: PARCEL, motions: [{ id: '7700001', name: 'რეგისტრაცია', date: Date.UTC(2026, 5, 18) }] },
  { id: OLDER, no: 'AR11101896', search: '2025-12-01', detailDate: '2025-12-01', cad: PARCEL, motions: [{ id: '7700002', name: 'პასუხი', date: Date.UTC(2025, 11, 20) }] },
  { id: OTHER_PARCEL, no: 'AR11199999', search: '01.10.2026', detailDate: '01.10.2026', cad: '01.18.06.019.099', motions: [] },
];

export const RESPONSES = new Map([
  [`${SECOND}:7700001`, 'ბრძანება N 4512345 18/06/2026\nშედეგი: შუალედური\nწარმოდგენილია დოკუმენტაცია. '],
  [`${OLDER}:7700002`, 'ბრძანება N 4400001 20/12/2025\nმშენებლობის ნებართვა გაიცეს\nნებართვის ვადა: 31.12.2027\n'],
]);

function searchReply() {
  const lines = ['//#DWR-INSERT', '//#DWR-REPLY', 'var s0=[];'];
  DOCS.forEach((d, i) => {
    const v = `s${i + 1}`;
    lines.push(`var ${v}={};${v}.documentId=${d.id};${v}.documentNo=${q(d.no)};${v}.docName=${q('მშენებლობის ნებართვა')};${v}.regDate=${q(d.search)};${v}.docStatusId=1;s0[${i}]=${v};`);
  });
  lines.push(`dwr.engine.remote.handleCallback("1","0",{isSuccess:true,source:s0,sources:[${DOCS.length}]});`);
  return lines.join('\n');
}

function detailReply(docId) {
  const d = DOCS.find((x) => x.id === docId);
  if (!d) return "dwr.engine._remoteHandleException('1','0',{javaClassName:'java.lang.Exception',message:'not found'});";
  const lines = ['//#DWR-INSERT', '//#DWR-REPLY', 'var s0={};'];
  lines.push(`s0.documentId=${d.id};s0.documentNo=${q(d.no)};s0.docName=${q('მრავალბინიანი საცხოვრებელი სახლის მშენებლობა')};s0.regDate=${q(d.detailDate)};s0.naprCadCode=${q(d.cad)};`);
  if (d.id === NEWEST) {
    lines.push(`s0.docStatusName=${q('განხილვის პროცესში')};`);
    lines.push('var a1={};a1.firstName="ნინო";a1.lastName="კაპანაძე";a1.personalNumber="01024012345";a1.phone="+995 555 12 34 56";a1.email="nino@example.ge";s0.docAuthor=a1;');
    lines.push('var c1={};c1.legalName="შპს ვილიონ დეველოპმენტი";c1.identificationCode="405123456";c1.roleName="დამკვეთი";var c0=[];c0[0]=c1;s0.coApplicants=c0;');
    lines.push('var v0=[];var v1={};v1.name="სართულიანობა";v1.value="14";v0[0]=v1;var v2={};v2.name="შენობის სიმაღლე";v2.value="45.2 მ";v0[1]=v2;var v3={};v3.name="პროექტის არქიტექტორი";v3.value="გიორგი ბერიძე";v0[2]=v3;var v4={};v4.name="საკონტაქტო ტელეფონი";v4.value="599123456";v0[3]=v4;s0.docValues=v0;');
    lines.push('var x0={};var x1={};x1.label="K-1";x1.text="0.6";var xs=[];xs[0]=x1;x0.fields=xs;s0.extraBlock=x0;');
  }
  lines.push('var m0=[];');
  d.motions.forEach((m, i) => lines.push(`var m${i + 1}={};m${i + 1}.motionId=${m.id};m${i + 1}.motionName=${q(m.name)};m${i + 1}.motionDate=new Date(${m.date});m0[${i}]=m${i + 1};`));
  lines.push('s0.motions=m0;var f0=[];s0.attachedFiles=f0;');
  const ids = d.id === NEWEST ? IDS_1161121 : d.id === SECOND ? [...IDS_1148112, SHARED_FILE] : d.id === OLDER ? IDS_OLDER : IDS_OTHER;
  ids.forEach((fid, i) => {
    const f = FILES.get(fid);
    lines.push(`var f${i + 1}={attachedFileId:${fid},fileName:${q(f.name)},motionId:null${f.size ? `,fileSize:${f.size}` : ''}};f0[${i}]=f${i + 1};`);
  });
  lines.push(d.wrap ? 'dwr.engine.remote.handleCallback("1","0",{isSuccess:true,source:s0});' : 'dwr.engine.remote.handleCallback("1","0",s0);');
  return lines.join('\n');
}

const PUBLIC_HTML = `<!doctype html><html><head>
<script src="/architect/dwr/engine.js"></script>
<script src="dwr/interface/UserMethods.js"></script>
<script src="/architect/dwr/interface/PublicDocManager.js"></script>
<script src="https://evil.example/architect/dwr/interface/Steal.js"></script>
</head><body><div id="app"></div></body></html>`;

const PUBLIC_DOC_MANAGER_JS = `if (typeof dwr == 'undefined' || dwr.engine == undefined) throw new Error('You must include DWR engine before including this file');
(function() {
  if (dwr.engine._getObject("PublicDocManager") == undefined) {
    var p;
    p = {};
    p._path = '/architect/dwr';
    p.saveDocument = function(p0, p1, callback) { return dwr.engine._execute(p._path, 'PublicDocManager', 'saveDocument', arguments); };
    p.getDocsForPublicInfo = function(p0, callback) { return dwr.engine._execute(p._path, 'PublicDocManager', 'getDocsForPublicInfo', arguments); };
    p.getPublicDocumentValues = function(p0, callback) { return dwr.engine._execute(p._path, 'PublicDocManager', 'getPublicDocumentValues', arguments); };
    dwr.engine._setObject("PublicDocManager", p);
  }
})();`;

const USER_METHODS_JS = `UserMethods._path = '/architect/dwr';
UserMethods.getUserDocumentLastMotion = function(p0, callback) { dwr.engine._execute(UserMethods._path, 'UserMethods', 'getUserDocumentLastMotion', p0, callback); }`;

function formReply(docId) {
  return [
    '//#DWR-INSERT', '//#DWR-REPLY',
    'var r0=[];var r1={};r1.fieldName="მიწის ნაკვეთის ფართობი";r1.fieldValue="2450 მ²";r0[0]=r1;',
    'var r2={};r2.fieldName="ელ-ფოსტა";r2.fieldValue="owner@example.ge";r0[1]=r2;',
    `var r3={};r3.label="პროექტის ავტორი";r3.value="შპს არქი სტუდიო";r0[2]=r3;`,
    `var r4={};r4.label="განაცხადის სტატუსი";r4.value=${q(docId === NEWEST ? 'განხილვის პროცესში' : 'დასრულებული')};r0[3]=r4;`,
    'dwr.engine.remote.handleCallback("1","0",{isSuccess:true,fields:r0});',
  ].join('\n');
}

/**
 * fetch() over the synthetic parcel. Options: `form` = 'ok' | 'none' | 'throw'
 * (public page discovery behaviour). Records every request.
 */
export function priorityFetcher({ form = 'ok' } = {}) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const u = new URL(String(url));
    calls.push({ path: u.pathname, search: u.search });
    const body = String(init.body ?? '');
    const js = (s) => new Response(s, { status: 200, headers: { 'content-type': 'text/javascript' } });
    if (u.pathname.endsWith('getDocsForPublicInfo.dwr')) {
      if (!body.includes(encodeURIComponent(PARCEL)) || body.includes(encodeURIComponent(FLAT))) return js('dwr.engine.remote.handleCallback("1","0",{isSuccess:true,source:[],sources:[0]});');
      return js(searchReply());
    }
    if (u.pathname.endsWith('getUserDocumentLastMotion.dwr')) return js(detailReply(/c0-param0=string:(\d+)/.exec(body)?.[1]));
    if (u.pathname === '/architect/public.html') {
      if (form === 'throw') throw new Error('ECONNRESET');
      if (form === 'none') return new Response('<html><body>no scripts</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
      return new Response(PUBLIC_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (u.pathname === '/architect/dwr/interface/PublicDocManager.js') return js(PUBLIC_DOC_MANAGER_JS);
    if (u.pathname === '/architect/dwr/interface/UserMethods.js') return js(USER_METHODS_JS);
    if (u.pathname.endsWith('PublicDocManager.getPublicDocumentValues.dwr')) return js(formReply(/c0-param0=string:(\d+)/.exec(body)?.[1]));
    if (u.pathname === '/NewArchitectureResponse') {
      const t = RESPONSES.get(`${u.searchParams.get('documentId')}:${u.searchParams.get('motionId')}`);
      return t ? new Response(Buffer.from(`%PDF-1.4 RESPONSE ${u.searchParams.get('documentId')}:${u.searchParams.get('motionId')}`), { status: 200, headers: { 'content-type': 'application/pdf' } }) : new Response('', { status: 200 });
    }
    if (u.pathname === '/DownloadServlet') {
      const id = u.searchParams.get('attachedFileId');
      const f = FILES.get(id);
      if (!f) return new Response('', { status: 404 });
      if (f.kind === 'pdf') return new Response(Buffer.from(`%PDF-1.5 ATT ${id}`), { status: 200, headers: { 'content-type': 'application/pdf' } });
      if (f.kind === 'pdfJpeg') return new Response(pdfWithJpegs(`ATT ${id}`, f.images, Number(id) % 1000), { status: 200, headers: { 'content-type': 'application/pdf' } });
      if (f.kind === 'jpg') return new Response(fakeJpeg(1920, 1080, Number(id)), { status: 200, headers: { 'content-type': 'image/jpeg' } });
      throw new Error(`unsupported format ${f.name} must never be downloaded`);
    }
    return new Response('not found', { status: 404 });
  };
  return { fetcher, calls };
}

/** pdf-parse stand-in with per-page text (the default parser's contract). */
export async function priorityPdfParser(bytes) {
  const s = bytes.toString('latin1');
  const resp = /RESPONSE (\d+:\d+)/.exec(s);
  if (resp) {
    const t = RESPONSES.get(resp[1]) ?? '';
    return { text: t, numpages: 1, pages: [t] };
  }
  const id = /ATT (\d+)/.exec(s)?.[1];
  const f = FILES.get(id);
  const pages = f?.pages ?? [''];
  return { text: pages.join('\n\n'), numpages: pages.length, pages };
}

/** A fake page renderer (PNG headers) honouring `pages` / `maxPages`; counts calls. */
export function fakeRenderer() {
  const state = { calls: [], closed: 0 };
  const png = (w, h, salt) => {
    const b = Buffer.alloc(64);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    b.writeUInt32BE(13, 8);
    b.write('IHDR', 12, 'latin1');
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    b.writeUInt32BE(salt >>> 0, 40);
    return new Uint8Array(b);
  };
  let salt = 0;
  const factory = () => ({
    async render(pdf, o) {
      const s = Buffer.from(pdf).toString('latin1');
      const id = /ATT (\d+)/.exec(s)?.[1];
      const f = FILES.get(id);
      const all = (f?.pages ?? ['']).map((_, i) => i + 1);
      const chosen = (o.pages?.length ? o.pages : all).slice(0, o.maxPages);
      state.calls.push({ id, pages: chosen });
      return { numPages: all.length, pages: chosen.map((p) => ({ page: p, mime: 'image/png', bytes: png(2200, 1555, ++salt), width: 2200, height: 1555, text: (f?.pages?.[p - 1] ?? '').slice(0, 200) })) };
    },
    async close() { state.closed++; },
  });
  return { factory, state };
}

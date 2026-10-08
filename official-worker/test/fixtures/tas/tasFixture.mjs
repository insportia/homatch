// tasFixture.mjs — a STRUCTURAL reconstruction of TAS's public DWR replies,
// shaped to the historical discovery for base parcel 01.18.06.019.055:
//   19 unique documents, 133 motions (67 PDF / 1 HTML / 65 empty responses),
//   413 unique attachments (326 PDF / 87 non-PDF), and document 1161121 with
//   22 attachment objects including case-level ones (motionId null).
//
// These are NOT captured production bytes (this repository's sandbox cannot
// reach docs.tbilisi.gov.ge). They reproduce the reply FORM DWR emits — var
// declarations, property assignments, shared references, strings containing
// ';' and '=' — so the parser and the accounting are exercised against the
// exact failure modes that broke the earlier regex parser. The counts are
// acceptance expectations for this fixture, not production constants.

export const BASE = '01.18.06.019.055';
export const FULL = '01.18.06.019.055.03.01.601';
export const DOC_IDS = [639208, 668968, 761052, 850369, 850793, 897963, 919535, 942605, 965637, 968595, 990786, 1026464, 1031305, 1034439, 1084312, 1101896, 1115640, 1148112, 1161121];

/** Deterministic distribution: motions per doc summing to 133. */
function motionsPerDoc() {
  const base = DOC_IDS.map(() => 7); // 19*7 = 133
  return base;
}

/** 413 attachments: doc 1161121 has 22; the other 18 share 391. */
function attachmentsPerDoc() {
  const out = DOC_IDS.map(() => 0);
  const last = DOC_IDS.indexOf(1161121);
  out[last] = 22;
  let remaining = 391;
  for (let i = 0; i < DOC_IDS.length; i++) {
    if (i === last) continue;
    const left = DOC_IDS.length - 1 - i - (i < last ? 1 : 0);
    const n = left <= 0 ? remaining : Math.round(remaining / (left + 1));
    out[i] = n;
    remaining -= n;
  }
  return out;
}

const q = (s) => JSON.stringify(s); // DWR emits double-quoted, \u-escaped strings

export function searchReply(start, limit, batchId = 1) {
  // Page 2 deliberately repeats one row from page 1 (source-side overlap).
  const ids = DOC_IDS.slice(start, start + limit);
  if (start > 0 && ids.length) ids.unshift(DOC_IDS[start - 1]);
  const lines = ['//#DWR-INSERT', '//#DWR-REPLY', 'dwr.engine.remote.handleNewScriptSession("FIXTURESESSION");', 'var s0=[];'];
  ids.forEach((id, i) => {
    const v = `s${i + 1}`;
    const day = String((i % 27) + 1).padStart(2, '0');
    lines.push(`var ${v}={};${v}.documentId=${id};${v}.documentNo=${q(`AR1${id}`)};${v}.docName=${q(i % 3 === 0 ? 'მშენებლობის ნებართვა; შეთანხმება=II' : 'არქიტექტურული პროექტის შეთანხმება')};${v}.regDate=new Date(${Date.UTC(2015 + (DOC_IDS.indexOf(id) % 10), 2, Number(day))});${v}.docStatusId=${[1, 2, 5, 6][i % 4]};`);
    lines.push(`s0[${i}]=${v};`);
  });
  // Verified reply shape: {isSuccess:true, source:[rows], sources:[total]}.
  lines.push(`dwr.engine.remote.handleCallback("${batchId}","0",{isSuccess:true,source:s0,sources:[${DOC_IDS.length}]});`);
  return lines.join('\n');
}

export function buildDetails() {
  let fileSeq = 5000000;
  const motions = motionsPerDoc();
  const atts = attachmentsPerDoc();
  const details = new Map();
  const responseKinds = new Map(); // `${doc}:${motion}` -> PDF|HTML|EMPTY
  const attachmentKinds = new Map(); // fileId -> {ext}
  let motionSeq = 7000000;
  let gMotion = 0, gAtt = 0, nonPdfCount = 0;
  DOC_IDS.forEach((docId, di) => {
    const lines = ['//#DWR-INSERT', '//#DWR-REPLY', 'throw \'allowScriptTagRemoting is false.\';'];
    lines.push('var s0={};');
    lines.push(`s0.documentId=${docId};s0.documentNo=${q(`AR1${docId}`)};s0.docName=${q('მრავალბინიანი საცხოვრებელი სახლის მშენებლობა')};`);
    lines.push(`s0.regDate=new Date(${Date.UTC(2015 + di % 10, 2, 1)});s0.address=${q('თბილისი, ვაკე-საბურთალო')};s0.naprCadCode=${q(BASE)};`);
    lines.push('var a1={};a1.firstName="გიორგი";a1.lastName="ბერიძე";a1.personalNumber="01024012345";s0.docAuthor=a1;');
    lines.push('var c1={};c1.legalName="შპს მაგალითი დეველოპმენტი";c1.identificationCode="405123456";c1.roleName="დამკვეთი";var c0=[];c0[0]=c1;s0.coApplicants=c0;');
    lines.push('var v0=[];var v1={};v1.name="სართულიანობა";v1.value="12";v0[0]=v1;var v2={};v2.name="შენობის სიმაღლე";v2.value="38.5 მ";v0[1]=v2;s0.docValues=v0;');
    lines.push('var k0={};k0.kZ1="0.5";k0.kZ2="3.2";s0.docClassCalculatorValues=k0;');
    lines.push('var t0={};t0.name="მშენებლობის ნებართვა - III კლასი";s0.archDocType=t0;');
    lines.push('s0.someFutureField="kept for audit";');
    // motions
    const mArr = [];
    lines.push('var m0=[];');
    for (let m = 0; m < motions[di]; m++) {
      const mid = motionSeq++;
      mArr.push(mid);
      const mv = `m${m + 1}`;
      lines.push(`var ${mv}={};${mv}.motionId=${mid};${mv}.motionName=${q(m === 0 ? 'რეგისტრაცია' : `ეტაპი ${m}`)};${mv}.motionDate=new Date(${Date.UTC(2015 + di % 10, 3 + m, 2)});m0[${m}]=${mv};var ma${m + 1}=[];${mv}.attachedFiles=ma${m + 1};`);
      const k = `${docId}:${mid}`;
      const g = gMotion++;
      // 67 PDF, 1 HTML, 65 EMPTY — interleaved so every case has a mix.
      responseKinds.set(k, g === 1 ? 'HTML' : g % 2 === 0 && g < 134 ? 'PDF' : 'EMPTY');
    }
    lines.push('s0.motions=m0;');
    // attachments: for 1161121, 5 case-level + 17 on motions, one shared ref
    const n = atts[di];
    const caseLevel = docId === 1161121 ? 5 : Math.max(1, Math.floor(n / 5));
    lines.push('var f0=[];s0.attachedFiles=f0;');
    let sharedVar = null;
    for (let i = 0; i < n; i++) {
      const fid = fileSeq++;
      const g = gAtt++;
      const nonPdf = g % 4 === 3 && nonPdfCount < 87;
      const ext = nonPdf ? ['jpg', 'dwg', 'pla', 'rar', 'docx'][nonPdfCount++ % 5] : 'pdf';
      const name = ext === 'jpg' ? `რენდერი_${i}.jpg` : ext === 'pdf' ? (i === 0 ? 'ფასადი; ხედი=1.pdf' : `დოკუმენტი_${i}.pdf`) : `file_${i}.${ext}`;
      attachmentKinds.set(String(fid), { ext, docId });
      const fv = `f${i + 1}`;
      if (i < caseLevel) {
        // Case level: motionId null. For the first one, the id is assigned
        // in a SEPARATE statement after an unrelated one.
        lines.push(`var ${fv}={};${fv}.fileName=${q(name)};${fv}.motionId=null;`);
        lines.push(`${fv}.fileSize=${100000 + i};`);
        lines.push(`${fv}.attachedFileId=${fid};f0[${i}]=${fv};`);
        if (i === 0) sharedVar = fv;
      } else {
        const mi = (i - caseLevel) % mArr.length;
        lines.push(`var ${fv}={attachedFileId:${fid},fileName:${q(name)},motionId:${mArr[mi]},fileSize:${200000 + i}};`);
        lines.push(`if(!m${mi + 1}.files){};`);
        lines.push(`m${mi + 1}.files=m${mi + 1}.files||[];`);
        lines.push(`ma${mi + 1}[ma${mi + 1}.length]=${fv};`);
      }
    }
    // A motion re-cites the first case-level file (shared reference): still one file.
    if (sharedVar) lines.push(`var r0=[];r0[0]=${sharedVar};m1.citedFiles=r0;`);
    lines.push('dwr.engine.remote.handleCallback("1","0",s0);');
    details.set(String(docId), lines.join('\n'));
  });
  return { details, responseKinds, attachmentKinds };
}

/** A fetch() over the fixture. Records every request for politeness checks. */
export function fixtureFetcher({ layoutCheck } = {}) {
  const { details, responseKinds, attachmentKinds } = buildDetails();
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const u = new URL(String(url));
    calls.push({ path: u.pathname, at: Date.now() });
    const body = String(init.body ?? '');
    const text = (s, ct = 'text/javascript') => new Response(s, { status: 200, headers: { 'content-type': ct } });
    if (u.pathname.endsWith('getDocsForPublicInfo.dwr')) {
      layoutCheck?.(body);
      const start = Number(/start:reference:c0-e(\d+)/.test(body) ? body.match(new RegExp(`c0-e${body.match(/start:reference:c0-e(\d+)/)[1]}=number:(\\d+)`))[1] : 0);
      const limit = Number(/limit:reference:c0-e(\d+)/.test(body) ? body.match(new RegExp(`c0-e${body.match(/limit:reference:c0-e(\d+)/)[1]}=number:(\\d+)`))[1] : 50);
      if (!body.includes(`naprCadCode:reference`) || !body.includes(encodeURIComponent(BASE))) return text('dwr.engine.remote.handleCallback("1","0",{isSuccess:true,source:[],sources:[0]});');
      return text(searchReply(start, limit));
    }
    if (u.pathname.endsWith('getUserDocumentLastMotion.dwr')) {
      const id = /c0-param0=string:(\d+)/.exec(body)?.[1];
      const d = details.get(id);
      return d ? text(d) : text("dwr.engine._remoteHandleException('1','0',{javaClassName:'java.lang.Exception',message:'not found'});");
    }
    if (u.pathname === '/NewArchitectureResponse') {
      const k = `${u.searchParams.get('documentId')}:${u.searchParams.get('motionId')}`;
      const kind = responseKinds.get(k);
      if (kind === 'PDF') return new Response(Buffer.from(`%PDF-1.4 RESPONSE ${k}`), { status: 200, headers: { 'content-type': 'application/pdf' } });
      if (kind === 'HTML') return new Response(`<html><body><p>გადაწყვეტილება ${k}: ნებართვის ვადა გაგრძელდა 2026 წლის 31 დეკემბრამდე</p></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
      return new Response('', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (u.pathname === '/DownloadServlet') {
      const id = u.searchParams.get('attachedFileId');
      const a = attachmentKinds.get(id);
      if (!a) return new Response('', { status: 404 });
      if (a.ext === 'pdf') return new Response(Buffer.from(`%PDF-1.5 ATT ${id}`), { status: 200, headers: { 'content-type': 'application/pdf' } });
      if (a.ext === 'jpg') return new Response(fakeJpeg(1600, 900, Number(id)), { status: 200, headers: { 'content-type': 'image/jpeg' } });
      if (a.ext === 'rar') return new Response(Buffer.from('Rar!\x1a\x07\x00...'), { status: 200, headers: { 'content-type': 'application/octet-stream' } });
      if (a.ext === 'dwg') return new Response(Buffer.from('AC1027 drawing'), { status: 200, headers: { 'content-type': 'application/octet-stream' } });
      if (a.ext === 'docx') return new Response(Buffer.from('PK\x03\x04 office'), { status: 200, headers: { 'content-type': 'application/octet-stream' } });
      return new Response(Buffer.from('ARCHICAD PLA'), { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetcher, calls };
}

/** A minimal JPEG header with an SOF0 frame of the given size (not decodable, sized). */
export function fakeJpeg(width, height, salt = 0) {
  const b = Buffer.alloc(64);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255], 0);
  b.writeUInt32BE(salt >>> 0, 40);
  b.set([0xff, 0xd9], 62);
  return b;
}

/** pdf-parse stand-in: fixture PDFs carry their own text marker. */
export async function fixturePdfParser(bytes) {
  const s = bytes.toString('latin1');
  if (s.includes('RESPONSE')) return { text: `ბრძანება ${s.slice(-20)}\nმშენებლობის ნებართვის ვადა: 31.12.2026\nმთავარი არქიტექტორის სახელი და გვარი: ნინო კაპანაძე\n`.repeat(4), numpages: 1 };
  const id = Number(s.split(' ').pop());
  if (id % 7 === 0) return { text: '', numpages: 3 }; // scan-only
  if (id % 11 === 0) return { text: 'გვერდი 1. ხელმოწერა და ბეჭედი. თარიღი 2019 წელი. დანართი', numpages: 1 }; // low text
  return { text: `საძირკველი: ფილისებრი რკინაბეტონის ფილა, სისქე 1.2 მ. დოკუმენტი ${id}. `.repeat(8), numpages: 1 };
}

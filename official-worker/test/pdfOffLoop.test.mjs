// PDF PARSING OFF THE EVENT LOOP (src/runtime/pdfOffLoop.ts): identical text to the in-process
// parser, and the event loop (AI TALK's speech frame relay) keeps its rhythm during a large parse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const off = await import('../.tstest-build/runtime/pdfOffLoop.js');
const core = await import('../.tstest-build/runtime/pdfParseCore.mjs');

function makePdf(pages) {
  const objs = []; const add = (s) => { objs.push(s); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); const kids = []; const pagesId = 1 + pages * 2 + 1; // font, then (content, page) per page, then the page tree
  for (let p = 0; p < pages; p++) { let b = 'BT /F1 9 Tf 40 800 Td 11 TL\n'; for (let l = 0; l < 60; l++) b += `(Page ${p} line ${l}: registry row ${p * 60 + l}) Tj T*\n`; b += 'ET';
    const c = add(`<< /Length ${b.length} >>\nstream\n${b}\nendstream`); kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Contents ${c} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`)); }
  add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${pages} >>`); const cat = add(`<< /Type /Catalog /Pages ${objs.length} 0 R >>`);
  let out = '%PDF-1.4\n'; const offs = []; objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out);
}

test('threaded parse returns exactly what the in-process parser returns, both modes', async () => {
  const pdf = makePdf(12);
  for (const mode of ['default', 'pages']) {
    const threaded = await off.parsePdfOffLoop(pdf, mode);
    const local = await core.parseIn(mode, pdf);
    assert.equal(threaded.text, local.text, mode);
    assert.equal(threaded.numpages, 12);
    assert.deepEqual(threaded.pages, local.pages, mode);
  }
  assert.ok(off.stats.threaded >= 2, 'ran in worker threads');
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF', 'the caller keeps its buffer');
});

test('a 200-page parse does not hold the event loop: a 20 ms timer stays on time', async () => {
  const pdf = makePdf(200);
  await off.parsePdfOffLoop(makePdf(12)); // threads up
  const late = []; let last = performance.now(); let on = true;
  const tick = () => { const n = performance.now(); late.push(n - last - 20); last = n; if (on) setTimeout(tick, 20); };
  setTimeout(tick, 20);
  const r = await off.parsePdfOffLoop(pdf, 'pages');
  on = false;
  assert.equal(r.numpages, 200);
  late.sort((a, b) => a - b);
  assert.ok(late.length >= 5, `timer kept running during the parse (${late.length} ticks)`);
  assert.ok(late[late.length - 1] < 100, `worst timer lateness ${late[late.length - 1].toFixed(1)} ms`);
});

test('every worker PDF parse goes through the off-loop parser', () => {
  for (const f of ['../src/workflows/tas/api/TasApiWorkflow.ts', '../src/workflows/mygov/MyGovApiWorkflow.ts', '../src/workflows/enreg/EnregWorkflow.ts', '../src/documents/PdfDocumentReader.ts']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.match(src, /parsePdfOffLoop\(/, f);
    assert.doesNotMatch(src, /import pdf from 'pdf-parse'|require\(\)?'pdf-parse\/lib\/pdf-parse\.js'\)\(/, f);
  }
});

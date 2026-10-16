// tasVisuals.test.mjs — Verify "Visual Property Intelligence" (worker side):
// deterministic classification on the REAL Villion Krtsanisi TAS file names
// (job 220ed087), EXIF refinement (a render is never a photo), identity hints
// (blocks / units / floors / case cadastral codes), drawing page rendering
// (real headless Chromium + the pdf.js already bundled in pdf-parse, skipped
// where no Chromium exists) and the bounded acquisition wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { classifyVisualMeta, classifyPageText, refineWithImage, readExif, identityHints, detectBlocks, detectUnitLabels, detectFloorLabels, cadastralBuildings } from '../.tstest-build/workflows/tas/api/visualClassify.js';
import { rankVisualCandidates, selectVisualShortlist, VISUAL_ASSET_MAX, VISUAL_FILE_MAX } from '../.tstest-build/workflows/tas/api/visuals.js';
import { createChromiumPdfRenderer, pdfJsBuildDir } from '../.tstest-build/workflows/tas/api/pdfRender.js';
import { acquireTasApi, __resetTasApiCaches, getCachedVisual } from '../.tstest-build/workflows/tas/api/TasApiWorkflow.js';
import { FULL, fixtureFetcher, fixturePdfParser } from './fixtures/tas/tasFixture.mjs';

const kindOf = (fileName) => classifyVisualMeta({ fileName });

test('Villion TAS file names: deterministic kind + category table', () => {
  const table = [
    ['01. site.pdf', 'SITE_PLAN', 'SITE'],
    ['02. floor plans.pdf', 'FLOOR_PLAN', 'ARCHITECTURE'],
    ['03. sections.pdf', 'SECTION', 'ARCHITECTURE'],
    ['04. elevations.pdf', 'ELEVATION', 'ARCHITECTURE'],
    ['Photos 2022.06.06.pdf', 'PHOTO', 'BUILDING'],
    ['AR1897963 - გარემო.pdf', 'LOCATION_DIAGRAM', 'SITE'],
    ['Krtsanisi Shenobis Laqa 2022.06.06.pdf', 'SITE_PLAN', 'SITE'],
    ['022.effectsResult.jpg', 'RENDER', 'BUILDING'],
    ['გენგეგმა.pdf', 'SITE_PLAN', 'SITE'],
    ['gengegma.pdf', 'SITE_PLAN', 'SITE'],
    ['ტოპო.pdf', 'SITE_PLAN', 'SITE'],
    ['ჭრილი 1-1.pdf', 'SECTION', 'ARCHITECTURE'],
    ['ფასადი.pdf', 'FACADE', 'ARCHITECTURE'],
    ['კონსტრუქციული ნაწილი.pdf', 'STRUCTURAL', 'STRUCTURE'],
    ['ტიპიური სართულის გეგმა.pdf', 'FLOOR_PLAN', 'ARCHITECTURE'],
    ['ბინის გეგმა.pdf', 'UNIT_PLAN', 'APARTMENT'],
    ['ფოტოფიქსაცია.pdf', 'PHOTO', 'BUILDING'],
    ['რენდერი.jpg', 'RENDER', 'BUILDING'],
    ['ვიზუალიზაცია 3.jpg', 'RENDER', 'BUILDING'],
    ['IMG_4411.jpg', 'PHOTO', 'BUILDING'],
    ['ვენტილაციის სქემა.pdf', 'ENGINEERING', 'STRUCTURE'],
    ['master plan.pdf', 'MASTER_PLAN', 'SITE'],
  ];
  for (const [name, kind, category] of table) {
    const c = kindOf(name);
    assert.ok(c, name);
    assert.equal(c.kind, kind, name);
    assert.equal(c.category, category, name);
  }
});

test('unlabelled Villion images stay OTHER with low confidence — never guessed as photo', () => {
  for (const n of ['Krtsanisi 02.jpg', 'Krtsanisi 05.jpg', '1.jpg', '2 copy.jpg']) {
    const c = kindOf(n);
    assert.equal(c.kind, 'OTHER', n);
    assert.ok(c.confidence < 0.5, n);
  }
});

test('paperwork is never a visual', () => {
  for (const n of ['ხელშეკრულება.pdf', 'ამონაწერი.pdf', 'განცხადება.pdf', 'payment receipt.pdf']) assert.equal(kindOf(n), null, n);
});

test('photos of a construction stage become CONSTRUCTION_PHOTO from case context', () => {
  const c = classifyVisualMeta({ fileName: 'ფოტო.pdf', context: 'მშენებლობის მიმდინარე სამუშაოების მონიტორინგი' });
  assert.equal(c.kind, 'CONSTRUCTION_PHOTO');
  assert.equal(c.category, 'CONSTRUCTION');
});

/** A JPEG with an EXIF IFD0 carrying the given ASCII tags. */
function jpegWithExif(tags) {
  const entries = Object.entries(tags);
  const strings = entries.map(([, v]) => Buffer.from(`${v}\0`, 'latin1'));
  const ifdSize = 2 + entries.length * 12 + 4;
  let dataOff = 8 + ifdSize;
  const tiff = Buffer.alloc(dataOff + strings.reduce((n, s) => n + s.length, 0));
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(entries.length, 8);
  const codes = { make: 0x010f, model: 0x0110, software: 0x0131 };
  entries.forEach(([k], i) => {
    const e = 10 + i * 12;
    tiff.writeUInt16LE(codes[k], e);
    tiff.writeUInt16LE(2, e + 2);
    tiff.writeUInt32LE(strings[i].length, e + 4);
    tiff.writeUInt32LE(dataOff, e + 8);
    strings[i].copy(tiff, dataOff);
    dataOff += strings[i].length;
  });
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const len = app1.length + 2;
  return new Uint8Array(Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255]), app1,
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x84, 0x06, 0x40]), Buffer.alloc(12), Buffer.from([0xff, 0xd9]),
  ]));
}

test('EXIF refinement: camera → PHOTO, render engine → RENDER, a named render is never turned into a photo', () => {
  const cam = readExif(jpegWithExif({ make: 'Canon', model: 'EOS 80D' }));
  assert.equal(cam.make, 'Canon');
  const lumion = readExif(jpegWithExif({ software: 'Lumion 12' }));
  assert.equal(lumion.software, 'Lumion 12');
  const other = kindOf('Krtsanisi 02.jpg');
  assert.equal(refineWithImage(other, { exif: cam, extraction: 'NATIVE_IMAGE' }).kind, 'PHOTO');
  assert.equal(refineWithImage(other, { exif: lumion, extraction: 'NATIVE_IMAGE' }).kind, 'RENDER');
  const render = kindOf('022.effectsResult.jpg');
  assert.equal(refineWithImage(render, { exif: cam, extraction: 'NATIVE_IMAGE' }).kind, 'RENDER', 'render evidence always wins');
  assert.equal(refineWithImage(other, { exif: cam, extraction: 'NATIVE_IMAGE', context: 'მშენებლობის მონიტორინგი' }).kind, 'CONSTRUCTION_PHOTO');
  assert.equal(refineWithImage(other, { exif: null, extraction: 'NATIVE_IMAGE' }).kind, 'OTHER');
});

test('drawing pages: the sheet title refines a generic plan; a vector page is never a photo', () => {
  assert.equal(classifyPageText('SECTION 1-1 scale 1:100').kind, 'SECTION');
  assert.equal(classifyPageText('ფოტო')?.kind ?? null, null);
  const generic = kindOf('გეგმა.pdf');
  assert.equal(generic.kind, 'FLOOR_PLAN');
  assert.equal(refineWithImage(generic, { exif: null, extraction: 'PDF_PAGE_RENDER', pageText: 'ჭრილი 2-2' }).kind, 'SECTION');
  const photoPdf = kindOf('Photos 2022.06.06.pdf');
  assert.ok(refineWithImage(photoPdf, { exif: null, extraction: 'PDF_PAGE_RENDER', pageText: '' }).confidence <= 0.5);
});

test('identity hints: block, unit, floor labels and case cadastral buildings', () => {
  assert.deepEqual(detectBlocks('კორპუსი 3 — ტიპიური სართული'), ['03']);
  assert.deepEqual(detectBlocks('Block 01 floor plan'), ['01']);
  assert.deepEqual(detectBlocks('მე-3 კორპუსის ფასადი'), ['03']);
  assert.deepEqual(detectBlocks('Krtsanisi 02'), [], 'a numbered file is not a building label');
  assert.deepEqual(detectBlocks('შენობა და ნაგებობა'), []);
  assert.deepEqual(detectUnitLabels('ბინა №503, სართული 5'), ['503']);
  assert.deepEqual(detectFloorLabels('სართული 5').floors, ['5']);
  assert.deepEqual(detectFloorLabels('9 სართულიანი შენობა').floors, [], 'building height is not a floor');
  assert.equal(detectFloorLabels('ტიპიური სართულის გეგმა').typical, true);
  assert.deepEqual(cadastralBuildings(['01.18.06.019.055', '01.18.06.019.055.01.01.012'], '01.18.06.019.055'), ['01']);
  const h = identityHints({ fileName: '02. floor plans.pdf', pageText: 'TYPICAL FLOOR PLAN BLOCK 03', caseCadastralCodes: ['01.18.06.019.055.01.01.012'], parcel: '01.18.06.019.055' });
  assert.deepEqual(h.blocks, ['03'], 'the drawing label wins over case codes');
  assert.equal(h.blockBasis, 'LABEL');
  assert.equal(h.typicalFloor, true);
  const h2 = identityHints({ fileName: '01. site.pdf', caseCadastralCodes: ['01.18.06.019.055.01.01.012'], parcel: '01.18.06.019.055' });
  assert.deepEqual(h2.blocks, ['01']);
  assert.equal(h2.blockBasis, 'CASE_CADASTRAL');
});

test('Villion shortlist: renders, site, floors, sections, elevations and photos all opened; ≤ VISUAL_FILE_MAX files', () => {
  const names = [
    ...Array.from({ length: 40 }, (_, i) => `${String(i + 5).padStart(2, '0')}. ტექსტი ${i}.pdf`),
    '01. site.pdf', '02. floor plans.pdf', '03. sections.pdf', '04. elevations.pdf', 'Photos 2022.06.06.pdf',
    'AR1897963 - გარემო.pdf', 'Krtsanisi Shenobis Laqa 2022.06.06.pdf',
    'Krtsanisi 02.jpg', 'Krtsanisi 03.jpg', 'Krtsanisi 04.jpg', 'Krtsanisi 05.jpg', '022.effectsResult.jpg', '1.jpg', '2 copy.jpg',
    'model.pla', 'plan.dwg', 'archive.rar',
  ];
  const atts = names.map((n, i) => ({
    attachedFileId: String(1000 + i), documentId: 'v', motionId: null, fileName: n, extension: n.split('.').pop(), contentType: null,
    sizeBytes: 900000 + i, date: '2022-06-06', description: null, sourcePath: '$', caseCadastralCodes: ['01.18.06.019.055'],
  }));
  const ranked = rankVisualCandidates(atts, { parcel: '01.18.06.019.055' });
  assert.ok(!ranked.some((c) => /\.(pla|dwg|rar)$/.test(c.fileName)));
  assert.ok(!ranked.some((c) => /ტექსტი/.test(c.fileName)), 'unlabelled PDFs are not visuals');
  const short = selectVisualShortlist(ranked);
  assert.ok(short.length <= VISUAL_FILE_MAX);
  const kinds = new Set(short.map((s) => s.candidate.kind));
  for (const k of ['RENDER', 'PHOTO', 'SITE_PLAN', 'FLOOR_PLAN', 'SECTION', 'ELEVATION', 'LOCATION_DIAGRAM', 'OTHER']) assert.ok(kinds.has(k), k);
  assert.equal(short[0].candidate.fileName, '022.effectsResult.jpg');
});

// ─────────────────────────── page rendering ───────────────────────────

/** A small vector PDF (lines + a Helvetica label), built in-test. */
function makeVectorPdf(pages = 2, label = 'TYPICAL FLOOR PLAN BLOCK 03') {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add(null), pagesObj = add(null), font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (let i = 0; i < pages; i++) {
    const content = `0 0 1 RG 4 w 50 50 m 790 50 l 790 545 l 50 545 l h S 1 0 0 RG 100 100 m 700 500 l S BT /F1 30 Tf 120 300 Td (${label} ${i + 1}) Tj ET`;
    const c = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

async function findChromium() {
  if (process.env.PDF_RENDER_CHROMIUM_PATH && existsSync(process.env.PDF_RENDER_CHROMIUM_PATH)) return process.env.PDF_RENDER_CHROMIUM_PATH;
  try {
    const { chromium } = await import('playwright');
    const p = chromium.executablePath();
    if (p && existsSync(p)) return p;
  } catch { /* none */ }
  for (const root of ['/opt/pw-browsers', `${process.env.HOME}/.cache/ms-playwright`]) {
    try {
      for (const d of readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
        const p = `${root}/${d}/chrome-linux/chrome`;
        if (existsSync(p)) return p;
      }
    } catch { /* none */ }
  }
  return null;
}

test('pdf.js is available from the existing pdf-parse dependency (no new dependency)', () => {
  assert.ok(pdfJsBuildDir(), 'pdf-parse ships pdf.js v2.0.550');
});

test('REAL page render: a vector drawing becomes a zoomable PNG with its title text; pages bounded', async (t) => {
  const exe = await findChromium();
  if (!exe) return t.skip('no Chromium binary on this machine');
  const r = createChromiumPdfRenderer({ executablePath: exe });
  try {
    const out = await r.render(makeVectorPdf(5), { maxPages: 2, longEdge: 2200 });
    assert.equal(out.numPages, 5);
    assert.equal(out.pages.length, 2, 'bounded pages per document');
    for (const p of out.pages) {
      assert.equal(p.mime, 'image/png');
      assert.equal(p.width, 2200);
      assert.ok(p.height > 1500 && p.height < 1600);
      assert.deepEqual([...p.bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
      assert.ok(p.bytes.length < 8 * 1024 * 1024);
      assert.match(p.text, /TYPICAL FLOOR PLAN BLOCK 03/);
    }
    // Title-block preference picks the matching sheet.
    const pref = await r.render(makeVectorPdf(3, 'SHEET'), { maxPages: 1, preferText: /SHEET 3/ });
    assert.equal(pref.pages[0].page, 3);
    // Broken input fails loudly (caller falls back), never hangs.
    await assert.rejects(r.render(new Uint8Array(Buffer.from('%PDF-1.4 broken')), { maxPages: 1, timeoutMs: 20000 }));
  } finally {
    await r.close();
  }
});

// ─────────────────────────── acquisition wiring ───────────────────────────

function fakePng(w, h, salt) {
  const b = Buffer.alloc(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  b.writeUInt32BE(salt >>> 0, 40);
  return new Uint8Array(b);
}

test('acquire: drawing PDFs are rendered page-by-page with provenance; bounds respected; renderer closed', async () => {
  __resetTasApiCaches();
  const { fetcher } = fixtureFetcher();
  let rendered = 0;
  let closed = 0;
  const factory = () => ({
    async render(_pdf, o) {
      const pages = Array.from({ length: o.maxPages }, (_, i) => ({ page: i + 1, mime: 'image/png', bytes: fakePng(2200, 1555, ++rendered), width: 2200, height: 1555, text: i === 0 ? 'ფასადი — კორპუსი 3' : '' }));
      return { numPages: 9, pages };
    },
    async close() { closed++; },
  });
  const r = await acquireTasApi(FULL, { fetcher, parsePdf: fixturePdfParser, pageSize: 10, minGapMs: 0, concurrency: 4, budgetMs: 120000, renderPdfPages: factory });
  const pages = r.visuals.filter((v) => v.extraction === 'PDF_PAGE_RENDER');
  assert.ok(pages.length >= 1, 'vector drawings now produce images');
  for (const v of pages) {
    assert.ok(v.page >= 1);
    assert.equal(v.mime, 'image/png');
    assert.ok(['FACADE', 'ELEVATION'].includes(v.kind));
    assert.ok(getCachedVisual(v.id));
  }
  assert.deepEqual(pages.find((v) => v.page === 1).identity.blocks, ['03'], 'block read from the sheet label');
  assert.ok(r.visuals.length <= VISUAL_ASSET_MAX);
  assert.equal(closed, 1, 'the headless renderer is closed at the end of the run');
  assert.ok(r.accounting.pagesRendered >= pages.length);

  // Asset bound: visualMax 3 → never more than 3.
  __resetTasApiCaches();
  const b = fixtureFetcher();
  const r2 = await acquireTasApi(FULL, { fetcher: b.fetcher, parsePdf: fixturePdfParser, pageSize: 10, minGapMs: 0, concurrency: 4, budgetMs: 120000, renderPdfPages: factory, visualMax: 3 });
  assert.ok(r2.visuals.length <= 3);

  // A renderer that throws is accounted, never fatal.
  __resetTasApiCaches();
  const c = fixtureFetcher();
  const r3 = await acquireTasApi(FULL, { fetcher: c.fetcher, parsePdf: fixturePdfParser, pageSize: 10, minGapMs: 0, concurrency: 4, budgetMs: 120000, renderPdfPages: () => ({ async render() { throw new Error('boom'); }, async close() {} }) });
  assert.equal(r3.error, null);
  assert.ok(r3.accounting.renderFailures >= 1);
  assert.ok(r3.visuals.length >= 1, 'native images still delivered');
});

// tasTiles.test.mjs — PDF pictures stored as TILES (2026-10-22, job
// 61c1c38c, TAS document 1107725): every gallery asset of that job was a
// 5000×400 slice of one photomontage, so the customer gallery was empty.
//
// Fixtures:
//   - fixtures/tas/tas-tiled-5108620.pdf: a REAL page subset of TAS
//     attachment 5108620 (made by fixtures/tas/makeTiledFixture.mjs; image
//     streams byte-identical — the tile hashes are production asset ids);
//   - synthetic PDFs built here (fake, sized JPEG headers) for the geometry
//     rules: strips, slices, gaps, banners, rotation, Form XObjects, object
//     streams, corrupt streams.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { scanPdfPictures, isCompleteJpeg, STRIP_MAX_ASPECT, TILE_MIN_ASPECT } from '../.tstest-build/workflows/tas/api/pdfTiles.js';
import { extractImagesFromPdf, imageSize } from '../.tstest-build/workflows/tas/api/visuals.js';
import { createChromiumPdfRenderer } from '../.tstest-build/workflows/tas/api/pdfRender.js';
import { acquireTasApi, __resetTasApiCaches, getCachedVisual } from '../.tstest-build/workflows/tas/api/TasApiWorkflow.js';
import { FLAT, FILES, priorityFetcher, priorityPdfParser } from './fixtures/tas/priorityFixture.mjs';
import { fakeJpeg } from './fixtures/tas/tasFixture.mjs';

const REAL = new Uint8Array(readFileSync(new URL('./fixtures/tas/tas-tiled-5108620.pdf', import.meta.url)));
const sha = (b) => createHash('sha256').update(b).digest('hex');
// Production asset ids of job 61c1c38c (result_json.officialVisuals, attachedFileId 5108620).
const PROD_STRIP_IDS = [
  '0f6e0df984bd1dcec3dcf26d97d27e9adce1ee77805875a833732a93d5cd482d',
  '7bcc310041907339a8ecb3c794745d784d8fc51519b12a6fcfdb683d3be04c26',
  'b269e62cf1e3e180656c1aa2dec99c0d6fb01fc86e598c647281aac4f2bf2c0c',
];

// ─────────────────────────── synthetic PDF builder ───────────────────────────

/**
 * pages: [{ size: [w, h], draws: [{ img, cm: [a,b,c,d,e,f], form?: true }] }]
 * img: { w, h, bytes?, cmyk? } — bytes default to a sized fake JPEG.
 */
function buildPdf(pages, { objStm = false, flate = true } = {}) {
  const objs = [];
  const add = (head, data = null) => { objs.push({ head, data }); return objs.length; };
  const catalog = add(null);
  const pagesObj = add(null);
  const kids = [];
  let salt = 1;
  const imgObj = new Map();
  const imageRef = (img) => {
    if (imgObj.has(img)) return imgObj.get(img);
    const bytes = img.bytes ?? fakeJpeg(img.w, img.h, salt++);
    const n = add(`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /${img.cmyk ? 'DeviceCMYK' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>`, Buffer.from(bytes));
    imgObj.set(img, n);
    return n;
  };
  const content = (s) => {
    const body = flate ? deflateSync(Buffer.from(s, 'latin1')) : Buffer.from(s, 'latin1');
    return add(`<< ${flate ? '/Filter /FlateDecode ' : ''}/Length ${body.length} >>`, body);
  };
  const deferred = [];
  for (const p of pages) {
    const xo = [];
    let ops = 'q 0.5 0 0 0.5 0 0 cm 2 0 0 2 0 0 cm\n';
    p.draws.forEach((d, i) => {
      const ref = imageRef(d.img);
      if (d.form) {
        const fs = `q ${d.cm.join(' ')} cm /Im0 Do Q`;
        const f = add(`<< /Type /XObject /Subtype /Form /BBox [0 0 ${p.size.join(' ')}] /Resources << /XObject << /Im0 ${ref} 0 R >> >> /Length ${fs.length} >>`, Buffer.from(fs, 'latin1'));
        xo.push(`/Fm${i} ${f} 0 R`);
        ops += `q /Fm${i} Do Q\n`;
      } else {
        xo.push(`/Im${i} ${ref} 0 R`);
        ops += `q ${d.cm.join(' ')} cm /Im${i} Do Q\n`;
      }
    });
    ops += 'Q\n';
    const c = content(ops);
    const dict = `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${p.size.join(' ')}] /Resources << /XObject << ${xo.join(' ')} >> >> /Contents ${c} 0 R >>`;
    if (objStm) { const n = add(undefined); deferred.push([n, dict]); kids.push(n); } else kids.push(add(dict));
  }
  const catDict = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  const pagesDict = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  if (objStm) {
    // Catalog, page tree and pages live in a compressed object stream (as most modern writers do).
    const inner = [[catalog, catDict], [pagesObj, pagesDict], ...deferred];
    let headTxt = '';
    let body = '';
    for (const [n, d] of inner) { headTxt += `${n} ${body.length} `; body += `${d}\n`; }
    const raw = deflateSync(Buffer.from(headTxt + body, 'latin1'));
    for (const [n] of inner) objs[n - 1] = { skip: true };
    add(`<< /Type /ObjStm /N ${inner.length} /First ${headTxt.length} /Filter /FlateDecode /Length ${raw.length} >>`, raw);
  } else {
    objs[catalog - 1].head = catDict;
    objs[pagesObj - 1].head = pagesDict;
  }
  const parts = [Buffer.from('%PDF-1.7\n', 'latin1')];
  objs.forEach((o, i) => {
    if (o.skip) return;
    parts.push(o.data
      ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${o.head}\nstream\n`, 'latin1'), o.data, Buffer.from('\nendstream\nendobj\n', 'latin1')])
      : Buffer.from(`${i + 1} 0 obj\n${o.head}\nendobj\n`, 'latin1'));
  });
  parts.push(Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'));
  return new Uint8Array(Buffer.concat(parts));
}

/** n horizontal strips (px w×h each) drawn edge to edge, top to bottom, at x, width wPt. */
const stripStack = (n, w, h, { x = 20, top = 800, wPt = 550, gap = 0 } = {}) => {
  const hPt = (wPt * h) / w;
  return Array.from({ length: n }, (_, i) => ({ img: { w, h }, cm: [wPt, 0, 0, hPt, x, top - (i + 1) * hPt - i * gap] }));
};

// ─────────────────────────── the real file ───────────────────────────

test('REAL TAS 5108620: the photomontage tiles are one group, in page order, with their production hashes; the real single picture is kept', () => {
  // The defect, reproduced: the raw extractor returns the slices as pictures.
  const old = extractImagesFromPdf(REAL, { maxImages: 12 });
  assert.equal(old.filter((i) => i.width === 5000 && i.height === 400).length, 3);
  const s = scanPdfPictures(REAL, { maxImages: 12 });
  assert.equal(s.pages, 2);
  assert.equal(s.groups.length, 1);
  const g = s.groups[0];
  assert.equal(g.page, 2);
  assert.equal(g.axis, 'VERTICAL');
  assert.equal(g.stitchable, true);
  assert.deepEqual(g.tiles.map((t) => t.sha256), PROD_STRIP_IDS, 'tiles in page order, hashed exactly as the stored slices were');
  assert.deepEqual(g.tiles.map((t) => [t.width, t.height]), [[5000, 400], [5000, 400], [5000, 400]]);
  // Native resolution, page geometry: 5000 wide, three ~400 px rows.
  assert.equal(g.layout.width, 5000);
  assert.ok(Math.abs(g.layout.height - 1200) <= 3, `height ${g.layout.height}`);
  g.layout.boxes.reduce((y, b) => { assert.equal(b.y, y, 'contiguous'); return b.y + b.h; }, 0);
  // The genuine 1600×960 picture (page 1) is unchanged, byte for byte.
  assert.equal(s.singles.length, 1);
  const one = s.singles[0];
  assert.deepEqual([one.width, one.height, one.page], [1600, 960, 1]);
  assert.equal(sha(one.bytes), sha(old.find((i) => i.width === 1600).bytes));
  assert.equal(s.rejected.tiles, 3);
});

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

test('REAL stitch (headless Chromium): the three real tiles become ONE 5000-px JPEG; the page render fallback works on the same file', async (t) => {
  const exe = await findChromium();
  if (!exe) return t.skip('no Chromium binary on this machine');
  const g = scanPdfPictures(REAL).groups[0];
  const r = createChromiumPdfRenderer({ executablePath: exe });
  try {
    const out = await r.stitch({ tiles: g.tiles.map((x) => ({ bytes: x.bytes, mime: 'image/jpeg' })), layout: g.layout, maxBytes: 8 * 1024 * 1024 });
    const size = imageSize(out.bytes);
    assert.deepEqual([size.mime, size.width, size.height], ['image/jpeg', g.layout.width, g.layout.height]);
    assert.ok(isCompleteJpeg(out.bytes));
    assert.ok(out.bytes.length < 8 * 1024 * 1024);
    assert.ok(Math.max(size.width, size.height) / Math.min(size.width, size.height) <= STRIP_MAX_ASPECT, 'no longer a strip');
    // CMYK / non-JPEG tiles go through the page renderer instead.
    const page = await r.render(REAL, { maxPages: 1, pages: [g.page], longEdge: 2200 });
    assert.equal(page.pages.length, 1);
    assert.equal(page.pages[0].page, 2);
    assert.equal(page.pages[0].width, 2200);
  } finally {
    await r.close();
  }
});

// ─────────────────────────── geometry rules (synthetic) ───────────────────────────

test('synthetic: strips stacked edge to edge are one group; a normal embedded image is returned exactly as before', () => {
  const photo = { w: 1600, h: 1000 };
  const pdf = buildPdf([
    { size: [595, 842], draws: stripStack(4, 2000, 300) },
    { size: [595, 842], draws: [{ img: photo, cm: [500, 0, 0, 312.5, 40, 300] }] },
  ]);
  const s = scanPdfPictures(pdf);
  assert.equal(s.groups.length, 1);
  assert.equal(s.groups[0].tiles.length, 4);
  assert.equal(s.groups[0].page, 1);
  assert.equal(s.groups[0].layout.width, 2000);
  assert.equal(s.groups[0].layout.height, 1200);
  assert.equal(s.singles.length, 1);
  assert.equal(s.singles[0].page, 2);
  const old = extractImagesFromPdf(pdf).find((i) => i.width === 1600);
  assert.equal(sha(s.singles[0].bytes), sha(old.bytes), 'a genuine single image is untouched');
  // Order: top → bottom even when the content stream draws bottom first.
  const rev = scanPdfPictures(buildPdf([{ size: [595, 842], draws: stripStack(4, 2000, 300).reverse() }])).groups[0];
  assert.deepEqual(rev.layout.boxes.map((b) => b.y), [0, 300, 600, 900]);
});

test('synthetic: vertical slices side by side are a HORIZONTAL group', () => {
  const draws = Array.from({ length: 3 }, (_, i) => ({ img: { w: 300, h: 1800 }, cm: [100, 0, 0, 600, 50 + i * 100, 100] }));
  const g = scanPdfPictures(buildPdf([{ size: [595, 842], draws }])).groups;
  assert.equal(g.length, 1);
  assert.equal(g[0].axis, 'HORIZONTAL');
  assert.deepEqual([g[0].layout.width, g[0].layout.height], [900, 1800]);
});

test('synthetic: a gap, a rotation or a different column breaks a group; lone strips are rejected, never kept as pictures', () => {
  const gapped = scanPdfPictures(buildPdf([{ size: [595, 842], draws: stripStack(2, 4000, 400, { gap: 40 }) }]));
  assert.equal(gapped.groups.length, 0);
  assert.equal(gapped.singles.length, 0);
  assert.equal(gapped.rejected.strips, 2, 'two 10:1 strips that cannot be assembled');
  const banner = scanPdfPictures(buildPdf([{ size: [595, 842], draws: [{ img: { w: 3500, h: 400 }, cm: [550, 0, 0, 63, 20, 700] }] }]));
  assert.equal(banner.singles.length, 0);
  assert.equal(banner.rejected.strips, 1);
  const rotated = stripStack(3, 2000, 300).map((d, i) => (i === 1 ? { ...d, cm: [0, d.cm[0], -d.cm[3], 0, d.cm[4] + d.cm[3], d.cm[5]] } : d));
  assert.equal(scanPdfPictures(buildPdf([{ size: [595, 842], draws: rotated }])).groups.length, 0, 'a rotated tile is never stitched');
  const shifted = stripStack(2, 2000, 300).map((d, i) => (i === 1 ? { ...d, cm: [d.cm[0], 0, 0, d.cm[3], d.cm[4] + 60, d.cm[5]] } : d));
  assert.equal(scanPdfPictures(buildPdf([{ size: [595, 842], draws: shifted }])).groups.length, 0);
  // 4:1 images (below the strip threshold) without a neighbour stay pictures.
  const wide = scanPdfPictures(buildPdf([{ size: [595, 842], draws: [{ img: { w: 2000, h: 500 }, cm: [500, 0, 0, 125, 40, 300] }] }]));
  assert.equal(wide.singles.length, 1);
  assert.ok(TILE_MIN_ASPECT < STRIP_MAX_ASPECT);
});

test('synthetic: tiles inside a Form XObject and pages inside an object stream are still found', () => {
  const viaForm = stripStack(3, 2000, 300).map((d) => ({ ...d, form: true }));
  assert.equal(scanPdfPictures(buildPdf([{ size: [595, 842], draws: viaForm }])).groups[0]?.tiles.length, 3);
  const compressed = scanPdfPictures(buildPdf([{ size: [595, 842], draws: stripStack(3, 2000, 300) }], { objStm: true }));
  assert.equal(compressed.pages, 1);
  assert.equal(compressed.groups[0]?.tiles.length, 3);
});

test('synthetic: CMYK tiles are grouped but not stitchable (page render); corrupt and truncated streams are rejected', () => {
  const cmyk = stripStack(3, 2000, 300).map((d) => ({ ...d, img: { ...d.img, cmyk: true } }));
  const g = scanPdfPictures(buildPdf([{ size: [595, 842], draws: cmyk }])).groups[0];
  assert.equal(g.tiles.length, 3);
  assert.equal(g.stitchable, false);
  const truncated = fakeJpeg(1600, 1000, 9).subarray(0, 40);
  const bad = scanPdfPictures(buildPdf([{ size: [595, 842], draws: [{ img: { w: 1600, h: 1000, bytes: truncated }, cm: [500, 0, 0, 312, 40, 300] }] }]));
  assert.equal(bad.singles.length, 0);
  assert.equal(bad.rejected.corrupt, 1);
  assert.equal(isCompleteJpeg(new Uint8Array(0)), false);
  assert.equal(isCompleteJpeg(fakeJpeg(800, 600, 1)), true);
  // Not a PDF at all: nothing, no throw.
  assert.deepEqual(scanPdfPictures(new Uint8Array(Buffer.from('not a pdf'))).singles, []);
});

// ─────────────────────────── acquisition wiring ───────────────────────────

/** Fake JPEG of a size (sized header, SOI/EOI) — what a stitch returns in these tests. */
const stitchedJpeg = (w, h, salt) => new Uint8Array(fakeJpeg(w, h, salt));

function tiledFetcher() {
  const montage = [...FILES.entries()].find(([, f]) => f.name === 'ახალი მონტაჟი.pdf')[0];
  const base = priorityFetcher();
  const fetcher = async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === '/DownloadServlet' && u.searchParams.get('attachedFileId') === montage) {
      return new Response(Buffer.from(REAL), { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
    return base.fetcher(url, init);
  };
  return { fetcher, montage };
}

function renderer({ stitch = true } = {}) {
  const calls = { stitch: 0, render: [] };
  let salt = 0;
  const factory = () => ({
    ...(stitch ? { async stitch(input) { calls.stitch++; return { bytes: stitchedJpeg(input.layout.width, input.layout.height, ++salt), mime: 'image/jpeg', width: input.layout.width, height: input.layout.height }; } } : {}),
    async render(_pdf, o) {
      calls.render.push(o.pages ?? null);
      const pages = (o.pages?.length ? o.pages : [1]).slice(0, o.maxPages).map((p) => ({ page: p, mime: 'image/jpeg', bytes: stitchedJpeg(2200, 1555, 1000 + ++salt), width: 2200, height: 1555, text: '' }));
      return { numPages: 2, pages };
    },
    async close() {},
  });
  return { factory, calls };
}

const OPTS = { parsePdf: priorityPdfParser, minGapMs: 0, concurrency: 3, budgetMs: 120_000 };
const allVisuals = (r) => [...new Map([...r.visuals, ...r.priorityVisuals].map((v) => [v.id, v])).values()];

test('acquire: the real tiled montage yields ONE stitched picture with full provenance — no slice is ever an asset', async () => {
  __resetTasApiCaches();
  const { fetcher, montage } = tiledFetcher();
  const rr = renderer();
  const r = await acquireTasApi(FLAT, { ...OPTS, fetcher, renderPdfPages: rr.factory });
  const mine = allVisuals(r).filter((v) => v.attachedFileId === montage);
  assert.ok(mine.length >= 2, `montage assets: ${mine.length}`);
  for (const v of allVisuals(r)) assert.ok(Math.max(v.width, v.height) / Math.min(v.width, v.height) <= STRIP_MAX_ASPECT, `strip asset ${v.width}×${v.height}`);
  const stitched = mine.filter((v) => v.extraction === 'PDF_TILES_STITCHED');
  assert.equal(new Set(stitched.map((v) => v.id)).size, 1);
  const s = stitched[0];
  assert.deepEqual([s.width, s.height, s.page], [5000, scanPdfPictures(REAL).groups[0].layout.height, 2]);
  assert.deepEqual(s.sourceTiles, PROD_STRIP_IDS);
  assert.equal(s.fileName, 'ახალი მონტაჟი.pdf');
  assert.equal(s.attachedFileId, montage);
  assert.ok(s.documentId);
  assert.equal(s.source, 'TAS');
  assert.equal(s.kind, 'RENDER', 'a montage is a render, never a photograph');
  assert.ok(getCachedVisual(s.id), 'stored bytes are the assembled picture');
  const single = mine.find((v) => v.extraction === 'PDF_EMBEDDED_IMAGE');
  assert.deepEqual([single.width, single.height, single.page], [1600, 960, 1]);
  assert.ok(!allVisuals(r).some((v) => PROD_STRIP_IDS.includes(v.id)), 'a slice reached the gallery');
  assert.ok(r.accounting.tileGroupsStitched >= 1);
  // Duplicates by content: one record per id.
  for (const list of [r.visuals, r.priorityVisuals]) assert.equal(new Set(list.map((v) => v.id)).size, list.length);
});

test('acquire: without stitch the tiled page is rendered (PDF_PAGE_RENDER, page + tiles kept); without any renderer the tiles are dropped and accounted', async () => {
  __resetTasApiCaches();
  const a = tiledFetcher();
  const rr = renderer({ stitch: false });
  const r = await acquireTasApi(FLAT, { ...OPTS, fetcher: a.fetcher, renderPdfPages: rr.factory });
  const page = allVisuals(r).find((v) => v.attachedFileId === a.montage && v.extraction === 'PDF_PAGE_RENDER' && v.sourceTiles);
  assert.ok(page, 'page render fallback');
  assert.equal(page.page, 2);
  assert.deepEqual(page.sourceTiles, PROD_STRIP_IDS);
  assert.ok(rr.calls.render.some((p) => Array.isArray(p) && p.includes(2)));
  assert.ok(r.accounting.tileGroupsPageRendered >= 1);

  __resetTasApiCaches();
  const b = tiledFetcher();
  const r2 = await acquireTasApi(FLAT, { ...OPTS, fetcher: b.fetcher });
  const mine = allVisuals(r2).filter((v) => v.attachedFileId === b.montage);
  assert.deepEqual(mine.map((v) => [v.width, v.height, v.extraction]), [[1600, 960, 'PDF_EMBEDDED_IMAGE']], 'only the genuine picture; no slices');
  assert.ok(r2.accounting.tileGroupsDropped >= 1);
});

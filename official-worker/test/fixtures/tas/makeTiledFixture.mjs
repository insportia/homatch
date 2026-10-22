// makeTiledFixture.mjs — how tas-tiled-5108620.pdf was made (kept for review;
// the tests read the committed PDF, not this script).
//
// Source: ONE public TAS attachment, fetched once on 2026-10-22 from
//   https://docs.tbilisi.gov.ge/DownloadServlet?downloadCase=2&attachedFileId=5108620
// ("მონტაჟი+ განთავსება+ კონსტრუქცია.pdf", TAS document 1107725, 2 473 476
// bytes, 3 pages) — the file behind production job 61c1c38c's 13:1 strips.
//
// The original is 2.4 MB, so only a REAL page subset is committed, built with
// no PDF library (the worker has none that writes PDFs; zlib only):
//   page 1 = original page 2's picture: image object 66 (1600×960 JPEG) at
//            its real composed CTM (text, fonts and optional-content layers
//            dropped);
//   page 2 = original page 3, cut to its first THREE tiles: image objects
//            71, 72, 73 (5000×400 JPEG strips, byte-identical — their sha256
//            are production asset ids 0f6e0df9…, 7bcc3100…, b269e62c…) and the
//            real content stream up to the third tile (cm / clip / Do kept).
// Every image stream is copied byte for byte.
//
// Usage: node makeTiledFixture.mjs <original.pdf> <out.pdf>
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

const [src, dst] = process.argv.slice(2);
const buf = readFileSync(src);
const t = buf.toString('latin1');
const stream = (n) => {
  const i = t.search(new RegExp(`(^|[^0-9])${n} 0 obj`));
  const sk = t.indexOf('stream', i);
  const dict = t.slice(t.indexOf('<<', i), sk).trim();
  const len = Number(/\/Length (\d+)/.exec(dict)[1]);
  let ds = sk + 6;
  if (t[ds] === '\r') ds++;
  if (t[ds] === '\n') ds++;
  return { dict, data: buf.subarray(ds, ds + len) };
};

const page3 = inflateSync(stream(79).data).toString('latin1');
const cut = page3.indexOf('/Image3 Do');
const tilesContent = `${page3.slice(0, page3.indexOf('Q\nQ\n', cut) + 4)}Q\n`;
const pictureContent = '1 0 0 -1 0 595.276 cm\nq\n2.83465 0 0 2.83465 0 0 cm\nq\n280.818 0 0 -168.491 8.11038 189.197 cm\n/Im2 Do\nQ\nQ\n';

const objs = [];
const add = (head, data = null) => { objs.push({ head, data }); return objs.length; };
const img = (n) => { const s = stream(n); return add(s.dict, s.data); };
const flate = (s) => { const d = deflateSync(Buffer.from(s, 'latin1')); return add(`<< /Filter /FlateDecode /Length ${d.length} >>`, d); };

const catalog = add(null);
const pages = add(null);
const im66 = img(66);
const c1 = flate(pictureContent);
const p1 = add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 841.89 595.276] /Resources << /XObject << /Im2 ${im66} 0 R >> >> /Contents ${c1} 0 R >>`);
const tiles = [71, 72, 73].map(img);
const c2 = flate(tilesContent);
const p2 = add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 841.92004 595.32001] /Resources << /XObject << ${tiles.map((o, i) => `/Image${i + 1} ${o} 0 R`).join(' ')} >> >> /Contents [${c2} 0 R] >>`);
objs[catalog - 1].head = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
objs[pages - 1].head = `<< /Type /Pages /Kids [${p1} 0 R ${p2} 0 R] /Count 2 >>`;

const parts = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
let off = parts[0].length;
const offs = [];
objs.forEach((o, i) => {
  offs.push(off);
  const chunk = o.data
    ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${o.head}\nstream\n`, 'latin1'), o.data, Buffer.from('\nendstream\nendobj\n', 'latin1')])
    : Buffer.from(`${i + 1} 0 obj\n${o.head}\nendobj\n`, 'latin1');
  parts.push(chunk);
  off += chunk.length;
});
parts.push(Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${off}\n%%EOF\n`, 'latin1'));
writeFileSync(dst, Buffer.concat(parts));

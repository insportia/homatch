// FILES A CUSTOMER CAN KEEP: A ZIP OF IMAGES AND A PDF PRESENTATION.
//
// Two small writers, no dependency:
//
//   zipStore()      a standard ZIP with STORED entries. The contents are
//                   JPEGs, which do not compress further; storing them keeps
//                   the writer tiny and every archive tool opens it.
//   pdfFromJpegs()  a PDF whose pages are JPEG images. The presentation's
//                   pages are drawn by the browser (so Georgian, Arabic and
//                   Hebrew text render with real fonts) and embedded as-is —
//                   no font subsetting, no re-encoding.
//
// Both are pure and byte-exact, so they are tested by reading their output
// back.

const encoder = new TextEncoder();

let CRC_TABLE: Uint32Array | null = null;
export function crc32(data: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry { name: string; data: Uint8Array }

/** A ZIP archive (stored, UTF-8 names), fixed timestamp for reproducible bytes. */
export function zipStore(entries: ZipEntry[]): Uint8Array {
  const DOS_TIME = 0; // 00:00:00
  const DOS_DATE = (2026 - 1980) << 9 | 1 << 5 | 1; // 2026-01-01
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, entry.data.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    parts.push(local, entry.data);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, entry.data.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd);
    offset += local.length + entry.data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return concat([...parts, ...central, end]);
}

/** Width and height from a JPEG's SOF marker, or null when it is not a JPEG. */
export function jpegSize(data: Uint8Array): { width: number; height: number } | null {
  if (data[0] !== 0xff || data[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < data.length) {
    if (data[i] !== 0xff) { i += 1; continue; }
    const marker = data[i + 1];
    const len = (data[i + 2] << 8) | data[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: (data[i + 5] << 8) | data[i + 6], width: (data[i + 7] << 8) | data[i + 8] };
    }
    i += 2 + len;
  }
  return null;
}

/**
 * A PDF with one full-bleed JPEG per page. `pageSize` is in points; each
 * image is scaled to fill its page (the pages are drawn at the page's aspect).
 */
export function pdfFromJpegs(pages: Uint8Array[], pageSize: [number, number] = [842, 595], title = 'HOMATCH Design Studio'): Uint8Array {
  const [pw, ph] = pageSize;
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (bytes: Uint8Array) => { chunks.push(bytes); length += bytes.length; };
  const text = (s: string) => push(encoder.encode(s));
  const object = (id: number, body: () => void) => { offsets[id] = length; text(`${id} 0 obj\n`); body(); text('\nendobj\n'); };

  const n = pages.length;
  // Objects: 1 catalog, 2 pages, 3 info, then per page: page, content, image.
  const pageId = (i: number) => 4 + i * 3;
  text('%PDF-1.4\n%âãÏÓ\n');
  object(1, () => text('<< /Type /Catalog /Pages 2 0 R >>'));
  object(2, () => text(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`));
  const safeTitle = title.replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '');
  object(3, () => text(`<< /Title (${safeTitle}) /Producer (HOMATCH Design Studio) >>`));
  pages.forEach((jpeg, i) => {
    const size = jpegSize(jpeg);
    if (!size) throw new Error(`page ${i + 1} is not a JPEG`);
    const id = pageId(i);
    object(id, () => text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im${i} ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`));
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im${i} Do Q`;
    object(id + 1, () => text(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    object(id + 2, () => {
      text(`<< /Type /XObject /Subtype /Image /Width ${size.width} /Height ${size.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
      push(jpeg);
      text('\nendstream');
    });
  });
  const xref = length;
  const count = 4 + n * 3;
  text(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id += 1) text(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  text(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return concat(chunks);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** A filename-safe, ASCII slug; non-Latin names fall back to `fallback`. */
export function fileSlug(name: string, fallback = 'design'): string {
  const slug = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return slug || fallback;
}

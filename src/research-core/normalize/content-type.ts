export type ContentKind = 'HTML' | 'JSON' | 'XML' | 'PDF' | 'TEXT' | 'IMAGE' | 'BINARY' | 'UNKNOWN';

export interface ContentTypeInfo {
  kind: ContentKind;
  mime: string | null;
  charset: string | null;
  /** True when the kind came from sniffing rather than the header. */
  sniffed: boolean;
}

export function parseContentTypeHeader(header: string | null | undefined): {
  mime: string | null;
  charset: string | null;
} {
  if (!header) return { mime: null, charset: null };
  const [mimePart, ...params] = header.split(';');
  const mime = (mimePart ?? '').trim().toLowerCase() || null;
  let charset: string | null = null;
  for (const param of params) {
    const [key, value] = param.split('=');
    if ((key ?? '').trim().toLowerCase() === 'charset') {
      charset = (value ?? '').trim().replace(/^["']|["']$/g, '').toLowerCase() || null;
    }
  }
  return { mime, charset };
}

export function kindFromMime(mime: string | null): ContentKind {
  if (!mime) return 'UNKNOWN';
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'HTML';
  if (mime === 'application/json' || mime.endsWith('+json')) return 'JSON';
  if (mime === 'application/pdf') return 'PDF';
  if (mime === 'text/xml' || mime === 'application/xml' || mime.endsWith('+xml')) return 'XML';
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('text/')) return 'TEXT';
  return 'BINARY';
}

/**
 * Detect content type from the header, falling back to sniffing the body.
 * Servers mislabel HTML as text/plain often enough that trusting the header
 * alone loses real evidence.
 */
export function detectContentType(header: string | null | undefined, body?: string): ContentTypeInfo {
  const { mime, charset } = parseContentTypeHeader(header);
  const declared = kindFromMime(mime);

  if (declared !== 'UNKNOWN' && declared !== 'TEXT' && declared !== 'BINARY') {
    return { kind: declared, mime, charset, sniffed: false };
  }

  if (body !== undefined) {
    const sniffed = sniffBody(body);
    if (sniffed !== 'UNKNOWN') return { kind: sniffed, mime, charset, sniffed: true };
  }

  return { kind: declared, mime, charset, sniffed: false };
}

export function sniffBody(body: string): ContentKind {
  const head = body.slice(0, 512).trimStart();
  if (!head) return 'UNKNOWN';
  if (head.startsWith('%PDF-')) return 'PDF';
  if (/^<!doctype\s+html/i.test(head) || /^<html[\s>]/i.test(head)) return 'HTML';
  if (/^<\?xml/i.test(head)) return 'XML';
  if (head.startsWith('{') || head.startsWith('[')) {
    try {
      JSON.parse(body);
      return 'JSON';
    } catch {
      // Looks like JSON but is not; fall through.
    }
  }
  if (/<(?:html|head|body|div|meta|script)[\s>]/i.test(head)) return 'HTML';
  return 'TEXT';
}

export function isParseable(kind: ContentKind): boolean {
  return kind === 'HTML' || kind === 'JSON' || kind === 'XML' || kind === 'TEXT' || kind === 'PDF';
}

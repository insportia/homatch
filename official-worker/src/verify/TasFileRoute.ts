// TasFileRoute.ts — ONE official TAS attachment, streamed to HOMATCH's own
// edge function so a customer never depends on a raw DownloadServlet link.
//
// Why this exists: docs.tbilisi.gov.ge answers the same DownloadServlet URL
// with "Access Denied" to many customer browsers, while the worker (server
// side, polite, no cookies) downloads it fine. research-agent's
// `document_file` action asks this route for ONE file, verifies it belongs to
// the caller's report, caches it in private storage and hands the customer a
// short-lived signed URL.
//
// Guarantees:
//   - token-only (WORKER_TOKEN): a signed-in Supabase user is NOT accepted,
//     so no browser can use the worker as a TAS fetcher;
//   - one numeric attachedFileId per call, nothing else is addressable;
//   - bounded bytes (30 MB default), bounded time, one retry on transient
//     failures, and a polite global gap between TAS requests (all callers
//     share one serial lane), so a burst of clicks never hammers TAS;
//   - only real files leave: the body is sniffed (PDF / JPEG / PNG / other
//     binary) and an HTML page (an "Access Denied" or error page) is refused;
//   - logs carry the id, status, bytes and timing — never the token.

import { TasApiClient, TasDeadline, TasPayloadTooLarge, TAS_PUBLIC, attachmentUrl } from '../workflows/tas/api/TasApiClient.js';

export const TAS_FILE_MAX_BYTES = 30 * 1024 * 1024;
const ID = /^\d{1,12}$/;

export type SniffedKind = 'pdf' | 'jpg' | 'png' | 'html' | 'other';

/** What the bytes actually are, independent of what the server claims. */
export function sniffFile(bytes: Uint8Array, contentType: string | null): SniffedKind {
  const b = bytes;
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 512)).trimStart().toLowerCase();
  if (/^<(!doctype|html|head|body|\?xml)/.test(head) || /text\/html/i.test(contentType ?? '')) return 'html';
  return 'other';
}

export const MIME: Record<Exclude<SniffedKind, 'html'>, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
  other: 'application/octet-stream',
};

export interface TasFileOptions {
  fetcher?: typeof fetch;
  /** Minimum gap between two TAS downloads, across all callers. */
  minGapMs?: number;
  maxBytes?: number;
  timeoutMs?: number;
  now?: () => number;
}

export type TasFileResult =
  | { ok: true; kind: Exclude<SniffedKind, 'html'>; mime: string; bytes: Uint8Array; durationMs: number }
  | { ok: false; status: number; error: 'bad_id' | 'too_large' | 'upstream' | 'not_a_file' | 'timeout' };

/**
 * The fetcher behind the route: a serial lane (one TAS download at a time,
 * spaced by minGapMs) and an in-flight map so two clicks on the same file
 * share one download.
 */
export function createTasFileFetcher(o: TasFileOptions = {}) {
  const now = o.now ?? Date.now;
  let lane: Promise<unknown> = Promise.resolve();
  let lastStart = 0;
  const inflight = new Map<string, Promise<TasFileResult>>();

  const run = async (id: string): Promise<TasFileResult> => {
    const gap = o.minGapMs ?? 1000;
    const wait = lastStart + gap - now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastStart = now();
    const client = new TasApiClient({
      fetcher: o.fetcher,
      deadlineAt: now() + (o.timeoutMs ?? 60_000),
      concurrency: 1,
      minGapMs: 0,
      retries: 1,
      timeoutMs: o.timeoutMs ?? 45_000,
      maxBytes: o.maxBytes ?? TAS_FILE_MAX_BYTES,
    });
    try {
      const r = await client.request(attachmentUrl(id), { headers: { Referer: `${TAS_PUBLIC.origin}/architect/public.html` } });
      if (r.status < 200 || r.status >= 300) return { ok: false, status: 502, error: 'upstream' };
      if (!r.bytes.length) return { ok: false, status: 502, error: 'not_a_file' };
      const kind = sniffFile(r.bytes, r.contentType);
      if (kind === 'html') return { ok: false, status: 502, error: 'not_a_file' };
      return { ok: true, kind, mime: MIME[kind], bytes: r.bytes, durationMs: r.durationMs };
    } catch (e) {
      if (e instanceof TasPayloadTooLarge) return { ok: false, status: 413, error: 'too_large' };
      if (e instanceof TasDeadline || (e as { name?: string })?.name === 'TimeoutError') return { ok: false, status: 504, error: 'timeout' };
      return { ok: false, status: 502, error: 'upstream' };
    }
  };

  return (attachedFileId: string): Promise<TasFileResult> => {
    const id = String(attachedFileId ?? '').trim();
    if (!ID.test(id)) return Promise.resolve({ ok: false, status: 400, error: 'bad_id' });
    const existing = inflight.get(id);
    if (existing) return existing;
    const p = lane.then(() => run(id));
    lane = p.catch(() => undefined);
    inflight.set(id, p);
    void p.finally(() => inflight.delete(id));
    return p;
  };
}

export function mountTasFileRoutes(app: any, options: { token: string } & TasFileOptions) {
  const fetchFile = createTasFileFetcher(options);
  const tokenOnly = (req: any, res: any, next: any) => {
    const header = String(req.headers.authorization || '');
    if (options.token && header === `Bearer ${options.token}`) return next();
    return res.status(401).json({ error: 'unauthorized' });
  };
  const handle = async (req: any, res: any) => {
    const id = String(req.query?.attachedFileId ?? req.body?.attachedFileId ?? '');
    const started = Date.now();
    const r = await fetchFile(id);
    console.log(JSON.stringify({ at: new Date().toISOString(), service: 'tas-file', id: ID.test(id) ? id : null, ok: r.ok, status: r.ok ? 200 : r.status, error: r.ok ? null : r.error, kind: r.ok ? r.kind : null, bytes: r.ok ? r.bytes.length : 0, ms: Date.now() - started }));
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    res.setHeader('Content-Type', r.mime);
    res.setHeader('X-Tas-File-Kind', r.kind);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(Buffer.from(r.bytes as any));
  };
  app.get('/verify/tas-file', tokenOnly, handle);
  app.post('/verify/tas-file', tokenOnly, handle);
}

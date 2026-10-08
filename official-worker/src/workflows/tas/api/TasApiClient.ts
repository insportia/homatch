// TasApiClient.ts — the polite HTTP client for TAS's public DWR application
// (docs.tbilisi.gov.ge/architect). No browser, no CAPTCHA handling, no
// authentication: these are the same public calls the public page makes.
//
// Politeness is part of correctness here: bounded concurrency, a minimum gap
// between requests, timeouts, limited retries on transient failures only,
// and a hard run deadline. A government server is never hammered to make a
// report a few seconds faster.

import { bytesToBuffer } from './tasModel.js';
import { parseDwrReply, serializeDwrCall, dwr, type DwrParam, type DwrValue } from './dwr.js';

export const TAS_PUBLIC = {
  origin: 'https://docs.tbilisi.gov.ge',
  shellUrl: 'https://tas.ge/?p=searchdocument&menuItemId=7104',
  publicPage: '/architect/publicInformation.html',
  searchPath: '/architect/dwr/call/plaincall/DocumentManager.getDocsForPublicInfo.dwr',
  detailPath: '/architect/dwr/call/plaincall/UserMethods.getUserDocumentLastMotion.dwr',
  responsePath: '/NewArchitectureResponse',
  downloadPath: '/DownloadServlet',
  applicationId: 2,
  docStatusIds: [1, 2, 5, 6, 7, 9, 11, 12, 20, 21, 25, 26, 27, 28],
} as const;

export const responseUrl = (documentId: string, motionId: string): string =>
  `${TAS_PUBLIC.origin}${TAS_PUBLIC.responsePath}?documentId=${encodeURIComponent(documentId)}&motionId=${encodeURIComponent(motionId)}`;
export const attachmentUrl = (attachedFileId: string): string =>
  `${TAS_PUBLIC.origin}${TAS_PUBLIC.downloadPath}?downloadCase=2&attachedFileId=${encodeURIComponent(attachedFileId)}`;
export const publicDocumentUrl = (documentId: string): string =>
  `${TAS_PUBLIC.origin}/architect/public.html?docId=${encodeURIComponent(documentId)}`;

/**
 * The search criteria object EXACTLY as the public page sends it — field
 * set, order, empty strings, nulls, and paging inside the object. Source:
 * the locally live-verified tas-worker contract (TASK.md "KNOWN VERIFIED
 * SEARCH CONTRACT" / "DWR BODY"). `ext-gen1020` is an ExtJS field the page
 * posts empty; it is kept so the body matches the verified one byte-for-byte
 * in shape rather than "probably equivalent".
 */
export const TAS_PAGE_SIZE = 25;

export function searchParams(cadastral: string, start: number, limit: number): DwrParam[] {
  return [
    dwr.obj({
      documentNo: dwr.str(''),
      responseMotionId: dwr.str(''),
      commissionMotionId: dwr.str(''),
      naprCadCode: dwr.str(cadastral),
      fromDate: dwr.nil(),
      toDate: dwr.nil(),
      responseFromDate: dwr.nil(),
      responseToDate: dwr.nil(),
      authorFirstName: dwr.str(''),
      authorLastName: dwr.str(''),
      architectName: dwr.str(''),
      'ext-gen1020': dwr.str(''),
      applicationId: dwr.num(TAS_PUBLIC.applicationId),
      docStatusIds: dwr.arr(TAS_PUBLIC.docStatusIds.map((n) => dwr.num(n))),
      start: dwr.num(start),
      limit: dwr.num(limit),
    }),
  ];
}

export interface HttpResult {
  status: number;
  contentType: string | null;
  bytes: Uint8Array;
  durationMs: number;
}

export interface TasClientOptions {
  fetcher?: typeof fetch;
  deadlineAt: number;
  concurrency?: number;
  minGapMs?: number;
  timeoutMs?: number;
  retries?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

export class TasDeadline extends Error {
  constructor() {
    super('TAS_API_DEADLINE');
  }
}

export class TasApiClient {
  private fetcher: typeof fetch;
  private active = 0;
  private waiters: Array<() => void> = [];
  private lastStart = 0;
  private batch = 0;
  readonly stats = { requests: 0, retries: 0, bytes: 0, failures: 0 };

  constructor(private o: TasClientOptions) {
    this.fetcher = o.fetcher ?? fetch;
  }

  remainingMs(): number {
    return this.o.deadlineAt - Date.now();
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    const max = Math.max(1, this.o.concurrency ?? 3);
    if (this.active >= max) await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
    try {
      const gap = this.o.minGapMs ?? 250;
      const wait = this.lastStart + gap - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastStart = Date.now();
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }

  async request(url: string, init: RequestInit = {}): Promise<HttpResult> {
    const retries = this.o.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      if (this.remainingMs() < 2000) throw new TasDeadline();
      this.o.signal?.throwIfAborted();
      try {
        const r = await this.slot(() => this.once(url, init));
        if ((r.status === 429 || r.status >= 500) && attempt < retries) {
          this.stats.retries++;
          await new Promise((res) => setTimeout(res, 800 * 2 ** attempt));
          continue;
        }
        return r;
      } catch (e) {
        if (e instanceof TasDeadline) throw e;
        if (attempt >= retries) {
          this.stats.failures++;
          throw e;
        }
        this.stats.retries++;
        await new Promise((res) => setTimeout(res, 800 * 2 ** attempt));
      }
    }
  }

  private async once(url: string, init: RequestInit): Promise<HttpResult> {
    const started = Date.now();
    this.stats.requests++;
    const timeout = Math.max(1000, Math.min(this.o.timeoutMs ?? 30000, this.remainingMs() - 1000));
    const signals = [AbortSignal.timeout(timeout), ...(this.o.signal ? [this.o.signal] : [])];
    const res = await this.fetcher(url, {
      ...init,
      redirect: 'follow',
      signal: AbortSignal.any(signals),
      headers: { 'User-Agent': 'HOMATCH-Verify/1.0 (+https://homatch.live)', ...(init.headers as any) },
    });
    const max = this.o.maxBytes ?? 40 * 1024 * 1024;
    const declared = Number(res.headers.get('content-length') ?? NaN);
    if (Number.isFinite(declared) && declared > max) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      throw new Error(`TAS_PAYLOAD_TOO_LARGE ${declared}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > max) throw new Error(`TAS_PAYLOAD_TOO_LARGE ${buf.length}`);
    this.stats.bytes += buf.length;
    return { status: res.status, contentType: res.headers.get('content-type'), bytes: buf, durationMs: Date.now() - started };
  }

  async dwrCall(path: string, scriptName: string, methodName: string, params: DwrParam[], page: string = TAS_PUBLIC.publicPage): Promise<{ data: DwrValue; objectCount: number }> {
    this.batch += 1;
    // Stateless: no cookies, empty httpSessionId/scriptSessionId — the server
    // creates its own DWR script session (live-verified).
    const body = serializeDwrCall({ scriptName, methodName, params }, { page, batchId: this.batch });
    const r = await this.request(`${TAS_PUBLIC.origin}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Referer: `${TAS_PUBLIC.origin}${page}` },
      body,
    });
    if (r.status < 200 || r.status >= 300) throw new Error(`TAS_DWR_HTTP_${r.status}`);
    const reply = parseDwrReply(bytesToBuffer(r.bytes).toString('utf8'));
    if (!reply.ok) throw new Error(`TAS_DWR_EXCEPTION ${reply.exception?.javaClassName ?? ''} ${reply.exception?.message ?? ''}`.trim());
    return { data: reply.data, objectCount: reply.objectCount };
  }

  search(cadastral: string, start: number, limit: number) {
    return this.dwrCall(TAS_PUBLIC.searchPath, 'DocumentManager', 'getDocsForPublicInfo', searchParams(cadastral, start, limit));
  }

  /** Verified form: `c0-param0=string:<id>`, page `/architect/public.html?docId=<id>`. */
  detail(documentId: string) {
    return this.dwrCall(TAS_PUBLIC.detailPath, 'UserMethods', 'getUserDocumentLastMotion', [dwr.str(String(documentId))], `/architect/public.html?docId=${documentId}`);
  }
}

// gateway.ts — the worker's client for the verify-queue edge function.
//
// Every call is a short POST with the worker token. Transient failures
// (network, 5xx) are retried with jittered backoff; anything else surfaces.
// The worker holds no database credential: all locking and fencing happen in
// Postgres behind this function.

export type Lane = 'HTTP' | 'BROWSER';

export interface QueueTask {
  id: string;
  jobId: string;
  source: string;
  lane: Lane;
  dedupeKey: string;
  scopeKey: string | null;
  input: Record<string, any>;
  state: string;
  attempts: number;
  maxAttempts: number;
  fencingToken: number;
  leaseSeconds: number;
}

export interface EvidenceRef {
  sha256: string;
  path: string;
  chars: number;
  contentType: 'text/plain' | 'application/json';
  documentId?: string | null;
  title?: string | null;
}

export interface GatewayOptions {
  url: string;
  token: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class QueueGateway {
  private readonly url: string;
  private readonly token: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(o: GatewayOptions) {
    this.url = o.url.replace(/\/+$/, '');
    this.token = o.token;
    this.fetcher = o.fetcher ?? fetch;
    this.timeoutMs = o.timeoutMs ?? 20_000;
    this.retries = o.retries ?? 3;
    this.sleep = o.sleep ?? wait;
  }

  async call<T = any>(action: string, body: Record<string, unknown> = {}): Promise<T> {
    let last: unknown = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const r = await this.fetcher(this.url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...body }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const text = await r.text();
        let data: any = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = null;
        }
        if (r.ok) return data as T;
        if (r.status < 500 && r.status !== 429) throw Object.assign(new Error(`verify-queue ${action}: HTTP ${r.status} ${data?.error ?? ''}`), { fatal: true });
        last = new Error(`verify-queue ${action}: HTTP ${r.status}`);
      } catch (e) {
        if ((e as any)?.fatal) throw e;
        last = e;
      }
      if (attempt < this.retries) await this.sleep(Math.min(8_000, 500 * 2 ** attempt) * (0.5 + Math.random()));
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  claim(worker: string, lanes: Lane[], limit: number): Promise<{ tasks: QueueTask[] }> {
    return this.call('claim', { worker, lanes, limit });
  }
  heartbeat(t: QueueTask): Promise<{ state: 'OK' | 'LOST' | 'CANCEL' }> {
    return this.call('heartbeat', { id: t.id, token: t.fencingToken });
  }
  complete(t: QueueTask, p: { result: unknown; evidenceRefs?: EvidenceRef[]; contentHash?: string | null; cacheScope?: string | null }) {
    return this.call<{ ok: boolean; reason?: string }>('complete', { id: t.id, token: t.fencingToken, ...p });
  }
  fail(t: QueueTask, error: string, retryable = true, retryAfterSeconds: number | null = null) {
    return this.call<{ ok: boolean; state?: string }>('fail', { id: t.id, token: t.fencingToken, error, retryable, retryAfterSeconds });
  }
  release(t: QueueTask) {
    return this.call<{ released: boolean }>('release', { id: t.id, token: t.fencingToken });
  }
  delegate(t: QueueTask, scopeKey: string, input?: Record<string, unknown>) {
    return this.call<{ ok: boolean; outcome?: 'CACHE' | 'SHARED' | 'PRODUCE'; reason?: string }>('delegate', { id: t.id, token: t.fencingToken, scopeKey, input });
  }
  captcha(events: Array<Record<string, unknown>>) {
    return this.call<{ recorded: number }>('captcha', { events });
  }

  /** Content-addressed upload of a complete document to the private bucket. */
  async upload(sha256: string, contentType: EvidenceRef['contentType'] | 'image/jpeg' | 'image/png', body: string | Uint8Array): Promise<string> {
    const r = await this.call<{ path: string; exists: boolean; signedUrl?: string | null }>('upload', { sha256, contentType });
    if (r.exists || !r.signedUrl) return r.path;
    const put = await this.fetcher(r.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, 'x-upsert': 'false' },
      body: body as any,
      signal: AbortSignal.timeout(60_000),
    });
    if (!put.ok && put.status !== 409) throw new Error(`evidence upload failed: HTTP ${put.status}`);
    return r.path;
  }
}

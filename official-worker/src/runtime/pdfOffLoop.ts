// PDF PARSING OFF THE EVENT LOOP — pdf-parse is synchronous CPU work; in-process it held AI TALK's
// speech frame relay for 41–284 ms per document (measured 2026-10-18, 20–200 pages). Parses run in
// a small pool of worker threads (PDF_PARSE_THREADS, default 2) with a per-parse timeout; a thread
// that times out or dies is replaced. If threads cannot start, the same code runs in-process.
import { existsSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { Worker } from 'node:worker_threads';
// @ts-ignore -- plain JavaScript module shared with the worker thread
import { parseIn } from './pdfParseCore.mjs';

export type PdfMode = 'default' | 'pages';
export interface PdfText { text: string; numpages: number; info?: any; pages?: string[] }

const THREAD_PATH = fileURLToPath(new URL('./pdfParseThread.mjs', import.meta.url));
const TIMEOUT_MS = Math.max(5_000, Number(process.env.PDF_PARSE_TIMEOUT_MS) || 120_000);
const SIZE = Math.min(8, Math.max(1, Math.trunc(Number(process.env.PDF_PARSE_THREADS) || 2)));

interface Slot { worker: Worker; busy: boolean }
interface Pending { resolve: (v: PdfText) => void; reject: (e: Error) => void; timer: NodeJS.Timeout; slot: Slot }

const slots: Slot[] = [];
const waiting: Array<() => void> = [];
const pending = new Map<number, Pending>();
let nextId = 1;
let threadsUsable = existsSync(THREAD_PATH);
export const stats = { threaded: 0, inProcess: 0, timeouts: 0, replaced: 0 };

function spawn(): Slot {
  const slot: Slot = { worker: new Worker(THREAD_PATH), busy: false };
  slot.worker.on('message', (m: { id: number; ok: boolean; result?: PdfText; error?: string }) => {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    release(slot);
    if (m.ok) p.resolve(m.result as PdfText); else p.reject(new Error(m.error || 'PDF_PARSE_FAILED'));
  });
  slot.worker.on('error', (e) => fail(slot, e instanceof Error ? e : new Error(String(e))));
  slot.worker.on('exit', () => fail(slot, new Error('PDF_PARSE_THREAD_EXITED')));
  /* After the listeners: attaching a 'message' listener re-references the port. An idle pool never
     keeps the process alive. */
  slot.worker.unref();
  return slot;
}

function fail(slot: Slot, error: Error) {
  for (const [id, p] of pending) if (p.slot === slot) { pending.delete(id); clearTimeout(p.timer); p.reject(error); }
  const i = slots.indexOf(slot);
  if (i >= 0) { slots.splice(i, 1); stats.replaced++; }
  waiting.shift()?.();
}

function release(slot: Slot) { slot.busy = false; waiting.shift()?.(); }

async function acquire(): Promise<Slot> {
  for (;;) {
    const free = slots.find((s) => !s.busy);
    if (free) { free.busy = true; return free; }
    if (slots.length < SIZE) { const s = spawn(); slots.push(s); s.busy = true; return s; }
    await new Promise<void>((r) => waiting.push(r));
  }
}

/** Parse a PDF without blocking the event loop. Same result shape as the in-process parser. */
export async function parsePdfOffLoop(bytes: Buffer, mode: PdfMode = 'default'): Promise<PdfText> {
  if (!threadsUsable) { stats.inProcess++; return parseIn(mode, bytes); }
  let slot: Slot;
  try { slot = await acquire(); } catch { threadsUsable = false; stats.inProcess++; return parseIn(mode, bytes); }
  stats.threaded++;
  const id = nextId++;
  /* A copy is transferred: the caller keeps its own buffer. */
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Promise<PdfText>((resolve, reject) => {
    const timer = setTimeout(() => {
      stats.timeouts++;
      pending.delete(id);
      reject(new Error('PDF_PARSE_TIMEOUT'));
      void slot.worker.terminate(); // 'exit' replaces the thread
    }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer, slot });
    slot.worker.postMessage({ id, mode, bytes: copy }, [copy.buffer]);
  });
}

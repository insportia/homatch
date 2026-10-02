// HOMATCH DESIGN STUDIO — an object edit's pixels, inside the edge's memory.
//
// Production (v19): a 2400×1504 edit was killed by the edge runtime's memory
// limit (113 MB, 99 MB of it image buffers) after OpenAI answered. The old path
// held the decoded picture, the decoded id picture, both compressed files, the
// request PNG, the answer's bytes, the decoded answer and a full composited copy
// at once. Here each is released as soon as nothing needs it, and the answer is
// composited into the picture already decoded. Same pixels, same resolution,
// same check, same request — only the lifetimes change.
//
// The codec and the provider are injected (the edge passes its npm codecs; tests
// pass real PNG bytes), and `probe` lets a test measure what is alive at each
// stage. It also holds the recovery rule for an edit whose worker died.

import { checkEdit, compositeInsideMaskInto, maskFromIds, resizeMask, rgbToGray, type CheckResult, type GrayPixels, type RgbPixels } from './renderCheck.ts';
import type { EditMask, ImageResult } from './imageProviders.ts';

export type EditStage = 'read' | 'decoded' | 'mask' | 'requested' | 'answered' | 'result' | 'checked' | 'composited' | 'encoded';

type Decoded = { ok: true; img: RgbPixels } | { ok: false; reason: string };
/** The provider's answer without its bytes (what the record and the money need). */
export type AnswerMeta = Omit<Extract<ImageResult, { ok: true }>, 'bytes'> | Extract<ImageResult, { ok: false }>;

export interface EditIo {
  readImage(): Promise<Uint8Array | null>;
  readIds(): Promise<Uint8Array | null>;
  decode(bytes: Uint8Array): Decoded;
  /** RGBA bytes of a picture (no copy when it already is RGBA). */
  rgba(img: RgbPixels): Uint8Array;
  encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array;
  edit(input: { image: { bytes: Uint8Array; mime: 'image/png' }; mask: EditMask; size: { width: number; height: number } }): Promise<ImageResult>;
  probe?(stage: EditStage): void;
}

export type EditOutcome =
  | { ok: true; png: Uint8Array; check: CheckResult; result: AnswerMeta; checkMs: number }
  | { ok: false; code: string; status: number; finishReason: string | null; check: CheckResult | null; result: AnswerMeta | null };

const EMPTY = new Uint8Array(0);

const failed = (code: string, status: number, extra: Partial<Extract<EditOutcome, { ok: false }>> = {}): EditOutcome =>
  ({ ok: false, code, status, finishReason: null, check: null, result: null, ...extra });

/**
 * The edit: mask from the id picture, the masked request, the structure check,
 * the answer pasted inside the mask only, the final PNG. Failure codes and their
 * order are the handler's (PICTURE_UNREADABLE, TARGET_NOT_VISIBLE, the provider's
 * error, EDIT_<decode reason>, EDIT_REFUSED).
 */
export async function editPixels(io: EditIo, targetColor: string): Promise<EditOutcome> {
  const probe = io.probe ?? (() => {});
  // An awaited value stays reachable from the suspended function after it resumes, so the
  // containers are emptied, not only our names for what they hold.
  const reads: Array<Uint8Array | null> = await Promise.all([io.readImage(), io.readIds()]);
  let imgBytes = reads[0]; let idBytes = reads[1];
  reads.fill(null);
  probe('read');
  let img: Decoded | null = imgBytes ? io.decode(imgBytes) : null;
  imgBytes = null;
  let ids: Decoded | null = idBytes ? io.decode(idBytes) : null;
  idBytes = null;
  probe('decoded');
  if (!img?.ok || !ids?.ok) return failed('PICTURE_UNREADABLE', 422);
  // The mask is all the id picture is needed for.
  const raw = maskFromIds(ids.img, targetColor, 2);
  ids = null;
  if (!raw.pixels) return failed('TARGET_NOT_VISIBLE', 422);
  const picture = img.img;
  img = null;
  const { width, height } = picture;
  const mask: EditMask = raw.width === width && raw.height === height ? raw : { width, height, data: resizeMask(raw, width, height) };
  probe('mask');

  // The image goes as PNG: OpenAI requires the image and its mask in the same format and size.
  // The request keeps its own copy (a Blob) while it is in flight; ours is not needed after it.
  let png: Uint8Array | null = io.encodePng(io.rgba(picture), width, height);
  let pending: Promise<ImageResult> | null = io.edit({ image: { bytes: png, mime: 'image/png' }, mask, size: { width, height } });
  png = null;
  probe('requested');
  let answer: ImageResult | null = await pending;
  pending = null; // a settled promise keeps its value (the answer and its bytes) alive
  probe('answered');
  if (!answer.ok) return failed(answer.error, 502, { finishReason: answer.error, result: answer });
  let bytes: Uint8Array | null = answer.bytes;
  const meta: AnswerMeta = {
    ok: true, provider: answer.provider, model: answer.model, mime: answer.mime, usage: answer.usage, cost: answer.cost, ms: answer.ms, requestId: answer.requestId,
  };
  (answer as { bytes: Uint8Array }).bytes = EMPTY;
  answer = null;
  let out: Decoded | null = io.decode(bytes);
  bytes = null;
  if (!out.ok) return failed(`EDIT_${out.reason}`, 502, { finishReason: `EDIT_${out.reason}`, result: meta });
  let edited: RgbPixels | null = out.img;
  out = null;
  probe('result');

  const c0 = Date.now();
  let before: GrayPixels | null = rgbToGray(picture);
  let after: GrayPixels | null = rgbToGray(edited);
  const check = checkEdit(before, after, mask);
  before = null; after = null;
  const checkMs = Date.now() - c0;
  probe('checked');
  if (!check.accepted) return failed('EDIT_REFUSED', 422, { check, result: meta });
  // Outside the mask the original pixels are kept exactly.
  compositeInsideMaskInto(picture, edited, mask);
  edited = null;
  probe('composited');
  const final = io.encodePng(io.rgba(picture), width, height);
  probe('encoded');
  return { ok: true, png: final, check, result: meta, checkMs };
}

// ── An edit whose worker died ─────────────────────────────────────────────

/** A running edit writes timings.heartbeatAt this often (it is the only sign it is alive). */
export const EDIT_HEARTBEAT_MS = 10_000;
/**
 * No heartbeat for this long: the worker is gone (an edge instance killed for
 * memory or time cannot clean up after itself). Seven missed beats: far above a
 * CPU-bound stretch (decode/encode take seconds), independent of how long the
 * provider takes — the beat continues while it is waited for.
 */
export const EDIT_SILENT_MS = 75_000;
/** Hard ceiling for any edit, alive or not (the edge's own wall-clock limit is lower). */
export const EDIT_LEASE_MS = 10 * 60_000;

/** Whether a FINISHING edit must be failed now, and why (null: leave it). */
export function editRecovery(
  row: { kind?: string | null; status?: string | null; lease_at?: string | null; timings?: { heartbeatAt?: unknown } | null },
  nowMs: number,
): 'EDIT_INTERRUPTED' | 'EDIT_TIMEOUT' | null {
  if (row.kind !== 'EDIT' || row.status !== 'FINISHING' || !row.lease_at) return null;
  const lease = Date.parse(row.lease_at);
  if (!Number.isFinite(lease)) return null;
  if (nowMs - lease > EDIT_LEASE_MS) return 'EDIT_TIMEOUT';
  const beat = typeof row.timings?.heartbeatAt === 'string' ? Date.parse(row.timings.heartbeatAt) : NaN;
  const last = Number.isFinite(beat) ? Math.max(beat, lease) : lease;
  return nowMs - last > EDIT_SILENT_MS ? 'EDIT_INTERRUPTED' : null;
}

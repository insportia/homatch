// HOMATCH DESIGN STUDIO — an object edit's pixels, in two steps that each fit
// one edge invocation.
//
// Production: a 2400×1504 edit was killed by the edge runtime first for memory
// (v19: 113 MB, 99 MB image buffers, 1964 ms CPU), then — once memory was fixed —
// for CPU time (v20: 2433 ms). The pixel work (two full PNG decodes, two full PNG
// encodes in pure JavaScript, the mask, the check) does not fit one invocation's
// CPU budget, so it is split around the provider's answer:
//
//   editRequestPixels  the mask from the id picture; the picture as it is stored
//                      (a compatible PNG is sent byte for byte — no decode, no
//                      re-encode); the provider's answer, returned unchanged.
//   editFinishPixels   picture, mask and answer decoded; the structure check; the
//                      answer pasted inside the mask only; the final PNG, once.
//
// Same request pixels, same mask, same check, same composite, same final PNG as
// the single-step edit — only where the work runs changes. Every full-size buffer
// is released as soon as nothing needs it (awaited containers emptied too: V8 keeps
// an awaited value reachable from the suspended function).
//
// The codec and the provider are injected (the edge passes its npm codecs; tests
// pass real PNG bytes), and `probe` lets a test measure what is alive at each stage.

import { checkEdit, compositeInsideMaskInto, maskFromIds, resizeMask, rgbToGray, type CheckResult, type GrayPixels, type RgbPixels } from './renderCheck.ts';
import type { EditMask, ImageResult } from './imageProviders.ts';

export type EditStage = 'read' | 'decoded' | 'mask' | 'requested' | 'answered' | 'result' | 'checked' | 'composited' | 'encoded';

type Decoded = { ok: true; img: RgbPixels } | { ok: false; reason: string };
/** The provider's answer without its bytes (what the record and the money need). */
export type AnswerMeta = Omit<Extract<ImageResult, { ok: true }>, 'bytes'> | Extract<ImageResult, { ok: false }>;
export type AnswerOk = Extract<AnswerMeta, { ok: true }>;

interface Codec {
  decode(bytes: Uint8Array): Decoded;
  /** RGBA bytes of a picture (no copy when it already is RGBA). */
  rgba(img: RgbPixels): Uint8Array;
  encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array;
  probe?(stage: EditStage): void;
}
export interface EditRequestIo extends Codec {
  readImage(): Promise<Uint8Array | null>;
  readIds(): Promise<Uint8Array | null>;
  edit(input: { image: { bytes: Uint8Array; mime: 'image/png' }; mask: EditMask; size: { width: number; height: number } }): Promise<ImageResult>;
}
export interface EditFinishIo extends Codec {
  readImage(): Promise<Uint8Array | null>;
  readIds(): Promise<Uint8Array | null>;
  /** The provider's answer, as staged by the request step. */
  readAnswer(): Promise<Uint8Array | null>;
}

export type EditFailure = { ok: false; code: string; status: number; finishReason: string | null; check: CheckResult | null; result: AnswerMeta | null };
export type EditRequestOutcome = { ok: true; bytes: Uint8Array; mime: string; answer: AnswerOk; reusedPicture: boolean } | EditFailure;
export type EditFinishOutcome = { ok: true; png: Uint8Array; check: CheckResult; checkMs: number } | EditFailure;

const EMPTY = new Uint8Array(0);
const failed = (code: string, status: number, extra: Partial<EditFailure> = {}): EditFailure =>
  ({ ok: false, code, status, finishReason: null, check: null, result: null, ...extra });

/**
 * A PNG the provider can take exactly as stored: 8-bit RGB or RGBA, not
 * interlaced. Its pixels are what decoding and re-encoding it would send, so it
 * goes byte for byte. Null for anything else (JPEG, palette, 16-bit, interlaced):
 * that is decoded and encoded as before.
 */
export function reusablePng(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 33) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i += 1) if (b[i] !== sig[i]) return null;
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null; // IHDR first
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const width = u32(16); const height = u32(20);
  const depth = b[24]; const colour = b[25]; const interlace = b[28];
  if (!width || !height || depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) return null;
  return { width, height };
}

/** The object's mask at the picture's size (1 = editable), from the id picture; null when the target is not in it. */
function maskAt(ids: RgbPixels, color: string, width: number, height: number): EditMask | null {
  const raw = maskFromIds(ids, color, 2);
  if (!raw.pixels) return null;
  return raw.width === width && raw.height === height ? raw : { width, height, data: resizeMask(raw, width, height) };
}

/**
 * Step 1: the mask, the request, the answer — nothing decoded that need not be.
 * Failure codes and their order are the handler's (PICTURE_UNREADABLE,
 * TARGET_NOT_VISIBLE before any paid request, then the provider's own error).
 */
export async function editRequestPixels(io: EditRequestIo, targetColor: string): Promise<EditRequestOutcome> {
  const probe = io.probe ?? (() => {});
  const reads: Array<Uint8Array | null> = await Promise.all([io.readImage(), io.readIds()]);
  let imgBytes = reads[0]; let idBytes = reads[1];
  reads.fill(null);
  probe('read');
  // The picture: as stored when it can be, else decoded once and encoded as PNG.
  let request: Uint8Array | null = null; let width = 0; let height = 0; let reused = false;
  const info = imgBytes ? reusablePng(imgBytes) : null;
  if (info && imgBytes) { request = imgBytes; width = info.width; height = info.height; reused = true; }
  else if (imgBytes) {
    let img: Decoded | null = io.decode(imgBytes);
    if (img.ok) { width = img.img.width; height = img.img.height; request = io.encodePng(io.rgba(img.img), width, height); }
    img = null;
  }
  imgBytes = null;
  let ids: Decoded | null = idBytes ? io.decode(idBytes) : null;
  idBytes = null;
  probe('decoded');
  if (!request || !ids?.ok) return failed('PICTURE_UNREADABLE', 422);
  const mask = maskAt(ids.img, targetColor, width, height);
  ids = null;
  if (!mask) return failed('TARGET_NOT_VISIBLE', 422);
  probe('mask');

  // The request keeps its own copy (a Blob) while it is in flight; ours is not needed after it.
  let pending: Promise<ImageResult> | null = io.edit({ image: { bytes: request, mime: 'image/png' }, mask, size: { width, height } });
  request = null;
  probe('requested');
  let answer: ImageResult | null = await pending;
  pending = null; // a settled promise keeps its value (the answer and its bytes) alive
  probe('answered');
  if (!answer.ok) return failed(answer.error, 502, { finishReason: answer.error, result: answer });
  const bytes = answer.bytes;
  const meta: AnswerOk = {
    ok: true, provider: answer.provider, model: answer.model, mime: answer.mime, usage: answer.usage, cost: answer.cost, ms: answer.ms, requestId: answer.requestId,
  };
  (answer as { bytes: Uint8Array }).bytes = EMPTY;
  answer = null;
  return { ok: true, bytes, mime: meta.mime, answer: meta, reusedPicture: reused };
}

/**
 * Step 2: the answer checked against the picture and pasted inside the mask
 * only; the final PNG encoded once. Failure codes: PICTURE_UNREADABLE,
 * TARGET_NOT_VISIBLE, EDIT_STAGED_MISSING, EDIT_<decode reason>, EDIT_REFUSED.
 */
export async function editFinishPixels(io: EditFinishIo, targetColor: string, answerMeta: AnswerOk | null = null): Promise<EditFinishOutcome> {
  const probe = io.probe ?? (() => {});
  const reads: Array<Uint8Array | null> = await Promise.all([io.readImage(), io.readIds(), io.readAnswer()]);
  let imgBytes = reads[0]; let idBytes = reads[1]; let answerBytes = reads[2];
  reads.fill(null);
  probe('read');
  let img: Decoded | null = imgBytes ? io.decode(imgBytes) : null;
  imgBytes = null;
  let ids: Decoded | null = idBytes ? io.decode(idBytes) : null;
  idBytes = null;
  probe('decoded');
  if (!img?.ok || !ids?.ok) return failed('PICTURE_UNREADABLE', 422, { result: answerMeta });
  const picture = img.img;
  img = null;
  const { width, height } = picture;
  const mask = maskAt(ids.img, targetColor, width, height);
  ids = null;
  if (!mask) return failed('TARGET_NOT_VISIBLE', 422, { result: answerMeta });
  probe('mask');
  if (!answerBytes) return failed('EDIT_STAGED_MISSING', 502, { finishReason: 'EDIT_STAGED_MISSING', result: answerMeta });
  let out: Decoded | null = io.decode(answerBytes);
  answerBytes = null;
  if (!out.ok) return failed(`EDIT_${out.reason}`, 502, { finishReason: `EDIT_${out.reason}`, result: answerMeta });
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
  if (!check.accepted) return failed('EDIT_REFUSED', 422, { check, result: answerMeta });
  // Outside the mask the original pixels are kept exactly.
  compositeInsideMaskInto(picture, edited, mask);
  edited = null;
  probe('composited');
  const final = io.encodePng(io.rgba(picture), width, height);
  probe('encoded');
  return { ok: true, png: final, check, checkMs };
}

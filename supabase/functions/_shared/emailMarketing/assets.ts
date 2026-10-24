// EMAIL STUDIO — images and logos for email designs. UX pass §4: upload from the computer, never
// paste a URL; stored in HOMATCH's private R2 bucket; delivered to mail clients by a stable link.
//
// UPLOAD (email-marketing, action asset_upload — the caller's JWT, service-role writes):
//   bytes arrive base64 in JSON (≤ 5 MB decoded). The TYPE IS READ FROM THE BYTES, never from the
//   filename or the declared content type: PNG, JPEG and GIF only — SVG (script), WebP (Outlook)
//   and everything else are refused; the browser converts WebP/HEIC before sending. Dimensions come
//   from the image header. The object is written to users/<account>/email-assets/<uuid>.<ext>, the
//   write is confirmed with a HEAD (size must match), indexed in storage_objects and registered in
//   email_assets; if any step fails the object is removed — no orphan, no half-registered image.
//   Per account: 60 uploads an hour, 300 active images.
//
// DELIVERY (email-webhook ?ema=<asset id>, assetFiles.ts): a mail client has no session and opens
// the email days later, and a presigned R2 URL expires in minutes — so the public function streams
// the object for an ACTIVE registered asset only, by its unguessable id, with the content type
// from the registry, nosniff, a no-script CSP and a long immutable cache. The id is the whole
// capability; nothing else in the bucket is reachable through it.
//
// DELETE: refused while any of the owner's campaigns still contains the image (a sent email would
// lose it); otherwise the object is removed from R2 and the row marked DELETED.

import { json, checkRateLimit, logEvent, redact } from '../comm/auth.ts';
import { deleteObject, envReport, headObject, putObject } from '../objectStore.ts';
import { ASSET_MAX_ACTIVE, ASSET_MAX_BYTES, ASSET_MAX_SIDE, decodeBase64, sniffImage } from './assetFiles.ts';
import { emailLinkBase, type Owner } from './core.ts';

declare const Deno: { env: { get(k: string): string | undefined } };
// deno-lint-ignore no-explicit-any
type Sb = any;

/** The stable public link a mail client loads the image from. */
export function assetPublicUrl(id: string): string {
  /* On the brand domain: www.homatch.live/m/a/<id> is rewritten to email-webhook ?ema=<id>. */
  return `${emailLinkBase()}/m/a/${id}`;
}

const sha256Hex = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))].map((x) => x.toString(16).padStart(2, '0')).join('');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AssetRow { id: string; content_type: string; byte_size: number; width: number | null; height: number | null; kind: string; original_filename: string | null; created_at: string }

export async function uploadAsset(sb: Sb, owner: Owner, body: Record<string, unknown>): Promise<Response> {
  if (!envReport().allPresent) return json({ ok: false, error: 'STORAGE_UNAVAILABLE' }, 503);
  const limit = await checkRateLimit(sb, 'email_asset_upload', 60, 3600, { userId: owner.authId });
  if (!limit.allowed) return json({ ok: false, error: 'RATE_LIMITED' }, 429);
  const raw = typeof body.dataBase64 === 'string' ? body.dataBase64 : '';
  if (!raw || raw.length > Math.ceil(ASSET_MAX_BYTES / 3) * 4 + 64) return json({ ok: false, error: 'TOO_LARGE' }, 413);
  const bytes = decodeBase64(raw);
  if (!bytes || bytes.length === 0) return json({ ok: false, error: 'BAD_FILE' }, 400);
  if (bytes.length > ASSET_MAX_BYTES) return json({ ok: false, error: 'TOO_LARGE' }, 413);
  const img = sniffImage(bytes);
  if (!img) return json({ ok: false, error: 'TYPE_NOT_ALLOWED' }, 415);
  if ((img.width ?? 1) < 1 || (img.height ?? 1) < 1 || (img.width ?? 0) > ASSET_MAX_SIDE || (img.height ?? 0) > ASSET_MAX_SIDE) {
    return json({ ok: false, error: 'BAD_DIMENSIONS' }, 422);
  }
  const { count } = await sb.from('email_assets').select('id', { count: 'exact', head: true }).eq('owner_id', owner.authId).eq('status', 'ACTIVE');
  if ((count ?? 0) >= ASSET_MAX_ACTIVE) return json({ ok: false, error: 'ASSET_LIMIT' }, 409);

  const id = crypto.randomUUID();
  const key = `users/${owner.userId}/email-assets/${id}.${img.ext}`;
  const kind = body.kind === 'LOGO' ? 'LOGO' : 'IMAGE';
  const filename = typeof body.filename === 'string' ? body.filename.replace(/[\u0000-\u001f<>"\\]/g, '').slice(0, 200) || null : null;
  let written = false, indexed = false;
  try {
    await putObject(key, bytes as unknown as BodyInit, img.type);
    written = true;
    const facts = await headObject(key);
    if (!facts.exists || facts.size !== bytes.byteLength) throw new Error(`write not confirmed (${facts.size ?? 'none'} of ${bytes.byteLength})`);
    const now = new Date().toISOString();
    const { error: idxErr } = await sb.from('storage_objects').insert({
      provider: 'R2', namespace: 'users', category: 'email-assets', object_key: key, owner_user_id: owner.userId,
      entity_type: 'email_asset', entity_id: id, purpose: 'email_design', original_filename: filename,
      content_type: img.type, byte_size: bytes.byteLength, checksum_md5: facts.etag, checksum_sha256: await sha256Hex(bytes),
      visibility: 'PUBLIC', lifecycle: 'ACTIVE', verified_at: now, updated_at: now,
    });
    if (idxErr) throw new Error(`index: ${idxErr.message ?? idxErr}`);
    indexed = true;
    const { data: row, error } = await sb.from('email_assets').insert({
      id, owner_id: owner.authId, owner_user_id: owner.userId, object_key: key, content_type: img.type, byte_size: bytes.byteLength,
      width: img.width, height: img.height, kind, original_filename: filename,
    }).select('id, content_type, byte_size, width, height, kind, original_filename, created_at').single();
    if (error) throw new Error(`register: ${error.message ?? error}`);
    logEvent('email-studio', 'asset_uploaded', { kind, bytes: bytes.byteLength });
    return json({ ok: true, asset: { ...(row as AssetRow), url: assetPublicUrl(id) } });
  } catch (e) {
    /* No orphans: an object nothing references is removed, and its index row marked deleted. */
    if (written) await deleteObject(key).catch(() => undefined);
    if (indexed) await sb.from('storage_objects').update({ lifecycle: 'DELETED', deleted_at: new Date().toISOString() }).eq('object_key', key);
    logEvent('email-studio', 'asset_upload_failed', { error: redact((e as Error)?.message ?? String(e)) });
    return json({ ok: false, error: 'UPLOAD_FAILED' }, 502);
  }
}

export async function deleteAsset(sb: Sb, owner: Owner, body: Record<string, unknown>): Promise<Response> {
  const id = String(body.id ?? '');
  if (!UUID.test(id)) return json({ ok: false, error: 'ASSET_NOT_FOUND' }, 404);
  const { data } = await sb.from('email_assets').select('id, object_key').eq('id', id).eq('owner_id', owner.authId).eq('status', 'ACTIVE').maybeSingle();
  const a = data as { id: string; object_key: string } | null;
  if (!a) return json({ ok: false, error: 'ASSET_NOT_FOUND' }, 404);
  /* Still in a design (any status: a draft would show a broken image, a sent email would lose it). */
  const { data: used } = await sb.from('outreach_campaigns').select('id, name').eq('owner_id', owner.authId).eq('campaign_type', 'EMAIL')
    .or(`html_body.like.%ema=${id}%,html_body.like.%/m/a/${id}%`).limit(3);
  if ((used ?? []).length) return json({ ok: false, error: 'ASSET_IN_USE', campaigns: used }, 409);
  try {
    await deleteObject(a.object_key);
  } catch (e) {
    logEvent('email-studio', 'asset_delete_failed', { error: redact((e as Error)?.message ?? String(e)) });
    return json({ ok: false, error: 'STORAGE_UNAVAILABLE' }, 503);
  }
  const now = new Date().toISOString();
  await sb.from('email_assets').update({ status: 'DELETED', deleted_at: now }).eq('id', a.id);
  await sb.from('storage_objects').update({ lifecycle: 'DELETED', deleted_at: now, updated_at: now }).eq('object_key', a.object_key);
  return json({ ok: true });
}

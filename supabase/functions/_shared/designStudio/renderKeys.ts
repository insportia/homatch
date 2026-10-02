/**
 * Where a finished or edited render picture is stored.
 *
 * The key is built by the storage layer's own accountKey, so storage-sign —
 * which only signs `users/<account>/<category>/<entity>/<uuid>.<ext>` — can
 * always hand the customer a URL for it. (A readable suffix such as
 * `<render>-final.png` stores fine and is then refused as INVALID_KEY on every
 * read: the picture exists and nobody can see it.)
 *
 * The object uuid is derived from (render, role), not random: a retried finish
 * overwrites its own picture instead of leaving an orphan beside it.
 */
import { accountKey } from '../storage/keys.ts';

/** final: a finished render; edit: an edited picture; staged: an edit's provider answer awaiting its finish. */
export type RenderPictureRole = 'final' | 'edit' | 'staged';

/** A uuid-shaped name (version 8, RFC 9562 "custom") from the sha-256 of the text. */
export async function uuidFrom(text: string): Promise<string> {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x80;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export async function renderPictureKey(
  row: { id: string; user_id: string; project_id: string }, role: RenderPictureRole, mime: string,
): Promise<string> {
  return accountKey({
    accountId: row.user_id, category: 'design-studio-thumbnails', entityId: row.project_id,
    objectId: await uuidFrom(`ds-render:${row.id}:${role}`), contentType: mime,
  });
}

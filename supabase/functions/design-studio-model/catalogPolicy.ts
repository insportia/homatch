// HOMATCH DESIGN STUDIO — what the catalogue signing route may sign, decided
// from the database, at the credential boundary.
//
// The importer is trusted with the service role, but the two credentials it
// acts through (R2's, Blendkit's API key) are not handed to it; this is the
// last check before either is used:
//
// - An R2 WRITE is signed only for an asset the catalogue has recorded, whose
//   licence is one HOMATCH may store and deliver today (IMPORTABLE_LICENSES),
//   and a PUBLIC key only for a CC0 asset. A licence stopped pending the
//   provider's permission (Blendkit Royalty-Free) cannot be written anywhere.
// - A Blendkit download is signed only for an asset recorded under Blendkit
//   with an importable licence, and only for a file that asset listed at
//   discovery — never an arbitrary Blendkit URL.
//
// Pure: the route supplies the rows; the tests supply them too.

/** The licence classes HOMATCH may import today. Widening this is a legal decision, not a code change. */
export const IMPORTABLE_LICENSES = new Set(['CC0']);

export interface ImportRow { homatch_asset_id: string; source_provider: string; license_class: string; source_asset?: { files?: Array<{ uuid?: string }> } | null }

export const assetOfKey = (key: string) => key.split('/')[4] ?? '';
export const deliveryOfKey = (key: string) => key.split('/')[2] ?? '';

/** Why an R2 write may not be signed (null when it may). Reads and HEADs need no licence: nothing new is stored. */
export function writeRefusal(key: string, row: ImportRow | undefined): string | null {
  if (!row) return 'ASSET_NOT_RECORDED';
  if (!IMPORTABLE_LICENSES.has(row.license_class)) return 'LICENSE_NOT_IMPORTABLE';
  if (deliveryOfKey(key) === 'public' && row.license_class !== 'CC0') return 'NOT_PUBLIC_DELIVERABLE';
  return null;
}

const UUID_IN_URL = /\/downloads\/([0-9a-f-]{36})\/$/;

/** Why a Blendkit download may not be signed (null when it may). */
export function downloadRefusal(url: string, row: ImportRow | undefined): string | null {
  if (!row || row.source_provider !== 'blendkit') return 'ASSET_NOT_RECORDED';
  if (!IMPORTABLE_LICENSES.has(row.license_class)) return 'LICENSE_NOT_IMPORTABLE';
  const uuid = UUID_IN_URL.exec(url)?.[1];
  const listed = new Set((row.source_asset?.files ?? []).map((f) => f.uuid).filter(Boolean));
  if (!uuid || !listed.has(uuid)) return 'FILE_NOT_LISTED_FOR_ASSET';
  return null;
}

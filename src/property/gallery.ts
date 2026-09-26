// WHICH PHOTOS A PROPERTY HAS, AND IN WHAT ORDER.
//
// Pure, and in its own module for the reason `rules.ts` is: a function that lives in a
// .tsx cannot be imported by a test, because JSX is not something node's type stripping
// will parse. A rule that cannot be tested without a browser is a rule nobody tests,
// and this one decides what a customer sees first.
//
// THREE SOURCES, IN ORDER OF TRUTHFULNESS
//
//   property_photos      the real table, ordered by display_order, carrying is_cover.
//                        This is what an owner actually manages on the edit screen.
//   cover_photo_url      a single key on the property row. Every row has one; an import
//                        sets it to the source portal's own image.
//   gallery_images       an importer's array on property_facts, kept because an imported
//                        listing's other photos live there and nowhere else.
//
// DEDUPLICATED ACROSS ALL THREE, because an import writes the same key into
// cover_photo_url AND into the gallery array. Showing that photo twice makes the count
// wrong, and the count is a claim the interface makes out loud.

export interface GalleryPhoto {
  id?: string | number;
  storage_path?: string | null;
  public_url?: string | null;
  is_cover?: boolean | null;
  display_order?: number | null;
}

export interface GallerySource {
  coverPhotoUrl?: string | null;
  photos?: GalleryPhoto[] | null;
  galleryImages?: string[] | null;
}

/**
 * One ordered, de-duplicated list of image addresses.
 *
 * THE OWNER'S COVER LEADS, whether it came from the photo table or from the property
 * row. They chose it, and an interface that opens on a different photo is quietly
 * overruling them.
 *
 * `storage_path` is preferred over `public_url` for the same reason the upload path
 * stores a key: `property-photos` is a private bucket, a URL into it expires, and
 * `public_url` is only ever set for an object that genuinely is public — which none of
 * these are.
 */
export function galleryImages(source: GallerySource): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string | null | undefined) => {
    const key = String(value ?? '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };

  const rows = [...(source.photos ?? [])].sort((a, b) => {
    /* The cover first; everything else keeps the order the owner put it in. */
    if (Boolean(a.is_cover) !== Boolean(b.is_cover)) return a.is_cover ? -1 : 1;
    return Number(a.display_order ?? 0) - Number(b.display_order ?? 0);
  });

  const cover = rows.find((row) => row.is_cover);
  if (cover) push(cover.storage_path ?? cover.public_url);
  else push(source.coverPhotoUrl);

  for (const row of rows) push(row.storage_path ?? row.public_url);
  push(source.coverPhotoUrl);
  for (const image of source.galleryImages ?? []) push(image);

  return out;
}

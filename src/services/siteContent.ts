// HOMATCH — Site Studio content service.
//
// The only module that talks to the site_pages tables. Everything above it
// works on the plain objects in src/site/model.ts, and everything below it is
// a SECURITY DEFINER function that re-checks the caller is an admin.
//
// Three properties this layer has to preserve, because the rest of the
// feature assumes them:
//
//   1. READING THE PUBLIC SITE NEVER NEEDS A SESSION, AND NEVER SEES A DRAFT.
//      The published read is a column-limited select against a table whose
//      `draft` column is not granted to anon or authenticated at all. A
//      visitor cannot read an unpublished draft even with a crafted query,
//      because the permission to do so was never granted, rather than being
//      filtered out in a WHERE clause we might get wrong.
//
//   2. A BROKEN BACKEND MUST NOT BLANK THE WEBSITE. Every read here resolves
//      to `null` on failure instead of throwing or returning an empty page.
//      `null` means "no overrides", and the renderer treats that as "show the
//      site exactly as the code describes it" — which is the current live
//      design. A Supabase outage costs us the ability to EDIT, not the site.
//
//   3. WRITES ARE SERVER-AUTHORISED. Nothing here sends a role, an is_admin
//      flag, or a user id that the server then trusts. The RPCs take content
//      and derive the actor from the JWT.

import { supabase } from '@/db/supabase';
import {
  type SitePageContent, type SiteVersion, normalizePage, emptyPage,
} from '@/site/model';
import { NORMALIZE_RULES } from '@/site/registry';

/** Pages Site Studio is allowed to address. Mirrors the seeded slugs. */
export type PageSlug = 'home' | 'about';

export interface SitePageRecord {
  slug: PageSlug;
  title: string;
  draft: SitePageContent;
  published: SitePageContent | null;
  publishedVersion: number | null;
  publishedAt: string | null;
}

/**
 * Why every failure is swallowed into a value instead of thrown.
 *
 * These tables may not exist yet. The migration is deliberately unapplied on
 * environments that have not opted in, and the public site is expected to
 * keep working there, unchanged, forever. A missing table, a revoked grant
 * and a network blip are therefore all the same answer: no overrides.
 */
function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // 42P01 undefined_table, 42501 insufficient_privilege, PGRST202 no such function.
  return error.code === '42P01' || error.code === '42501' || error.code === 'PGRST202';
}

/* ------------------------------------------------------------------ *
 * Public reads (no session required)                                  *
 * ------------------------------------------------------------------ */

/**
 * The published content for one page, or null if there is none.
 *
 * Null is the normal, healthy answer until somebody publishes something. It
 * is also the answer when the backend is unreachable, on purpose: see the
 * header. The caller cannot tell those apart, and must not need to.
 */
export async function fetchPublishedPage(slug: PageSlug): Promise<SitePageContent | null> {
  try {
    const { data, error } = await supabase
      .from('site_pages')
      // Explicit column list, not `*`: `*` would expand to include `draft`
      // and fail the request outright once the grants tighten.
      .select('published')
      .eq('slug', slug)
      .maybeSingle();

    if (error || !data?.published) return null;
    return normalizePage(data.published, NORMALIZE_RULES);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Admin reads and writes (all server-authorised)                      *
 * ------------------------------------------------------------------ */

export type StudioResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'FORBIDDEN' | 'UNAVAILABLE' | 'FAILED'; message?: string };

function fail(error: { code?: string; message?: string } | null): StudioResult<never> {
  const message = error?.message ?? '';
  if (message.includes('FORBIDDEN')) return { ok: false, reason: 'FORBIDDEN' };
  if (isMissingRelation(error)) return { ok: false, reason: 'UNAVAILABLE' };
  return { ok: false, reason: 'FAILED', message };
}

/** The draft, the published copy and the version list, in one round trip. */
export async function loadPage(slug: PageSlug): Promise<StudioResult<{
  page: SitePageRecord;
  versions: SiteVersion[];
}>> {
  try {
    const { data, error } = await supabase.rpc('site_get_page', { p_slug: slug });
    if (error) return fail(error);
    if (!data) return { ok: false, reason: 'UNAVAILABLE' };

    const row = data as Record<string, unknown>;
    const versionsRaw = Array.isArray(row.versions) ? row.versions : [];

    return {
      ok: true,
      value: {
        page: {
          slug,
          title: typeof row.title === 'string' ? row.title : slug,
          // A corrupt draft degrades to an empty override set rather than
          // taking the editor down with it; the admin can then re-save.
          draft: row.draft ? normalizePage(row.draft, NORMALIZE_RULES) : emptyPage(),
          published: row.published ? normalizePage(row.published, NORMALIZE_RULES) : null,
          publishedVersion: typeof row.published_version === 'number' ? row.published_version : null,
          publishedAt: typeof row.published_at === 'string' ? row.published_at : null,
        },
        versions: versionsRaw.map(v => {
          const r = v as Record<string, unknown>;
          return {
            version: Number(r.version ?? 0),
            content: normalizePage(r.content, NORMALIZE_RULES),
            note: typeof r.note === 'string' ? r.note : null,
            publishedAt: typeof r.published_at === 'string' ? r.published_at : '',
            publishedBy: typeof r.published_by === 'string' ? r.published_by : null,
          };
        }),
      },
    };
  } catch (e) {
    return fail({ message: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Save the draft. Does not touch what visitors see.
 *
 * The whole page goes over in one call rather than a per-field patch, so the
 * draft a reviewer approved is the exact document that gets published; there
 * is no window in which half an edit is stored.
 */
export async function saveDraft(
  slug: PageSlug, content: SitePageContent, note?: string,
): Promise<StudioResult<void>> {
  try {
    const { error } = await supabase.rpc('site_save_draft', {
      p_slug: slug,
      p_content: content as unknown as Record<string, unknown>,
      p_note: note ?? null,
    });
    if (error) return fail(error);
    return { ok: true, value: undefined };
  } catch (e) {
    return fail({ message: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Publish the current draft.
 *
 * Deliberately takes no content: publishing means "make the saved draft
 * live", so the thing being published is always something already stored and
 * reviewable, never a payload assembled in the browser at click time.
 */
export async function publishPage(
  slug: PageSlug, note?: string,
): Promise<StudioResult<number>> {
  try {
    const { data, error } = await supabase.rpc('site_publish', {
      p_slug: slug,
      p_note: note ?? null,
    });
    if (error) return fail(error);
    return { ok: true, value: Number(data ?? 0) };
  } catch (e) {
    return fail({ message: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Load an old version into the draft. Publishes nothing.
 *
 * This is the safe half of "rollback": the admin gets the old content in the
 * editor, can look at it in every language, and then publishes it like any
 * other change. History is untouched.
 */
export async function restoreVersion(
  slug: PageSlug, version: number,
): Promise<StudioResult<SitePageContent>> {
  try {
    const { data, error } = await supabase.rpc('site_restore_version', {
      p_slug: slug,
      p_version: version,
    });
    if (error) return fail(error);
    return { ok: true, value: normalizePage(data, NORMALIZE_RULES) };
  } catch (e) {
    return fail({ message: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Publish an old version immediately, as a NEW version number.
 *
 * For the case the restore flow is too slow for: something wrong is live
 * right now. It still appends to history rather than rewinding it, so the
 * bad version remains on the record instead of disappearing.
 */
export async function rollbackTo(
  slug: PageSlug, version: number,
): Promise<StudioResult<number>> {
  try {
    const { data, error } = await supabase.rpc('site_rollback', {
      p_slug: slug,
      p_version: version,
    });
    if (error) return fail(error);
    return { ok: true, value: Number(data ?? 0) };
  } catch (e) {
    return fail({ message: e instanceof Error ? e.message : String(e) });
  }
}

/* ------------------------------------------------------------------ *
 * Images                                                              *
 * ------------------------------------------------------------------ */

/** Kept in sync with the site-assets bucket's allowed_mime_types. */
export const ASSET_MIME = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/svg+xml']);
export const ASSET_MAX_BYTES = 5 * 1024 * 1024;

export type AssetRejection =
  | { ok: true }
  | { ok: false; reason: 'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE' };

export function validateAsset(file: { size: number; type: string }): AssetRejection {
  if (!file || file.size <= 0) return { ok: false, reason: 'EMPTY' };
  if (file.size > ASSET_MAX_BYTES) return { ok: false, reason: 'TOO_LARGE' };
  if (!ASSET_MIME.includes(file.type)) return { ok: false, reason: 'UNSUPPORTED_TYPE' };
  return { ok: true };
}

/**
 * Upload an image for use in a section.
 *
 * `site-assets` is the one public bucket in the system, because these files
 * ARE the public website: a signed URL would expire behind a visitor. Write
 * access is still admin-only, enforced by storage RLS.
 */
export async function uploadAsset(file: File): Promise<StudioResult<string>> {
  const check = validateAsset(file);
  if (!check.ok) return { ok: false, reason: 'FAILED', message: check.reason };

  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${new Date().getFullYear()}/${crypto.randomUUID()}.${ext}`;

  try {
    const { error } = await supabase.storage.from('site-assets').upload(path, file, {
      contentType: file.type,
      cacheControl: '31536000',
      upsert: false,
    });
    if (error) return fail(error);

    const { data } = supabase.storage.from('site-assets').getPublicUrl(path);
    return { ok: true, value: data.publicUrl };
  } catch (e) {
    return fail({ message: e instanceof Error ? e.message : String(e) });
  }
}

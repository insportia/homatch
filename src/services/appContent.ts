import { supabase } from '@/db/supabase';
import { LOCALES, type ContentLocale, type OverrideMap } from '@/i18n/appContent';

/**
 * HOMATCH — the App Content service.
 *
 * The only module that talks to the `app_content` table. It has the same
 * three properties as the Site Studio service beside it, for the same
 * reasons:
 *
 *   1. READING NEEDS NO SESSION. The strings are already in the bundle every
 *      visitor downloads; there is nothing to protect by hiding them, and the
 *      signed-out marketing pages need them too.
 *
 *   2. A BROKEN BACKEND MUST NOT BLANK THE PRODUCT. Every read resolves to an
 *      empty override set on failure. Empty means "show what shipped", which
 *      is the reviewed six-language copy. A Supabase outage costs the ability
 *      to EDIT, never the words.
 *
 *   3. WRITES ARE SERVER-AUTHORISED. Nothing here sends a role or an is_admin
 *      flag. app_content_set re-reads users.is_admin for the calling
 *      auth.uid() and writes an audit row; the table grants no INSERT or
 *      UPDATE to anybody, so the function is the only way in.
 */

export interface OverrideRow {
  key: string;
  locale: ContentLocale;
  value: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

function isLocale(value: unknown): value is ContentLocale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Every override, for the running application.
 *
 * One query at startup, and normally zero rows: the table holds only what
 * somebody has actually changed. Failure is indistinguishable from emptiness
 * on purpose — see property 2 above — so this never throws and never reports
 * an error the caller would have to decide what to do about.
 */
export async function fetchOverrides(): Promise<OverrideMap> {
  const map: OverrideMap = {};
  try {
    const { data, error } = await supabase
      .from('app_content')
      // Explicit columns: `*` would ask for updated_by, which is not granted
      // to a browser, and the whole request would be refused.
      .select('key, locale, value');
    if (error || !Array.isArray(data)) return map;

    for (const row of data) {
      const locale = (row as { locale?: unknown }).locale;
      const key = (row as { key?: unknown }).key;
      const value = (row as { value?: unknown }).value;
      if (!isLocale(locale) || typeof key !== 'string' || typeof value !== 'string') continue;
      (map[locale] ??= {})[key] = value;
    }
    return map;
  } catch {
    return map;
  }
}

export type ContentResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'FORBIDDEN' | 'UNAVAILABLE' | 'FAILED'; message?: string };

function fail(error: { code?: string; message?: string } | null): ContentResult<never> {
  const message = error?.message ?? '';
  if (message.includes('FORBIDDEN')) return { ok: false, reason: 'FORBIDDEN' };
  // 42P01 undefined_table, 42501 insufficient_privilege, PGRST202 no function.
  if (error?.code === '42P01' || error?.code === '42501' || error?.code === 'PGRST202') {
    return { ok: false, reason: 'UNAVAILABLE' };
  }
  return { ok: false, reason: 'FAILED', message };
}

/** Every override with its authorship. Admin only; the editor's own read. */
export async function loadOverrides(): Promise<ContentResult<OverrideRow[]>> {
  try {
    const { data, error } = await supabase.rpc('app_content_all');
    if (error) return fail(error);
    const rows = Array.isArray(data) ? data : [];
    return {
      ok: true,
      value: rows.flatMap((raw) => {
        const row = raw as Record<string, unknown>;
        if (!isLocale(row.locale) || typeof row.key !== 'string' || typeof row.value !== 'string') return [];
        return [{
          key: row.key,
          locale: row.locale,
          value: row.value,
          updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
          updatedBy: typeof row.updated_by === 'string' ? row.updated_by : null,
        }];
      }),
    };
  } catch (e) {
    return fail({ message: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Write one string, in one language.
 *
 * An empty value is not an error and not a blank string: the function deletes
 * the row, and the copy the application shipped comes back. That is what the
 * editor's Reset control sends, and it is why there is one function here
 * rather than a set and a clear.
 */
export async function setOverride(
  key: string, locale: ContentLocale, value: string,
): Promise<ContentResult<{ cleared: boolean }>> {
  try {
    const { data, error } = await supabase.rpc('app_content_set', {
      p_key: key, p_locale: locale, p_value: value,
    });
    if (error) return fail(error);
    const row = (data ?? {}) as Record<string, unknown>;
    return { ok: true, value: { cleared: row.cleared === true } };
  } catch (e) {
    return fail({ message: e instanceof Error ? e.message : String(e) });
  }
}

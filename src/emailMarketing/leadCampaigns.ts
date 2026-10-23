// HOMATCH — purchased leads → the EXISTING email campaigns and contacts screens.
//
// Pure (no React, no Supabase) so node:test reads exactly what the pages run.
//
//   · the hand-off URL an unlock lands on (/outreach/email?new=1&list=…&property=…)
//   · the per-language plan for "one campaign per language" (never guessing a language)
//   · the contacts manager's source / language / country filters and their URL form
//
// Nothing here sends anything. A draft is a draft until a person launches it, and
// outreach-send keeps its own rule about who may receive mail.

/* ── /outreach/email?new=1&list=<id>&property=<id> ─────────────────────────── */

export interface CampaignLaunch {
  listId: string | null;
  propertyId: string | null;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function cleanId(v: string | null): string | null {
  const s = (v ?? '').trim();
  return ID.test(s) ? s : null;
}

/** null unless the URL asks for a new campaign. Ids that are not ids are dropped, not trusted. */
export function parseCampaignLaunch(params: URLSearchParams): CampaignLaunch | null {
  if (params.get('new') !== '1') return null;
  return { listId: cleanId(params.get('list')), propertyId: cleanId(params.get('property')) };
}

/** The same params with the launch keys removed — so a refresh does not reopen the dialog. */
export function withoutLaunchParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const k of ['new', 'list', 'property']) next.delete(k);
  return next;
}

/* ── languages ─────────────────────────────────────────────────────────────── */

export const UNKNOWN_LANGUAGE = 'unknown';
/** The six languages HOMATCH (and Email Studio's AI drafting) writes in. */
export const CAMPAIGN_LANGUAGES = ['ka', 'en', 'ru', 'tr', 'ar', 'he'] as const;

export function isCampaignLanguage(lang: string | null | undefined): boolean {
  return typeof lang === 'string' && (CAMPAIGN_LANGUAGES as readonly string[]).includes(lang.toLowerCase());
}

/** "<campaign name> · KA" */
export function languageCampaignName(name: string, language: string): string {
  const base = name.trim();
  const tag = language.trim().toUpperCase();
  return base ? `${base} · ${tag}` : tag;
}

export interface LanguageCount { language: string; total: number; eligible: number }

/** byLanguage from outreach_list_audience, largest first, "unknown" always last. */
export function audienceLanguages(byLanguage: Record<string, { total: number; eligible: number }> | null | undefined): LanguageCount[] {
  return Object.entries(byLanguage ?? {})
    .map(([language, v]) => ({ language, total: Number(v?.total ?? 0), eligible: Number(v?.eligible ?? 0) }))
    .filter((x) => x.total > 0)
    .sort((a, b) => {
      if (a.language === UNKNOWN_LANGUAGE) return 1;
      if (b.language === UNKNOWN_LANGUAGE) return -1;
      return b.total - a.total || a.language.localeCompare(b.language);
    });
}

/** Offer the split when there are two languages, or any contact without one. */
export function shouldOfferLanguageSplit(langs: LanguageCount[]): boolean {
  return langs.length >= 2 || langs.some((x) => x.language === UNKNOWN_LANGUAGE);
}

/**
 * The fallback for contacts with no recorded language: a language the owner CHOSE,
 * or LEAVE_OUT. There is no third option — a language is never inferred from a country.
 */
export const LEAVE_OUT = 'LEAVE_OUT';

export function fallbackForSplit(choice: string): string | null {
  if (!choice || choice === LEAVE_OUT) return null;
  return /^[a-z]{2,3}$/.test(choice) ? choice : null;
}

export interface LanguageListRef { language: string; listId: string; audience?: { total?: number; eligible?: number } | null }

export interface LanguageDraftPlan { language: string; listId: string; name: string; total: number; eligible: number }

/** One draft per language list. The "unknown" list (owner chose to leave them out) gets none. */
export function planLanguageDrafts(name: string, lists: LanguageListRef[]): LanguageDraftPlan[] {
  return lists
    .filter((l) => l.language && l.language !== UNKNOWN_LANGUAGE && l.listId)
    .map((l) => ({
      language: l.language,
      listId: l.listId,
      name: languageCampaignName(name, l.language),
      total: Number(l.audience?.total ?? 0),
      eligible: Number(l.audience?.eligible ?? 0),
    }));
}

/** Email Studio's copy → the campaign's plain-text body (the subject is separate). */
export function copyToTextBody(copy: { headline?: string; body?: string; cta?: string }): string {
  return [copy.headline, copy.body, copy.cta].map((s) => (s ?? '').trim()).filter(Boolean).join('\n\n');
}

/* ── contacts manager filters (?source=&language=&country=&list=) ──────────── */

/** What a person chooses in the toolbar. UPLOADED = IMPORT, MANUAL or nothing recorded. */
export type ContactSourceFilter = 'CURATED_LEAD' | 'INTERNAL_MATCH' | 'UPLOADED' | 'FIND_BUYERS';
export const CONTACT_SOURCE_FILTERS: readonly ContactSourceFilter[] = ['CURATED_LEAD', 'INTERNAL_MATCH', 'UPLOADED', 'FIND_BUYERS'];

export function parseSourceFilter(v: string | null | undefined): ContactSourceFilter | null {
  const s = (v ?? '').trim().toUpperCase();
  if (s === 'IMPORT' || s === 'MANUAL' || s === 'UPLOADED' || s === 'USER') return 'UPLOADED';
  return (CONTACT_SOURCE_FILTERS as readonly string[]).includes(s) ? (s as ContactSourceFilter) : null;
}

/** The source a stored source_kind belongs to (null / legacy rows are user-uploaded). */
export function sourceFilterOf(kind: string | null | undefined): ContactSourceFilter {
  if (kind === 'CURATED_LEAD' || kind === 'INTERNAL_MATCH' || kind === 'FIND_BUYERS') return kind;
  return 'UPLOADED';
}

export interface ContactFilters {
  source: ContactSourceFilter | null;
  /** an ISO code, "unknown" for none recorded, or null for all */
  language: string | null;
  country: string | null;
  list: string | null;
}

export function parseContactFilters(params: URLSearchParams): ContactFilters {
  const lang = (params.get('language') ?? '').trim().toLowerCase();
  const country = (params.get('country') ?? '').trim().toUpperCase();
  return {
    source: parseSourceFilter(params.get('source')),
    language: lang === UNKNOWN_LANGUAGE || /^[a-z]{2,3}$/.test(lang) ? lang : null,
    country: /^[A-Z]{2}$/.test(country) ? country : null,
    list: cleanId(params.get('list')),
  };
}

/** Writes the filters into the URL, keeping any other params that were there. */
export function contactFiltersToParams(f: ContactFilters, base?: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(base);
  const put = (k: string, v: string | null) => (v ? next.set(k, v) : next.delete(k));
  put('source', f.source);
  put('language', f.language);
  put('country', f.country);
  put('list', f.list);
  return next;
}

/** PostgREST source_kind condition for a filter: `in` list, or an `or` group for UPLOADED. */
export function sourceKindQuery(f: ContactSourceFilter): { eq: string } | { or: string } {
  if (f === 'UPLOADED') return { or: 'source_kind.is.null,source_kind.in.(IMPORT,MANUAL)' };
  return { eq: f };
}

// HOMATCH SITE STUDIO — the content model.
//
// Pure domain: no React, no Supabase, no DOM. Everything here is a function
// of its arguments, which is what lets the rules that matter (a locale edit
// never touches another locale; an unknown section type never renders; a
// javascript: URL never reaches an anchor) be tested without a database.
//
// THE ONE DESIGN DECISION EVERYTHING ELSE FOLLOWS FROM
//
// Site Studio does not own the website's copy. It owns OVERRIDES.
//
// Every section on the public site already renders real translated strings
// from src/i18n/translations.ts, in six languages, reviewed by a human. If
// the editor owned that copy it would have to import all of it on day one,
// and an empty or failed content fetch would blank the homepage.
//
// So a section field resolves in this order:
//
//   1. the admin's override for the current locale, if there is one
//   2. the section's existing translation key
//
// which means an EMPTY configuration renders the current site exactly. That
// is what makes the migration in §21 safe: the hardcoded site stays the
// floor, and the database can only ever add to it.

export const LOCALES = ['ka', 'en', 'ru', 'tr', 'ar', 'he'] as const;
export type Locale = (typeof LOCALES)[number];

/** A value that exists separately in each language. Partial on purpose: an
 *  absent locale falls through to the section's translation key. */
export type LocalizedText = Partial<Record<Locale, string>>;

export interface SectionMedia {
  /** Public URL of the asset, or a bundled path. */
  url: string;
  alt: LocalizedText;
}

export interface SectionLink {
  label: LocalizedText;
  /** Internal route starting with '/', or an http(s) URL. */
  href: string;
}

export type SectionTheme = 'light' | 'dark';
export type SectionSpacing = 'compact' | 'normal' | 'spacious';

export interface SiteSection {
  /** Stable across reorders and versions. */
  id: string;
  type: string;
  enabled: boolean;
  /** Must be one of the variants the registry declares for this type. */
  variant: string;
  theme: SectionTheme | null;
  spacing: SectionSpacing;
  content: Record<string, LocalizedText>;
  /** Translation state and pending suggestions, per field. Kept BESIDE
   *  `content` rather than inside it, so the approved value and the machine's
   *  opinion of it can never occupy the same slot. */
  i18n: Record<string, FieldI18n>;
  media: Record<string, SectionMedia | null>;
  links: Record<string, SectionLink>;
}

export interface SitePageSeo {
  title: LocalizedText;
  description: LocalizedText;
  ogTitle: LocalizedText;
  ogDescription: LocalizedText;
  ogImage: string | null;
  canonical: string | null;
  noindex: boolean;
}

export interface SitePageContent {
  /** Bumped only for a breaking shape change, so an old snapshot can be
   *  recognised rather than silently misread. */
  schema: 1;
  sections: SiteSection[];
  seo: SitePageSeo;
}

/* ------------------------------------------------------------------ *
 * Construction                                                        *
 * ------------------------------------------------------------------ */

export function emptySeo(): SitePageSeo {
  return {
    title: {}, description: {}, ogTitle: {}, ogDescription: {},
    ogImage: null, canonical: null, noindex: false,
  };
}

export function makeSection(type: string, id: string, variant = 'default'): SiteSection {
  return {
    id, type, enabled: true, variant, theme: null, spacing: 'normal',
    content: {}, i18n: {}, media: {}, links: {},
  };
}

export function emptyPage(): SitePageContent {
  return { schema: 1, sections: [], seo: emptySeo() };
}

/* ------------------------------------------------------------------ *
 * Localized field editing                                             *
 *                                                                     *
 * §5: "Do not overwrite other locale values when editing one language."*
 * Every write below is a copy that touches exactly one locale key.     *
 * ------------------------------------------------------------------ */

export function setLocalized(current: LocalizedText | undefined, locale: Locale, value: string): LocalizedText {
  const next: LocalizedText = { ...(current ?? {}) };
  const trimmed = value.trim();
  if (trimmed === '') {
    // Clearing an override returns the field to the site default rather
    // than publishing an empty string onto the page.
    delete next[locale];
  } else {
    next[locale] = value;
  }
  return next;
}

export function setSectionField(
  section: SiteSection, field: string, locale: Locale, value: string,
): SiteSection {
  return {
    ...section,
    content: { ...section.content, [field]: setLocalized(section.content[field], locale, value) },
  };
}

/** The override for this locale, or undefined when the site default applies. */
export function readLocalized(text: LocalizedText | undefined, locale: Locale): string | undefined {
  const v = text?.[locale];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export type FieldStatus = 'edited' | 'default' | 'missing';

/**
 * §19's translation status.
 *
 * A field backed by a translation key is never "missing": with no override
 * the site's own reviewed copy shows, which is `default`. Only a field with
 * NO fallback key — content the admin created, such as a rich text block —
 * can genuinely be missing in a locale.
 */
export function fieldStatus(
  text: LocalizedText | undefined, locale: Locale, hasFallback: boolean,
): FieldStatus {
  if (readLocalized(text, locale) !== undefined) return 'edited';
  return hasFallback ? 'default' : 'missing';
}

/* ------------------------------------------------------------------ *
 * Translation state                                                   *
 *                                                                     *
 * The rule this exists to enforce: editing one locale never changes    *
 * another locale's VALUE. It may only change how that value is         *
 * DESCRIBED, from "current" to "needs update", and it may attach a     *
 * suggestion next to it. Those are different columns.                  *
 * ------------------------------------------------------------------ */

export type LocaleState =
  /** Matches the source locale as it currently stands. */
  | 'current'
  /** The source locale changed after this translation was written. The
   *  translation is still live and still shown; it is only flagged. */
  | 'needs_update'
  /** A machine suggestion is waiting beside this locale. */
  | 'ai_suggested'
  /** A human wrote or approved this. The strongest state: automatic modes
   *  will not overwrite it, only propose alongside it. */
  | 'reviewed';

export interface FieldI18n {
  /** The locale this field was last authored in. */
  source?: Locale;
  state: Partial<Record<Locale, LocaleState>>;
  /** Unapproved machine output. Deliberately a different key from the value
   *  in `content`, so "apply" is an explicit act and never an accident. */
  suggestion: Partial<Record<Locale, string>>;
}

export type TranslationMode =
  /** Only the edited locale changes. Others are flagged, nothing generated. */
  | 'manual'
  /** Default. Others are flagged and suggestions are generated for review. */
  | 'suggest'
  /** Suggestions are written straight into the draft for locales that no
   *  human has reviewed; reviewed locales still only get a suggestion. */
  | 'auto_all';

export const DEFAULT_TRANSLATION_MODE: TranslationMode = 'suggest';

export function emptyFieldI18n(): FieldI18n {
  return { state: {}, suggestion: {} };
}

function fieldI18nOf(section: SiteSection, field: string): FieldI18n {
  const existing = section.i18n?.[field];
  return existing ? { ...existing, state: { ...existing.state }, suggestion: { ...existing.suggestion } }
    : emptyFieldI18n();
}

function withFieldI18n(section: SiteSection, field: string, meta: FieldI18n): SiteSection {
  return { ...section, i18n: { ...section.i18n, [field]: meta } };
}

/**
 * The state to show for one locale of one field.
 *
 * Derived rather than stored wherever possible: a locale with no override is
 * showing the site's own reviewed copy, so it is `current`, not "missing".
 */
export function localeState(
  section: SiteSection, field: string, locale: Locale,
): LocaleState {
  const stored = section.i18n?.[field]?.state?.[locale];
  if (stored) return stored;
  return 'current';
}

export function suggestionFor(
  section: SiteSection, field: string, locale: Locale,
): string | undefined {
  const v = section.i18n?.[field]?.suggestion?.[locale];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * A human edit to one locale.
 *
 * Writes the value for that locale only, marks it `reviewed` because a person
 * typed it, records it as the new source, and flags every OTHER locale that
 * carries an override as `needs_update`. Their values are untouched and stay
 * on the page; only the label changes.
 *
 * A locale with no override is not flagged: there is nothing of the admin's
 * to go stale, and the site default is already correct in that language.
 */
export function editLocale(
  section: SiteSection, field: string, locale: Locale, value: string,
): SiteSection {
  const next = setSectionField(section, field, locale, value);
  const meta = fieldI18nOf(next, field);

  meta.source = locale;
  meta.state[locale] = 'reviewed';

  const cleared = readLocalized(next.content[field], locale) === undefined;
  if (cleared) {
    // The override was removed, so this locale is back on the site default
    // and cannot be anybody's source of truth.
    delete meta.state[locale];
    if (meta.source === locale) delete meta.source;
  }

  for (const other of LOCALES) {
    if (other === locale) continue;
    if (readLocalized(next.content[field], other) === undefined) continue;
    if (cleared) continue;
    meta.state[other] = 'needs_update';
  }

  return withFieldI18n(next, field, meta);
}

/** Attach a machine suggestion. Never touches the approved value. */
export function setSuggestion(
  section: SiteSection, field: string, locale: Locale, text: string,
): SiteSection {
  const meta = fieldI18nOf(section, field);
  const trimmed = text.trim();
  if (trimmed === '') {
    delete meta.suggestion[locale];
    if (meta.state[locale] === 'ai_suggested') delete meta.state[locale];
    return withFieldI18n(section, field, meta);
  }
  meta.suggestion[locale] = text;
  // A reviewed translation keeps its state: the suggestion sits beside it and
  // the badge must keep saying a human approved what is live.
  if (meta.state[locale] !== 'reviewed') meta.state[locale] = 'ai_suggested';
  return withFieldI18n(section, field, meta);
}

/**
 * Automatic translation, in `auto_all` mode.
 *
 * Writes into the draft only where no human has reviewed that locale. A
 * reviewed locale gets a suggestion instead, so "auto translate everything"
 * still cannot overwrite somebody's approved wording.
 */
export function applyAutoTranslation(
  section: SiteSection, field: string, locale: Locale, text: string,
): SiteSection {
  if (localeState(section, field, locale) === 'reviewed') {
    return setSuggestion(section, field, locale, text);
  }
  const next = setSectionField(section, field, locale, text);
  const meta = fieldI18nOf(next, field);
  meta.state[locale] = 'ai_suggested';
  delete meta.suggestion[locale];
  return withFieldI18n(next, field, meta);
}

/** Approve a suggestion: it becomes the value, and the state becomes human. */
export function applySuggestion(
  section: SiteSection, field: string, locale: Locale,
): SiteSection {
  const text = suggestionFor(section, field, locale);
  if (text === undefined) return section;
  const next = setSectionField(section, field, locale, text);
  const meta = fieldI18nOf(next, field);
  delete meta.suggestion[locale];
  meta.state[locale] = 'reviewed';
  return withFieldI18n(next, field, meta);
}

/** Throw the suggestion away. The approved value is never involved. */
export function dismissSuggestion(
  section: SiteSection, field: string, locale: Locale,
): SiteSection {
  const meta = fieldI18nOf(section, field);
  delete meta.suggestion[locale];
  if (meta.state[locale] === 'ai_suggested') delete meta.state[locale];
  return withFieldI18n(section, field, meta);
}

/** Mark a locale reviewed without changing its text, for "this is still fine". */
export function markReviewed(
  section: SiteSection, field: string, locale: Locale,
): SiteSection {
  const meta = fieldI18nOf(section, field);
  meta.state[locale] = 'reviewed';
  return withFieldI18n(section, field, meta);
}

/** Fields and locales that a translate action should act on. */
export interface TranslationTarget {
  sectionId: string;
  field: string;
  locale: Locale;
  /** The text to translate from. */
  source: string;
  sourceLocale: Locale;
}

/**
 * What "translate changed content on this page" means, concretely.
 *
 * A locale is a target when it is flagged needs_update, or when `includeMissing`
 * and the field has an override in the source locale but none here. Locales a
 * human has reviewed since the last change are left alone unless asked for.
 */
export function translationTargets(
  page: SitePageContent,
  opts: {
    sourceLocale: Locale;
    sectionId?: string;
    field?: string;
    includeMissing?: boolean;
    includeReviewed?: boolean;
  },
): TranslationTarget[] {
  const out: TranslationTarget[] = [];
  for (const section of page.sections) {
    if (opts.sectionId && section.id !== opts.sectionId) continue;
    for (const [field, text] of Object.entries(section.content)) {
      if (opts.field && field !== opts.field) continue;
      const source = readLocalized(text, opts.sourceLocale);
      if (source === undefined) continue;
      for (const locale of LOCALES) {
        if (locale === opts.sourceLocale) continue;
        const state = localeState(section, field, locale);
        const hasValue = readLocalized(text, locale) !== undefined;
        const stale = state === 'needs_update';
        const missing = !hasValue;
        const wanted =
          stale ||
          (opts.includeMissing === true && missing) ||
          (opts.includeReviewed === true && state === 'reviewed');
        if (!wanted) continue;
        out.push({ sectionId: section.id, field, locale, source, sourceLocale: opts.sourceLocale });
      }
    }
  }
  return out;
}

/** Counts for the page-level translation summary in the editor. */
export function translationSummary(page: SitePageContent): Record<Locale, {
  current: number; needsUpdate: number; suggested: number; reviewed: number;
}> {
  const base = () => ({ current: 0, needsUpdate: 0, suggested: 0, reviewed: 0 });
  const out = Object.fromEntries(LOCALES.map(l => [l, base()])) as Record<Locale, ReturnType<typeof base>>;
  for (const section of page.sections) {
    for (const field of Object.keys(section.content)) {
      for (const locale of LOCALES) {
        switch (localeState(section, field, locale)) {
          case 'needs_update': out[locale].needsUpdate += 1; break;
          case 'ai_suggested': out[locale].suggested += 1; break;
          case 'reviewed': out[locale].reviewed += 1; break;
          default: out[locale].current += 1;
        }
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Ordering and visibility                                             *
 * ------------------------------------------------------------------ */

/** Order is the array order. Explicit, and impossible to get out of sync
 *  with a separate index column that someone forgets to renumber. */
export function reorder<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice();
  if (from < 0 || from >= next.length) return next;
  const clamped = Math.max(0, Math.min(next.length - 1, to));
  const [moved] = next.splice(from, 1);
  next.splice(clamped, 0, moved);
  return next;
}

export function moveSection(page: SitePageContent, id: string, delta: number): SitePageContent {
  const from = page.sections.findIndex(s => s.id === id);
  if (from < 0) return page;
  return { ...page, sections: reorder(page.sections, from, from + delta) };
}

export function setSectionEnabled(page: SitePageContent, id: string, enabled: boolean): SitePageContent {
  return {
    ...page,
    sections: page.sections.map(s => (s.id === id ? { ...s, enabled } : s)),
  };
}

/* ------------------------------------------------------------------ *
 * Links                                                               *
 *                                                                     *
 * §17: internal routes are validated, unknown ones warn, javascript:   *
 * URLs are refused outright.                                          *
 * ------------------------------------------------------------------ */

export type LinkVerdict =
  | { ok: true; kind: 'internal' | 'external'; warning?: string }
  | { ok: false; reason: 'empty' | 'unsafe-scheme' | 'malformed' };

const UNSAFE_SCHEME = /^\s*(javascript|data|vbscript|file|blob)\s*:/i;

export function checkLink(href: string, knownRoutes: readonly string[]): LinkVerdict {
  const raw = (href ?? '').trim();
  if (raw === '') return { ok: false, reason: 'empty' };

  // Checked before anything else: a scheme test that runs after some other
  // branch has already accepted the string is a scheme test that can be
  // walked around.
  if (UNSAFE_SCHEME.test(raw)) return { ok: false, reason: 'unsafe-scheme' };

  if (raw.startsWith('/')) {
    const path = raw.split('?')[0].split('#')[0];
    // A route with a parameter segment is matched by shape, so /verify/:id
    // accepts /verify/anything.
    const known = knownRoutes.some(route => {
      if (route === path) return true;
      const rp = route.split('/');
      const pp = path.split('/');
      if (rp.length !== pp.length) return false;
      return rp.every((seg, i) => seg.startsWith(':') || seg === pp[i]);
    });
    return known
      ? { ok: true, kind: 'internal' }
      : { ok: true, kind: 'internal', warning: 'unknown-route' };
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      new URL(raw);
      return { ok: true, kind: 'external' };
    } catch {
      return { ok: false, reason: 'malformed' };
    }
  }

  return { ok: false, reason: 'malformed' };
}

/* ------------------------------------------------------------------ *
 * Normalisation                                                       *
 *                                                                     *
 * Everything arriving from the database goes through this. A row can be *
 * old, hand-edited, or written by a future version of the editor, and   *
 * none of those may be able to render an unregistered component or put  *
 * an unsafe href on the public site.                                    *
 * ------------------------------------------------------------------ */

export interface NormalizeRules {
  /** Section types that have a registered component. Anything else is dropped. */
  knownTypes: readonly string[];
  /** Variants per type. A variant not in the list falls back to 'default'. */
  variantsFor: (type: string) => readonly string[];
  knownRoutes: readonly string[];
}

function cleanLocalized(raw: unknown): LocalizedText {
  const out: LocalizedText = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const locale of LOCALES) {
    const v = (raw as Record<string, unknown>)[locale];
    if (typeof v === 'string' && v.length > 0) out[locale] = v;
  }
  return out;
}

export function normalizeSection(raw: unknown, rules: NormalizeRules): SiteSection | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const type = typeof r.type === 'string' ? r.type : '';
  if (!rules.knownTypes.includes(type)) return null;

  const id = typeof r.id === 'string' && r.id ? r.id : `${type}-${Math.random().toString(36).slice(2, 10)}`;

  const variants = rules.variantsFor(type);
  const wanted = typeof r.variant === 'string' ? r.variant : 'default';
  const variant = variants.includes(wanted) ? wanted : (variants[0] ?? 'default');

  const theme = r.theme === 'light' || r.theme === 'dark' ? r.theme : null;
  const spacing: SectionSpacing =
    r.spacing === 'compact' || r.spacing === 'spacious' ? r.spacing : 'normal';

  const content: Record<string, LocalizedText> = {};
  if (r.content && typeof r.content === 'object') {
    for (const [k, v] of Object.entries(r.content as Record<string, unknown>)) {
      const cleaned = cleanLocalized(v);
      if (Object.keys(cleaned).length) content[k] = cleaned;
    }
  }

  const i18n: Record<string, FieldI18n> = {};
  if (r.i18n && typeof r.i18n === 'object') {
    const STATES: readonly string[] = ['current', 'needs_update', 'ai_suggested', 'reviewed'];
    for (const [k, v] of Object.entries(r.i18n as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const m = v as Record<string, unknown>;
      const meta = emptyFieldI18n();
      if (typeof m.source === 'string' && (LOCALES as readonly string[]).includes(m.source)) {
        meta.source = m.source as Locale;
      }
      if (m.state && typeof m.state === 'object') {
        for (const locale of LOCALES) {
          const st = (m.state as Record<string, unknown>)[locale];
          if (typeof st === 'string' && STATES.includes(st)) meta.state[locale] = st as LocaleState;
        }
      }
      if (m.suggestion && typeof m.suggestion === 'object') {
        for (const locale of LOCALES) {
          const sg = (m.suggestion as Record<string, unknown>)[locale];
          if (typeof sg === 'string' && sg.length > 0) meta.suggestion[locale] = sg;
        }
      }
      i18n[k] = meta;
    }
  }

  const media: Record<string, SectionMedia | null> = {};
  if (r.media && typeof r.media === 'object') {
    for (const [k, v] of Object.entries(r.media as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const m = v as Record<string, unknown>;
      const url = typeof m.url === 'string' ? m.url.trim() : '';
      // An image src is a URL like any other, and a data: or javascript:
      // src is exactly the injection this whole function exists to stop.
      if (!url || UNSAFE_SCHEME.test(url)) continue;
      media[k] = { url, alt: cleanLocalized(m.alt) };
    }
  }

  const links: Record<string, SectionLink> = {};
  if (r.links && typeof r.links === 'object') {
    for (const [k, v] of Object.entries(r.links as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const l = v as Record<string, unknown>;
      const href = typeof l.href === 'string' ? l.href : '';
      const verdict = checkLink(href, rules.knownRoutes);
      if (!verdict.ok) continue;
      links[k] = { href: href.trim(), label: cleanLocalized(l.label) };
    }
  }

  return { id, type, enabled: r.enabled !== false, variant, theme, spacing, content, i18n, media, links };
}

function normalizeSeo(raw: unknown): SitePageSeo {
  const seo = emptySeo();
  if (!raw || typeof raw !== 'object') return seo;
  const r = raw as Record<string, unknown>;
  seo.title = cleanLocalized(r.title);
  seo.description = cleanLocalized(r.description);
  seo.ogTitle = cleanLocalized(r.ogTitle);
  seo.ogDescription = cleanLocalized(r.ogDescription);
  seo.ogImage = typeof r.ogImage === 'string' && r.ogImage && !UNSAFE_SCHEME.test(r.ogImage) ? r.ogImage : null;
  seo.canonical = typeof r.canonical === 'string' && r.canonical ? r.canonical : null;
  seo.noindex = r.noindex === true;
  return seo;
}

export function normalizePage(raw: unknown, rules: NormalizeRules): SitePageContent {
  if (!raw || typeof raw !== 'object') return emptyPage();
  const r = raw as Record<string, unknown>;
  if (r.schema !== 1) return emptyPage();

  const sections = Array.isArray(r.sections)
    ? r.sections.map(s => normalizeSection(s, rules)).filter((s): s is SiteSection => s !== null)
    : [];

  // Two sections cannot share an id, or selecting one in the editor would
  // edit the other.
  const seen = new Set<string>();
  const unique = sections.filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  return { schema: 1, sections: unique, seo: normalizeSeo(r.seo) };
}

/* ------------------------------------------------------------------ *
 * Versions                                                            *
 * ------------------------------------------------------------------ */

export interface SiteVersion {
  version: number;
  content: SitePageContent;
  note: string | null;
  publishedAt: string;
  publishedBy: string | null;
}

/**
 * §14: "Restoring should create a new draft/publish event rather than
 * destructively deleting history."
 *
 * So restore returns the snapshot AS A DRAFT. Nothing is removed, the
 * published page is untouched until someone publishes that draft, and the
 * version being restored from stays in the list exactly as it was.
 */
export function restoreAsDraft(snapshot: SitePageContent, rules: NormalizeRules): SitePageContent {
  return normalizePage(snapshot, rules);
}

/** The number the next publish will carry. */
export function nextVersion(versions: readonly SiteVersion[]): number {
  return versions.reduce((max, v) => Math.max(max, v.version), 0) + 1;
}

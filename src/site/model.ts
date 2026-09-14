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

/**
 * STYLE PRESETS — how a section is set, as opposed to what it says.
 *
 * Ten axes, counting `theme` and `spacing` which already existed. Every one
 * of them is a CLOSED list of named steps rather than a value an admin types,
 * and that is the whole design:
 *
 *   A named step cannot produce a colour that fails contrast, a measure that
 *   breaks the grid, or a radius that belongs to no other card on the page.
 *   A free field can do all three, and the person doing it has no way to know
 *   until somebody else notices.
 *
 *   Every step resolves to a class or a custom property the stylesheet
 *   already defines. Nothing here is inline style, so nothing here can put a
 *   raw value into the DOM — which is also why a stored value the code no
 *   longer recognises renders the default instead of an unstyled section.
 *
 * 'default' is not a value. It means "whatever this section was designed to
 * do", and it is what every axis starts at, so a section nobody has styled
 * renders byte for byte as it does today.
 */
export const STYLE_AXES = {
  /** The ground the section sits on. */
  surface: ['default', 'muted', 'contrast', 'plain'],
  /** The measure its content is held to. */
  width: ['default', 'narrow', 'wide', 'full'],
  /** Where that measure sits, when it is narrower than the page. */
  align: ['default', 'start', 'center'],
  /** Which way the words run. Distinct from `align`: a centred column of
      left-aligned text is a real and common composition. */
  textAlign: ['default', 'start', 'center'],
  /** Vertical air INSIDE the section, as opposed to around it. */
  density: ['default', 'compact'],
  /** Whether the section's highlights are gold or stay quiet. */
  accent: ['default', 'neutral'],
  /** How a card inside the section is drawn. */
  cardStyle: ['default', 'flat', 'outlined', 'elevated'],
  /** The shape of a picture inside it. */
  mediaRatio: ['default', 'square', 'wide', 'tall'],
} as const;

export type StyleAxis = keyof typeof STYLE_AXES;
export type SectionStyle = { [K in StyleAxis]: (typeof STYLE_AXES)[K][number] };

/** Every axis at 'default': the section as the code drew it. */
export function defaultStyle(): SectionStyle {
  return Object.fromEntries(
    (Object.keys(STYLE_AXES) as StyleAxis[]).map(axis => [axis, 'default']),
  ) as SectionStyle;
}

/**
 * A stored style, reduced to steps the code knows.
 *
 * Anything else — a typo, a value from a newer build, a direct database
 * write — becomes 'default'. The section then renders as designed, which is
 * the only safe answer: the alternative is a class name that resolves to no
 * rule and a section with no background.
 */
export function cleanStyle(raw: unknown): SectionStyle {
  const out = defaultStyle();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const axis of Object.keys(STYLE_AXES) as StyleAxis[]) {
    const value = r[axis];
    const allowed: readonly string[] = STYLE_AXES[axis];
    if (typeof value === 'string' && allowed.includes(value)) {
      (out as Record<string, string>)[axis] = value;
    }
  }
  return out;
}

/**
 * One repeated child of a section: a card, a step, a question.
 *
 * It carries its own id, and that id is the point. Inline editing
 * addresses "the body of item card-3 in section features-1", which stays
 * true when the card is reordered, duplicated, or edited to say something
 * else. Addressing it by position or by its current text does not.
 */
export interface SiteItem {
  id: string;
  content: Record<string, LocalizedText>;
  /**
   * Translation state for this child, kept ON the child.
   *
   * The alternative was to namespace item fields into the section's own i18n
   * map, under keys like "card-3.title". That map would then need pruning
   * whenever a card was deleted and rewriting whenever one was duplicated --
   * two bookkeeping jobs that simply do not exist if the state travels with
   * the thing it describes.
   */
  i18n: Record<string, FieldI18n>;
  media: Record<string, SectionMedia | null>;
  /** Icon NAMES from the curated set — never markup. See normalizeItem. */
  icons: Record<string, string>;
}

export interface SiteSection {
  /** Stable across reorders and versions. */
  id: string;
  type: string;
  enabled: boolean;
  /** Must be one of the variants the registry declares for this type. */
  variant: string;
  theme: SectionTheme | null;
  spacing: SectionSpacing;
  /**
   * How the section is set. See STYLE_AXES.
   *
   * Beside `variant` rather than inside it, because they answer different
   * questions. A variant is a LAYOUT the component implements and the
   * registry declares — 'console_focus' exists only where somebody wrote it.
   * A style is a presentation step that every section understands, because it
   * is applied by the renderer rather than by the component.
   */
  style: SectionStyle;
  content: Record<string, LocalizedText>;
  /** Translation state and pending suggestions, per field. Kept BESIDE
   *  `content` rather than inside it, so the approved value and the machine's
   *  opinion of it can never occupy the same slot. */
  i18n: Record<string, FieldI18n>;
  media: Record<string, SectionMedia | null>;
  links: Record<string, SectionLink>;
  /**
   * Icon choices, by slot. A NAME from the curated set, not markup.
   *
   * That is the safety argument for letting an admin change an icon at
   * all: an icon slot cannot hold an <svg onload=...> because it does not
   * hold markup. A name the code does not recognise falls back to the
   * icon the section ships.
   */
  icons: Record<string, string>;
  /** Repeated children, in the order they render. */
  items: SiteItem[];
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
    style: defaultStyle(),
    content: {}, i18n: {}, media: {}, links: {}, icons: {}, items: [],
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

export function setSectionField<T extends FieldHost>(
  host: T, field: string, locale: Locale, value: string,
): T {
  return {
    ...host,
    content: { ...host.content, [field]: setLocalized(host.content[field], locale, value) },
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

/**
 * ANYTHING THAT HOLDS TRANSLATABLE FIELDS.
 *
 * A section holds them. So does each repeated child of a section -- a card, a
 * step, a question. Both need the same rules: an edit touches one locale, the
 * others are flagged rather than changed, a machine suggestion sits beside the
 * approved value instead of replacing it, and automatic translation refuses to
 * overwrite what a person reviewed.
 *
 * Those rules are written once, below, against this shape. The generic
 * parameter is what keeps them ONE implementation rather than two: a card that
 * translated by slightly different rules from the section around it is exactly
 * the kind of divergence nobody notices until a published page is half in the
 * wrong language.
 */
export interface FieldHost {
  content: Record<string, LocalizedText>;
  i18n: Record<string, FieldI18n>;
}

function fieldI18nOf(host: FieldHost, field: string): FieldI18n {
  const existing = host.i18n?.[field];
  return existing ? { ...existing, state: { ...existing.state }, suggestion: { ...existing.suggestion } }
    : emptyFieldI18n();
}

function withFieldI18n<T extends FieldHost>(host: T, field: string, meta: FieldI18n): T {
  return { ...host, i18n: { ...host.i18n, [field]: meta } };
}

/**
 * The state to show for one locale of one field.
 *
 * Derived rather than stored wherever possible: a locale with no override is
 * showing the site's own reviewed copy, so it is `current`, not "missing".
 */
export function localeState(
  host: FieldHost, field: string, locale: Locale,
): LocaleState {
  const stored = host.i18n?.[field]?.state?.[locale];
  if (stored) return stored;
  return 'current';
}

export function suggestionFor(
  host: FieldHost, field: string, locale: Locale,
): string | undefined {
  const v = host.i18n?.[field]?.suggestion?.[locale];
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
export function editLocale<T extends FieldHost>(
  host: T, field: string, locale: Locale, value: string,
): T {
  const next = setSectionField(host, field, locale, value);
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
export function setSuggestion<T extends FieldHost>(
  host: T, field: string, locale: Locale, text: string,
): T {
  const meta = fieldI18nOf(host, field);
  const trimmed = text.trim();
  if (trimmed === '') {
    delete meta.suggestion[locale];
    if (meta.state[locale] === 'ai_suggested') delete meta.state[locale];
    return withFieldI18n(host, field, meta);
  }
  meta.suggestion[locale] = text;
  // A reviewed translation keeps its state: the suggestion sits beside it and
  // the badge must keep saying a human approved what is live.
  if (meta.state[locale] !== 'reviewed') meta.state[locale] = 'ai_suggested';
  return withFieldI18n(host, field, meta);
}

/**
 * Automatic translation, in `auto_all` mode.
 *
 * Writes into the draft only where no human has reviewed that locale. A
 * reviewed locale gets a suggestion instead, so "auto translate everything"
 * still cannot overwrite somebody's approved wording.
 */
export function applyAutoTranslation<T extends FieldHost>(
  host: T, field: string, locale: Locale, text: string,
): T {
  if (localeState(host, field, locale) === 'reviewed') {
    return setSuggestion(host, field, locale, text);
  }
  const next = setSectionField(host, field, locale, text);
  const meta = fieldI18nOf(next, field);
  meta.state[locale] = 'ai_suggested';
  delete meta.suggestion[locale];
  return withFieldI18n(next, field, meta);
}

/** Approve a suggestion: it becomes the value, and the state becomes human. */
export function applySuggestion<T extends FieldHost>(
  host: T, field: string, locale: Locale,
): T {
  const text = suggestionFor(host, field, locale);
  if (text === undefined) return host;
  const next = setSectionField(host, field, locale, text);
  const meta = fieldI18nOf(next, field);
  delete meta.suggestion[locale];
  meta.state[locale] = 'reviewed';
  return withFieldI18n(next, field, meta);
}

/** Throw the suggestion away. The approved value is never involved. */
export function dismissSuggestion<T extends FieldHost>(
  host: T, field: string, locale: Locale,
): T {
  const meta = fieldI18nOf(host, field);
  delete meta.suggestion[locale];
  if (meta.state[locale] === 'ai_suggested') delete meta.state[locale];
  return withFieldI18n(host, field, meta);
}

/** Mark a locale reviewed without changing its text, for "this is still fine". */
export function markReviewed<T extends FieldHost>(
  host: T, field: string, locale: Locale,
): T {
  const meta = fieldI18nOf(host, field);
  meta.state[locale] = 'reviewed';
  return withFieldI18n(host, field, meta);
}

/** Fields and locales that a translate action should act on. */
export interface TranslationTarget {
  sectionId: string;
  /** Set when the field belongs to a repeated child rather than the section. */
  itemId?: string;
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

  /* One host's fields. A section and each of its children are walked by the
     same function, so a card cannot be quietly left out of a translate run. */
  const collect = (host: FieldHost, sectionId: string, itemId?: string) => {
    for (const [field, text] of Object.entries(host.content)) {
      if (opts.field && field !== opts.field) continue;
      const source = readLocalized(text, opts.sourceLocale);
      if (source === undefined) continue;
      for (const locale of LOCALES) {
        if (locale === opts.sourceLocale) continue;
        const state = localeState(host, field, locale);
        const hasValue = readLocalized(text, locale) !== undefined;
        const stale = state === 'needs_update';
        const missing = !hasValue;
        const wanted =
          stale ||
          (opts.includeMissing === true && missing) ||
          (opts.includeReviewed === true && state === 'reviewed');
        if (!wanted) continue;
        out.push({ sectionId, itemId, field, locale, source, sourceLocale: opts.sourceLocale });
      }
    }
  };

  for (const section of page.sections) {
    if (opts.sectionId && section.id !== opts.sectionId) continue;
    collect(section, section.id);
    for (const item of section.items) collect(item, section.id, item.id);
  }
  return out;
}

/** Counts for the page-level translation summary in the editor. */
export function translationSummary(page: SitePageContent): Record<Locale, {
  current: number; needsUpdate: number; suggested: number; reviewed: number;
}> {
  const base = () => ({ current: 0, needsUpdate: 0, suggested: 0, reviewed: 0 });
  const out = Object.fromEntries(LOCALES.map(l => [l, base()])) as Record<Locale, ReturnType<typeof base>>;

  const count = (host: FieldHost) => {
    for (const field of Object.keys(host.content)) {
      for (const locale of LOCALES) {
        switch (localeState(host, field, locale)) {
          case 'needs_update': out[locale].needsUpdate += 1; break;
          case 'ai_suggested': out[locale].suggested += 1; break;
          case 'reviewed': out[locale].reviewed += 1; break;
          default: out[locale].current += 1;
        }
      }
    }
  };

  for (const section of page.sections) {
    count(section);
    // The summary is what tells an admin a language is finished. A page whose
    // cards were never translated must not be able to report that it is.
    for (const item of section.items) count(item);
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

/**
 * Insert a new section directly below `afterId`.
 *
 * An `afterId` that is not on the page appends, rather than throwing or
 * dropping the section: the page is the source of truth, and a stale id
 * from a control the admin clicked must not silently lose the action.
 */
/**
 * Put the sections in exactly this order.
 *
 * The delta version above answers "one step up"; a drag answers "this whole
 * order, now". Reconciling a drag into a series of deltas is arithmetic
 * nobody should have to trust, so the drag reports the order it produced and
 * this validates it: the ids must be a permutation of the page's own, or the
 * page is returned untouched. That makes a stale drag — a section deleted in
 * another tab mid-gesture — a no-op rather than a way to drop content.
 */
export function orderSections(page: SitePageContent, ids: readonly string[]): SitePageContent {
  const byId = new Map(page.sections.map(s => [s.id, s]));
  if (ids.length !== page.sections.length) return page;
  const next: SiteSection[] = [];
  for (const id of ids) {
    const found = byId.get(id);
    if (!found) return page;
    byId.delete(id);
    next.push(found);
  }
  return { ...page, sections: next };
}

/** The same contract, for a section's children. */
export function orderItems(section: SiteSection, ids: readonly string[]): SiteSection {
  const byId = new Map(section.items.map(i => [i.id, i]));
  if (ids.length !== section.items.length) return section;
  const next: SiteItem[] = [];
  for (const id of ids) {
    const found = byId.get(id);
    if (!found) return section;
    byId.delete(id);
    next.push(found);
  }
  return { ...section, items: next };
}

export function insertSectionAfter(
  page: SitePageContent, type: string, id: string, afterId?: string,
): SitePageContent {
  const sections = [...page.sections];
  const at = afterId ? sections.findIndex(s => s.id === afterId) : -1;
  const created = makeSection(type, id);
  if (at === -1) sections.push(created);
  else sections.splice(at + 1, 0, created);
  return { ...page, sections };
}

/**
 * Copy a section, with everything it says, directly below itself.
 *
 * The clone is DEEP. A section's content, media and i18n bookkeeping are
 * nested objects, so a spread would leave the copy sharing the original's
 * localized strings — and editing either one would change both, in every
 * language, with nothing on screen to suggest why.
 *
 * Returns the page unchanged when the id is unknown, so a caller cannot
 * corrupt the page by acting on a section that has already gone.
 */
export function duplicateSection(
  page: SitePageContent, id: string, newId: string,
): SitePageContent {
  const at = page.sections.findIndex(s => s.id === id);
  if (at < 0) return page;
  const copy: SiteSection = { ...structuredClone(page.sections[at]), id: newId };
  const sections = [...page.sections];
  sections.splice(at + 1, 0, copy);
  return { ...page, sections };
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

/*
 * THE FOUR CLEANERS.
 *
 * A section and each of its children store the same four kinds of thing, so
 * they are cleaned by the same four functions. That is not tidiness: the
 * media cleaner is where a javascript: URL stops being an image src, and a
 * second copy of that check, written later, for children, is precisely the
 * copy that would be missing a case.
 */

function cleanContent(raw: unknown): Record<string, LocalizedText> {
  const out: Record<string, LocalizedText> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const cleaned = cleanLocalized(v);
    if (Object.keys(cleaned).length) out[k] = cleaned;
  }
  return out;
}

function cleanI18n(raw: unknown): Record<string, FieldI18n> {
  const out: Record<string, FieldI18n> = {};
  if (!raw || typeof raw !== 'object') return out;
  const STATES: readonly string[] = ['current', 'needs_update', 'ai_suggested', 'reviewed'];
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
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
    out[k] = meta;
  }
  return out;
}

function cleanMedia(raw: unknown): Record<string, SectionMedia | null> {
  const out: Record<string, SectionMedia | null> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const m = v as Record<string, unknown>;
    const url = typeof m.url === 'string' ? m.url.trim() : '';
    // An image or video src is a URL like any other, and a data: or
    // javascript: src is exactly the injection this function exists to stop.
    if (!url || UNSAFE_SCHEME.test(url)) continue;
    out[k] = { url, alt: cleanLocalized(m.alt) };
  }
  return out;
}

/**
 * Icon choices: a NAME, never markup.
 *
 * Length-capped and character-restricted here so that even if a future caller
 * forgets to check the name against the curated set, what reaches the DOM is
 * a short identifier rather than an arbitrary string.
 */
function cleanIcons(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'string') continue;
    const name = v.trim();
    if (name && name.length <= 48 && /^[A-Za-z0-9-]+$/.test(name)) out[k] = name;
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
  const style = cleanStyle(r.style);

  const content = cleanContent(r.content);
  const i18n = cleanI18n(r.i18n);
  const media = cleanMedia(r.media);

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

  const icons = cleanIcons(r.icons);

  const items: SiteItem[] = [];
  if (Array.isArray(r.items)) {
    for (const raw of r.items) {
      const item = normalizeItem(raw);
      if (item) items.push(item);
    }
  }

  return {
    id, type, enabled: r.enabled !== false, variant, theme, spacing, style,
    content, i18n, media, links, icons, items,
  };
}

/**
 * One repeated child, cleaned.
 *
 * Returns null for anything that is not an object, so a malformed entry
 * drops out of the list rather than rendering as a blank card.
 */
export function normalizeItem(raw: unknown): SiteItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const id = typeof r.id === 'string' && r.id
    ? r.id
    : `item-${Math.random().toString(36).slice(2, 10)}`;

  return {
    id,
    content: cleanContent(r.content),
    i18n: cleanI18n(r.i18n),
    media: cleanMedia(r.media),
    icons: cleanIcons(r.icons),
  };
}

/** A new, empty repeated child. */
export function makeItem(id: string): SiteItem {
  return { id, content: {}, i18n: {}, media: {}, icons: {} };
}

/**
 * Apply an operation to ONE child, and leave the rest of the page identical.
 *
 * Every item-level edit goes through here, which is why each of them is a
 * one-liner below. Returning the section unchanged when the operation was a
 * no-op matters more than it looks: the editor treats a new page object as a
 * change worth recording, so an edit that changed nothing would otherwise
 * cost an undo step and mark a clean draft dirty.
 */
export function onItem(
  section: SiteSection, itemId: string, fn: (item: SiteItem) => SiteItem,
): SiteSection {
  const at = section.items.findIndex(i => i.id === itemId);
  if (at < 0) return section;
  const next = fn(section.items[at]);
  if (next === section.items[at]) return section;
  const items = [...section.items];
  items[at] = next;
  return { ...section, items };
}

/**
 * Move a repeated child within its section.
 *
 * Bounds are a no-op rather than a wrap: an editor pressing "up" on the
 * first card means nothing, and must not mean "send it to the bottom".
 */
export function moveItem(section: SiteSection, itemId: string, delta: number): SiteSection {
  const from = section.items.findIndex(i => i.id === itemId);
  if (from < 0) return section;
  const to = from + delta;
  if (to < 0 || to >= section.items.length) return section;
  return { ...section, items: reorder(section.items, from, to) };
}

/** Add a child, at the end or directly after another. */
export function addItem(section: SiteSection, id: string, afterId?: string): SiteSection {
  const items = [...section.items];
  const at = afterId ? items.findIndex(i => i.id === afterId) : -1;
  const created = makeItem(id);
  if (at === -1) items.push(created);
  else items.splice(at + 1, 0, created);
  return { ...section, items };
}

/** Remove a child. An unknown id changes nothing. */
export function removeItem(section: SiteSection, itemId: string): SiteSection {
  if (!section.items.some(i => i.id === itemId)) return section;
  return { ...section, items: section.items.filter(i => i.id !== itemId) };
}

/**
 * Copy a child, directly below itself.
 *
 * Deep-cloned for the same reason a duplicated SECTION is: the localized
 * strings are nested objects, and a shallow copy would leave two cards
 * sharing one set of words in six languages.
 */
export function duplicateItem(section: SiteSection, itemId: string, newId: string): SiteSection {
  const at = section.items.findIndex(i => i.id === itemId);
  if (at < 0) return section;
  const copy: SiteItem = { ...structuredClone(section.items[at]), id: newId };
  const items = [...section.items];
  items.splice(at + 1, 0, copy);
  return { ...section, items };
}

/**
 * A human edit to one locale of one repeated child.
 *
 * Deliberately editLocale, not a private copy of it: a card's words are
 * flagged, sourced and protected from automatic overwriting by exactly the
 * rules that govern the heading above the card.
 */
export function editItemField(
  section: SiteSection, itemId: string, field: string, locale: Locale, value: string,
): SiteSection {
  return onItem(section, itemId, item => editLocale(item, field, locale, value));
}

/** Set, or clear, one icon slot on a repeated child. */
export function setItemIcon(
  section: SiteSection, itemId: string, slot: string, name: string | null,
): SiteSection {
  return onItem(section, itemId, item => {
    const icons = { ...item.icons };
    if (name === null) delete icons[slot];
    else icons[slot] = name;
    return { ...item, icons };
  });
}

/** Set, or clear, one icon slot on the section itself. */
export function setSectionIcon(
  section: SiteSection, slot: string, name: string | null,
): SiteSection {
  const icons = { ...section.icons };
  if (name === null) delete icons[slot];
  else icons[slot] = name;
  return { ...section, icons };
}

/** Set, or clear, one media slot on a repeated child. */
export function setItemMedia(
  section: SiteSection, itemId: string, slot: string,
  value: SectionMedia | null,
): SiteSection {
  return onItem(section, itemId, item => {
    const media = { ...item.media };
    if (value === null) delete media[slot];
    else media[slot] = value;
    return { ...item, media };
  });
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

import React, { createContext, useContext, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { readLocalized, type Locale, type SiteItem, type SiteSection } from './model';
import { iconFor } from './icons';
import { isVideo, parseVideo, type VideoRef } from './video';
import type { LucideIcon } from 'lucide-react';

/**
 * HOW A SECTION READS ITS COPY
 *
 * A section component asks for a FIELD and names the translation key it has
 * always used:
 *
 *   const sf = useSectionField();
 *   sf('title', 'mp_hero_h1')
 *
 * With no stored content that returns t('mp_hero_h1'), which is the string
 * the site ships today, reviewed in six languages. With an override saved
 * for the current locale it returns the override instead.
 *
 * That ordering is the whole safety argument for this feature. An empty
 * database renders today's website. A failed fetch renders today's website.
 * A section the admin has never touched renders today's website. Nothing in
 * Site Studio can take copy AWAY from the public site, only add to it.
 *
 * The fallback key is typed as TranslationKey, so a typo is a compile error
 * rather than a blank heading discovered in production.
 */

interface SectionScopeValue {
  section: SiteSection | null;
  /** Set only inside the editor, where clicking the preview selects. */
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  /**
   * True only inside Site Studio.
   *
   * Sections use this to mark the elements that render editable copy, and
   * to show a prompt where a field is empty. On the public site it is
   * false and every one of those additions costs nothing: no attributes,
   * no wrappers, nothing extra in what a visitor downloads.
   */
  editing?: boolean;
}

const SectionScopeCtx = createContext<SectionScopeValue>({ section: null });

export function SectionScope({
  section, onSelect, selectedId, editing, children,
}: SectionScopeValue & { children: React.ReactNode }) {
  const value = useMemo(
    () => ({ section, onSelect, selectedId, editing }),
    [section, onSelect, selectedId, editing],
  );
  return <SectionScopeCtx.Provider value={value}>{children}</SectionScopeCtx.Provider>;
}

export function useSectionScope(): SectionScopeValue {
  return useContext(SectionScopeCtx);
}

/** Resolve a section field: stored override for this locale, else the key. */
export function useSectionField(): (field: string, fallbackKey: TranslationKey) => string {
  const { section } = useContext(SectionScopeCtx);
  const { t, lang } = useLanguage();
  return (field, fallbackKey) => (
    readLocalized(section?.content[field], lang as Locale) ?? t(fallbackKey)
  );
}

/** The attribute names the editor looks for. One place, so they cannot drift. */
export const FIELD_ATTR = {
  section: 'data-hm-section',
  field: 'data-hm-field',
  item: 'data-hm-item',
  /** On the ELEMENT that wraps a whole repeated child, not on its fields. */
  itemRoot: 'data-hm-item-root',
  locale: 'data-hm-locale',
} as const;

export interface MediaMark {
  'data-hm-section'?: string;
  'data-hm-media'?: string;
}

/**
 * WHICH IMAGE SLOT THIS ELEMENT SHOWS.
 *
 * Spread onto the element that wraps a picture, the same way useFieldProps
 * is spread onto the element that carries a piece of copy. It is what lets
 * an admin click the photograph they can see and be offered THAT
 * photograph, instead of finding the right slot in a form and hoping.
 */
export function useMediaProps(): (slot: string) => MediaMark {
  const { section, editing } = useContext(SectionScopeCtx);
  return (slot) => {
    if (!editing || !section) return {};
    return { [FIELD_ATTR.section]: section.id, 'data-hm-media': slot };
  };
}

export interface ItemMark {
  'data-hm-section'?: string;
  'data-hm-item-root'?: string;
}

/**
 * WHICH REPEATED CHILD THIS ELEMENT IS.
 *
 * Spread onto the element that wraps a whole card, question or step — not
 * onto its individual fields, which carry useFieldProps instead.
 *
 * The editor uses it to put that child's own controls on it: move up, move
 * down, duplicate, delete, on the thing itself rather than in a list an admin
 * has to map back to what they can see.
 */
export function useItemProps(): (itemId: string) => ItemMark {
  const { section, editing } = useContext(SectionScopeCtx);
  return itemId => {
    if (!editing || !section) return {};
    return { [FIELD_ATTR.section]: section.id, [FIELD_ATTR.itemRoot]: itemId };
  };
}

export interface FieldMark {
  'data-hm-section'?: string;
  'data-hm-field'?: string;
  'data-hm-item'?: string;
  'data-hm-locale'?: string;
}

/**
 * WHICH MODEL FIELD THIS ELEMENT IS.
 *
 * Spread onto the element that actually renders a piece of copy:
 *
 *   <h1 className="..." {...fp('title')}>{sf('title', 'mp_hero_h1')}</h1>
 *
 * The editor then knows, from the DOM node alone, exactly which section,
 * field, repeated item and locale a caret is sitting in. That identity is
 * the whole point.
 *
 * WHY NOT MATCH ON THE TEXT
 *
 * The first version of inline editing found elements by comparing their
 * rendered text to the value the model held. It worked once and then
 * broke: the comparison ran against the value from BEFORE the edit, so a
 * field stopped being editable the moment it was edited, and two fields
 * that happened to say the same thing were indistinguishable. Identity
 * cannot be derived from content that is about to change.
 *
 * Returns nothing at all outside the editor, so the public site's HTML is
 * byte for byte what it was before.
 */
export function useFieldProps(): (field: string, item?: string) => FieldMark {
  const { section, editing } = useContext(SectionScopeCtx);
  const { lang } = useLanguage();
  return (field, item) => {
    if (!editing || !section) return {};
    return {
      [FIELD_ATTR.section]: section.id,
      [FIELD_ATTR.field]: field,
      [FIELD_ATTR.locale]: lang,
      ...(item ? { [FIELD_ATTR.item]: item } : {}),
    };
  };
}

/**
 * The override for a field, or undefined. No fallback, by design.
 *
 * For the one section type whose content is admin-authored rather than
 * shipped in the code (rich_text). Everything else must use useSectionField,
 * which cannot return undefined, so a missing override can never blank a
 * region of the public site.
 */
export function useSectionRaw(): (field: string) => string | undefined {
  const { section } = useContext(SectionScopeCtx);
  const { lang } = useLanguage();
  return field => readLocalized(section?.content[field], lang as Locale);
}

/**
 * Is this section being rendered INSIDE Site Studio?
 *
 * A section may legitimately render nothing on the public site — an
 * announcement nobody has written yet — and still need to be visible and
 * writable in the editor, which is the one place its absence is a problem
 * to be solved rather than the correct result.
 */
export function useIsEditing(): boolean {
  return useContext(SectionScopeCtx).editing === true;
}

/** The section's own settings, with defaults when rendered outside a scope. */
export function useSectionSettings(): Pick<SiteSection, 'variant' | 'theme' | 'spacing'> {
  const { section } = useContext(SectionScopeCtx);
  return {
    variant: section?.variant ?? 'default',
    theme: section?.theme ?? null,
    spacing: section?.spacing ?? 'normal',
  };
}

/** An image the admin may have replaced, else whatever the code shipped. */
export function useSectionMedia(): (slot: string) => { url: string; alt: string } | null {
  const { section } = useContext(SectionScopeCtx);
  const { lang } = useLanguage();
  return slot => {
    const m = section?.media[slot];
    if (!m) return null;
    return { url: m.url, alt: readLocalized(m.alt, lang as Locale) ?? '' };
  };
}

/* ------------------------------------------------------------------ *
 * Repeated children                                                    *
 * ------------------------------------------------------------------ */

/**
 * The section's children, in order.
 *
 * Empty outside a scope and empty for a section that has none, so a component
 * can map over this without asking whether it is on the public site, in the
 * editor, or being rendered with no stored content at all.
 */
export function useSectionItems(): SiteItem[] {
  const { section } = useContext(SectionScopeCtx);
  return section?.items ?? [];
}

/**
 * One field of one child.
 *
 * No fallback translation key, deliberately, and for the same reason
 * useSectionRaw has none: a card exists only because an admin created it, so
 * there is no shipped six-language copy for it to fall back TO. A card
 * without words in this language renders without words; see the section
 * components for what they do about that.
 */
export function useItemField(): (item: SiteItem, field: string) => string | undefined {
  const { lang } = useLanguage();
  return (item, field) => readLocalized(item.content[field], lang as Locale);
}

/**
 * The icon a child asked for, or the one the section ships.
 *
 * Resolved through iconFor, so a stored name this build no longer has renders
 * the fallback instead of a hole. That matters more than it sounds: icon sets
 * get curated, and a page published last year must not break because a glyph
 * was retired this year.
 */
export function useItemIcon(): (item: SiteItem, slot: string, fallback: LucideIcon) => LucideIcon {
  return (item, slot, fallback) => iconFor(item.icons[slot], fallback);
}

/**
 * The NAME stored in an icon slot, or undefined if nobody chose one.
 *
 * useSectionIcon always returns a component -- the fallback when unset -- so
 * it cannot answer "has an admin picked one here?". A component that keeps
 * its own drawn glyph until overridden needs to know the difference.
 */
export function useSectionIconName(): (slot: string) => string | undefined {
  const { section } = useContext(SectionScopeCtx);
  return slot => section?.icons[slot];
}

/** The same, for an icon slot on the section itself. */
export function useSectionIcon(): (slot: string, fallback: LucideIcon) => LucideIcon {
  const { section } = useContext(SectionScopeCtx);
  return (slot, fallback) => iconFor(section?.icons[slot], fallback);
}

/**
 * The video in a slot, already checked and turned into something embeddable.
 *
 * Returns null for a slot that is empty OR that holds an address the
 * allowlist refuses. The refusal happens here, at render, and not only in the
 * editor, because the stored value could have arrived from an older build, a
 * restored version, or a direct database write.
 */
export function useSectionVideo(): (slot: string) => VideoRef | null {
  const { section } = useContext(SectionScopeCtx);
  return slot => {
    const url = section?.media[slot]?.url;
    if (!url) return null;
    const parsed = parseVideo(url);
    return isVideo(parsed) ? parsed : null;
  };
}

/** Vertical rhythm, as one of three sanctioned steps. §11: no raw margins. */
export function spacingClass(spacing: SiteSection['spacing']): string {
  switch (spacing) {
    case 'compact': return 'py-10 sm:py-14 lg:py-20';
    case 'spacious': return 'py-20 sm:py-28 lg:py-36';
    default: return 'py-14 sm:py-20 lg:py-28';
  }
}

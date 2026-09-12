import React, { createContext, useContext, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { readLocalized, type Locale, type SiteSection } from './model';

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
   * Editor only: called with the exact string a field just rendered as.
   *
   * This is what makes click-to-edit possible without rewriting all
   * nineteen section components. useSectionField returns a STRING — the
   * components interpolate it into JSX and into attributes like
   * `placeholder`, so it cannot become a React element without breaking
   * them. Recording the value instead lets the edit layer find the element
   * that rendered it and make THAT editable, and it means only fields the
   * registry declares are ever editable.
   */
  recordField?: (field: string, value: string) => void;
}

const SectionScopeCtx = createContext<SectionScopeValue>({ section: null });

export function SectionScope({
  section, onSelect, selectedId, recordField, children,
}: SectionScopeValue & { children: React.ReactNode }) {
  const value = useMemo(
    () => ({ section, onSelect, selectedId, recordField }),
    [section, onSelect, selectedId, recordField],
  );
  return <SectionScopeCtx.Provider value={value}>{children}</SectionScopeCtx.Provider>;
}

export function useSectionScope(): SectionScopeValue {
  return useContext(SectionScopeCtx);
}

/** Resolve a section field: stored override for this locale, else the key. */
export function useSectionField(): (field: string, fallbackKey: TranslationKey) => string {
  const { section, recordField } = useContext(SectionScopeCtx);
  const { t, lang } = useLanguage();
  return (field, fallbackKey) => {
    const value = readLocalized(section?.content[field], lang as Locale) ?? t(fallbackKey);
    // A no-op everywhere except inside Site Studio.
    recordField?.(field, value);
    return value;
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
 * `recordField` is supplied only by the editor's preview, so its presence
 * is the honest signal. A section may legitimately render nothing on the
 * public site — an announcement nobody has written yet — and still need
 * to be visible and writable in the editor, which is the one place its
 * absence is a problem to be solved rather than the correct result.
 */
export function useIsEditing(): boolean {
  return useContext(SectionScopeCtx).recordField !== undefined;
}

/**
 * Announce what a field rendered as, so the editor can find it in the DOM.
 *
 * useSectionField does this for itself. A section that renders a value it
 * did NOT get from there — a placeholder standing in for empty copy —
 * has to say so, or inline editing will not see it.
 */
export function useRecordField(): (field: string, value: string) => void {
  const { recordField } = useContext(SectionScopeCtx);
  return (field, value) => recordField?.(field, value);
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

/** Vertical rhythm, as one of three sanctioned steps. §11: no raw margins. */
export function spacingClass(spacing: SiteSection['spacing']): string {
  switch (spacing) {
    case 'compact': return 'py-10 sm:py-14 lg:py-20';
    case 'spacious': return 'py-20 sm:py-28 lg:py-36';
    default: return 'py-14 sm:py-20 lg:py-28';
  }
}

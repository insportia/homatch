// HOMATCH — getting around inside one long page.
//
// WHY THIS IS NOT IN THE HEADER
//
// About used to put its three sections — what, market, sources — into the
// site header, as though they were destinations of the same kind as Verify
// and Pricing. They are not: they are parts of the page you are already on,
// and mixing the two is how nine pages ended up with four different global
// navigations. The header now shows the product; this shows the page.
//
// It is real anchors rather than scroll handlers, so it works with the
// keyboard, with middle-click, with "copy link address", and with the back
// button. ScrollToTop deliberately leaves a location carrying a hash alone,
// which is what lets these land where they point.

import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';

export interface LocalSection {
  /** The `id` of the element on this page. */
  id: string;
  labelKey: TranslationKey;
}

/**
 * A quiet row of in-page links, under the header.
 *
 * Horizontally scrollable rather than wrapped: six languages disagree about
 * how long these words are, and a second line here would push the page's
 * actual first sentence below the fold on a phone.
 */
export function LocalSectionNav({ sections, ariaLabelKey }: {
  sections: LocalSection[];
  ariaLabelKey: TranslationKey;
}) {
  const { t } = useLanguage();
  if (sections.length === 0) return null;

  return (
    <nav
      aria-label={t(ariaLabelKey)}
      className="sticky top-16 z-30 border-b border-border/70 bg-background/85 backdrop-blur md:top-20"
    >
      <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map(section => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="whitespace-nowrap rounded-full px-3.5 py-2 text-sm text-ink-soft transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t(section.labelKey)}
          </a>
        ))}
      </div>
    </nav>
  );
}

export default LocalSectionNav;

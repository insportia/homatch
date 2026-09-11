import React, { useMemo } from 'react';
import { LanguageOverride } from '@/contexts/LanguageContext';
import { SitePage } from '@/site/render/SitePage';
import { RTL_LANGUAGES } from '@/types/types';
import type { Locale, SitePageContent } from '@/site/model';
import type { SupportedLanguage } from '@/types/types';

/**
 * THE LIVE PREVIEW
 *
 * The real page components, rendered with the draft, in the language being
 * edited. Not a screenshot, not an approximation, and not an iframe.
 *
 * WHY NOT AN IFRAME
 *
 * An iframe would need its own document, its own copy of the stylesheet and
 * a message channel to carry the unsaved draft across, and it would still
 * not be the live site: it would be a second rendering of it. Rendering the
 * same components in place means the preview cannot drift from production by
 * construction, and clicking a section can select it directly.
 *
 * DEVICE WIDTHS
 *
 * The frame is resized, not scaled. A 375px-wide container makes the page's
 * own container queries and `sizes` attributes behave exactly as they do on a
 * phone, where a CSS transform would keep desktop breakpoints active and show
 * a shrunken desktop layout instead of the mobile one. This matters here
 * specifically: the mobile Intelligence Layers composition is a different
 * layout, not a narrower one.
 */

export const DEVICE_WIDTHS = [
  { key: 'desktop', width: null as number | null, labelKey: 'studio_device_desktop' },
  { key: 'tablet', width: 834, labelKey: 'studio_device_tablet' },
  { key: 'p430', width: 430, labelKey: null },
  { key: 'p390', width: 390, labelKey: null },
  { key: 'p375', width: 375, labelKey: null },
  { key: 'p320', width: 320, labelKey: null },
] as const;

export type DeviceKey = typeof DEVICE_WIDTHS[number]['key'];

interface StudioPreviewProps {
  slug: string;
  content: SitePageContent;
  locale: Locale;
  device: DeviceKey;
  /** Preview the page mirrored, without flipping the editor around it. */
  forceRTL: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function StudioPreview({
  slug, content, locale, device, forceRTL, selectedId, onSelect,
}: StudioPreviewProps) {
  const width = useMemo(
    () => DEVICE_WIDTHS.find(d => d.key === device)?.width ?? null,
    [device],
  );

  const rtl = forceRTL || RTL_LANGUAGES.includes(locale as SupportedLanguage);

  return (
    <div className="flex h-full justify-center overflow-auto bg-muted/40 p-4">
      <div
        // A white page on a grey ground, at the chosen width, with the
        // light-surface tokens the public site uses. The editor chrome around
        // it keeps its own theme.
        data-surface="light"
        dir={rtl ? 'rtl' : 'ltr'}
        lang={locale}
        className="h-fit w-full origin-top bg-background shadow-sm ring-1 ring-border"
        style={width ? { maxWidth: `${width}px` } : undefined}
      >
        <LanguageOverride lang={locale as SupportedLanguage}>
          <SitePage
            slug={slug}
            content={content}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </LanguageOverride>
      </div>
    </div>
  );
}

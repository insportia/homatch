import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LanguageOverride } from '@/contexts/LanguageContext';
import { SitePage } from '@/site/render/SitePage';
import { RTL_LANGUAGES } from '@/types/types';
import type { Locale, SitePageContent } from '@/site/model';
import type { SupportedLanguage } from '@/types/types';

/**
 * THE LIVE PREVIEW
 *
 * The real page components, rendered with the draft, in the language being
 * edited. Not a screenshot and not an approximation: the same components the
 * public site renders, so the preview cannot drift from production.
 *
 * They are rendered THROUGH A PORTAL into an iframe, for viewport semantics
 * a plain container cannot give. See PreviewFrame below for what went wrong
 * without it; the short version is that a narrow div is not a narrow
 * viewport, and the difference is the whole mobile layout.
 *
 * DEVICE WIDTHS
 *
 * The frame is resized, not scaled. A CSS transform would keep desktop
 * breakpoints active and show a shrunken desktop layout; resizing a real
 * viewport makes the page's own media queries and `sizes` attributes behave
 * exactly as they do on a phone. That matters here specifically: the mobile
 * Intelligence Layers composition is a different layout, not a narrower one.
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

/**
 * The device frame, and why it is an iframe.
 *
 * The obvious implementation is a plain div with a max-width, and it is
 * wrong in a way that is easy to miss and actively misleading. A narrow div
 * is not a narrow VIEWPORT:
 *
 *   - `vw` units resolve against the browser window, not the div. The hero's
 *     clamp(1.5rem, 7.4vw, 3.9rem) rendered 62px inside a 390px div on a
 *     1920px screen, where a real phone renders about 29px.
 *   - media queries likewise. `lg:` still matched inside the 390px box, so
 *     the DESKTOP layout was being shown at phone width — the hero photo
 *     that a phone removes from the DOM was visible, and the Intelligence
 *     Layers section's dedicated mobile composition could never appear.
 *
 * An admin checking a phone layout would have been shown a squeezed desktop
 * one and told it was a phone. An iframe has its own viewport, so both vw
 * and media queries resolve against the device width and the preview is the
 * real thing.
 *
 * The stylesheets are copied in rather than re-imported: same origin, same
 * URLs, already in the browser cache, and it keeps the preview honest by
 * construction — it can only ever use the styles the real site shipped.
 * React context crosses the portal, so LanguageOverride and SectionScope
 * work exactly as they do in the page.
 */
function PreviewFrame({
  width, rtl, locale, children,
}: { width: number | null; rtl: boolean; locale: Locale; children: React.ReactNode }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);

  const attach = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc) return;

    doc.documentElement.setAttribute('data-surface', 'light');
    doc.documentElement.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    doc.documentElement.setAttribute('lang', locale);

    // Copy the app's styles in once. Re-running on every render would
    // reinsert them and make the preview flash.
    if (!doc.getElementById('studio-styles')) {
      const marker = doc.createElement('meta');
      marker.id = 'studio-styles';
      doc.head.appendChild(marker);
      for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) {
        doc.head.appendChild(node.cloneNode(true));
      }
      doc.body.style.margin = '0';
    }
    setBody(doc.body);
  }, [rtl, locale]);

  // The document exists before onLoad fires for an about:blank iframe, and
  // onLoad may already have passed by the time this effect runs, so attach
  // from both rather than relying on the event alone.
  useEffect(() => { attach(); }, [attach]);

  return (
    <iframe
      ref={ref}
      title="preview"
      onLoad={attach}
      className="h-full bg-background shadow-sm ring-1 ring-border"
      style={{ width: width ? `${width}px` : '100%', border: 0 }}
    >
      {body ? createPortal(children, body) : null}
    </iframe>
  );
}

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
      <PreviewFrame width={width} rtl={rtl} locale={locale}>
        <LanguageOverride lang={locale as SupportedLanguage}>
          <SitePage
            slug={slug}
            content={content}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </LanguageOverride>
      </PreviewFrame>
    </div>
  );
}

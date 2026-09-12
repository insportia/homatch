import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LanguageOverride, useLanguage } from '@/contexts/LanguageContext';
import { SitePage } from '@/site/render/SitePage';
import { InlineEditLayer, type EditableFieldRef } from './InlineEdit';
import { SectionControls, type SectionControlsApi } from './SectionControls';
import { sectionDef } from '@/site/registry';
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
/** The smallest standards-mode document the portal can render into. */
const FRAME_DOC = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';

function PreviewFrame({
  width, rtl, locale, children, onBody,
}: { width: number | null; rtl: boolean; locale: Locale; children: React.ReactNode;
     onBody?: (body: HTMLElement | null) => void }) {
  const { t } = useLanguage();
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
    /*
     * THE PREVIEW MUST NOT NAVIGATE.
     *
     * These are the real components, so they contain real links and real
     * forms. The selected section deliberately lets clicks through to
     * them (see SitePage: the overlay steps aside so text can be edited),
     * and a stray click on a link would replace the previewed page with a
     * dead route inside the frame — the editor would look broken and the
     * draft would appear to have vanished.
     *
     * Captured on the document so it runs before anything a component
     * attached, and registered once alongside the stylesheets.
     */
    if (!doc.body.dataset.studioNavGuard) {
      doc.body.dataset.studioNavGuard = 'on';
      doc.addEventListener('click', (e) => {
        const el = e.target as HTMLElement | null;
        if (el?.closest('a[href]')) e.preventDefault();
      }, true);
      doc.addEventListener('submit', (e) => e.preventDefault(), true);
    }

    setBody(doc.body);
    onBody?.(doc.body);
  }, [rtl, locale]);

  // The document exists before onLoad fires for an about:blank iframe, and
  // onLoad may already have passed by the time this effect runs, so attach
  // from both rather than relying on the event alone.
  useEffect(() => { attach(); }, [attach]);

  return (
    <iframe
      ref={ref}
      title={t('studio_preview')}
      /*
       * A DOCTYPE, because an empty iframe does not have one.
       *
       * Without it the preview document is in QUIRKS MODE, and this
       * preview's entire justification is that it renders the same way
       * production does — which production, with its doctype, does not.
       * It also broke scrolling outright: in quirks mode the scrolling
       * element is <body>, and scrollIntoView on a section left the
       * document exactly where it was, so selecting a block below the
       * fold showed the admin nothing.
       */
      srcDoc={FRAME_DOC}
      onLoad={attach}
      className="h-full bg-background shadow-sm ring-1 ring-border"
      style={{ width: width ? `${width}px` : '100%', border: 0 }}
    >
      {body ? createPortal(children, body) : null}
    </iframe>
  );
}

interface StudioPreviewProps {
  /** Editor only: commit an inline text edit on the selected section. */
  onInlineEdit?: (sectionId: string, field: string, value: string) => void;
  /** The floating per-section actions, built by the shell that owns the state. */
  controls?: SectionControlsApi | null;
  /** Whether click-to-edit is armed. */
  editing?: boolean;
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
  slug, content, locale, device, forceRTL, selectedId, onSelect, onInlineEdit, editing = true, controls = null,
}: StudioPreviewProps) {
  /*
   * What each field of each section rendered as, this pass.
   *
   * A ref, not state: it is written DURING render by
   * useSectionField and read by an effect afterwards, so state
   * here would loop. Rebuilt every render, which is what keeps it
   * correct after an edit changes a value.
   */
  const rendered = useRef(new Map<string, Map<string, string>>());
  const [previewBody, setPreviewBody] = useState<HTMLElement | null>(null);

  const record = useCallback((sectionId: string, field: string, value: string) => {
    const forSection = rendered.current.get(sectionId) ?? new Map<string, string>();
    forSection.set(field, value);
    rendered.current.set(sectionId, forSection);
  }, []);

  const selectedSection = content.sections.find((x) => x.id === selectedId) ?? null;
  const def = selectedSection ? sectionDef(selectedSection.type) : undefined;

  /*
   * Only fields the REGISTRY declares are ever editable, which is the
   * same allowlist the inspector uses.
   *
   * A function rather than an array, because the values it reads are
   * written during the children's render. See InlineEditLayer's
   * `getFields` for what a snapshot would break.
   */
  const getEditableFields = useCallback((): EditableFieldRef[] => {
    if (!selectedSection || !def) return [];
    const values = rendered.current.get(selectedSection.id);
    if (!values) return [];
    return def.fields
      .map((f) => ({ field: f.key, value: values.get(f.key) ?? '', multiline: f.kind === 'textarea' }))
      .filter((f) => f.value.length > 0);
  }, [selectedSection, def]);

  /*
   * The selected section's element inside the preview document.
   *
   * State rather than a memo, and populated from an effect, because the
   * element does not exist until React has committed the portal's
   * children into the iframe. A memo would run during the render that
   * creates it and find nothing.
   */
  const [sectionRoot, setSectionRoot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!previewBody || !selectedSection) { setSectionRoot(null); return; }
    setSectionRoot(previewBody.querySelector<HTMLElement>(
      `[data-studio-section="${selectedSection.id}"]`,
    ));
  }, [previewBody, selectedSection, content, locale, device]);

  /*
   * BRING THE SELECTED SECTION INTO VIEW.
   *
   * Adding a block selects it, and on a long page it lands below the
   * fold — so without this the admin presses "add" and nothing appears to
   * happen. Its floating controls go with it, which makes the next action
   * unreachable too.
   *
   * Only when it is actually out of view: scrolling a section that is
   * already on screen would yank the page away under a click.
   */
  /*
   * BRING THE SELECTED SECTION INTO VIEW.
   *
   * Adding a block selects it, and on a long page it lands below the
   * fold — so without this the admin presses "add" and nothing appears
   * to happen. Its floating controls go with it, which makes the next
   * action unreachable too.
   *
   * Keyed on WHICH SECTION, and it finds the element itself rather than
   * depending on the sectionRoot state. That state changes identity
   * whenever the content re-renders, which re-ran this effect, and the
   * re-run's cleanup cancelled the corrections below before they could
   * fire — so the page never actually moved. Selection is the thing that
   * should cause a scroll, so selection is what it depends on.
   */
  const selectedIdForScroll = selectedSection?.id ?? null;
  useEffect(() => {
    if (!previewBody || !selectedIdForScroll) return;
    const el = previewBody.querySelector<HTMLElement>(
      `[data-studio-section="${selectedIdForScroll}"]`,
    );
    const win = el?.ownerDocument.defaultView;
    if (!el || !win) return;

    const inView = () => {
      const r = el.getBoundingClientRect();
      return r.top >= 48 && r.top < win.innerHeight - 80;
    };
    // Already on screen: scrolling would yank the page out from under a
    // click the admin has only just made.
    if (inView()) return;

    const reduced = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' });

    /*
     * Then confirm it, twice.
     *
     * The page above is full of photographs that finish loading after the
     * scroll, each one pushing this section further down, so a single
     * scrollIntoView lands on where the section used to be.
     *
     * 'instant', not 'auto': `auto` means "whatever CSS says", and the
     * site's own stylesheet — cloned into this document with everything
     * else — sets `scroll-behavior: smooth`. A correction that animates
     * is not a correction, it is a second animation racing the first.
     */
    const again = () => {
      if (!inView()) el.scrollIntoView({ block: 'center', behavior: 'instant' });
    };
    const t1 = win.setTimeout(again, 600);
    const t2 = win.setTimeout(again, 1400);
    return () => { win.clearTimeout(t1); win.clearTimeout(t2); };
  }, [previewBody, selectedIdForScroll]);

  const width = useMemo(
    () => DEVICE_WIDTHS.find(d => d.key === device)?.width ?? null,
    [device],
  );

  const rtl = forceRTL || RTL_LANGUAGES.includes(locale as SupportedLanguage);

  return (
    <div className="flex h-full justify-center overflow-auto bg-muted/40 p-4">
      <PreviewFrame width={width} rtl={rtl} locale={locale} onBody={setPreviewBody}>
        <LanguageOverride lang={locale as SupportedLanguage}>
          <SitePage
            slug={slug}
            content={content}
            selectedId={selectedId}
            onSelect={onSelect}
            onRecordField={record}
          />
        </LanguageOverride>
        {/* Applies the edit affordance to the selected section, inside the
            preview document. Renders nothing itself. */}
        <SectionControls root={sectionRoot} body={previewBody} api={controls} />
        <InlineEditLayer
          root={sectionRoot}
          getFields={getEditableFields}
          revision={content}
          enabled={Boolean(editing && onInlineEdit && selectedSection)}
          onCommit={(field, value) => {
            if (selectedSection && onInlineEdit) onInlineEdit(selectedSection.id, field, value);
          }}
        />
      </PreviewFrame>
    </div>
  );
}

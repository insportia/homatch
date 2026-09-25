import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LanguageOverride, useLanguage } from '@/contexts/LanguageContext';
import type { OverrideMap } from '@/i18n/appContent';
import { fetchOverrides } from '@/services/appContent';
import { SitePage } from '@/site/render/SitePage';
import { InlineEditLayer, type FieldTarget } from './InlineEdit';
import { SectionControls, type SectionControlsApi } from './SectionControls';
import { MediaControls, type MediaTarget } from './MediaControls';
import { ItemControls, type ItemControlsApi } from './ItemControls';
import { itemsDef, sectionDef } from '@/site/registry';
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

/*
 * "DESKTOP" IS THE PANE, AND THE PANE HAS TO STAY WIDE ENOUGH.
 *
 * A stated width (1280) was tried here and reverted. It is the more honest
 * definition — a narrower editor window does not make the website narrower —
 * but a frame wider than its pane has to be scrolled to, and clicking a
 * block on the right of the page then means scrolling the pane first. In an
 * editor whose whole premise is "click the thing you can see", that is a
 * worse trade than the one it fixes.
 *
 * So the pane stays the measure, and the LAYER PANEL's width is the thing
 * that has to stay modest: at a 1920px browser the frame gets 1040px, and
 * the site's `lg` breakpoint is 1024. Widening the left panel by two rem put
 * the frame at 1008 and silently turned the desktop preview into the tablet
 * one. Anything added to either side panel has to be checked against that
 * number.
 */
/**
 * The narrowest viewport that is honestly a desktop: the site's own `lg`.
 *
 * Used as the desktop preview's viewport whenever the pane cannot hold one,
 * because the least scaling is the least blur, and any wider number would
 * scale a 1440px laptop harder for no extra truth.
 */
export const DESKTOP_MIN_WIDTH = 1024;

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
  width, height, scale, rtl, locale, children, onBody, editing,
}: { width: number | null; height: number | null; scale: number;
     rtl: boolean; locale: Locale; children: React.ReactNode; editing: boolean;
     onBody?: (body: HTMLElement | null) => void }) {
  const { t } = useLanguage();
  const ref = useRef<HTMLIFrameElement>(null);
  // Read inside attach(), which must not be rebuilt when the mode flips.
  const editingRef = useRef(editing);
  editingRef.current = editing;
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

    /*
     * KEYSTROKES OUT OF THE FRAME.
     *
     * The caret lives in the preview document, which is a separate
     * document: its key events reach that document and stop. So Ctrl+Z
     * pressed while looking at the page did nothing at all, because the
     * editor's own listener is on the editor's document.
     *
     * Re-dispatching a copy lets one handler serve both, and the copy
     * carries the flags the intent is read from. Registered once,
     * alongside the stylesheets.
     */
    if (!doc.body.dataset.studioKeyBridge) {
      doc.body.dataset.studioKeyBridge = 'on';
      doc.addEventListener('keydown', (e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (!mod) return;
        const key = e.key.toLowerCase();
        if (key !== 'z' && key !== 'y') return;
        // An editable field owns its own undo: mid-word, Ctrl+Z should
        // take back the word rather than the last committed edit.
        const el = e.target as HTMLElement | null;
        if (el?.isContentEditable) return;
        e.preventDefault();
        window.parent?.document.dispatchEvent(new KeyboardEvent('keydown', {
          key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey,
        }));
      });
    }

    setBody(doc.body);
    /*
     * Tells the preview document whether it is being edited.
     *
     * The stylesheet uses it to make the rendered page inert — see
     * index.css. An attribute rather than a class so it cannot collide
     * with anything Tailwind generates.
     */
    doc.body.dataset.hmEditing = editingRef.current ? 'on' : 'off';

    onBody?.(doc.body);
  }, [rtl, locale]);

  // The document exists before onLoad fires for an about:blank iframe, and
  // onLoad may already have passed by the time this effect runs, so attach
  // from both rather than relying on the event alone.
  useEffect(() => { attach(); }, [attach]);

  // The mode can flip long after the frame was attached.
  useEffect(() => {
    const doc = ref.current?.contentDocument;
    if (doc?.body) doc.body.dataset.hmEditing = editing ? 'on' : 'off';
  }, [editing]);

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
      /* shrink-0: the frame is a stated width, and a flex parent narrower
         than it must scroll rather than squeeze it. Without this the
         "desktop" preview silently became whatever was left over. */
      className={scale === 1 ? 'h-full shrink-0 bg-background shadow-sm ring-1 ring-border'
        : 'shrink-0 bg-background shadow-sm ring-1 ring-border'}
      style={{
        width: width ? `${width}px` : '100%',
        /* Only set when scaling: otherwise h-full keeps doing its job. */
        ...(scale === 1 ? {} : {
          height: height ? `${height}px` : '100%',
          transform: `scale(${scale})`,
          transformOrigin: rtl ? 'top right' : 'top left',
        }),
        border: 0,
      }}
    >
      {body ? createPortal(children, body) : null}
    </iframe>
  );
}

interface StudioPreviewProps {
  /**
   * Commit an edit made on the page itself.
   *
   * The target names the section, field, repeated item and locale the
   * caret was in, so this never has to guess from the selection — which
   * can have moved by the time a blur commits.
   */
  onInlineEdit?: (target: FieldTarget, value: string) => void;
  /** The floating image actions, built by the shell that owns the state. */
  media?: {
    busy: boolean;
    hasOverride: (sectionId: string, slot: string) => boolean;
    labels: { replace: string; uploading: string; remove: string };
    onReplace: (sectionId: string, slot: string) => void;
    onRemove: (sectionId: string, slot: string) => void;
  } | null;
  /** The floating per-section actions, built by the shell that owns the state. */
  controls?: SectionControlsApi | null;
  /** The floating per-card actions for the selected block, if it has cards. */
  items?: ItemControlsApi | null;
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
  slug, content, locale, device, forceRTL, selectedId, onSelect, onInlineEdit,
  editing = true, controls = null, media = null, items = null,
}: StudioPreviewProps) {
  const [previewBody, setPreviewBody] = useState<HTMLElement | null>(null);
  const [mediaTarget, setMediaTarget] = useState<MediaTarget | null>(null);






  const selectedSection = content.sections.find((x) => x.id === selectedId) ?? null;
  const def = selectedSection ? sectionDef(selectedSection.type) : undefined;

  /*
   * Is this field multiline?
   *
   * Asked of the REGISTRY, by section id and field key — the same
   * allowlist the inspector uses. A field the registry does not declare
   * has no answer here and cannot be edited, because nothing rendered it
   * with a mark in the first place.
   */
  const isMultiline = useCallback((sectionId: string, field: string) => {
    const target = content.sections.find((x) => x.id === sectionId);
    if (!target) return false;
    const own = sectionDef(target.type)?.fields.find((f) => f.key === field);
    // A field key can belong to the section, to its repeated children, or to
    // both — a card's `body` is a paragraph exactly as the section's is. The
    // child's declaration is consulted only where the section has none, so a
    // key declared in both cannot be answered by the wrong one.
    const child = itemsDef(target.type)?.fields.find((f) => f.key === field);
    return (own ?? child)?.kind === 'textarea';
  }, [content]);

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

  /* Loaded once for the life of the editor. Empty until it arrives, and empty
     on failure, which renders the shipped copy — the same answer the running
     application gives. */
  const [appContent, setAppContent] = useState<OverrideMap>({});
  useEffect(() => {
    let live = true;
    void fetchOverrides().then(map => { if (live) setAppContent(map); });
    return () => { live = false; };
  }, []);

  const rtl = forceRTL || RTL_LANGUAGES.includes(locale as SupportedLanguage);

  /*
   * A DESKTOP PREVIEW HAS TO BE A DESKTOP, IN A PANE THAT IS OFTEN SMALLER.
   *
   * "Desktop" used to mean "whatever the pane happens to be", which is right
   * only while the pane is at least the site's own lg breakpoint. It rarely
   * is: with the structure panel and the inspector open, a 1440px laptop
   * leaves 832px and a 1280px window leaves 672px. Both render the TABLET
   * layout, so the desktop navigation an owner opened this editor to rename
   * is not on screen at all — and nothing says so, because a tablet layout is
   * a perfectly good-looking page.
   *
   * So when the pane cannot hold a desktop, the frame is given a real desktop
   * viewport and scaled down to fit. The media queries and `sizes` attributes
   * inside it then behave exactly as they do on a desktop, which is the whole
   * point of the frame; only the pixels on the way to the eye are smaller.
   *
   * This is NOT the transform that the note at the top of this file rejects.
   * That one was about the phone previews, where scaling a desktop render
   * would have shown a shrunken desktop instead of the real mobile layout.
   * Here the desktop layout IS the thing being asked for, and the frame is
   * still a real viewport of a real width — 1024 exactly, the narrowest
   * width that is honestly a desktop, so the scale stays as close to 1 as the
   * pane allows and a wide window still scales by nothing at all.
   */
  const paneRef = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = paneRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setPane({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* The padding the pane draws around the frame (p-4 on each side). */
  const PANE_PAD = 32;
  const avail = Math.max(0, pane.w - PANE_PAD);
  const needsScale = width === null && avail > 0 && avail < DESKTOP_MIN_WIDTH;
  const frameWidth = needsScale ? DESKTOP_MIN_WIDTH : width;
  const scale = needsScale ? avail / DESKTOP_MIN_WIDTH : 1;
  /* Scaled by s, the frame must be 1/s taller to still fill the pane. */
  const frameHeight = needsScale ? Math.round(Math.max(0, pane.h - PANE_PAD) / scale) : null;

  /* `justify-start` until there is room to centre: a 1280px frame centred in
     a 1000px pane hides its left edge behind the scroll origin, where no
     amount of scrolling reaches it. */
  return (
    <div ref={paneRef} className="flex h-full justify-start overflow-auto bg-muted/40 p-4 xl:justify-center">
      <PreviewFrame
        width={frameWidth}
        height={frameHeight}
        scale={scale}
        rtl={rtl}
        locale={locale}
        onBody={setPreviewBody}
        editing={Boolean(editing && onInlineEdit)}
      >
        {/*
          * App Content overrides, carried into the preview.
          *
          * A section field with no stored value falls back to t(key), and
          * t(key) is exactly what App Content replaces. Without this the
          * preview would show an admin the copy they have already rewritten
          * somewhere else — the one thing a preview must never do.
          */}
        <LanguageOverride lang={locale as SupportedLanguage} overrides={appContent}>
          <SitePage
            slug={slug}
            content={content}
            selectedId={selectedId}
            onSelect={onSelect}
            editing
            onSelectMedia={(sectionId, slot) => setMediaTarget(slot ? { sectionId, slot } : null)}
          />
        </LanguageOverride>
        <SectionControls root={sectionRoot} body={previewBody} api={controls} />
        <ItemControls body={previewBody} api={items} revision={content} />

        {media && (
          <MediaControls
            body={previewBody}
            target={mediaTarget}
            revision={content}
            busy={media.busy}
            hasOverride={Boolean(mediaTarget && media.hasOverride(mediaTarget.sectionId, mediaTarget.slot))}
            labels={media.labels}
            onReplace={() => mediaTarget && media.onReplace(mediaTarget.sectionId, mediaTarget.slot)}
            onRemove={() => mediaTarget && media.onRemove(mediaTarget.sectionId, mediaTarget.slot)}
          />
        )}

        {/*
          * EVERY marked field on the page, not just the selected section's.
          *
          * This is the difference between "select a block, then edit it"
          * and editing the page. A single click has to put the caret in the
          * words under the pointer, wherever they are — so the whole
          * document is armed, and selection follows the caret rather than
          * gating it.
          */}
        <InlineEditLayer
          root={previewBody}
          isMultiline={isMultiline}
          revision={`${locale}:${JSON.stringify(content.sections.map((x) => x.id))}`}
          enabled={Boolean(editing && onInlineEdit)}
          onFocusField={(target) => {
            // Typing in a block is a stronger statement about what you are
            // working on than having clicked it, so the structure list and
            // the inspector follow the caret.
            if (target.sectionId !== selectedId) onSelect(target.sectionId);
          }}
          onCommit={(target, value) => onInlineEdit?.(target, value)}
        />
      </PreviewFrame>
    </div>
  );
}

// HOMATCH Verify — "Explore the property".
//
// The official visuals of the project as one place to look: a large stage,
// category tabs (only the categories that hold something), a thumbnail strip,
// and a full-screen viewer with zoom, pan and swipe.
//
// THE RULES (held in src/verify/visualCatalog.ts, tested there):
//   - only signed storage URLs are rendered; anything else is dropped
//   - every asset carries a label — Photo / Render (illustrative design) /
//     Drawing / Plan / Exact apartment plan / Typical floor plan / General
//     building plan — and a label is never stronger than the data
//   - an image that fails to load is removed; the text stands on its own
//   - no stock photography, ever: with nothing to show, the section says so
//
// No animation library: CSS transitions behind motion-safe, so reduced motion
// gets an instant, still viewer.

import React from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut, Maximize2, Info, ImageOff } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  catalogVisuals,
  categoryTabs,
  heroVisual,
  BADGE_KEY,
  CATEGORY_KEY,
  type CatalogVisual,
  type VisualCategory,
} from '@/verify/visualCatalog';

type Clean = (s: string) => string;

const day = (iso?: string | null): string | null => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
};

/** Badge tone: a photo is a fact, a render is a promise, a drawing is a plan. */
const BADGE_TONE: Record<CatalogVisual['badge'], string> = {
  PHOTO: 'bg-emerald-50 text-emerald-900 ring-emerald-700/25',
  RENDER: 'bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))] ring-[hsl(var(--gold-border))]',
  DRAWING: 'bg-slate-100 text-slate-800 ring-slate-500/25',
  PLAN: 'bg-slate-100 text-slate-800 ring-slate-500/25',
  EXACT_UNIT_PLAN: 'bg-sky-50 text-sky-900 ring-sky-700/25',
  TYPICAL_FLOOR_PLAN: 'bg-slate-100 text-slate-800 ring-slate-500/25',
  GENERAL_PLAN: 'bg-slate-100 text-slate-800 ring-slate-500/25',
  MATERIAL: 'bg-slate-100 text-slate-800 ring-slate-500/25',
};

const Badge: React.FC<{ v: CatalogVisual; className?: string }> = ({ v, className }) => {
  const { t } = useLanguage();
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-2xs font-semibold ring-1 ${BADGE_TONE[v.badge]} ${className ?? ''}`}>
      {t(BADGE_KEY[v.badge])}
    </span>
  );
};

function useVisualText(clean: Clean) {
  const { t } = useLanguage();
  return React.useCallback(
    (v: CatalogVisual) => {
      const what = v.explanation?.what ? clean(v.explanation.what) : '';
      const title = v.title ? clean(v.title) : '';
      const label = t(BADGE_KEY[v.badge]);
      return {
        label,
        title: title || what || t(v.captionKey),
        alt: [label, what || title].filter(Boolean).join(' — '),
        what,
      };
    },
    [clean, t],
  );
}

/** A render's place in the design's history, when the server said so. */
function useVersionBadge(history?: { visuals?: Array<{ id: string; versionStatus: string }> } | null) {
  const { t } = useLanguage();
  return (v: CatalogVisual): string | null => {
    if (v.role === 'EARLIEST_RENDER') return t('verify_ox_original');
    if (v.role === 'LATEST_RENDER') {
      const status = v.versionStatus ?? history?.visuals?.find((x) => x.id === v.id)?.versionStatus;
      return t(status === 'CURRENT_APPROVED' ? 'verify_ox_latest' : 'verify_ox_latest_submitted');
    }
    return null;
  };
}

const Meta: React.FC<{ v: CatalogVisual; className?: string }> = ({ v, className }) => {
  const { t } = useLanguage();
  const parts = [
    day(v.date) ? <bdi key="d" dir="ltr" className="tabular-nums">{day(v.date)}</bdi> : null,
    v.block ? <span key="b">{t(v.otherBuilding ? 'vrx_visual_other_building' : 'vrx_visual_block', { block: v.block })}</span> : null,
    v.page ? <span key="p">{t('vrx_visual_page', { page: String(v.page) })}</span> : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return (
    <p className={`flex flex-wrap gap-x-2 text-2xs text-muted-foreground ${className ?? ''}`}>
      {parts.map((p, i) => (
        <React.Fragment key={i}>{i ? <span aria-hidden="true">·</span> : null}{p}</React.Fragment>
      ))}
    </p>
  );
};

/** What / interesting / buyer meaning / uncertain — only the parts that exist. */
const Explanation: React.FC<{ v: CatalogVisual; clean: Clean; tone?: 'light' | 'dark' }> = ({ v, clean, tone = 'light' }) => {
  const { t } = useLanguage();
  const e = v.explanation;
  const rows = e
    ? ([
        ['vrx_visual_what', e.what],
        ['vrx_visual_interesting', e.interesting],
        ['vrx_visual_meaning', e.buyerMeaning],
        ['vrx_visual_uncertain', e.uncertain],
      ] as Array<[string, string]>).filter(([, text]) => clean(text))
    : [];
  const label = tone === 'dark' ? 'text-[hsl(38_92%_66%)]' : 'text-[hsl(var(--gold-ink))]';
  const body = tone === 'dark' ? 'text-[hsl(220_14%_86%)]' : 'text-foreground/85';
  return (
    <div className="space-y-3">
      {rows.map(([key, text]) => (
        <div key={key} className="space-y-0.5">
          <p className={`text-2xs font-semibold uppercase tracking-[0.04em] ${label}`}>{t(key)}</p>
          <p className={`text-sm leading-6 break-words ${body}`} dir="auto">{clean(text)}</p>
        </div>
      ))}
      {v.badge === 'RENDER' ? (
        <p className={`text-xs leading-5 ${tone === 'dark' ? 'text-[hsl(220_14%_72%)]' : 'text-muted-foreground'}`}>{t('vrx_visual_render_note')}</p>
      ) : null}
    </div>
  );
};

/* ───────────────────────── Lightbox ───────────────────────── */

const MIN_SCALE = 1;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const Lightbox: React.FC<{
  items: CatalogVisual[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onBroken: (id: string) => void;
  clean: Clean;
  versionBadge: (v: CatalogVisual) => string | null;
}> = ({ items, index, onIndex, onClose, onBroken, clean, versionBadge }) => {
  const { t, lang } = useLanguage();
  const rtl = lang === 'ar' || lang === 'he';
  const v = items[index];
  const text = useVisualText(clean);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  const [scale, setScale] = React.useState(1);
  const [pos, setPos] = React.useState({ x: 0, y: 0 });
  const [dragging, setDragging] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const maxScale = v?.technical ? 6 : 4;

  const pointers = React.useRef(new Map<number, { x: number; y: number }>());
  const gesture = React.useRef<{ startX: number; startY: number; startPos: { x: number; y: number }; startScale: number; startDist: number; moved: boolean } | null>(null);
  const lastTap = React.useRef<{ t: number; x: number; y: number } | null>(null);

  const reset = React.useCallback(() => { setScale(1); setPos({ x: 0, y: 0 }); }, []);
  React.useEffect(reset, [index, reset]);

  const bound = React.useCallback((p: { x: number; y: number }, s: number) => {
    const el = stageRef.current;
    if (!el || s <= 1) return { x: 0, y: 0 };
    const mx = ((s - 1) * el.clientWidth) / 2;
    const my = ((s - 1) * el.clientHeight) / 2;
    return { x: clamp(p.x, -mx, mx), y: clamp(p.y, -my, my) };
  }, []);

  const zoomTo = React.useCallback((next: number) => {
    const s = clamp(next, MIN_SCALE, maxScale);
    setScale(s);
    setPos((p) => bound(p, s));
  }, [bound, maxScale]);

  const go = React.useCallback((d: number) => {
    if (items.length < 2) return;
    onIndex((index + d + items.length) % items.length);
  }, [index, items.length, onIndex]);

  /* Focus in, focus back, page still. */
  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(rtl ? -1 : 1); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(rtl ? 1 : -1); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(scale * 1.4); return; }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomTo(scale / 1.4); return; }
    if (e.key === '0') { e.preventDefault(); reset(); return; }
    if (e.key === 'Tab') {
      // Focus trap: the dialog's own controls, in a loop.
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
      if (!nodes || !nodes.length) return;
      const list = [...nodes].filter((n) => n.offsetParent !== null);
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  /* Wheel zoom needs a non-passive listener to keep the page from scrolling. */
  React.useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale((s) => {
        const next = clamp(s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), MIN_SCALE, maxScale);
        setPos((p) => bound(p, next));
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [bound, maxScale]);

  const dist = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current = { startX: e.clientX, startY: e.clientY, startPos: pos, startScale: scale, startDist: dist(), moved: false };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (pointers.current.size >= 2) {
      const d = dist();
      if (g.startDist > 0 && d > 0) {
        const s = clamp((g.startScale * d) / g.startDist, MIN_SCALE, maxScale);
        setScale(s);
        setPos((p) => bound(p, s));
      }
      g.moved = true;
      return;
    }
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) g.moved = true;
    if (scale > 1) setPos(bound({ x: g.startPos.x + dx, y: g.startPos.y + dy }, scale));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    const wasPinch = pointers.current.size >= 2;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size) {
      // One finger left after a pinch: restart from here, do not swipe.
      const [rest] = [...pointers.current.values()];
      gesture.current = { startX: rest.x, startY: rest.y, startPos: pos, startScale: scale, startDist: 0, moved: true };
      return;
    }
    setDragging(false);
    gesture.current = null;
    if (!g || wasPinch) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    // Swipe between images, only when not zoomed in.
    if (scale <= 1 && Math.abs(dx) > 56 && Math.abs(dy) < 64) {
      go((dx < 0) !== rtl ? 1 : -1);
      return;
    }
    if (!g.moved && e.pointerType !== 'mouse') {
      // Double-tap toggles zoom (a mouse uses onDoubleClick).
      const now = Date.now();
      const lt = lastTap.current;
      if (lt && now - lt.t < 320 && Math.hypot(lt.x - e.clientX, lt.y - e.clientY) < 30) {
        lastTap.current = null;
        if (scale > 1) reset(); else zoomTo(2.5);
      } else {
        lastTap.current = { t: now, x: e.clientX, y: e.clientY };
      }
    }
  };

  if (!v) return null;
  const tx = text(v);
  const version = versionBadge(v);
  const btn = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[hsl(0_0%_96%)] ring-1 ring-white/15 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_60%)] disabled:opacity-40 motion-reduce:transition-none';

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="vx-lightbox-title"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[100] flex flex-col bg-[hsl(222_47%_6%)] text-[hsl(0_0%_96%)]"
    >
      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 py-2 sm:px-5 sm:py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge v={v} />
            {version ? <span className="text-2xs font-medium text-[hsl(38_92%_66%)]">{version}</span> : null}
            {v.otherBuilding && v.block ? <span className="text-2xs font-semibold text-white">{t('vrx_visual_other_building', { block: v.block })}</span> : null}
            {items.length > 1 ? (
              <span className="text-2xs tabular-nums text-[hsl(220_14%_72%)]">
                <bdi dir="ltr">{index + 1} / {items.length}</bdi>
              </span>
            ) : null}
          </div>
          <h2 id="vx-lightbox-title" className="mt-1 truncate text-sm font-medium !text-[hsl(0_0%_96%)]" dir="auto">{tx.title}</h2>
        </div>
        <button type="button" className={btn} onClick={() => zoomTo(scale / 1.4)} disabled={scale <= MIN_SCALE} aria-label={t('vrx_lightbox_zoom_out')}>
          <ZoomOut className="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" className={btn} onClick={() => zoomTo(scale * 1.4)} disabled={scale >= maxScale} aria-label={t('vrx_lightbox_zoom_in')}>
          <ZoomIn className="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" className={`${btn} hidden sm:inline-flex`} onClick={reset} disabled={scale === 1} aria-label={t('vrx_lightbox_reset')}>
          <Maximize2 className="h-5 w-5" aria-hidden="true" />
        </button>
        <button ref={closeRef} type="button" className={btn} onClick={onClose} aria-label={t('vrx_lightbox_close')}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Stage */}
        <div
          ref={stageRef}
          className={`relative min-h-0 flex-1 overflow-hidden ${scale > 1 ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'}`}
          style={{ touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => (scale > 1 ? reset() : zoomTo(2.5))}
        >
          <div className="absolute inset-0 flex items-center justify-center p-2 sm:p-6">
            <img
              key={v.id}
              src={v.url}
              alt={tx.alt}
              width={v.width ?? undefined}
              height={v.height ?? undefined}
              referrerPolicy="no-referrer"
              draggable={false}
              decoding="async"
              onError={() => onBroken(v.id)}
              className={`max-h-full max-w-full select-none object-contain ${v.technical ? 'bg-white' : ''} ${dragging ? '' : 'motion-safe:transition-transform motion-safe:duration-200'}`}
              style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0) scale(${scale})`, transformOrigin: 'center center' }}
            />
          </div>
          {items.length > 1 ? (
            <>
              <button type="button" className={`${btn} absolute start-2 top-1/2 -translate-y-1/2 bg-black/40 sm:start-4`} onClick={() => go(-1)} aria-label={t('vrx_lightbox_prev')}>
                <ChevronLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
              </button>
              <button type="button" className={`${btn} absolute end-2 top-1/2 -translate-y-1/2 bg-black/40 sm:end-4`} onClick={() => go(1)} aria-label={t('vrx_lightbox_next')}>
                <ChevronRight className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
              </button>
            </>
          ) : null}
          <p className="pointer-events-none absolute inset-x-0 bottom-2 hidden text-center text-2xs text-[hsl(220_14%_66%)] sm:block">{t('vrx_lightbox_hint')}</p>
        </div>

        {/* Desktop side panel */}
        <aside className="hidden w-[22rem] shrink-0 overflow-y-auto border-s border-white/10 p-5 lg:block" aria-label={t('vrx_visual_about')}>
          <Meta v={v} className="mb-3 !text-[hsl(220_14%_72%)]" />
          <Explanation v={v} clean={clean} tone="dark" />
          <p className="mt-4 text-2xs leading-relaxed text-[hsl(220_14%_66%)]">{t('verify_ox_visual_note')}</p>
        </aside>

        {/* Mobile bottom sheet */}
        <div className="border-t border-white/10 bg-[hsl(222_47%_9%)] lg:hidden">
          <button
            type="button"
            className="flex min-h-[44px] w-full items-center justify-between gap-3 px-4 py-2 text-start text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(38_92%_60%)]"
            aria-expanded={sheetOpen}
            aria-controls="vx-sheet"
            onClick={() => setSheetOpen((o) => !o)}
          >
            <span className="flex items-center gap-2"><Info className="h-4 w-4 text-[hsl(38_92%_66%)]" aria-hidden="true" />{t('vrx_visual_about')}</span>
            <ChevronRight className={`h-4 w-4 motion-safe:transition-transform ${sheetOpen ? '-rotate-90' : 'rotate-90'}`} aria-hidden="true" />
          </button>
          <div id="vx-sheet" hidden={!sheetOpen} className="max-h-[45vh] overflow-y-auto px-4 pb-4">
            <Meta v={v} className="mb-3 !text-[hsl(220_14%_72%)]" />
            <Explanation v={v} clean={clean} tone="dark" />
            <p className="mt-4 text-2xs leading-relaxed text-[hsl(220_14%_66%)]">{t('verify_ox_visual_note')}</p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

/* ───────────────────────── Explorer ───────────────────────── */

export const VisualExplorer: React.FC<{
  visuals?: unknown[] | null;
  explanations?: unknown[] | null;
  captions?: unknown[] | null;
  /** True when the unit's identity is unresolved: "exact apartment plan" is withdrawn. */
  identityUnresolved?: boolean;
  history?: { visuals?: Array<{ id: string; versionStatus: string }> } | null;
  clean: Clean;
}> = ({ visuals, explanations, captions, identityUnresolved, history, clean }) => {
  const { t, lang } = useLanguage();
  const rtl = lang === 'ar' || lang === 'he';
  const catalog = React.useMemo(
    () => catalogVisuals(visuals ?? [], explanations ?? [], captions ?? [], { identityUnresolved }),
    [visuals, explanations, captions, identityUnresolved],
  );
  const [broken, setBroken] = React.useState<Set<string>>(() => new Set());
  const onBroken = React.useCallback((id: string) => setBroken((b) => (b.has(id) ? b : new Set(b).add(id))), []);
  const usable = React.useMemo(() => catalog.filter((v) => !broken.has(v.id)), [catalog, broken]);
  const tabs = React.useMemo(() => categoryTabs(usable), [usable]);
  const hero = React.useMemo(() => heroVisual(usable), [usable]);
  const text = useVisualText(clean);
  const versionBadge = useVersionBadge(history);

  const [tab, setTab] = React.useState<VisualCategory | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [lightbox, setLightbox] = React.useState<number | null>(null);
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const current: VisualCategory | null = tab && tabs.some((x) => x.category === tab) ? tab : hero?.category ?? tabs[0]?.category ?? null;
  const inTab = usable.filter((v) => v.category === current);
  const active = inTab.find((v) => v.id === activeId) ?? (hero && hero.category === current ? hero : inTab[0]) ?? null;

  if (!usable.length) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-dashed border-border bg-muted/30 p-5">
        <ImageOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm leading-6 text-muted-foreground break-words">{t('vrx_explore_empty')}</p>
      </div>
    );
  }

  const selectTab = (i: number) => {
    const next = tabs[(i + tabs.length) % tabs.length];
    if (!next) return;
    setTab(next.category);
    setActiveId(null);
    tabRefs.current[(i + tabs.length) % tabs.length]?.focus();
  };
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const fwd = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === fwd) { e.preventDefault(); selectTab(i + 1); }
    else if (e.key === back) { e.preventDefault(); selectTab(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); selectTab(0); }
    else if (e.key === 'End') { e.preventDefault(); selectTab(tabs.length - 1); }
  };

  const at = active ? text(active) : null;
  const version = active ? versionBadge(active) : null;
  const ratio = active?.width && active?.height ? `${active.width} / ${active.height}` : '16 / 10';

  return (
    <div className="space-y-4">
      {/* The stage */}
      {active && at ? (
        <figure className="space-y-3">
          <button
            type="button"
            onClick={() => setLightbox(inTab.findIndex((v) => v.id === active.id))}
            aria-label={t('verify_ox_visual_open', { title: at.title })}
            className="group relative block w-full overflow-hidden rounded-2xl bg-[hsl(222_47%_11%)] shadow-[0_18px_50px_-24px_hsl(222_47%_11%/0.55)] ring-1 ring-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_54%)]"
            style={{ aspectRatio: ratio, maxHeight: '70vh' }}
          >
            <img
              key={active.id}
              src={active.url}
              alt={at.alt}
              width={active.width ?? undefined}
              height={active.height ?? undefined}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => onBroken(active.id)}
              className={`h-full w-full ${active.technical ? 'bg-white object-contain' : 'object-cover'} motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-[1.015]`}
            />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/45 to-transparent" aria-hidden="true" />
            <span className="absolute start-3 top-3 flex flex-wrap items-center gap-2">
              <Badge v={active} className="shadow-sm" />
              {version ? (
                <span className="rounded-full bg-[hsl(222_47%_11%/0.85)] px-2.5 py-1 text-2xs font-medium text-[hsl(38_92%_66%)] ring-1 ring-[hsl(38_92%_54%/0.40)]">{version}</span>
              ) : null}
              {active.otherBuilding && active.block ? (
                <span className="rounded-full bg-white/90 px-2.5 py-1 text-2xs font-semibold text-slate-900 ring-1 ring-slate-500/30">
                  {t('vrx_visual_other_building', { block: active.block })}
                </span>
              ) : null}
            </span>
            <span className="absolute bottom-3 end-3 inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-black/55 px-3 text-2xs font-medium text-white opacity-90 motion-safe:transition-opacity group-hover:opacity-100">
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
              {t('vrx_explore_open')}
            </span>
          </button>
          <figcaption className="space-y-1">
            <p className="text-[15px] font-medium leading-6 break-words" dir="auto">{at.title}</p>
            <Meta v={active} />
            {active.explanation?.buyerMeaning ? (
              <p className="text-sm leading-6 text-muted-foreground break-words" dir="auto">{clean(active.explanation.buyerMeaning)}</p>
            ) : null}
          </figcaption>
        </figure>
      ) : null}

      {/* Category tabs — only the ones that hold something */}
      {tabs.length > 1 ? (
        <div role="tablist" aria-label={t('vrx_explore_tabs')} className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
          {tabs.map((x, i) => {
            const selected = x.category === current;
            return (
              <button
                key={x.category}
                ref={(el) => { tabRefs.current[i] = el; }}
                type="button"
                role="tab"
                id={`vx-tab-${x.category}`}
                aria-selected={selected}
                aria-controls="vx-panel"
                tabIndex={selected ? 0 : -1}
                onKeyDown={(e) => onTabKey(e, i)}
                onClick={() => { setTab(x.category); setActiveId(null); }}
                className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-ink))] motion-reduce:transition-none ${
                  selected
                    ? 'border-[hsl(222_47%_11%)] bg-[hsl(222_47%_11%)] text-white'
                    : 'border-border bg-card text-foreground/80 hover:border-[hsl(var(--gold-border))] hover:text-foreground'
                }`}
              >
                {t(CATEGORY_KEY[x.category])}
                <span className={`tabular-nums ${selected ? 'text-[hsl(38_92%_66%)]' : 'text-muted-foreground'}`}>{x.count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Thumbnails */}
      {inTab.length > 1 ? (
        <div
          id="vx-panel"
          role={tabs.length > 1 ? 'tabpanel' : undefined}
          aria-labelledby={tabs.length > 1 && current ? `vx-tab-${current}` : undefined}
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]"
        >
          {inTab.map((v) => {
            const vt = text(v);
            const on = v.id === active?.id;
            return (
              <button
                key={v.id}
                type="button"
                aria-pressed={on}
                aria-label={vt.alt}
                onClick={() => setActiveId(v.id)}
                className={`group relative h-[72px] w-[96px] shrink-0 overflow-hidden rounded-xl bg-[hsl(222_47%_11%)] ring-offset-2 ring-offset-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_54%)] motion-reduce:transition-none sm:h-[84px] sm:w-[120px] ${
                  on ? 'ring-2 ring-[hsl(38_92%_54%)]' : 'opacity-80 hover:opacity-100'
                }`}
              >
                <img
                  src={v.url}
                  alt=""
                  width={v.width ?? undefined}
                  height={v.height ?? undefined}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={() => onBroken(v.id)}
                  className={`h-full w-full ${v.technical ? 'bg-white object-contain' : 'object-cover'}`}
                />
                <span className="absolute inset-x-1 bottom-1 truncate rounded-md bg-black/60 px-1.5 py-0.5 text-start text-2xs font-medium leading-4 text-white">
                  {vt.label}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <p className="text-2xs leading-relaxed text-muted-foreground break-words">{t('verify_ox_visual_note')}</p>

      {lightbox !== null && inTab[lightbox] ? (
        <Lightbox
          items={inTab}
          index={lightbox}
          onIndex={(i) => { setLightbox(i); setActiveId(inTab[i]?.id ?? null); }}
          onClose={() => setLightbox(null)}
          onBroken={(id) => { onBroken(id); setLightbox(null); }}
          clean={clean}
          versionBadge={versionBadge}
        />
      ) : null}
    </div>
  );
};

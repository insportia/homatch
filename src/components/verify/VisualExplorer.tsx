// HOMATCH Verify — "Explore the property".
//
// The official visuals of the project as one place to look: a large stage,
// five tabs, newest first (უახლესი ფოტოები / ბოლო პროექტი / ცვლილებები /
// ძველი ვერსიები / ნახაზები; only the tabs that hold something; it opens on
// the newest photographs, a verified fresh one first), a thumbnail strip, and a full-screen viewer with zoom
// (pinch, wheel, buttons, keys), pan and swipe. Every card says what it is,
// when (a verified date or period), what it concerns (unit / building /
// project), what it shows and why it matters. A picture filed five or more
// years ago carries the mandatory historical label ON the image and above
// it ("ძველი საპროექტო ვერსია | 2012 წელი"), and when no newer verified
// render exists the gallery says so ("განახლებული რენდერი ვერ მოიძებნა").
// A photograph is never "today": its card says whether its capture date is
// verified, or only the date of the material it was filed in (visualDates.ts),
// and the latest-photos tab says which of the two cases applies.
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
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut, Maximize2, Info, ImageOff, Images, History } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  catalogFreshPhotos,
  catalogVisuals,
  scopeKeyFor,
  visualChronology,
  BADGE_KEY,
  CHAPTER_KEY,
  CHAPTER_WHY_KEY,
  type CatalogVisual,
  type ChronoVisual,
  type HistoricalLabel,
  type LatestPhotosHeader,
  type VisualChapter,
} from '@/verify/visualCatalog';
import { documentDatePhrase } from '@/verify/intelligence/visualDates';
import { safeHref } from '@/verify/reportPresentation';
import { OfficialLink } from './OfficialLink';

/** The official case an image was filed with: its number, date and public page. */
export interface VisualCase { caseRef: string | null; date: string | null; href: string | null }
export type VisualCaseMap = Map<string, VisualCase>;

/** documentId → the case it belongs to, from the report's officialDocuments. */
export function visualCaseMap(docs: unknown): VisualCaseMap {
  const m: VisualCaseMap = new Map();
  for (const d of Array.isArray(docs) ? docs : []) {
    const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
    const id = typeof o.documentId === 'string' || typeof o.documentId === 'number' ? String(o.documentId) : '';
    if (!id) continue;
    m.set(id, {
      caseRef: typeof o.caseRef === 'string' && o.caseRef.trim() ? o.caseRef.trim() : null,
      date: typeof o.caseDate === 'string' ? o.caseDate : null,
      href: safeHref(o.publicUrl),
    });
  }
  return m;
}

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

const Badge: React.FC<{ v: CatalogVisual; className?: string; wrap?: boolean }> = ({ v, className, wrap }) => {
  const { t } = useLanguage();
  return (
    <span className={`inline-flex max-w-full items-center ${wrap ? "whitespace-normal text-start" : "whitespace-nowrap"} rounded-full px-2.5 py-1 text-2xs font-semibold ring-1 ${BADGE_TONE[v.badge]} ${className ?? ''}`}>
      {t(BADGE_KEY[v.badge])}
    </span>
  );
};

/** "Project render · from the September 2026 application": what it is, then when it was filed. */
/** The verified date or period of a card ("from the September 2026 application", "dated 14.04.2025 in the official file name"). */
function useDatedText() {
  const { t } = useLanguage();
  return React.useCallback((c: ChronoVisual): string => {
    const vars = c.dated.vars.month ? { ...c.dated.vars, month: t(`vfv_month_${c.dated.vars.month}`) } : c.dated.vars;
    return t(c.dated.key, vars);
  }, [t]);
}

/** A card's supporting date notes; an archival note's {{date}} is phrased per language ("2025 წლის 14 აპრილით"). */
function useDateNotes() {
  const { t, lang } = useLanguage();
  return React.useCallback((c: ChronoVisual | null | undefined): string[] => (c?.notes ?? []).map((n) =>
    t(n.key, n.vars.date ? { ...n.vars, date: documentDatePhrase(n.vars.date, lang) ?? n.vars.date } : n.vars)), [t, lang]);
}

function useChronoLabel() {
  const { t } = useLanguage();
  const dated = useDatedText();
  return React.useCallback((c: ChronoVisual | undefined | null): string => {
    if (!c) return '';
    // An archival photograph is named by its year ("2025 წლის საარქივო ფოტო"), never by a capture date it does not have.
    return `${c.photoLabel ? t(c.photoLabel.key, c.photoLabel.vars) : t(c.typeKey)} · ${dated(c)}`;
  }, [t, dated]);
}

/**
 * THE MANDATORY HISTORICAL LABEL (owner, 2026-10-11): "ძველი საპროექტო
 * ვერსია | 2012 წელი", shown above the image AND on it, for every picture in
 * the earlier-versions tab (its date is verified by construction).
 */
const HistoricalBadge: React.FC<{ h: HistoricalLabel; className?: string }> = ({ h, className }) => {
  const { t } = useLanguage();
  return (
    <span
      data-historical-badge
      className={`inline-flex max-w-full items-center gap-1.5 whitespace-normal rounded-full bg-[hsl(38_92%_54%)] px-2.5 py-1 text-start text-2xs font-semibold text-[hsl(222_47%_11%)] ring-1 ring-black/10 ${className ?? ''}`}
    >
      <History className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{t(h.badgeKey, h.vars)}</span>
    </span>
  );
};

/** The label printed ON the picture: a band across its bottom edge, never cropping it. */
const HistoricalOverlay: React.FC<{ h: HistoricalLabel }> = ({ h }) => {
  const { t } = useLanguage();
  return (
    <span
      data-historical-overlay
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-[hsl(222_47%_8%/0.78)] px-3 py-1.5 text-center text-xs font-semibold tracking-[0.02em] text-[hsl(38_92%_66%)]"
    >
      {t(h.badgeKey, h.vars)}
    </span>
  );
};

/**
 * A fresh photo's credit: source, author, license (with its link), the
 * verified capture date, and separately the publication and retrieval dates
 * (never presented as the capture date).
 */
const FreshCredit: React.FC<{ v: CatalogVisual; tone?: 'light' | 'dark' }> = ({ v, tone = 'light' }) => {
  const { t } = useLanguage();
  const f = v.fresh;
  if (!f) return null;
  const muted = tone === 'dark' ? 'text-[hsl(220_14%_72%)]' : 'text-muted-foreground';
  // Links go through OfficialLink (safeHref-checked, new tab), never a raw anchor.
  const sourceHref = safeHref(f.sourceUrl);
  const licenseHref = safeHref(f.licenseUrl);
  const sourceName = t(`vg_src_${f.source.toLowerCase()}`);
  const dmy = (iso: string | null) => (iso ? <bdi dir="ltr" className="tabular-nums">{day(iso)}</bdi> : null);
  return (
    <dl className={`grid grid-cols-1 gap-x-3 gap-y-1 text-xs leading-5 sm:grid-cols-[minmax(6rem,auto)_1fr] ${muted}`} data-fresh-credit>
      <dt className="font-semibold">{t('vg_fresh_source')}</dt>
      <dd className="min-w-0 break-words">
        {sourceHref ? <OfficialLink href={sourceHref} label={sourceName} tone={tone} /> : sourceName}
      </dd>
      {f.author ? (<><dt className="font-semibold">{t('vg_fresh_author')}</dt><dd className="min-w-0 break-words" dir="auto">{f.author}</dd></>) : null}
      {f.license ? (
        <>
          <dt className="font-semibold">{t('vg_fresh_license')}</dt>
          <dd className="min-w-0 break-words">{licenseHref ? <OfficialLink href={licenseHref} label={f.license} tone={tone} /> : <bdi dir="ltr">{f.license}</bdi>}</dd>
        </>
      ) : null}
      <dt className="font-semibold">{t('vg_fresh_captured')}</dt>
      <dd>{f.capture ? dmy(f.capture.date) : t('vg_capture_unknown_title')}</dd>
      {f.publishedAt ? (<><dt className="font-semibold">{t('vg_fresh_published')}</dt><dd>{dmy(f.publishedAt)}</dd></>) : null}
      {f.retrievedAt ? (<><dt className="font-semibold">{t('vg_fresh_retrieved')}</dt><dd>{dmy(f.retrievedAt)}</dd></>) : null}
    </dl>
  );
};

/**
 * The latest-photos tab says which case applies: the newest verified photos
 * of the building, or the last available photo (with its year when it is
 * not this year's). A photo is never called "today".
 */
const LatestPhotosNote: React.FC<{ h: LatestPhotosHeader }> = ({ h }) => {
  const { t } = useLanguage();
  return (
    <div className="space-y-2 rounded-2xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] p-4" data-latest-photos={h.kind}>
      {h.badge ? (
        <span data-latest-photo-badge className="inline-flex max-w-full items-center gap-1.5 whitespace-normal rounded-full bg-[hsl(222_47%_11%)] px-2.5 py-1 text-start text-2xs font-semibold text-[hsl(38_92%_66%)] ring-1 ring-[hsl(38_92%_54%/0.40)]">
          <History className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{t(h.badge.key, h.badge.vars)}</span>
        </span>
      ) : null}
      <p className="text-sm font-semibold leading-6 text-foreground break-words">{t(h.titleKey)}</p>
      <p className="text-sm leading-6 text-foreground/80 break-words">{t(h.bodyKey)}</p>
      {h.badge ? <p className="text-xs leading-5 text-foreground/75 break-words">{t(h.badge.noteKey, h.badge.vars)}</p> : null}
    </div>
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

/** Exact apartment / this building / the whole project — said on every image. */
const ScopeChip: React.FC<{ v: CatalogVisual; identityUnresolved?: boolean; className?: string }> = ({ v, identityUnresolved, className }) => {
  const { t } = useLanguage();
  return (
    <span className={`inline-flex max-w-full items-center whitespace-normal rounded-full bg-[hsl(222_47%_11%/0.85)] px-2.5 py-1 text-start text-2xs font-medium text-white ring-1 ring-white/20 ${className ?? ''}`}>
      {t(scopeKeyFor(v, identityUnresolved))}
    </span>
  );
};

/** Case № · date · the official page — where this image was filed. */
const SourceRow: React.FC<{ v: CatalogVisual; cases?: VisualCaseMap; tone?: 'light' | 'dark' }> = ({ v, cases, tone = 'light' }) => {
  const { t } = useLanguage();
  const c = v.documentId ? cases?.get(v.documentId) : undefined;
  if (!c || (!c.caseRef && !c.href)) return null;
  const text = [c.caseRef ? t('verify_v3_case_ref', { ref: `\u2066${c.caseRef}\u2069` }) : null, day(c.date) ? `\u2066${day(c.date)}\u2069` : null].filter(Boolean).join(' · ');
  return (
    <div className={`flex flex-wrap items-center gap-x-3 ${tone === 'dark' ? 'text-[hsl(220_14%_72%)]' : 'text-muted-foreground'}`}>
      {text ? <p className="text-xs leading-5">{t('verify_p0_visual_filed_with', { case: text })}</p> : null}
      {c.href ? <OfficialLink href={c.href} tone={tone} /> : null}
    </div>
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
  cases?: VisualCaseMap;
  identityUnresolved?: boolean;
  /** The chronology label ("Project render · from the … application"), when the caller has one. */
  labelOf?: (v: CatalogVisual) => string | null;
  /** The mandatory historical label of an earlier-versions picture. */
  historicalOf?: (v: CatalogVisual) => HistoricalLabel | null;
  /** The date notes of a picture (capture unknown / archival material date). */
  notesOf?: (v: CatalogVisual) => string[];
}> = ({ items, index, onIndex, onClose, onBroken, clean, versionBadge, cases, identityUnresolved, labelOf, historicalOf, notesOf }) => {
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
  const [loaded, setLoaded] = React.useState<Set<string>>(() => new Set());
  const markLoaded = React.useCallback((id: string) => setLoaded((l) => (l.has(id) ? l : new Set(l).add(id))), []);
  const stripRef = React.useRef<HTMLDivElement | null>(null);
  const maxScale = v?.technical ? 6 : 4;

  const pointers = React.useRef(new Map<number, { x: number; y: number }>());
  const gesture = React.useRef<{ startX: number; startY: number; startPos: { x: number; y: number }; startScale: number; startDist: number; moved: boolean } | null>(null);
  const lastTap = React.useRef<{ t: number; x: number; y: number } | null>(null);

  const reset = React.useCallback(() => { setScale(1); setPos({ x: 0, y: 0 }); }, []);
  React.useEffect(reset, [index, reset]);
  /* Keep the current thumbnail in view as the reader moves through the set. */
  React.useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [index]);

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
  const hist = historicalOf?.(v) ?? null;
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
            {hist ? <HistoricalBadge h={hist} /> : null}
            <Badge v={v} wrap />
            <ScopeChip v={v} identityUnresolved={identityUnresolved} />
            {version ? <span className="text-2xs font-medium text-[hsl(38_92%_66%)]">{version}</span> : null}
            {v.otherBuilding && v.block ? <span className="text-2xs font-semibold text-white">{t('vrx_visual_other_building', { block: v.block })}</span> : null}
            {items.length > 1 ? (
              <span className="text-2xs tabular-nums text-[hsl(220_14%_72%)]">
                <bdi dir="ltr">{index + 1} / {items.length}</bdi>
              </span>
            ) : null}
          </div>
          {labelOf?.(v) ? <p className="mt-1 truncate text-xs font-semibold text-[hsl(38_92%_66%)]">{labelOf(v)}</p> : null}
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
            {!loaded.has(v.id) ? (
              <span className="absolute inset-6 rounded-xl bg-white/[0.06] motion-safe:animate-pulse sm:inset-12" aria-hidden="true" />
            ) : null}
            <img
              key={v.id}
              src={v.url}
              alt={tx.alt}
              width={v.width ?? undefined}
              height={v.height ?? undefined}
              referrerPolicy="no-referrer"
              draggable={false}
              decoding="async"
              onLoad={() => markLoaded(v.id)}
              onError={() => onBroken(v.id)}
              className={`relative max-h-full max-w-full select-none object-contain ${v.technical ? 'bg-white' : ''} ${loaded.has(v.id) ? 'opacity-100' : 'opacity-0'} ${dragging ? '' : 'motion-safe:transition-[transform,opacity] motion-safe:duration-200'}`}
              style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0) scale(${scale})`, transformOrigin: 'center center' }}
            />
          </div>
          {hist ? <HistoricalOverlay h={hist} /> : null}
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
          <Meta v={v} className="mb-1 !text-[hsl(220_14%_72%)]" />
          <SourceRow v={v} cases={cases} tone="dark" />
          <FreshCredit v={v} tone="dark" />
          {(notesOf?.(v) ?? []).map((n, i) => <p key={i} className="mt-2 text-xs leading-5 text-[hsl(220_14%_80%)]">{n}</p>)}
          {hist ? <p className="mt-3 text-xs leading-5 text-[hsl(38_92%_72%)]">{t(hist.noteKey, hist.vars)}</p> : null}
          <div className="mt-3"><Explanation v={v} clean={clean} tone="dark" /></div>
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
            <Meta v={v} className="mb-1 !text-[hsl(220_14%_72%)]" />
            <SourceRow v={v} cases={cases} tone="dark" />
            <FreshCredit v={v} tone="dark" />
            {(notesOf?.(v) ?? []).map((n, i) => <p key={i} className="mt-2 text-xs leading-5 text-[hsl(220_14%_80%)]">{n}</p>)}
            {hist ? <p className="mt-3 text-xs leading-5 text-[hsl(38_92%_72%)]">{t(hist.noteKey, hist.vars)}</p> : null}
            <div className="mt-3"><Explanation v={v} clean={clean} tone="dark" /></div>
            <p className="mt-4 text-2xs leading-relaxed text-[hsl(220_14%_66%)]">{t('verify_ox_visual_note')}</p>
          </div>
        </div>
      </div>

      {/* Every image of the set, one tap away. */}
      {items.length > 1 ? (
        <div
          ref={stripRef}
          className="flex shrink-0 gap-2 overflow-x-auto border-t border-white/10 px-3 py-2 [scrollbar-width:thin] sm:px-5"
          aria-label={t('verify_v3_lightbox_thumbs')}
          role="group"
        >
          {items.map((it, i) => {
            const on = i === index;
            return (
              <button
                key={it.id}
                type="button"
                aria-current={on ? 'true' : undefined}
                aria-label={text(it).alt}
                onClick={() => onIndex(i)}
                className={`relative h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_60%)] motion-safe:transition-opacity sm:h-14 sm:w-20 ${on ? 'ring-2 ring-[hsl(38_92%_54%)]' : 'opacity-60 hover:opacity-100'}`}
              >
                <img
                  src={it.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  draggable={false}
                  className="h-full w-full object-contain"
                />
              </button>
            );
          })}
        </div>
      ) : null}
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
  /** The report's officialDocuments: each image's case number, date and official page. */
  docs?: unknown[] | null;
  /**
   * synthesis_json.freshPhotos (FreshPhotoSearch, signed `url`s added at
   * read time): accepted photos with a verified capture date lead the
   * latest-photos tab and open the gallery.
   */
  freshPhotos?: unknown;
  clean: Clean;
}> = ({ visuals, explanations, captions, identityUnresolved, history, docs, freshPhotos, clean }) => {
  const { t, lang } = useLanguage();
  const rtl = lang === 'ar' || lang === 'he';
  const today = new Date().toISOString().slice(0, 10);
  const catalog = React.useMemo(
    () => [...catalogFreshPhotos(freshPhotos, { today }), ...catalogVisuals(visuals ?? [], explanations ?? [], captions ?? [], { identityUnresolved })],
    [freshPhotos, today, visuals, explanations, captions, identityUnresolved],
  );
  const [broken, setBroken] = React.useState<Set<string>>(() => new Set());
  const onBroken = React.useCallback((id: string) => setBroken((b) => (b.has(id) ? b : new Set(b).add(id))), []);
  const usable = React.useMemo(() => catalog.filter((v) => !broken.has(v.id)), [catalog, broken]);
  const text = useVisualText(clean);
  const label = useChronoLabel();
  const dateText = useDatedText();
  const dateNotes = useDateNotes();
  const baseVersionBadge = useVersionBadge(history);
  const cases = React.useMemo(() => visualCaseMap(docs), [docs]);
  // The project's story: tabs by verified capture / document date (visualCatalog.ts, visualDates.ts).
  const chrono = React.useMemo(() => visualChronology(usable, cases, today), [usable, cases, today]);
  const hero = chrono.hero;
  const tabs = React.useMemo(() => chrono.groups.map((g) => ({ chapter: g.chapter, count: g.items.length })), [chrono]);
  const chronoOf = React.useMemo(() => new Map(chrono.groups.flatMap((g) => g.items.map((i) => [i.visual.id, i] as const))), [chrono]);

  const [tab, setTab] = React.useState<VisualChapter | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [lightbox, setLightbox] = React.useState<number | null>(null);
  const [stageLoaded, setStageLoaded] = React.useState<Set<string>>(() => new Set());
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const heroChapter = hero ? chronoOf.get(hero.id)?.chapter ?? null : null;
  // Opens on the newest verified tab: today's photographs, else the latest
  // design, else the changes, else the newer of earlier versions / drawings.
  const opening: VisualChapter | null = chrono.defaultChapter ?? heroChapter;
  const current: VisualChapter | null = tab && tabs.some((x) => x.chapter === tab) ? tab : opening ?? tabs[0]?.chapter ?? null;
  const inTab = chrono.groups.find((g) => g.chapter === current)?.items.map((i) => i.visual) ?? [];
  // A tab opens on its newest picture (the hero only when it is that tab's first choice).
  const active = inTab.find((v) => v.id === activeId) ?? inTab[0] ?? null;
  const historicalOf = (v: CatalogVisual): HistoricalLabel | null => chronoOf.get(v.id)?.historical ?? null;
  const notesOf = (v: CatalogVisual): string[] => dateNotes(chronoOf.get(v.id));
  // "Latest design" is said only of a render the dates place in the latest design;
  // an old LATEST_RENDER (a 2013 case) is never presented as the latest.
  const versionBadge = (v: CatalogVisual): string | null =>
    v.role === 'LATEST_RENDER' && chronoOf.get(v.id)?.chapter !== 'LATEST' ? null : baseVersionBadge(v);

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
    setTab(next.chapter);
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
  const activeChrono = active ? chronoOf.get(active.id) : null;
  const hist = activeChrono?.historical ?? null;
  const why = active?.explanation?.buyerMeaning ? clean(active.explanation.buyerMeaning) : activeChrono ? t(CHAPTER_WHY_KEY[activeChrono.chapter]) : '';
  // A tall picture would push the page: the stage keeps a sane ratio and the
  // whole image is shown inside it (object-contain on a navy matte).
  const ratio = active?.width && active?.height ? `${Math.max(active.width / active.height, 0.8)}` : '16 / 10';

  const caseCount = new Set(usable.map((v) => v.documentId).filter(Boolean)).size;
  const pickers = (
    <>
      {/* The story's chapters — only the ones that hold something. The chips
          scroll sideways inside their own box; the page never does. */}
      {tabs.length > 1 ? (
        <div role="tablist" aria-label={t('vev_tabs_label')} className="flex min-w-0 max-w-full gap-1.5 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:thin]">
          {tabs.map((x, i) => {
            const selected = x.chapter === current;
            return (
              <button
                key={x.chapter}
                ref={(el) => { tabRefs.current[i] = el; }}
                type="button"
                role="tab"
                id={`vx-tab-${x.chapter}`}
                aria-selected={selected}
                aria-controls="vx-panel"
                tabIndex={selected ? 0 : -1}
                onKeyDown={(e) => onTabKey(e, i)}
                onClick={() => { setTab(x.chapter); setActiveId(null); }}
                className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-ink))] motion-reduce:transition-none ${
                  selected
                    ? 'border-[hsl(222_47%_11%)] bg-[hsl(222_47%_11%)] text-white'
                    : 'border-border bg-card text-foreground/80 hover:border-[hsl(var(--gold-border))] hover:text-foreground'
                }`}
              >
                {t(CHAPTER_KEY[x.chapter])}
                <span className={`tabular-nums ${selected ? 'text-[hsl(38_92%_66%)]' : 'text-muted-foreground'}`}>{x.count}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {/* No photograph at all: said plainly, once (the latest-photos tab speaks for itself). */}
      {chrono.noCurrentPhotos && !chrono.latestPhotos ? (
        <p className="text-xs leading-5 text-muted-foreground break-words" data-no-current-photos>
          {chrono.newestPhotoDate
            ? t('vfv_no_current_photos_since', { year: chrono.newestPhotoDate.slice(0, 4) })
            : t('vfv_no_current_photos')}
        </p>
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
            const cl = chronoOf.get(v.id);
            const on = v.id === active?.id;
            return (
              <button
                key={v.id}
                type="button"
                aria-pressed={on}
                aria-label={cl ? `${label(cl)} — ${vt.alt}` : vt.alt}
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
                  className="h-full w-full object-contain"
                />
                <span className={`absolute inset-x-1 bottom-1 truncate rounded-md px-1.5 py-0.5 text-start text-2xs font-medium leading-4 ${cl?.historical ? 'bg-[hsl(222_47%_8%/0.85)] text-[hsl(38_92%_66%)]' : 'bg-black/60 text-white'}`}>
                  {cl?.historical
                    ? t(cl.historical.badgeKey, cl.historical.vars)
                    : cl
                      ? `${cl.photoLabel ? t(cl.photoLabel.key, cl.photoLabel.vars) : t(cl.typeKey)}${cl.date ? '' : ` · ${t('vg_undated')}`}`
                      : vt.label}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </>
  );
  return (
    <div className="space-y-4">
      {/* How much there is, before the first image. */}
      <p className="flex items-center gap-2 text-sm font-medium text-foreground/85" data-gallery-count={usable.length}>
        <Images className="h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
        <span className="min-w-0 break-words">
          {caseCount > 1
            ? t('verify_p0_gallery_count_cases', { count: String(usable.length), cases: String(caseCount) })
            : t('verify_p0_gallery_count', { count: String(usable.length) })}
        </span>
      </p>
      {/* No newer verified render than the historical ones: said once, plainly. */}
      {chrono.noNewerRender ? (
        <div className="flex items-start gap-3 rounded-2xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] p-4" data-no-newer-render>
          <History className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold leading-6 text-foreground break-words">{t('vev_no_newer_title')}</p>
            <p className="text-sm leading-6 text-foreground/80 break-words">{t('vev_no_newer_body')}</p>
          </div>
        </div>
      ) : null}
      {/* The latest-photos tab says which case applies, before its image. */}
      {current === 'LATEST_PHOTOS' && chrono.latestPhotos ? <LatestPhotosNote h={chrono.latestPhotos} /> : null}
      {/* The stage */}
      {active && at ? (
        <figure className="space-y-3">
          {/* The historical label ABOVE the image (and again on it, below). */}
          {hist ? <HistoricalBadge h={hist} className="text-xs" /> : null}
          <button
            type="button"
            onClick={() => setLightbox(inTab.findIndex((v) => v.id === active.id))}
            aria-label={t('verify_ox_visual_open', { title: at.title })}
            className="group relative block w-full overflow-hidden rounded-2xl bg-[hsl(222_47%_11%)] shadow-[0_18px_50px_-24px_hsl(222_47%_11%/0.55)] ring-1 ring-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_54%)]"
            style={{ aspectRatio: ratio, maxHeight: '70vh' }}
          >
            {!stageLoaded.has(active.id) ? (
              <span className="absolute inset-0 bg-gradient-to-br from-white/[0.04] to-white/[0.10] motion-safe:animate-pulse" aria-hidden="true" />
            ) : null}
            <img
              key={active.id}
              src={active.url}
              alt={at.alt}
              width={active.width ?? undefined}
              height={active.height ?? undefined}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onLoad={() => setStageLoaded((l) => (l.has(active.id) ? l : new Set(l).add(active.id)))}
              onError={() => onBroken(active.id)}
              className="relative h-full w-full object-contain motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-[1.015]"
            />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/45 to-transparent" aria-hidden="true" />
            {hist ? <HistoricalOverlay h={hist} /> : null}
            <span className="absolute start-3 end-3 top-3 flex flex-wrap items-center gap-2">
              <Badge v={active} className="shadow-sm" wrap />
              <ScopeChip v={active} identityUnresolved={identityUnresolved} className="shadow-sm" />
              {version ? (
                <span className="rounded-full bg-[hsl(222_47%_11%/0.85)] px-2.5 py-1 text-2xs font-medium text-[hsl(38_92%_66%)] ring-1 ring-[hsl(38_92%_54%/0.40)]">{version}</span>
              ) : null}
              {active.otherBuilding && active.block ? (
                <span className="rounded-full bg-white/90 px-2.5 py-1 text-2xs font-semibold text-slate-900 ring-1 ring-slate-500/30">
                  {t('vrx_visual_other_building', { block: active.block })}
                </span>
              ) : null}
            </span>
            <span className={`absolute end-3 inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-black/55 px-3 text-2xs font-medium text-white opacity-90 motion-safe:transition-opacity group-hover:opacity-100 ${hist ? 'bottom-11' : 'bottom-3'}`}>
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
              {t('vrx_explore_open')}
            </span>
          </button>
          {/* Tabs and thumbnails directly under the image (owner, 2026-10-12):
              choose, enlarge and compare without scrolling past the text. */}
          {pickers}
          <figcaption className="space-y-2">
            {activeChrono ? (
              <p className="text-sm font-semibold leading-6 text-[hsl(var(--gold-ink))] break-words" data-visual-label>{label(activeChrono)}</p>
            ) : null}
            {hist ? <p className="text-sm leading-6 text-foreground/85 break-words" data-historical-note>{t(hist.noteKey, hist.vars)}</p> : null}
            {notesOf(active).map((n, i) => <p key={i} className="text-sm leading-6 text-foreground/80 break-words" data-date-note>{n}</p>)}
            {/* Every card: what it shows, when, what kind of picture, what it concerns, why it matters. */}
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(7rem,auto)_1fr]" data-visual-card>
              <dt className="text-2xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{t('vev_card_what')}</dt>
              <dd className="font-medium leading-6 break-words" dir="auto">{at.title}</dd>
              <dt className="text-2xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{t('vev_card_type')}</dt>
              <dd className="leading-6 break-words">{activeChrono ? t(activeChrono.typeKey) : at.label}</dd>
              <dt className="text-2xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{t('vev_card_date')}</dt>
              <dd className="leading-6 break-words">{activeChrono ? dateText(activeChrono) : t('vfv_date_unknown')}</dd>
              <dt className="text-2xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{t('vev_card_scope')}</dt>
              <dd className="leading-6 break-words">{t(scopeKeyFor(active, identityUnresolved))}{active.block ? ` · ${t(active.otherBuilding ? 'vrx_visual_other_building' : 'vrx_visual_block', { block: active.block })}` : ''}</dd>
              {why ? (
                <>
                  <dt className="text-2xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{t('vev_card_why')}</dt>
                  <dd className="leading-6 text-foreground/85 break-words" dir="auto">{why}</dd>
                </>
              ) : null}
            </dl>
            {activeChrono && (activeChrono.type === 'RENDER' || activeChrono.type === 'IMAGE') && !hist ? (
              <p className="text-xs leading-5 text-muted-foreground break-words">{t(activeChrono.type === 'RENDER' ? 'vfv_render_not_evidence' : 'vfv_image_type_note')}</p>
            ) : null}
            <Meta v={active} />
            <SourceRow v={active} cases={cases} />
            <FreshCredit v={active} />
          </figcaption>
        </figure>
      ) : null}

      {/* Without an image on the stage the tabs and thumbnails still show. */}
      {active && at ? null : pickers}

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
          cases={cases}
          identityUnresolved={identityUnresolved}
          labelOf={(v) => label(chronoOf.get(v.id)) || null}
          historicalOf={historicalOf}
          notesOf={notesOf}
        />
      ) : null}
    </div>
  );
};

/* ───────────────────────── Shared viewer ───────────────────────── */

/**
 * The same full-screen viewer, for another section that holds catalogued
 * official images (the document explorer). Signed URLs only — the items have
 * already passed catalogVisuals().
 */
export const OfficialImagesViewer: React.FC<{
  items: CatalogVisual[];
  start: number;
  onClose: () => void;
  clean: Clean;
}> = ({ items, start, onClose, clean }) => {
  const [index, setIndex] = React.useState(start);
  const [gone, setGone] = React.useState<Set<string>>(() => new Set());
  const versionBadge = useVersionBadge(null);
  const list = items.filter((v) => !gone.has(v.id));
  if (!list.length) return null;
  return (
    <Lightbox
      items={list}
      index={Math.min(index, list.length - 1)}
      onIndex={setIndex}
      onClose={onClose}
      onBroken={(id) => setGone((g) => new Set(g).add(id))}
      clean={clean}
      versionBadge={versionBadge}
    />
  );
};

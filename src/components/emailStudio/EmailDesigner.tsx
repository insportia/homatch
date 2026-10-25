// EMAIL STUDIO — the visual email designer ("ელფოსტის დიზაინი"). Owner briefs §5, the UX pass §4, the
// drag & drop builder brief and the editor UX rebuild (2026-10-24).
//
// Edits a designer DOCUMENT (src/emailMarketing/designer/document.ts), never HTML. Every
// structural action goes through designer/tree.ts, which refuses a placement the format cannot
// hold; every value through normalizeDoc. Nothing here can express a script.
//
// TWO LAYOUTS, ONE EDITOR.
//   Desktop (≥ 1280 px): Elements / Layers · the email · Element settings. The email is drawn at its
//   design width and scaled to fit ("Fit", or a chosen zoom), so nothing is squeezed. The selected
//   block's actions sit in a rail beside the email, never over it.
//   Phone and tablet: the email at full width; a sticky Edit · Add · Layers · Preview bar; tapping an
//   element opens its settings in a bottom sheet whose header carries Move up / Move down /
//   Duplicate / Delete; the drag handle beside the block reorders by touch.
//
// Keyboard: Ctrl/⌘ Z / Shift+Z / Y undo and redo; C, X, V copy, cut, paste; D duplicate; G group
// into a section, Shift+G ungroup; A select all; Alt+↑/↓ move; Delete removes; Esc clears;
// Ctrl/⌘ + / − / 0 zoom; Space+drag (or the middle button) pans. Typing is coalesced into one undo
// step per pause.

import {
  AlertTriangle, ArrowDown, ArrowUp, BookmarkPlus, Box, Columns2, Contact, Copy, Eye, Footprints, GalleryHorizontal, GalleryHorizontalEnd, Heading,
  History, Image as ImageIcon, Info, Layers, LayoutPanelTop, LayoutTemplate, ListChecks, Minus, MoreHorizontal, MousePointerClick, MoveVertical, Palette,
  PencilLine, Plus, Redo2, Save, Share2, SquareCode, SquareStack, Star, Tag, Trash2, Type, Undo2, UserMinus, Video, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/contexts/LanguageContext';
import { analyzeCompat } from '@/emailMarketing/designer/compat';
import {
  type Block, type BlockType, cloneBlock, createBlock, type EmailDoc, FONT_STACKS, normalizeDoc, type SectionBlock, type Theme,
} from '@/emailMarketing/designer/document';
import { READY_SECTIONS, type ReadySectionKey, readySection } from '@/emailMarketing/designer/readySections';
import { inlineMarkup } from '@/emailMarketing/designer/render';
import {
  canContain, childrenOf, duplicateBlocks, findBlock, groupIntoSection, insertBlocks, isLockedPath, locate, moveBlocks, nudge, type Place, pasteBlocks,
  removeBlocks, ROOT, subtreeIds, ungroupSection, updateBlock,
} from '@/emailMarketing/designer/tree';
import { cn } from '@/lib/utils';
import { isCurrentUserAdmin } from '@/services/api';
import { BottomSheet, SHEET_HEIGHT } from './designer/BottomSheet';
import { Canvas, type EditorLayout, RAIL_GUTTER } from './designer/Canvas';
import { BlockProperties, ThemeProperties } from './designer/Inspector';
import { LayersPanel } from './designer/LayersPanel';
import { PreviewPanel } from './designer/PreviewPanel';
import { type DragPayload, useBlockDrag } from './designer/useBlockDrag';
import { VersionHistory } from './designer/VersionHistory';
import { RichTextEditor } from './RichTextEditor';

type Icon = React.ComponentType<{ className?: string }>;
type Group = 'basics' | 'layout' | 'media' | 'brand';
const PALETTE: Array<{ group: Group; type: BlockType; icon: Icon; admin?: boolean }> = [
  { group: 'basics', type: 'heading', icon: Heading }, { group: 'basics', type: 'text', icon: Type }, { group: 'basics', type: 'image', icon: ImageIcon },
  { group: 'basics', type: 'button', icon: MousePointerClick }, { group: 'basics', type: 'badge', icon: Tag }, { group: 'basics', type: 'icon', icon: Star },
  { group: 'layout', type: 'section', icon: Box }, { group: 'layout', type: 'columns', icon: Columns2 }, { group: 'layout', type: 'header', icon: LayoutPanelTop },
  { group: 'layout', type: 'banner', icon: GalleryHorizontal }, { group: 'layout', type: 'card', icon: SquareStack }, { group: 'layout', type: 'facts', icon: ListChecks },
  { group: 'layout', type: 'divider', icon: Minus }, { group: 'layout', type: 'spacer', icon: MoveVertical },
  { group: 'media', type: 'gallery', icon: GalleryHorizontalEnd }, { group: 'media', type: 'video', icon: Video }, { group: 'media', type: 'html', icon: SquareCode, admin: true },
  { group: 'brand', type: 'logo', icon: LayoutTemplate }, { group: 'brand', type: 'social', icon: Share2 }, { group: 'brand', type: 'contact', icon: Contact },
  { group: 'brand', type: 'footer', icon: Footprints }, { group: 'brand', type: 'unsubscribe', icon: UserMinus },
];
/* The approved "add …" labels (owner copy) for the tiles that have one. */
const ADD_LABEL: Partial<Record<BlockType, string>> = {
  text: 'ems_b_add_text', image: 'ems_b_add_photo', button: 'ems_b_add_button', section: 'ems_b_add_section', columns: 'ems_b_add_columns', divider: 'ems_b_add_divider',
};
const ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];
const MAX_HISTORY = 80;
const CLIP_KEY = 'homatch.emailDesigner.clipboard.v1';
const TIP_KEY = 'homatch.emailDesigner.tipDismissed.v1';
/* A protected layer still takes these: its protection, its visibility and its name. */
const EDITABLE_WHEN_LOCKED = new Set(['locked', 'hidden', 'name']);

export interface DesignerSection { id: string; name: string; block: Block }

export interface EmailDesignerProps {
  value: EmailDoc;
  onChange: (doc: EmailDoc) => void;
  rtl?: boolean;
  subject: string;
  previewText?: string | null;
  senderName?: string | null;
  language?: string | null;
  sections?: DesignerSection[];
  onSaveSection?: (block: Block) => void;
  onSaveTemplate?: () => void;
  /** Block ids the review checks point at (missing link / alt text): outlined on the canvas. */
  flagged?: string[];
  /** The saved campaign (version history); null before the first save. */
  campaignId?: string | null;
  /** Ask the page to save now and keep a named snapshot (manual "save version", restore). */
  onSnapshot?: (reason: 'MANUAL' | 'RESTORE') => void;
  /** The page's save status ("Saved automatically 14:02" / "Saving…"), shown in the editor bar. */
  status?: React.ReactNode;
}

/* One layout mounted at a time: two canvases would mean two in-place editors fighting for focus. */
function useLayout(): EditorLayout {
  const query = '(min-width: 1280px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide ? 'desktop' : 'mobile';
}

/* The designer clipboard survives a reload and works across campaigns (same browser only). */
const readClip = (): Block[] => {
  try { const v = JSON.parse(localStorage.getItem(CLIP_KEY) ?? 'null'); return Array.isArray(v) ? normalizeDoc({ blocks: v }).blocks : []; } catch { return []; }
};
const readTipDismissed = () => { try { return localStorage.getItem(TIP_KEY) === '1'; } catch { return false; } };

export default function EmailDesigner({
  value, onChange, rtl = false, subject, previewText, senderName, language, sections = [], onSaveSection, onSaveTemplate, flagged = [], campaignId = null, onSnapshot, status,
}: EmailDesignerProps) {
  const { t } = useLanguage();
  const layout = useLayout();
  const desktop = layout === 'desktop';
  const doc = value;
  const [selIds, setSelIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [past, setPast] = useState<EmailDoc[]>([]);
  const [future, setFuture] = useState<EmailDoc[]>([]);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [side, setSide] = useState<'elements' | 'layers'>('elements');
  /* Phone: which sheet is open (the selected element's settings, Add, or Layers). */
  const [sheet, setSheet] = useState<'none' | 'settings' | 'add' | 'layers'>('none');
  const [sheetFull, setSheetFull] = useState(false);
  const [zoomPref, setZoomPref] = useState<'fit' | number>('fit');
  const [viewportWidth, setViewportWidth] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [tipDismissed, setTipDismissed] = useState(readTipDismissed);
  /* Only offers the HTML block; the server decides (campaign_save refuses non-admin HTML). */
  const [admin, setAdmin] = useState(false);
  const clip = useRef<Block[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const lastKey = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => { void isCurrentUserAdmin().then(setAdmin).catch(() => setAdmin(false)); }, []);
  /* Selection never points at a block that is gone (undo, delete, restore). */
  useEffect(() => {
    setSelIds((s) => { const k = s.filter((id) => findBlock(doc.blocks, id)); return k.length === s.length ? s : k; });
    setEditingId((e) => (e && findBlock(doc.blocks, e) ? e : null));
  }, [doc]);

  const label = useCallback((b: Block) => b.name || t(`ems_block_${b.type}`), [t]);

  /* ── zoom: fit the email's design width into the canvas (desktop) ──────────────────────── */
  useLayoutEffect(() => {
    const vp = viewport.current;
    if (!vp) return;
    const ro = new ResizeObserver(() => setViewportWidth(vp.clientWidth));
    ro.observe(vp);
    setViewportWidth(vp.clientWidth);
    return () => ro.disconnect();
  }, [desktop, mode]);
  const fit = viewportWidth ? Math.max(0.5, Math.min(1, (viewportWidth - RAIL_GUTTER.desktop - 48) / doc.theme.width)) : 1;
  const zoom = !desktop ? 1 : zoomPref === 'fit' ? fit : zoomPref;

  /* ── history ───────────────────────────────────────────────────────────────────────────── */
  const commit = useCallback((next: EmailDoc, key?: string) => {
    const now = Date.now();
    const coalesce = key && lastKey.current && lastKey.current.key === key && now - lastKey.current.at < 1200;
    if (!coalesce) { setPast((p) => [...p.slice(-MAX_HISTORY + 1), doc]); setFuture([]); }
    lastKey.current = key ? { key, at: now } : null;
    onChange(normalizeDoc(next));
  }, [doc, onChange]);
  const setBlocks = useCallback((blocks: Block[] | null, key?: string) => { if (blocks) commit({ ...doc, blocks }, key); return Boolean(blocks); }, [commit, doc]);
  const undo = useCallback(() => {
    if (!past.length) return;
    setPast(past.slice(0, -1)); setFuture([doc, ...future].slice(0, MAX_HISTORY)); lastKey.current = null; onChange(past[past.length - 1]);
  }, [past, future, doc, onChange]);
  const redo = useCallback(() => {
    if (!future.length) return;
    setFuture(future.slice(1)); setPast([...past, doc].slice(-MAX_HISTORY)); lastKey.current = null; onChange(future[0]);
  }, [past, future, doc, onChange]);

  /* ── operations ────────────────────────────────────────────────────────────────────────── */
  const primary = selIds[selIds.length - 1] ?? null;
  const selected = primary ? findBlock(doc.blocks, primary) : null;
  const unlocked = useCallback((ids: string[]) => ids.filter((id) => !isLockedPath(doc.blocks, id)), [doc.blocks]);

  /* On a phone, selecting opens the element's settings and brings the block into the space above the sheet
     — at once, not smoothly: an animated scroll moved the email under a finger that had just found the
     handle, and alongside the sheet's entrance it left Chrome producing a frame or two a second. */
  const reveal = useCallback((id: string) => {
    if (desktop) return;
    window.requestAnimationFrame(() => {
      const el = rootRef.current?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      /* Into the band between the sticky editor bar and the sheet — not under the bar, where the
         block's handle (beneath the bar) could not be reached. A tall block shows its top. */
      const top = (barRef.current?.getBoundingClientRect().bottom ?? 72) + 8;
      const bottom = window.innerHeight * (1 - SHEET_HEIGHT.half) - 8;
      const target = top + Math.max(0, (bottom - top - r.height) / 2);
      if (Math.abs(r.top - target) >= 2) window.scrollBy({ top: r.top - target, behavior: 'instant' });
    });
  }, [desktop]);
  const select = useCallback((id: string, additive: boolean) => {
    setEditingId((e) => (e === id ? e : null));
    setSelIds((s) => (additive ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]));
    if (!desktop && !additive) { setSheet('settings'); setSheetFull(false); reveal(id); }
  }, [desktop, reveal]);
  const clearSelection = useCallback(() => { setSelIds([]); setEditingId(null); if (sheet === 'settings') setSheet('none'); }, [sheet]);

  /** Where a new block goes: after the selection if its container can hold it, else after the top-level block around it. */
  const placeFor = useCallback((b: Block): Place => {
    const at = primary ? locate(doc.blocks, primary) : null;
    if (at && canContain(at.container, b)) return { container: at.container, index: at.index + 1 };
    if (at && primary) return { container: ROOT, index: doc.blocks.findIndex((x) => subtreeIds(x).includes(primary)) + 1 };
    return { container: ROOT, index: doc.blocks.length };
  }, [doc.blocks, primary]);

  const insert = useCallback((b: Block, place?: Place) => {
    const ok = setBlocks(insertBlocks(doc.blocks, place ?? placeFor(b), [b]));
    if (!ok) { toast.error(t('ems_b_cannot_place')); return; }
    setSelIds([b.id]); setEditingId(null);
    if (!desktop) { setSheet('settings'); setSheetFull(false); reveal(b.id); }
  }, [doc.blocks, placeFor, setBlocks, t, desktop, reveal]);
  const addBlock = (type: BlockType) => insert(createBlock(type));

  const patch = useCallback((id: string, p: Record<string, unknown>, key?: string) => {
    if (isLockedPath(doc.blocks, id) && !Object.keys(p).every((k) => EDITABLE_WHEN_LOCKED.has(k))) return;
    setBlocks(updateBlock(doc.blocks, id, (b) => ({ ...b, ...p } as Block)), key);
  }, [doc.blocks, setBlocks]);

  const nudgeOne = (id: string, dir: -1 | 1) => { if (!isLockedPath(doc.blocks, id)) { setBlocks(nudge(doc.blocks, id, dir)); reveal(id); } };
  const duplicateSel = (ids = selIds) => {
    const r = duplicateBlocks(doc.blocks, ids);
    if (r) { setBlocks(r.blocks); setSelIds(r.ids); if (r.ids[0]) reveal(r.ids[0]); } else if (ids.length) toast.error(t('ems_b_same_container'));
  };
  const removeSel = (ids = selIds) => {
    const ok = unlocked(ids);
    if (!ok.length) return;
    setBlocks(removeBlocks(doc.blocks, ok));
    setSelIds([]); setEditingId(null);
    if (sheet === 'settings') setSheet('none');
  };
  const groupSel = () => {
    const r = groupIntoSection(doc.blocks, unlocked(selIds), (children) => ({ ...(createBlock('section') as SectionBlock), children, background: null, padding: { t: 0, r: 0, b: 0, l: 0 }, radius: 0 }));
    if (r) { setBlocks(r.blocks); setSelIds([r.id]); } else toast.error(t('ems_b_group_rule'));
  };
  const ungroupSel = () => {
    const r = primary ? ungroupSection(doc.blocks, primary) : null;
    if (r) { setBlocks(r.blocks); setSelIds(r.ids); }
  };
  const copySel = (cut = false) => {
    const blocks = selIds.map((id) => findBlock(doc.blocks, id)).filter((b): b is Block => Boolean(b));
    if (!blocks.length) return;
    clip.current = blocks.map((b) => JSON.parse(JSON.stringify(b)) as Block);
    try { localStorage.setItem(CLIP_KEY, JSON.stringify(clip.current)); } catch { /* clipboard stays in memory */ }
    if (cut) removeSel(); else toast.success(t('ems_b_copied_n', { n: blocks.length }));
  };
  const paste = () => {
    const items = clip.current.length ? clip.current : readClip();
    if (!items.length) return;
    const at = primary ? locate(doc.blocks, primary) : null;
    const r = pasteBlocks(doc.blocks, at ? { container: at.container, index: at.index + 1 } : { container: ROOT, index: doc.blocks.length }, items);
    if (r) { setBlocks(r.blocks); setSelIds(r.ids); } else toast.error(t('ems_b_cannot_place'));
  };

  const primaryAt = primary ? locate(doc.blocks, primary) : null;
  const atRoot = selIds.length > 0 && selIds.every((id) => locate(doc.blocks, id)?.container === ROOT);
  const canGroup = atRoot && selIds.every((id) => findBlock(doc.blocks, id)?.type !== 'section') && !selIds.some((id) => isLockedPath(doc.blocks, id));
  const canUngroup = selIds.length === 1 && selected?.type === 'section' && primaryAt?.container === ROOT && !isLockedPath(doc.blocks, selected.id);
  const siblings = primaryAt ? childrenOf(doc.blocks, primaryAt.container).length : null;

  /* ── drag & drop ───────────────────────────────────────────────────────────────────────── */
  const onDrop = useCallback((p: DragPayload, place: Place) => {
    if (p.kind === 'new') { insert(createBlock(p.type), place); return; }
    if (p.kind === 'section') { insert(cloneBlock(p.block), place); return; }
    const ids = unlocked(p.ids);
    if (ids.length && !setBlocks(moveBlocks(doc.blocks, ids, place))) toast.error(t('ems_b_cannot_place'));
  }, [doc.blocks, insert, setBlocks, t, unlocked]);
  const { drag, begin } = useBlockDrag({ blocks: doc.blocks, viewport, onDrop });

  /* ── zoom & pan ────────────────────────────────────────────────────────────────────────── */
  const zoomBy = useCallback((dir: -1 | 1) => setZoomPref(() => {
    const i = ZOOMS.findIndex((x) => x >= zoom - 0.001);
    return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 4 : i) + dir))];
  }), [zoom]);
  const pan = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  useEffect(() => {
    const vp = viewport.current;
    if (!vp || !desktop) return;
    const wheel = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomBy(e.deltaY > 0 ? -1 : 1); } };
    vp.addEventListener('wheel', wheel, { passive: false });
    return () => vp.removeEventListener('wheel', wheel);
  }, [zoomBy, mode, desktop]);

  /* ── keyboard ──────────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT' || el?.isContentEditable;
      const inside = !el || el === document.body || Boolean(rootRef.current?.contains(el));
      if (!inside || typing || mode !== 'edit') return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === ' ' && !e.repeat && desktop && el?.getAttribute('role') !== 'button' && el?.tagName !== 'BUTTON') { setSpaceDown(true); return; }
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && ((k === 'z' && e.shiftKey) || k === 'y')) { e.preventDefault(); redo(); }
      else if (mod && k === 'd' && selIds.length) { e.preventDefault(); duplicateSel(); }
      else if (mod && k === 'c' && selIds.length) { e.preventDefault(); copySel(); }
      else if (mod && k === 'x' && selIds.length) { e.preventDefault(); copySel(true); }
      else if (mod && k === 'v') { e.preventDefault(); paste(); }
      else if (mod && k === 'g' && e.shiftKey) { e.preventDefault(); if (canUngroup) ungroupSel(); }
      else if (mod && k === 'g') { e.preventDefault(); if (canGroup) groupSel(); }
      else if (mod && k === 'a') { e.preventDefault(); setSelIds(doc.blocks.map((b) => b.id)); }
      else if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomBy(1); }
      else if (mod && k === '-') { e.preventDefault(); zoomBy(-1); }
      else if (mod && k === '0') { e.preventDefault(); setZoomPref('fit'); }
      else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && primary) { e.preventDefault(); nudgeOne(primary, e.key === 'ArrowUp' ? -1 : 1); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selIds.length) { e.preventDefault(); removeSel(); }
      else if (e.key === 'Escape') { clearSelection(); }
    };
    const onUp = (e: KeyboardEvent) => { if (e.key === ' ') setSpaceDown(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp); };
  });

  const warnings = useMemo(() => analyzeCompat(doc), [doc]);
  const warnCount = warnings.filter((w) => w.severity === 'warn').length;
  const flaggedSet = useMemo(() => new Set(flagged), [flagged]);

  /* ── panels ────────────────────────────────────────────────────────────────────────────── */
  const tile = cn('flex touch-manipulation select-none flex-col items-center justify-center gap-1 rounded-xl border bg-card px-1.5 py-2 text-center text-xs leading-tight text-foreground/85 transition-colors hover:border-[hsl(38_70%_60%)] hover:bg-[hsl(38_90%_97%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_80%_55%)]',
    desktop ? 'min-h-[60px]' : 'min-h-[72px]');
  const row = 'flex min-h-11 w-full touch-manipulation select-none items-center gap-2 rounded-xl border bg-card px-3 py-2 text-start text-[13px] hover:bg-muted';
  /* Tap/click adds (and, on a phone, closes the sheet and opens the new element's settings); a mouse can also drag. */
  const addFrom = (fn: () => void) => () => { fn(); };
  const palette = (
    <div className="space-y-4">
      <p className="text-2xs leading-snug text-muted-foreground">{t(desktop ? 'ems_b_elements_hint' : 'ems_b_elements_hint_touch')}</p>
      {(['basics', 'layout', 'media', 'brand'] as const).map((g) => (
        <div key={g}>
          <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t(`ems_b_group_${g}`)}</p>
          <div className={cn('grid gap-1.5', desktop ? 'grid-cols-2' : 'grid-cols-3 min-[430px]:grid-cols-4')}>
            {PALETTE.filter((p) => p.group === g && (!p.admin || admin)).map(({ type, icon: I }) => (
              <button key={type} type="button" title={t(`ems_block_${type}_hint`)} className={tile} aria-label={ADD_LABEL[type] ? t(ADD_LABEL[type]!) : t(`ems_block_${type}`)}
                onPointerDown={(e) => { if (e.pointerType === 'mouse') begin({ kind: 'new', type, label: t(`ems_block_${type}`) }, e); }}
                onClick={addFrom(() => addBlock(type))}>
                <I className="h-5 w-5 text-[hsl(32_60%_38%)]" aria-hidden="true" />
                <span className="[overflow-wrap:anywhere]">{t(`ems_block_${type}`)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <div>
        <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('ems_b_ready_sections')}</p>
        <div className="space-y-1.5">
          {READY_SECTIONS.map((k: ReadySectionKey) => (
            <button key={k} type="button" className={row}
              onPointerDown={(e) => { if (e.pointerType === 'mouse') begin({ kind: 'section', block: readySection(k, doc.theme.accent), label: t(`ems_b_ready_${k}`) }, e); }}
              onClick={addFrom(() => insert(cloneBlock(readySection(k, doc.theme.accent))))}>
              <Box className="h-4 w-4 shrink-0 text-[hsl(32_60%_38%)]" aria-hidden="true" />
              <span className="min-w-0 flex-1"><span className="block [overflow-wrap:anywhere]">{t(`ems_b_ready_${k}`)}</span><span className="block text-2xs text-muted-foreground [overflow-wrap:anywhere]">{t(`ems_b_ready_${k}_hint`)}</span></span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('ems_b_custom_blocks')}</p>
        {sections.length ? (
          <div className="space-y-1.5">
            {sections.map((s) => (
              <button key={s.id} type="button" className={row}
                onPointerDown={(e) => { if (e.pointerType === 'mouse') begin({ kind: 'section', block: s.block, label: s.name }, e); }} onClick={addFrom(() => insert(cloneBlock(s.block)))}>
                <Layers className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{s.name}</span>
              </button>
            ))}
          </div>
        ) : <p className="text-xs leading-relaxed text-muted-foreground">{t('ems_d_sections_empty')}</p>}
      </div>
    </div>
  );

  const layers = (
    <LayersPanel blocks={doc.blocks} selIds={selIds} label={label} touch={!desktop} onSelect={(id, add) => { select(id, add); }} onPatch={(id, p) => patch(id, p)} onNudge={nudgeOne}
      onDuplicate={() => duplicateSel()} onRemove={() => removeSel()} onGroup={groupSel} onUngroup={ungroupSel} canGroup={canGroup} canUngroup={canUngroup} />
  );

  /* The text or heading being edited, in the email's own look. */
  const inlineEditor = (b: Block) => {
    if (b.type !== 'text' && b.type !== 'heading') return null;
    const font = FONT_STACKS[b.fontFamily ?? doc.theme.fontFamily];
    const size = b.type === 'heading' ? b.fontSize ?? (b.level === 1 ? 28 : b.level === 2 ? 22 : 18) : b.fontSize ?? 16;
    const align = b.align === 'center' ? 'center' : b.align === 'right' ? (rtl ? 'left' : 'right') : (rtl ? 'right' : 'left');
    return (
      <div data-no-drag style={{ padding: `${b.padding?.t ?? 8}px ${b.padding?.r ?? 32}px ${b.padding?.b ?? 8}px ${b.padding?.l ?? 32}px`, backgroundColor: b.background ?? undefined }}
        onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setEditingId(null); }}>
        <RichTextEditor
          value={b.rich ?? ''} fallbackHtml={b.rich ? undefined : inlineMarkup(b.text, doc.theme.link)} autoFocus inline={b.type === 'heading'}
          ariaLabel={label(b)} placeholder={t(b.type === 'heading' ? 'ems_d_heading_placeholder' : 'ems_d_text_placeholder')} dir={rtl ? 'rtl' : 'ltr'}
          onChange={(rich) => patch(b.id, { rich }, `rich:${b.id}`)}
          style={{ fontFamily: font, fontSize: size, lineHeight: b.type === 'heading' ? 1.3 : b.lineHeight ?? 1.65, fontWeight: b.fontWeight ?? (b.type === 'heading' ? 700 : 400), color: b.color ?? doc.theme.text, textAlign: align, overflowWrap: 'anywhere' }}
        />
      </div>
    );
  };

  const canvas = (
    <div
      ref={viewport}
      className={cn('relative min-w-0', desktop && 'max-h-[calc(100dvh-9rem)] overflow-auto rounded-2xl', spaceDown && 'cursor-grab')}
      style={!desktop && sheet !== 'none' ? { paddingBottom: `${SHEET_HEIGHT.half * 100}dvh` } : undefined}
      onPointerDownCapture={(e) => {
        if (!desktop || !(spaceDown || e.button === 1) || !viewport.current) return;
        e.preventDefault(); e.stopPropagation();
        viewport.current.setPointerCapture(e.pointerId);
        pan.current = { x: e.clientX, y: e.clientY, sl: viewport.current.scrollLeft, st: viewport.current.scrollTop };
      }}
      onPointerMove={(e) => { const p = pan.current; const v = viewport.current; if (p && v) { v.scrollLeft = p.sl - (e.clientX - p.x); v.scrollTop = p.st - (e.clientY - p.y); } }}
      onPointerUp={() => { pan.current = null; }}
      onClickCapture={(e) => { if (spaceDown) { e.stopPropagation(); e.preventDefault(); } }}
    >
      <Canvas doc={doc} rtl={rtl} zoom={zoom} layout={layout} selIds={selIds} editingId={editingId} flagged={flaggedSet} drag={drag} beginDrag={begin}
        onSelect={select} onClear={clearSelection} onEdit={(id) => { setSelIds([id]); setEditingId(id); }}
        onPatch={patch} onNudge={nudgeOne} onDuplicate={(id) => duplicateSel([id])} onRemove={(id) => removeSel([id])} onSaveSection={onSaveSection}
        onAdd={() => { if (desktop) setSide('elements'); else { setSheet('add'); setSheetFull(false); } }}
        renderInline={inlineEditor} label={label} />
    </div>
  );

  const inspector = selected ? (
    <BlockProperties
      block={selected} theme={doc.theme} rtl={rtl} onPatch={(p, key) => patch(selected.id, p, key)} onClose={clearSelection}
      editsOnCanvas={desktop} locked={isLockedPath(doc.blocks, selected.id)} canHtml={admin} onRemove={() => removeSel([selected.id])} compactHeader={!desktop}
    />
  ) : <ThemeProperties theme={doc.theme} onPatch={(p: Partial<Theme>) => commit({ ...doc, theme: { ...doc.theme, ...p } })} />;

  const multi = selIds.length > 1 ? (
    <div className="mb-3 flex items-center justify-between rounded-lg border bg-[hsl(38_90%_96%)] px-2.5 py-1.5 text-xs">
      <span>{t('ems_b_n_selected', { n: selIds.length })}</span>
      <button type="button" className="text-2xs underline-offset-2 hover:underline" onClick={() => setSelIds([])}>{t('ems_b_clear_selection')}</button>
    </div>
  ) : null;

  const tip = !tipDismissed && mode === 'edit' && !selIds.length && doc.blocks.length ? (
    <div className="flex items-start gap-2 rounded-xl border border-[hsl(38_60%_80%)] bg-[hsl(38_90%_97%)] px-3 py-2 text-xs text-foreground/80" role="note">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(32_60%_38%)]" aria-hidden="true" />
      <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">{t(desktop ? 'ems_b_tip_desktop' : 'ems_b_tip_touch')}</p>
      <button type="button" className="-m-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-white/70" aria-label={t('ems_b_tip_dismiss')}
        onClick={() => { setTipDismissed(true); try { localStorage.setItem(TIP_KEY, '1'); } catch { /* per-device only */ } }}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  ) : null;

  const preview = (
    <PreviewPanel doc={doc} rtl={rtl} subject={subject} previewText={previewText} senderName={senderName} language={language} label={label}
      onApply={(next) => commit(next)} onSelect={(id) => { setMode('edit'); select(id, false); }} />
  );

  const versionDialog = (
    <VersionHistory campaignId={campaignId} open={historyOpen} onOpenChange={setHistoryOpen} rtl={rtl}
      onRestore={(d) => { commit(d); onSnapshot?.('RESTORE'); toast.success(t('ems_b_restored')); }} />
  );

  /* ───────────────────────────────────────── phone & tablet ───────────────────────────────── */
  if (!desktop) {
    /* Four equal tabs, icon over label: Georgian labels ("რედაქტირება") clipped side by side at 320–390 px. */
    const navBtn = (active: boolean) => cn('inline-flex min-h-11 min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-2xs font-medium leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_85%_55%)]',
      active ? 'bg-[#0C1119] text-white' : 'text-foreground/75 hover:bg-muted');
    const view = mode === 'preview' ? 'preview' : sheet === 'add' ? 'add' : sheet === 'layers' ? 'layers' : 'edit';
    const sheetBtn = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-foreground/75 hover:bg-muted disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_85%_55%)]';
    const locked = selected ? isLockedPath(doc.blocks, selected.id) : false;
    const at = primaryAt;
    return (
      <div ref={rootRef} className="flex min-w-0 flex-col gap-2.5">
        <div ref={barRef} className="sticky top-16 z-30 -mx-1 space-y-1.5 rounded-2xl border bg-card/95 p-1.5 shadow-sm backdrop-blur" role="toolbar" aria-label={t('ems_d_mode')}>
          <div className="flex gap-1">
            <button type="button" className={navBtn(view === 'edit')} aria-pressed={view === 'edit'} onClick={() => { setMode('edit'); setSheet(selected ? 'settings' : 'none'); }}>
              <Palette className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="max-w-full truncate" title={t('ems_b_nav_edit')}>{t('ems_b_nav_edit')}</span>
            </button>
            <button type="button" className={navBtn(view === 'add')} aria-pressed={view === 'add'} onClick={() => { setMode('edit'); setSheet('add'); setSheetFull(false); }}>
              <Plus className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="max-w-full truncate" title={t('ems_b_nav_add')}>{t('ems_b_nav_add')}</span>
            </button>
            <button type="button" className={navBtn(view === 'layers')} aria-pressed={view === 'layers'} onClick={() => { setMode('edit'); setSheet('layers'); setSheetFull(false); }}>
              <Layers className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="max-w-full truncate" title={t('ems_b_layers')}>{t('ems_b_layers')}</span>
            </button>
            <button type="button" className={navBtn(view === 'preview')} aria-pressed={view === 'preview'} onClick={() => { setMode('preview'); setSheet('none'); }}>
              <Eye className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="max-w-full truncate" title={t('ems_d_mode_preview')}>{t('ems_d_mode_preview')}</span>
            </button>
          </div>
          <div className="flex items-center gap-1 px-0.5">
            <button type="button" className={sheetBtn} onClick={undo} disabled={!past.length} aria-label={t('ems_d_undo')}><Undo2 className="h-4 w-4" /></button>
            <button type="button" className={sheetBtn} onClick={redo} disabled={!future.length} aria-label={t('ems_d_redo')}><Redo2 className="h-4 w-4" /></button>
            <div className="min-w-0 flex-1 truncate px-1 text-2xs text-muted-foreground" aria-live="polite">{status}</div>
            {warnings.length ? (
              <button type="button" onClick={() => setMode('preview')} className={cn('inline-flex h-9 items-center gap-1 rounded-lg border px-2 text-2xs', warnCount ? 'border-amber-300 bg-amber-50 text-amber-900' : 'text-muted-foreground')}>
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />{warnings.length}<span className="sr-only">{t('ems_b_compat_n', { n: warnings.length })}</span>
              </button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={sheetBtn} aria-label={t('ems_b_more_actions')}><MoreHorizontal className="h-5 w-5" /></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[13rem]">
                <DropdownMenuItem className="min-h-11" onSelect={() => setHistoryOpen(true)}><History className="me-2 h-4 w-4" />{t('ems_b_history')}</DropdownMenuItem>
                {onSnapshot ? <DropdownMenuItem className="min-h-11" disabled={!campaignId} onSelect={() => onSnapshot('MANUAL')}><Save className="me-2 h-4 w-4" />{t('ems_b_save_version')}</DropdownMenuItem> : null}
                {onSaveTemplate ? <DropdownMenuItem className="min-h-11" onSelect={onSaveTemplate}><BookmarkPlus className="me-2 h-4 w-4" />{t('ems_d_save_template')}</DropdownMenuItem> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {mode === 'preview' ? preview : (<>
          {tip}
          {canvas}
        </>)}

        <BottomSheet open={mode === 'edit' && sheet === 'settings' && Boolean(selected)} labelledBy="ems-sheet-settings" suspended={Boolean(drag)} expanded={sheetFull} onExpand={setSheetFull} onClose={clearSelection}
          title={selected ? label(selected) : ''} subtitle={selected ? t(`ems_block_${selected.type}_hint`) : undefined}
          actions={selected ? (<>
            <button type="button" className={sheetBtn} aria-label={t('ems_d_move_up')} disabled={locked || !at || at.index === 0} onClick={() => nudgeOne(selected.id, -1)}><ArrowUp className="h-5 w-5" /></button>
            <button type="button" className={sheetBtn} aria-label={t('ems_d_move_down')} disabled={locked || !at || (siblings != null && at.index >= siblings - 1)} onClick={() => nudgeOne(selected.id, 1)}><ArrowDown className="h-5 w-5" /></button>
            <button type="button" className={sheetBtn} aria-label={t('ems_d_duplicate')} onClick={() => duplicateSel([selected.id])}><Copy className="h-5 w-5" /></button>
            <button type="button" className={sheetBtn} aria-label={t('ems_d_delete')} disabled={locked} onClick={() => removeSel([selected.id])}><Trash2 className="h-5 w-5 text-red-600" /></button>
          </>) : null}>
          {multi}{inspector}
        </BottomSheet>
        <BottomSheet open={mode === 'edit' && sheet === 'add'} labelledBy="ems-sheet-add" suspended={Boolean(drag)} expanded={sheetFull} onExpand={setSheetFull} onClose={() => setSheet(selected ? 'settings' : 'none')}
          title={t('ems_b_add_element')} subtitle={selected ? t('ems_b_add_after', { name: label(selected) }) : t('ems_b_add_at_end')}>
          {palette}
        </BottomSheet>
        <BottomSheet open={mode === 'edit' && sheet === 'layers'} labelledBy="ems-sheet-layers" suspended={Boolean(drag)} expanded={sheetFull} onExpand={setSheetFull} onClose={() => setSheet(selected ? 'settings' : 'none')}
          title={t('ems_b_layers')}>
          {layers}
        </BottomSheet>
        {versionDialog}
      </div>
    );
  }

  /* ───────────────────────────────────────── desktop ──────────────────────────────────────── */
  return (
    <div ref={rootRef} className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2 overflow-hidden rounded-xl border bg-card px-2.5 py-2">
        <div className="inline-flex shrink-0 gap-0.5">
          <Button type="button" variant="ghost" size="sm" className="h-9 gap-1.5" onClick={undo} disabled={!past.length} aria-label={t('ems_d_undo')} title={t('ems_b_shortcut', { action: t('ems_d_undo'), keys: 'Ctrl+Z' })}>
            <Undo2 className="h-4 w-4" /><span className="hidden 2xl:inline">{t('ems_d_undo')}</span>
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-9 gap-1.5" onClick={redo} disabled={!future.length} aria-label={t('ems_d_redo')} title={t('ems_b_shortcut', { action: t('ems_d_redo'), keys: 'Ctrl+Shift+Z' })}>
            <Redo2 className="h-4 w-4" /><span className="hidden 2xl:inline">{t('ems_d_redo')}</span>
          </Button>
        </div>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label={t('ems_d_mode')}>
          {(['edit', 'preview'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
              className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs', mode === m ? 'bg-[#0C1119] text-white' : 'text-muted-foreground hover:text-foreground')}>
              {m === 'edit' ? <Palette className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}{t(`ems_d_mode_${m}`)}
            </button>
          ))}
        </div>
        {mode === 'edit' ? (
          <div className="inline-flex items-center rounded-lg border p-0.5" role="group" aria-label={t('ems_b_zoom')}>
            <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground disabled:opacity-30" onClick={() => zoomBy(-1)} disabled={zoom <= ZOOMS[0]} aria-label={t('ems_b_zoom_out')} title={t('ems_b_shortcut', { action: t('ems_b_zoom_out'), keys: 'Ctrl −' })}><ZoomOut className="h-3.5 w-3.5" /></button>
            <button type="button" className={cn('h-8 min-w-[3.75rem] rounded-md px-1.5 text-xs tabular-nums', zoomPref === 'fit' && 'font-semibold')} onClick={() => setZoomPref('fit')} title={t('ems_b_zoom_fit')} dir="ltr">
              {zoomPref === 'fit' ? `${t('ems_b_zoom_fit_short')} · ${Math.round(zoom * 100)}%` : `${Math.round(zoom * 100)}%`}
            </button>
            <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground disabled:opacity-30" onClick={() => zoomBy(1)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} aria-label={t('ems_b_zoom_in')} title={t('ems_b_shortcut', { action: t('ems_b_zoom_in'), keys: 'Ctrl +' })}><ZoomIn className="h-3.5 w-3.5" /></button>
          </div>
        ) : null}
        {warnings.length ? (
          <button type="button" onClick={() => setMode('preview')} title={t('ems_b_compat_title')}
            className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs', warnCount ? 'border-amber-300 bg-amber-50 text-amber-900' : 'text-muted-foreground')}>
            <AlertTriangle className="h-3.5 w-3.5" />{t('ems_b_compat_n', { n: warnings.length })}
          </button>
        ) : null}
        <div className="ms-auto flex min-w-0 items-center gap-1.5">
          {/* A fixed slot: the status text changes as you work and must never re-flow the bar (the canvas would jump mid-drag). */}
          <span className="block w-48 truncate text-end text-xs text-muted-foreground 2xl:w-56" aria-live="polite">{status}</span>
          <Button type="button" variant="ghost" size="sm" className="h-9 gap-1.5" onClick={() => setHistoryOpen(true)}><History className="h-4 w-4" /><span className="hidden 2xl:inline">{t('ems_b_history')}</span><span className="sr-only 2xl:hidden">{t('ems_b_history')}</span></Button>
          {onSnapshot ? <Button type="button" variant="ghost" size="sm" className="h-9 gap-1.5" disabled={!campaignId} onClick={() => onSnapshot('MANUAL')}><Save className="h-4 w-4" /><span className="hidden 2xl:inline">{t('ems_b_save_version')}</span><span className="sr-only 2xl:hidden">{t('ems_b_save_version')}</span></Button> : null}
          {onSaveTemplate ? (
            <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={onSaveTemplate}><BookmarkPlus className="h-4 w-4" />{t('ems_d_save_template')}</Button>
          ) : null}
        </div>
      </div>

      {mode === 'preview' ? preview : (
        <div className="grid min-w-0 grid-cols-[13.5rem_minmax(0,1fr)_19rem] gap-4 2xl:grid-cols-[15rem_minmax(0,1fr)_21rem]">
          <aside className="min-w-0">
            <div className="sticky top-20 max-h-[calc(100dvh-7rem)] overflow-y-auto pe-1">
              <Tabs value={side} onValueChange={(v) => setSide(v as typeof side)}>
                <TabsList className="mb-3 grid w-full grid-cols-2">
                  <TabsTrigger value="elements">{t('ems_b_elements')}</TabsTrigger>
                  <TabsTrigger value="layers">{t('ems_b_layers')}</TabsTrigger>
                </TabsList>
                <TabsContent value="elements">{palette}</TabsContent>
                <TabsContent value="layers">{layers}</TabsContent>
              </Tabs>
            </div>
          </aside>
          <div className="min-w-0 space-y-2">{tip}{canvas}</div>
          <aside className="min-w-0">
            <div className="sticky top-20 max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-xl border bg-card p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('ems_b_properties')}</p>
                {selected && (selected.type === 'text' || selected.type === 'heading') && !isLockedPath(doc.blocks, selected.id) ? (
                  <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => { setEditingId(selected.id); }}>
                    <PencilLine className="h-3.5 w-3.5" />{t('ems_b_edit_text')}
                  </Button>
                ) : null}
              </div>
              {multi}{inspector}
            </div>
          </aside>
        </div>
      )}
      {versionDialog}
    </div>
  );
}

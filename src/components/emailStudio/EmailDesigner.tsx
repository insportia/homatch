// EMAIL STUDIO — the visual email designer ("ელფოსტის დიზაინი"). Owner briefs §5, the UX pass §4 and
// the drag & drop builder brief (2026-10-24).
//
// Edits a designer DOCUMENT (src/emailMarketing/designer/document.ts), never HTML. Three panels:
// Elements / Layers · the live canvas · Properties. The canvas shows each block through the same
// renderer the server uses, so the canvas is the email. Every structural action goes through
// designer/tree.ts, which refuses a placement the format cannot hold; every value through
// normalizeDoc. Nothing here can express a script.
//
// Interaction: drag blocks, ready-made sections and saved blocks onto the canvas and between
// sections and columns (pointer events: mouse, pen, touch via the grip); click to select,
// Shift/Ctrl/⌘-click to add to the selection; double-click (or Enter) edits text in place; resize
// handles on images, videos and spacers. Keyboard: Ctrl/⌘ Z / Shift+Z / Y undo and redo; C, X, V
// copy, cut, paste; D duplicate; G group into a section, Shift+G ungroup; A select all;
// Alt+↑/↓ move; Delete removes; Esc clears; Ctrl/⌘ + / − / 0 zoom; Space+drag (or the middle
// button) pans. Typing is coalesced into one undo step per pause.

import {
  AlertTriangle, BookmarkPlus, Box, Columns2, Contact, Eye, Footprints, GalleryHorizontal, GalleryHorizontalEnd, Heading, History, Image as ImageIcon,
  Layers, LayoutPanelTop, LayoutTemplate, ListChecks, Minus, MousePointerClick, MoveVertical, Palette, Plus, Redo2, Save, Share2, SquareCode, SquareStack,
  Star, Tag, Type, Undo2, UserMinus, Video, ZoomIn, ZoomOut,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/contexts/LanguageContext';
import { analyzeCompat } from '@/emailMarketing/designer/compat';
import {
  type Block, type BlockType, cloneBlock, createBlock, type EmailDoc, FONT_STACKS, normalizeDoc, type SectionBlock, type Theme,
} from '@/emailMarketing/designer/document';
import { READY_SECTIONS, type ReadySectionKey, readySection } from '@/emailMarketing/designer/readySections';
import { inlineMarkup } from '@/emailMarketing/designer/render';
import {
  canContain, duplicateBlocks, findBlock, groupIntoSection, insertBlocks, isLockedPath, locate, moveBlocks, nudge, type Place, pasteBlocks,
  removeBlocks, ROOT, subtreeIds, ungroupSection, updateBlock,
} from '@/emailMarketing/designer/tree';
import { cn } from '@/lib/utils';
import { isCurrentUserAdmin } from '@/services/api';
import { Canvas } from './designer/Canvas';
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
/* A locked layer still takes these: its lock, its visibility and its name. */
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
}

/* One layout mounted at a time: two canvases would mean two in-place editors fighting for focus. */
function useWide(): boolean {
  const query = '(min-width: 1280px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/* The designer clipboard survives a reload and works across campaigns (same browser only). */
const readClip = (): Block[] => {
  try { const v = JSON.parse(localStorage.getItem(CLIP_KEY) ?? 'null'); return Array.isArray(v) ? normalizeDoc({ blocks: v }).blocks : []; } catch { return []; }
};

export default function EmailDesigner({
  value, onChange, rtl = false, subject, previewText, senderName, language, sections = [], onSaveSection, onSaveTemplate, flagged = [], campaignId = null, onSnapshot,
}: EmailDesignerProps) {
  const { t } = useLanguage();
  const wide = useWide();
  const doc = value;
  const [selIds, setSelIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [past, setPast] = useState<EmailDoc[]>([]);
  const [future, setFuture] = useState<EmailDoc[]>([]);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [side, setSide] = useState<'elements' | 'layers'>('elements');
  const [mobilePane, setMobilePane] = useState<'blocks' | 'layers' | 'canvas' | 'props'>('canvas');
  const [zoom, setZoom] = useState(1);
  const [historyOpen, setHistoryOpen] = useState(false);
  /* Only offers the HTML block; the server decides (campaign_save refuses non-admin HTML). */
  const [admin, setAdmin] = useState(false);
  const clip = useRef<Block[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const lastKey = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => { void isCurrentUserAdmin().then(setAdmin).catch(() => setAdmin(false)); }, []);
  /* Selection never points at a block that is gone (undo, delete, restore). */
  useEffect(() => {
    setSelIds((s) => { const k = s.filter((id) => findBlock(doc.blocks, id)); return k.length === s.length ? s : k; });
    setEditingId((e) => (e && findBlock(doc.blocks, e) ? e : null));
  }, [doc]);

  const label = useCallback((b: Block) => b.name || t(`ems_block_${b.type}`), [t]);

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

  const select = useCallback((id: string, additive: boolean) => {
    setEditingId((e) => (e === id ? e : null));
    setSelIds((s) => (additive ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]));
  }, []);

  /** Where a new block goes: after the selection if its container can hold it, else after the top-level block around it. */
  const placeFor = useCallback((b: Block): Place => {
    const at = primary ? locate(doc.blocks, primary) : null;
    if (at && canContain(at.container, b)) return { container: at.container, index: at.index + 1 };
    if (at && primary) return { container: ROOT, index: doc.blocks.findIndex((x) => subtreeIds(x).includes(primary)) + 1 };
    return { container: ROOT, index: doc.blocks.length };
  }, [doc.blocks, primary]);

  const insert = useCallback((b: Block, place?: Place) => {
    const ok = setBlocks(insertBlocks(doc.blocks, place ?? placeFor(b), [b]));
    if (ok) { setSelIds([b.id]); setEditingId(null); setMobilePane('props'); } else toast.error(t('ems_b_cannot_place'));
  }, [doc.blocks, placeFor, setBlocks, t]);
  const addBlock = (type: BlockType) => insert(createBlock(type));

  const patch = useCallback((id: string, p: Record<string, unknown>, key?: string) => {
    if (isLockedPath(doc.blocks, id) && !Object.keys(p).every((k) => EDITABLE_WHEN_LOCKED.has(k))) return;
    setBlocks(updateBlock(doc.blocks, id, (b) => ({ ...b, ...p } as Block)), key);
  }, [doc.blocks, setBlocks]);

  const nudgeOne = (id: string, dir: -1 | 1) => { if (!isLockedPath(doc.blocks, id)) setBlocks(nudge(doc.blocks, id, dir)); };
  const duplicateSel = (ids = selIds) => {
    const r = duplicateBlocks(doc.blocks, ids);
    if (r) { setBlocks(r.blocks); setSelIds(r.ids); } else if (ids.length) toast.error(t('ems_b_same_container'));
  };
  const removeSel = (ids = selIds) => {
    const ok = unlocked(ids);
    if (!ok.length) return;
    setBlocks(removeBlocks(doc.blocks, ok));
    setSelIds([]); setEditingId(null);
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

  /* ── drag & drop ───────────────────────────────────────────────────────────────────────── */
  const onDrop = useCallback((p: DragPayload, place: Place) => {
    if (p.kind === 'new') { insert(createBlock(p.type), place); return; }
    if (p.kind === 'section') { insert(cloneBlock(p.block), place); return; }
    const ids = unlocked(p.ids);
    if (ids.length && !setBlocks(moveBlocks(doc.blocks, ids, place))) toast.error(t('ems_b_cannot_place'));
  }, [doc.blocks, insert, setBlocks, t, unlocked]);
  const { drag, begin } = useBlockDrag({ blocks: doc.blocks, viewport, onDrop });

  /* ── zoom & pan ────────────────────────────────────────────────────────────────────────── */
  const zoomBy = useCallback((dir: -1 | 1) => setZoom((z) => {
    const i = ZOOMS.findIndex((x) => x >= z - 0.001);
    return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 4 : i) + dir))];
  }), []);
  const pan = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  useEffect(() => {
    const vp = viewport.current;
    if (!vp) return;
    const wheel = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomBy(e.deltaY > 0 ? -1 : 1); } };
    vp.addEventListener('wheel', wheel, { passive: false });
    return () => vp.removeEventListener('wheel', wheel);
  }, [zoomBy, mode, wide]);

  /* ── keyboard ──────────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT' || el?.isContentEditable;
      const inside = !el || el === document.body || Boolean(rootRef.current?.contains(el));
      if (!inside || typing || mode !== 'edit') return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === ' ' && !e.repeat && el?.getAttribute('role') !== 'button' && el?.tagName !== 'BUTTON') { setSpaceDown(true); return; }
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
      else if (mod && k === '0') { e.preventDefault(); setZoom(1); }
      else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && primary) { e.preventDefault(); nudgeOne(primary, e.key === 'ArrowUp' ? -1 : 1); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selIds.length) { e.preventDefault(); removeSel(); }
      else if (e.key === 'Escape') { setSelIds([]); setEditingId(null); }
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
  const tile = 'flex min-h-[60px] touch-manipulation select-none flex-col items-center justify-center gap-1 rounded-lg border bg-card px-1.5 py-2 text-center text-2xs leading-tight text-foreground/80 transition-colors hover:border-[hsl(38_70%_60%)] hover:bg-[hsl(38_90%_97%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_80%_55%)]';
  const row = 'flex w-full touch-manipulation select-none items-center gap-2 rounded-lg border bg-card px-2.5 py-2 text-start text-[13px] hover:bg-muted';
  const palette = (
    <div className="space-y-4">
      <p className="text-2xs leading-snug text-muted-foreground">{t('ems_b_elements_hint')}</p>
      {(['basics', 'layout', 'media', 'brand'] as const).map((g) => (
        <div key={g}>
          <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t(`ems_b_group_${g}`)}</p>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 xl:grid-cols-2">
            {PALETTE.filter((p) => p.group === g && (!p.admin || admin)).map(({ type, icon: I }) => (
              <button key={type} type="button" title={t(`ems_block_${type}_hint`)} className={tile} aria-label={ADD_LABEL[type] ? t(ADD_LABEL[type]!) : undefined}
                onPointerDown={(e) => begin({ kind: 'new', type, label: t(`ems_block_${type}`) }, e)} onClick={() => addBlock(type)}>
                <I className="h-4 w-4 text-[hsl(32_60%_38%)]" aria-hidden="true" />
                <span className="[overflow-wrap:anywhere]">{t(`ems_block_${type}`)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <div>
        <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('ems_b_ready_sections')}</p>
        <div className="space-y-1">
          {READY_SECTIONS.map((k: ReadySectionKey) => (
            <button key={k} type="button" className={row}
              onPointerDown={(e) => begin({ kind: 'section', block: readySection(k, doc.theme.accent), label: t(`ems_b_ready_${k}`) }, e)}
              onClick={() => insert(cloneBlock(readySection(k, doc.theme.accent)))}>
              <Box className="h-3.5 w-3.5 shrink-0 text-[hsl(32_60%_38%)]" aria-hidden="true" />
              <span className="min-w-0 flex-1"><span className="block [overflow-wrap:anywhere]">{t(`ems_b_ready_${k}`)}</span><span className="block text-2xs text-muted-foreground">{t(`ems_b_ready_${k}_hint`)}</span></span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('ems_b_custom_blocks')}</p>
        {sections.length ? (
          <div className="space-y-1">
            {sections.map((s) => (
              <button key={s.id} type="button" className={row}
                onPointerDown={(e) => begin({ kind: 'section', block: s.block, label: s.name }, e)} onClick={() => insert(cloneBlock(s.block))}>
                <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{s.name}</span>
              </button>
            ))}
          </div>
        ) : <p className="text-xs leading-relaxed text-muted-foreground">{t('ems_d_sections_empty')}</p>}
      </div>
    </div>
  );

  const layers = (
    <LayersPanel blocks={doc.blocks} selIds={selIds} label={label} onSelect={select} onPatch={(id, p) => patch(id, p)} onNudge={nudgeOne}
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
          style={{ fontFamily: font, fontSize: size, lineHeight: b.type === 'heading' ? 1.3 : b.lineHeight ?? 1.65, fontWeight: b.fontWeight ?? (b.type === 'heading' ? 700 : 400), color: b.color ?? doc.theme.text, textAlign: align }}
        />
      </div>
    );
  };

  const canvas = (
    <div
      ref={viewport}
      className={cn('relative min-w-0 overflow-auto rounded-2xl pt-10', wide && 'max-h-[calc(100dvh-9rem)]', spaceDown && 'cursor-grab')}
      onPointerDownCapture={(e) => {
        if (!(spaceDown || e.button === 1) || !viewport.current) return;
        e.preventDefault(); e.stopPropagation();
        viewport.current.setPointerCapture(e.pointerId);
        pan.current = { x: e.clientX, y: e.clientY, sl: viewport.current.scrollLeft, st: viewport.current.scrollTop };
      }}
      onPointerMove={(e) => { const p = pan.current; const v = viewport.current; if (p && v) { v.scrollLeft = p.sl - (e.clientX - p.x); v.scrollTop = p.st - (e.clientY - p.y); } }}
      onPointerUp={() => { pan.current = null; }}
      onClickCapture={(e) => { if (spaceDown) { e.stopPropagation(); e.preventDefault(); } }}
    >
      <Canvas doc={doc} rtl={rtl} zoom={zoom} selIds={selIds} editingId={editingId} flagged={flaggedSet} drag={drag} beginDrag={begin}
        onSelect={select} onClear={() => { setSelIds([]); setEditingId(null); }} onEdit={(id) => { setSelIds([id]); setEditingId(id); }}
        onPatch={patch} onNudge={nudgeOne} onDuplicate={(id) => duplicateSel([id])} onRemove={(id) => removeSel([id])} onSaveSection={onSaveSection}
        renderInline={inlineEditor} label={label} />
    </div>
  );

  const props = selected ? (
    <BlockProperties
      block={selected} theme={doc.theme} rtl={rtl} onPatch={(p, key) => patch(selected.id, p, key)} onClose={() => setSelIds([])}
      editsOnCanvas={wide} locked={isLockedPath(doc.blocks, selected.id)} canHtml={admin} onRemove={() => removeSel([selected.id])}
    />
  ) : <ThemeProperties theme={doc.theme} onPatch={(p: Partial<Theme>) => commit({ ...doc, theme: { ...doc.theme, ...p } })} />;

  const multi = selIds.length > 1 ? (
    <div className="mb-3 flex items-center justify-between rounded-lg border bg-[hsl(38_90%_96%)] px-2.5 py-1.5 text-xs">
      <span>{t('ems_b_n_selected', { n: selIds.length })}</span>
      <button type="button" className="text-2xs underline-offset-2 hover:underline" onClick={() => setSelIds([])}>{t('ems_b_clear_selection')}</button>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className="flex min-w-0 flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-2.5 py-2">
        <div className="inline-flex gap-0.5">
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5" onClick={undo} disabled={!past.length} aria-label={t('ems_d_undo')} title={t('ems_b_shortcut', { action: t('ems_d_undo'), keys: 'Ctrl+Z' })}>
            <Undo2 className="h-4 w-4" /><span className="hidden sm:inline">{t('ems_d_undo')}</span>
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5" onClick={redo} disabled={!future.length} aria-label={t('ems_d_redo')} title={t('ems_b_shortcut', { action: t('ems_d_redo'), keys: 'Ctrl+Shift+Z' })}>
            <Redo2 className="h-4 w-4" /><span className="hidden sm:inline">{t('ems_d_redo')}</span>
          </Button>
        </div>
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
        <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label={t('ems_d_mode')}>
          {(['edit', 'preview'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
              className={cn('inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs', mode === m ? 'bg-[#0C1119] text-white' : 'text-muted-foreground hover:text-foreground')}>
              {m === 'edit' ? <Palette className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}{t(`ems_d_mode_${m}`)}
            </button>
          ))}
        </div>
        {mode === 'edit' ? (
          <div className="inline-flex items-center rounded-lg border p-0.5" role="group" aria-label={t('ems_b_zoom')}>
            <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground disabled:opacity-30" onClick={() => zoomBy(-1)} disabled={zoom <= ZOOMS[0]} aria-label={t('ems_b_zoom_out')} title={t('ems_b_shortcut', { action: t('ems_b_zoom_out'), keys: 'Ctrl −' })}><ZoomOut className="h-3.5 w-3.5" /></button>
            <button type="button" className="h-7 min-w-[3.25rem] rounded-md px-1 text-xs tabular-nums" onClick={() => setZoom(1)} title={t('ems_b_zoom_reset')} dir="ltr">{Math.round(zoom * 100)}%</button>
            <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground disabled:opacity-30" onClick={() => zoomBy(1)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} aria-label={t('ems_b_zoom_in')} title={t('ems_b_shortcut', { action: t('ems_b_zoom_in'), keys: 'Ctrl +' })}><ZoomIn className="h-3.5 w-3.5" /></button>
          </div>
        ) : null}
        {warnings.length ? (
          <button type="button" onClick={() => setMode('preview')} title={t('ems_b_compat_title')}
            className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs', warnCount ? 'border-amber-300 bg-amber-50 text-amber-900' : 'text-muted-foreground')}>
            <AlertTriangle className="h-3.5 w-3.5" />{t('ems_b_compat_n', { n: warnings.length })}
          </button>
        ) : null}
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <span className="hidden text-xs text-muted-foreground md:inline">{t('ems_d_blocks_count', { n: doc.blocks.length })}</span>
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => setHistoryOpen(true)}><History className="h-4 w-4" /><span className="hidden lg:inline">{t('ems_b_history')}</span></Button>
          {onSnapshot ? <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5" disabled={!campaignId} onClick={() => onSnapshot('MANUAL')}><Save className="h-4 w-4" /><span className="hidden lg:inline">{t('ems_b_save_version')}</span></Button> : null}
          {onSaveTemplate ? (
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={onSaveTemplate}><BookmarkPlus className="h-4 w-4" />{t('ems_d_save_template')}</Button>
          ) : null}
        </div>
      </div>

      {mode === 'preview' ? (
        <PreviewPanel doc={doc} rtl={rtl} subject={subject} previewText={previewText} senderName={senderName} language={language} label={label}
          onApply={(next) => commit(next)} onSelect={(id) => { setMode('edit'); setSelIds([id]); setMobilePane('props'); }} />
      ) : !wide ? (
        /* Mobile and tablet: one pane at a time. */
        <Tabs value={mobilePane} onValueChange={(v) => setMobilePane(v as typeof mobilePane)}>
          {/* Two by two on phones: Georgian pane names do not fit four across at 390 px. */}
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4 [&>button]:whitespace-normal [&>button]:leading-tight">
            <TabsTrigger value="blocks"><Plus className="me-1 h-3.5 w-3.5" aria-hidden="true" />{t('ems_d_pane_blocks')}</TabsTrigger>
            <TabsTrigger value="layers">{t('ems_b_layers')}</TabsTrigger>
            <TabsTrigger value="canvas">{t('ems_d_pane_canvas')}</TabsTrigger>
            <TabsTrigger value="props">{selected ? t('ems_d_pane_block') : t('ems_d_pane_style')}</TabsTrigger>
          </TabsList>
          <TabsContent value="blocks" className="mt-3">{palette}</TabsContent>
          <TabsContent value="layers" className="mt-3 rounded-xl border bg-card p-3">{layers}</TabsContent>
          <TabsContent value="canvas" className="mt-3">{canvas}</TabsContent>
          <TabsContent value="props" className="mt-3 rounded-xl border bg-card p-3">{multi}{props}</TabsContent>
        </Tabs>
      ) : (
        /* Desktop: Elements / Layers · canvas · Properties. */
        <div className="grid min-w-0 grid-cols-[14rem_minmax(0,1fr)_19rem] gap-4 2xl:grid-cols-[15rem_minmax(0,1fr)_21rem]">
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
          <div className="min-w-0">{canvas}</div>
          <aside className="min-w-0">
            <div className="sticky top-20 max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-xl border bg-card p-3">
              <p className="mb-3 text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('ems_b_properties')}</p>
              {multi}{props}
            </div>
          </aside>
        </div>
      )}

      <VersionHistory campaignId={campaignId} open={historyOpen} onOpenChange={setHistoryOpen} rtl={rtl}
        onRestore={(d) => { commit(d); onSnapshot?.('RESTORE'); toast.success(t('ems_b_restored')); }} />
    </div>
  );
}

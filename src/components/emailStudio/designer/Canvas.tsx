// EMAIL STUDIO — the designer canvas: the email as it will look, editable in place.
//
// Each block is the SAME renderer output the server sends (renderBlockHtml: escaped, inline
// styles, no script). Sections and column rows are real containers (data-container) so blocks can
// be dropped into them; useBlockDrag reads exactly these attributes.
//
// NOTHING COVERS THE CONTENT. The selected block's actions live in a rail in the gutter BESIDE the
// email (never over the block or its neighbour): a drag handle, move up/down, duplicate, save as a
// block, delete. On a phone the rail is only the drag handle; the other actions sit in the
// settings sheet (EmailDesigner). The rail is positioned from the selected block's real geometry.
//
// The email is drawn at its DESIGN width and scaled to fit on desktop (EmailDesigner computes the
// zoom), so fixed-width parts never spill out of a squeezed card. On a phone it is drawn at the
// phone's width with the email's own mobile rules (columns stack), via a container query — what a
// recipient on a phone sees. Hidden layers show dimmed (never sent); protected layers cannot be
// dragged, resized or edited.

import { ArrowDown, ArrowUp, BookmarkPlus, Copy, EyeOff, GripVertical, Image as ImageIcon, Lock, Plus, Trash2 } from 'lucide-react';
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { type Block, type ColumnsBlock, type EmailDoc, type SectionBlock } from '@/emailMarketing/designer/document';
import { renderBlockHtml } from '@/emailMarketing/designer/render';
import { columnKey, type ContainerKey, isLockedPath, ROOT, sectionKey } from '@/emailMarketing/designer/tree';
import { cn } from '@/lib/utils';
import type { DragPayload, DragState } from './useBlockDrag';

export type EditorLayout = 'desktop' | 'mobile';

export interface CanvasProps {
  doc: EmailDoc;
  rtl: boolean;
  zoom: number;
  layout: EditorLayout;
  selIds: string[];
  editingId: string | null;
  flagged: Set<string>;
  drag: DragState | null;
  beginDrag: (p: DragPayload, e: React.PointerEvent) => void;
  onSelect: (id: string, additive: boolean) => void;
  onClear: () => void;
  onEdit: (id: string) => void;
  onPatch: (id: string, patch: Record<string, unknown>, key?: string) => void;
  onNudge: (id: string, dir: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onSaveSection?: (b: Block) => void;
  onAdd: () => void;
  renderInline: (b: Block) => React.ReactNode;
  label: (b: Block) => string;
}

const padStyle = (b: Block) => `${b.padding?.t ?? 8}px ${b.padding?.r ?? 32}px ${b.padding?.b ?? 8}px ${b.padding?.l ?? 32}px`;
const isEmptyText = (b: Block) => (b.type === 'text' || b.type === 'heading') && !b.text.trim() && !(b.rich ?? '').replace(/<[^>]+>/g, '').trim();
const isEmptyMedia = (b: Block) => ((b.type === 'image' || b.type === 'logo') && !b.src) || (b.type === 'video' && !b.thumbSrc) || (b.type === 'html' && !b.html)
  || (b.type === 'gallery' && b.images.every((x) => !x.src));

/* The email's own mobile rules (render.ts), applied when the CARD is phone-narrow; plus guards so
   rendered parts never exceed the card. Scoped to the canvas. */
const CANVAS_CSS = `
.hm-canvas-card{container-type:inline-size}
.hm-canvas-card img{max-width:100%;height:auto}
.hm-canvas-card table{max-width:100%}
@container (max-width: 620px){
  .hm-canvas-card .hm-col{display:block!important;width:100%!important;max-width:100%!important;padding-left:0!important;padding-right:0!important}
  .hm-canvas-card .hm-gap{display:none!important}
  .hm-canvas-card .hm-stack{grid-template-columns:minmax(0,1fr)!important;row-gap:12px}
}`;

/** Gutter beside the email that holds the selection rail (px, before zoom on desktop). */
export const RAIL_GUTTER = { desktop: 60, mobile: 44 } as const;
/** The rail's height (desktop: handle, up, down, duplicate, save, delete), to keep it inside the canvas. */
const RAIL_HEIGHT = { desktop: 236, mobile: 48 } as const;

export function Canvas(props: CanvasProps) {
  const { doc, rtl, zoom, onClear, layout, selIds } = props;
  const { t } = useLanguage();
  const card = useRef<HTMLDivElement>(null);
  const dragIds = useMemo(() => new Set(props.drag?.payload.kind === 'move' ? props.drag.payload.ids : []), [props.drag]);
  const primary = selIds[selIds.length - 1] ?? null;
  const [railTop, setRailTop] = useState<number | null>(null);
  /* The card's unscaled height, so the box around a scaled card takes the scaled height. */
  const scaler = useRef<HTMLDivElement>(null);
  const [scaledHeight, setScaledHeight] = useState(0);
  useLayoutEffect(() => {
    const el = scaler.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScaledHeight(el.offsetHeight));
    ro.observe(el);
    setScaledHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, [layout]);

  /* The rail follows the selected block's real position (re-measured when anything moves). */
  useLayoutEffect(() => {
    const c = card.current;
    if (!c || !primary || props.editingId === primary) { setRailTop(null); return; }
    const measure = () => {
      const el = c.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(primary)}"]`);
      if (!el) { setRailTop(null); return; }
      const top = (el.getBoundingClientRect().top - c.getBoundingClientRect().top) / (zoom || 1);
      /* Never below the email's end: a rail on the last block moves up to stay visible. */
      setRailTop(Math.max(0, Math.min(Math.round(top), c.offsetHeight - RAIL_HEIGHT[layout])));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(c);
    return () => ro.disconnect();
  }, [primary, doc, zoom, layout, props.editingId]);

  const selected = primary ? findIn(doc.blocks, primary) : null;
  const gutter = RAIL_GUTTER[layout];

  return (
    /* The canvas takes the EMAIL's direction, not the page's: the gutter (padding) and the rail
       beside the card must sit on the same side — with a Georgian email in a Hebrew interface the
       rail went to the side without a gutter and pushed the page 31 px wider than the phone. */
    <div
      dir={rtl ? 'rtl' : 'ltr'}
      className={cn('hm-canvas min-w-0', layout === 'desktop' ? 'rounded-2xl border py-6 pe-6' : 'py-3 pe-2')}
      style={{ backgroundColor: doc.theme.canvas, paddingInlineStart: layout === 'desktop' ? gutter * zoom + 12 : gutter }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClear(); }}
    >
      <style>{CANVAS_CSS}</style>
      {/* Scaled with a TRANSFORM, not CSS zoom: under zoom, element geometry and the pointer's hit
          test disagree, so drops landed in the wrong container. The outer box carries the scaled
          size so the page flows around it. */}
      {/* overflow-y: clip — the scaled card's unscaled layout height must not make the canvas
          scrollable (it scrolled under the pointer mid-drag); x stays visible for the side rail. */}
      <div style={layout === 'desktop' ? { width: doc.theme.width * zoom, height: scaledHeight ? Math.max(scaledHeight, selected && railTop != null ? railTop + RAIL_HEIGHT.desktop : 0) * zoom : undefined, marginInline: 'auto', overflowY: 'clip' } : undefined}
        onPointerDown={(e) => { if (e.target === e.currentTarget) onClear(); }}>
      <div ref={scaler} style={layout === 'desktop' && zoom !== 1 ? { width: doc.theme.width, transform: `scale(${zoom})`, transformOrigin: rtl ? 'top right' : 'top left' } : undefined}
        onPointerDown={(e) => { if (e.target === e.currentTarget) onClear(); }}>
        <div
          ref={card}
          className="hm-canvas-card relative mx-auto shadow-sm"
          style={{ maxWidth: layout === 'desktop' ? doc.theme.width : undefined, width: layout === 'desktop' ? doc.theme.width : '100%', backgroundColor: doc.theme.card, borderRadius: doc.theme.radius }}
          dir={rtl ? 'rtl' : 'ltr'}
        >
          <Container ctx={props} dragIds={dragIds} keyName={ROOT} blocks={doc.blocks} empty={
            <div className="flex min-h-[18rem] flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
              <ImageIcon className="h-8 w-8 opacity-60" aria-hidden="true" />
              <p className="font-medium text-foreground">{t('ems_d_empty_title')}</p>
              <p className="max-w-xs text-xs">{t('ems_b_empty_body')}</p>
              <button type="button" onClick={props.onAdd}
                className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#0C1119] px-4 text-sm font-semibold text-white hover:bg-[#0C1119]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_85%_55%)]">
                <Plus className="h-4 w-4" aria-hidden="true" />{t('ems_b_add_element')}
              </button>
            </div>
          } />
          {selected && railTop != null ? (
            <SelectionRail ctx={props} b={selected} top={railTop} gutter={gutter} />
          ) : null}
        </div>
      </div>
      </div>
      {props.drag ? <DragOverlay drag={props.drag} /> : null}
    </div>
  );
}

function findIn(blocks: Block[], id: string): Block | null {
  for (const b of blocks) {
    if (b.id === id) return b;
    const kids = b.type === 'section' ? b.children : b.type === 'columns' ? [...b.columns[0], ...b.columns[1]] : [];
    const hit = findIn(kids as Block[], id);
    if (hit) return hit;
  }
  return null;
}

/* The selected block's actions, in the gutter beside the email: nothing over the content. */
function SelectionRail({ ctx, b, top, gutter }: { ctx: CanvasProps; b: Block; top: number; gutter: number }) {
  const { t } = useLanguage();
  const locked = isLockedPath(ctx.doc.blocks, b.id);
  const mobile = ctx.layout === 'mobile';
  const size = mobile ? 'h-11 w-10' : 'h-9 w-9';
  const btn = cn('inline-flex items-center justify-center rounded-lg text-foreground/75 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_85%_55%)] disabled:opacity-30', size);
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  const grip = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (locked) return;
    const ids = ctx.selIds.includes(b.id) ? ctx.selIds : [b.id];
    ctx.beginDrag({ kind: 'move', ids, label: ids.length > 1 ? t('ems_b_n_blocks', { n: ids.length }) : ctx.label(b) }, e);
  };
  return (
    <div
      data-no-drag data-rail
      className="absolute z-20 flex flex-col items-center gap-0.5 rounded-xl border bg-white p-0.5 shadow-md"
      style={{ top, insetInlineEnd: '100%', marginInlineEnd: Math.max(4, gutter - (mobile ? 40 : 36) - 8) }}
      onPointerDown={(e) => e.stopPropagation()}
      role="toolbar" aria-label={t('ems_b_block_actions', { name: ctx.label(b) })}
    >
      <button type="button" aria-label={t('ems_b_drag_hint')} title={t('ems_b_drag_hint')} disabled={locked}
        className={cn(btn, 'cursor-grab touch-none select-none text-[hsl(32_60%_38%)] active:cursor-grabbing')} onPointerDown={grip}>
        <GripVertical className="h-4 w-4" />
      </button>
      {!mobile ? (<>
        <button type="button" aria-label={t('ems_d_move_up')} title={t('ems_d_move_up')} className={btn} disabled={locked} onClick={stop(() => ctx.onNudge(b.id, -1))}><ArrowUp className="h-4 w-4" /></button>
        <button type="button" aria-label={t('ems_d_move_down')} title={t('ems_d_move_down')} className={btn} disabled={locked} onClick={stop(() => ctx.onNudge(b.id, 1))}><ArrowDown className="h-4 w-4" /></button>
        <button type="button" aria-label={t('ems_d_duplicate')} title={t('ems_d_duplicate')} className={btn} onClick={stop(() => ctx.onDuplicate(b.id))}><Copy className="h-4 w-4" /></button>
        {ctx.onSaveSection ? <button type="button" aria-label={t('ems_d_save_section')} title={t('ems_d_save_section')} className={btn} onClick={stop(() => ctx.onSaveSection?.(b))}><BookmarkPlus className="h-4 w-4" /></button> : null}
        <button type="button" aria-label={t('ems_d_delete')} title={t('ems_d_delete')} className={btn} disabled={locked} onClick={stop(() => ctx.onRemove(b.id))}><Trash2 className="h-4 w-4 text-red-600" /></button>
      </>) : null}
    </div>
  );
}

function Container({ ctx, dragIds, keyName, blocks, empty, className }: {
  ctx: CanvasProps; dragIds: Set<string>; keyName: ContainerKey; blocks: Block[]; empty?: React.ReactNode; className?: string;
}) {
  const { t } = useLanguage();
  const target = ctx.drag?.place?.container === keyName;
  return (
    <div data-container={keyName} className={cn('relative min-h-[1.5rem]', target && keyName !== ROOT && 'outline-dashed outline-2 -outline-offset-2 outline-[hsl(38_85%_55%)]', className)}>
      {blocks.length === 0 ? (empty ?? <div className="flex min-h-[3.25rem] items-center justify-center rounded border border-dashed border-foreground/25 px-2 text-center text-2xs text-muted-foreground">{t('ems_b_drop_here')}</div>) : null}
      {blocks.map((b) => <BlockView key={b.id} ctx={ctx} dragIds={dragIds} b={b} />)}
    </div>
  );
}

function BlockView({ ctx, dragIds, b }: { ctx: CanvasProps; dragIds: Set<string>; b: Block }) {
  const { t } = useLanguage();
  const { doc, rtl, selIds, editingId } = ctx;
  const ref = useRef<HTMLDivElement>(null);
  const selected = selIds.includes(b.id);
  const primary = selIds[selIds.length - 1] === b.id;
  const locked = isLockedPath(doc.blocks, b.id);
  const editing = editingId === b.id && (b.type === 'text' || b.type === 'heading') && !locked;
  const name = ctx.label(b);
  /* A mouse drags the block itself; touch drags only from the rail's handle (so a finger scrolls). */
  const drag = (e: React.PointerEvent) => {
    if (locked || editing || e.pointerType !== 'mouse') return;
    const ids = selected ? selIds : [b.id];
    ctx.beginDrag({ kind: 'move', ids, label: ids.length > 1 ? t('ems_b_n_blocks', { n: ids.length }) : name }, e);
  };

  let body: React.ReactNode;
  if (editing) body = ctx.renderInline(b);
  else if (b.type === 'section') body = <SectionView ctx={ctx} dragIds={dragIds} b={b} />;
  else if (b.type === 'columns') body = <ColumnsView ctx={ctx} dragIds={dragIds} b={b} />;
  else if (isEmptyMedia(b)) {
    body = (
      <div style={{ padding: padStyle(b) }}>
        <div className="flex h-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-foreground/25 bg-foreground/[0.02] text-xs text-muted-foreground">
          <ImageIcon className="h-5 w-5" aria-hidden="true" />{t(b.type === 'html' ? 'ems_b_html_empty' : b.type === 'video' ? 'ems_b_video_empty' : 'ems_b_tap_to_add_photo')}
        </div>
      </div>
    );
  } else if (isEmptyText(b)) {
    body = <div style={{ padding: padStyle(b), backgroundColor: b.background ?? undefined }} className="italic text-muted-foreground/70">{t(b.type === 'heading' ? 'ems_d_heading_placeholder' : 'ems_d_text_placeholder')}</div>;
  } else {
    // Safe: the email renderer escapes every value; no script can be expressed in a design document.
    body = <div dangerouslySetInnerHTML={{ __html: renderBlockHtml(b, doc.theme, rtl) }} />;
  }

  return (
    <div
      ref={ref} data-block-id={b.id} role="button" tabIndex={0} aria-label={name} aria-pressed={selected}
      onPointerDown={(e) => { if (!(e.target as HTMLElement).closest('[data-no-drag]')) { e.stopPropagation(); drag(e); } }}
      onClick={(e) => { e.stopPropagation(); if (!editing) ctx.onSelect(b.id, e.shiftKey || e.metaKey || e.ctrlKey); }}
      onDoubleClick={(e) => { e.stopPropagation(); if (b.type === 'text' || b.type === 'heading') ctx.onEdit(b.id); }}
      onKeyDown={(e) => {
        if (editing || e.target !== e.currentTarget) return;
        if (e.key === 'Enter') { e.preventDefault(); if (b.type === 'text' || b.type === 'heading') ctx.onEdit(b.id); else ctx.onSelect(b.id, false); }
        else if (e.key === ' ') { e.preventDefault(); ctx.onSelect(b.id, e.shiftKey); }
      }}
      style={{ marginTop: b.margin?.t || undefined, marginBottom: b.margin?.b || undefined }}
      className={cn('group/b relative outline-none transition-[box-shadow,opacity]',
        !editing && 'select-none', !editing && !locked && 'md:cursor-grab',
        selected ? 'z-10 shadow-[inset_0_0_0_2px_hsl(38_85%_50%)]' : 'hover:shadow-[inset_0_0_0_1px_hsl(38_70%_65%)] focus-visible:shadow-[inset_0_0_0_2px_hsl(38_85%_50%)]',
        primary && 'shadow-[inset_0_0_0_2px_hsl(38_85%_50%),0_0_0_3px_hsl(38_90%_88%)]',
        ctx.flagged.has(b.id) && !selected && 'shadow-[inset_0_0_0_2px_rgb(248_113_113)]', dragIds.has(b.id) && 'opacity-40', b.hidden && 'opacity-40')}
    >
      {body}
      {b.hidden || locked ? (
        <span className="pointer-events-none absolute end-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded bg-[#0C1119]/80 px-1.5 py-0.5 text-2xs text-white">
          {b.hidden ? <><EyeOff className="h-3 w-3" aria-hidden="true" />{t('ems_b_hidden')}</> : null}
          {locked ? <><Lock className="h-3 w-3" aria-hidden="true" />{t('ems_b_locked')}</> : null}
        </span>
      ) : null}
      {primary && !locked && !editing && selIds.length === 1 ? <Resize ctx={ctx} b={b} host={ref} /> : null}
    </div>
  );
}

function SectionView({ ctx, dragIds, b }: { ctx: CanvasProps; dragIds: Set<string>; b: SectionBlock }) {
  const bg = b.background ?? ctx.doc.theme.card;
  return (
    <div style={{ padding: padStyle(b), border: b.borderWidth && b.borderColor ? `${b.borderWidth}px solid ${b.borderColor}` : undefined }}>
      <div style={{ backgroundColor: bg, backgroundImage: b.bgImage ? `url("${b.bgImage}")` : undefined, backgroundSize: 'cover', backgroundPosition: 'center', borderRadius: b.radius }} className="py-1">
        <Container ctx={ctx} dragIds={dragIds} keyName={sectionKey(b.id)} blocks={b.children} />
      </div>
    </div>
  );
}

function ColumnsView({ ctx, dragIds, b }: { ctx: CanvasProps; dragIds: Set<string>; b: ColumnsBlock }) {
  const [l, r] = b.ratio.split('-').map(Number);
  return (
    <div style={{ padding: padStyle(b), backgroundColor: b.background ?? undefined, gridTemplateColumns: `minmax(0,${l}fr) minmax(0,${r}fr)`, columnGap: b.gap }}
      className={cn('grid', b.stackOnMobile && 'hm-stack')}>
      {([0, 1] as const).map((c) => (
        <Container key={c} ctx={ctx} dragIds={dragIds} keyName={columnKey(b.id, c)} blocks={b.columns[c]} className="min-w-0 rounded-sm outline-dashed outline-1 outline-foreground/10" />
      ))}
    </div>
  );
}

/* ── resize ───────────────────────────────────────────────────────────────────────────────── */

const SNAP = 6;
function Resize({ ctx, b, host }: { ctx: CanvasProps; b: Block; host: React.RefObject<HTMLDivElement | null> }) {
  const { t } = useLanguage();
  const [live, setLive] = useState<{ value: number; guide: string | null } | null>(null);
  const start = useRef<{ x: number; y: number; value: number; max: number; centered: boolean } | null>(null);
  const axis: 'w' | 'h' | null = b.type === 'image' || b.type === 'logo' || b.type === 'video' ? 'w' : b.type === 'spacer' ? 'h' : null;
  if (!axis) return null;
  const value = axis === 'h' ? (b as { height: number }).height : (b as { width: number }).width;
  const limit = b.type === 'logo' ? 300 : 600;

  const down = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const el = host.current;
    const inner = el ? el.getBoundingClientRect().width / ctx.zoom - (b.padding?.l ?? 32) - (b.padding?.r ?? 32) : limit;
    start.current = { x: e.clientX, y: e.clientY, value, max: Math.max(40, Math.min(limit, Math.round(inner))), centered: 'align' in b && b.align === 'center' };
  };
  const move = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    if (axis === 'h') {
      const raw = s.value + (e.clientY - s.y) / ctx.zoom;
      const v = Math.min(120, Math.max(4, Math.round(raw / 4) * 4));
      setLive({ value: v, guide: null });
      ctx.onPatch(b.id, { height: v }, `h:${b.id}`);
      return;
    }
    const dir = ctx.rtl ? -1 : 1;
    const raw = s.value + ((e.clientX - s.x) / ctx.zoom) * dir * (s.centered ? 2 : 1);
    const points: Array<[number, string]> = [[s.max, '100%'], [Math.round((s.max * 2) / 3), '⅔'], [Math.round(s.max / 2), '½']];
    const hit = points.find(([p]) => Math.abs(raw - p) <= SNAP);
    const v = Math.min(s.max, Math.max(40, hit ? hit[0] : Math.round(raw / 8) * 8));
    setLive({ value: v, guide: hit ? hit[1] : null });
    ctx.onPatch(b.id, { width: v }, `w:${b.id}`);
  };
  const up = () => { start.current = null; setLive(null); };
  const nudge = (e: React.KeyboardEvent) => {
    const d = { ArrowRight: 8, ArrowLeft: -8, ArrowDown: 4, ArrowUp: -4 }[e.key];
    if (d == null) return;
    e.preventDefault(); e.stopPropagation();
    if (axis === 'h' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) ctx.onPatch(b.id, { height: Math.min(120, Math.max(4, value + d)) }, `h:${b.id}`);
    if (axis === 'w' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) ctx.onPatch(b.id, { width: Math.min(limit, Math.max(40, value + d * (ctx.rtl ? -1 : 1))) }, `w:${b.id}`);
  };
  return (
    <>
      <span
        data-no-drag role="slider" tabIndex={0} aria-label={t(axis === 'w' ? 'ems_b_resize_width' : 'ems_b_resize_height')}
        aria-valuenow={value} aria-valuemin={axis === 'w' ? 40 : 4} aria-valuemax={axis === 'w' ? limit : 120}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={nudge} onClick={(e) => e.stopPropagation()}
        className={cn('absolute z-20 touch-none rounded-full border-2 border-white bg-[hsl(38_85%_52%)] shadow outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_85%_40%)]',
          axis === 'w' ? 'end-1 top-1/2 h-10 w-3 -translate-y-1/2 cursor-ew-resize' : 'bottom-0 left-1/2 h-3 w-10 -translate-x-1/2 translate-y-1/2 cursor-ns-resize')}
      />
      {live ? (
        <>
          <span className="pointer-events-none absolute end-5 top-1 z-30 rounded bg-[#0C1119] px-1.5 py-0.5 font-mono text-2xs text-white" dir="ltr">
            {live.value}px{live.guide ? ` · ${live.guide}` : ''}
          </span>
          {live.guide ? <span className="pointer-events-none absolute inset-y-0 end-0 z-20 border-e border-dashed border-[hsl(200_90%_45%)]" aria-hidden="true" /> : null}
        </>
      ) : null}
    </>
  );
}

function DragOverlay({ drag }: { drag: DragState }) {
  return (
    <>
      {drag.line ? (
        <span className="pointer-events-none fixed z-[70] h-1 rounded-full bg-[hsl(38_85%_52%)] shadow-[0_0_0_2px_rgba(255,255,255,0.9)]" aria-hidden="true"
          style={{ left: drag.line.left, top: drag.line.top - 2, width: drag.line.width }} />
      ) : null}
      <span className="pointer-events-none fixed z-[71] max-w-[14rem] truncate rounded-md bg-[#0C1119] px-2.5 py-1.5 text-xs font-medium text-white shadow-lg"
        style={{ left: drag.x + 14, top: drag.y + 12 }} aria-hidden="true">{drag.payload.label}</span>
    </>
  );
}

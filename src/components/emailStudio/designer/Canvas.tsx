// EMAIL STUDIO — the designer canvas: the email as it will look, editable in place.
//
// Each block is the SAME renderer output the server sends (renderBlockHtml: escaped, inline
// styles, no script), inside a wrapper that carries selection, dragging and the floating block
// toolbar. Sections and column rows are drawn as real containers (data-container) so blocks can
// be dropped into them; useBlockDrag reads exactly these attributes. The selected image, logo,
// video or spacer gets a resize handle that snaps to the 8 px grid and to the full, two-thirds and
// half content width, with a guide and a live size label. Hidden layers show dimmed (they are
// never sent); locked layers cannot be dragged, resized or edited.

import { ArrowDown, ArrowUp, BookmarkPlus, Copy, EyeOff, GripVertical, Image as ImageIcon, Lock, PencilLine, Trash2 } from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { type Block, type ColumnsBlock, type EmailDoc, type SectionBlock } from '@/emailMarketing/designer/document';
import { renderBlockHtml } from '@/emailMarketing/designer/render';
import { columnKey, type ContainerKey, isLockedPath, ROOT, sectionKey } from '@/emailMarketing/designer/tree';
import { cn } from '@/lib/utils';
import type { DragPayload, DragState } from './useBlockDrag';

export interface CanvasProps {
  doc: EmailDoc;
  rtl: boolean;
  zoom: number;
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
  renderInline: (b: Block) => React.ReactNode;
  label: (b: Block) => string;
}

const padStyle = (b: Block) => `${b.padding?.t ?? 8}px ${b.padding?.r ?? 32}px ${b.padding?.b ?? 8}px ${b.padding?.l ?? 32}px`;
const isEmptyText = (b: Block) => (b.type === 'text' || b.type === 'heading') && !b.text.trim() && !(b.rich ?? '').replace(/<[^>]+>/g, '').trim();
const isEmptyMedia = (b: Block) => ((b.type === 'image' || b.type === 'logo') && !b.src) || (b.type === 'video' && !b.thumbSrc) || (b.type === 'html' && !b.html)
  || (b.type === 'gallery' && b.images.every((x) => !x.src));

export function Canvas(props: CanvasProps) {
  const { doc, rtl, zoom, onClear } = props;
  const { t } = useLanguage();
  const dragIds = useMemo(() => new Set(props.drag?.payload.kind === 'move' ? props.drag.payload.ids : []), [props.drag]);
  return (
    <div className="min-w-0 rounded-2xl border p-3 sm:p-6" style={{ backgroundColor: doc.theme.canvas }} onPointerDown={(e) => { if (e.target === e.currentTarget) onClear(); }}>
      <div style={{ zoom } as React.CSSProperties}>
        <div className="mx-auto overflow-visible shadow-sm" style={{ maxWidth: doc.theme.width, backgroundColor: doc.theme.card, borderRadius: doc.theme.radius }} dir={rtl ? 'rtl' : 'ltr'}>
          <Container ctx={props} dragIds={dragIds} keyName={ROOT} blocks={doc.blocks} empty={
            <div className="flex min-h-[18rem] flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <ImageIcon className="h-8 w-8 opacity-60" aria-hidden="true" />
              <p className="font-medium text-foreground">{t('ems_d_empty_title')}</p>
              <p className="max-w-xs text-xs">{t('ems_b_empty_body')}</p>
            </div>
          } />
        </div>
      </div>
      {props.drag ? <DragOverlay drag={props.drag} /> : null}
    </div>
  );
}

function Container({ ctx, dragIds, keyName, blocks, empty, className }: {
  ctx: CanvasProps; dragIds: Set<string>; keyName: ContainerKey; blocks: Block[]; empty?: React.ReactNode; className?: string;
}) {
  const { t } = useLanguage();
  const target = ctx.drag?.place?.container === keyName;
  return (
    <div data-container={keyName} className={cn('relative min-h-[1.5rem]', target && keyName !== ROOT && 'outline-dashed outline-1 outline-[hsl(38_85%_55%)]', className)}>
      {blocks.length === 0 ? (empty ?? <div className="flex min-h-[3rem] items-center justify-center rounded border border-dashed border-foreground/20 px-2 text-center text-2xs text-muted-foreground">{t('ems_b_drop_here')}</div>) : null}
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
  const drag = (e: React.PointerEvent) => {
    if (locked || editing) return;
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
        <div className="flex h-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-foreground/20 bg-foreground/[0.02] text-xs text-muted-foreground">
          <ImageIcon className="h-5 w-5" aria-hidden="true" />{t(b.type === 'html' ? 'ems_b_html_empty' : b.type === 'video' ? 'ems_b_video_empty' : 'ems_d_image_empty')}
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
      onPointerDown={(e) => { if (e.pointerType === 'mouse' && !(e.target as HTMLElement).closest('[data-no-drag]')) { e.stopPropagation(); drag(e); } }}
      onClick={(e) => { e.stopPropagation(); if (!editing) ctx.onSelect(b.id, e.shiftKey || e.metaKey || e.ctrlKey); }}
      onDoubleClick={(e) => { e.stopPropagation(); if (b.type === 'text' || b.type === 'heading') ctx.onEdit(b.id); }}
      onKeyDown={(e) => {
        if (editing || e.target !== e.currentTarget) return;
        if (e.key === 'Enter') { e.preventDefault(); if (b.type === 'text' || b.type === 'heading') ctx.onEdit(b.id); else ctx.onSelect(b.id, false); }
        else if (e.key === ' ') { e.preventDefault(); ctx.onSelect(b.id, e.shiftKey); }
      }}
      style={{ marginTop: b.margin?.t || undefined, marginBottom: b.margin?.b || undefined }}
      className={cn('group/b relative outline-none transition-[box-shadow,opacity]', !editing && (locked ? 'cursor-default' : 'cursor-grab'),
        selected ? 'ring-2 ring-inset ring-[hsl(38_85%_52%)]' : 'hover:ring-1 hover:ring-inset hover:ring-[hsl(38_70%_70%)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(38_85%_52%)]',
        ctx.flagged.has(b.id) && !selected && 'ring-2 ring-inset ring-red-400', dragIds.has(b.id) && 'opacity-40', b.hidden && 'opacity-40')}
    >
      {body}
      {b.hidden || locked ? (
        <span className="pointer-events-none absolute start-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded bg-[#0C1119]/80 px-1.5 py-0.5 text-2xs text-white">
          {b.hidden ? <><EyeOff className="h-3 w-3" aria-hidden="true" />{t('ems_b_hidden')}</> : null}
          {locked ? <><Lock className="h-3 w-3" aria-hidden="true" />{t('ems_b_locked')}</> : null}
        </span>
      ) : null}
      {primary && !editing ? <Toolbar ctx={ctx} b={b} locked={locked} onGrip={drag} /> : null}
      {primary && !locked && !editing && selIds.length === 1 ? <Resize ctx={ctx} b={b} host={ref} /> : null}
    </div>
  );
}

function Toolbar({ ctx, b, locked, onGrip }: { ctx: CanvasProps; b: Block; locked: boolean; onGrip: (e: React.PointerEvent) => void }) {
  const { t } = useLanguage();
  const btn = 'inline-flex h-7 w-7 items-center justify-center rounded text-foreground/70 hover:bg-muted hover:text-foreground disabled:opacity-30';
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  return (
    <div data-no-drag className="absolute -top-9 end-0 z-30 flex gap-0.5 rounded-md border bg-white p-0.5 shadow-md" onPointerDown={(e) => e.stopPropagation()}>
      <span className="inline-flex max-w-[9rem] items-center truncate px-1.5 text-2xs font-medium text-foreground/80">{ctx.label(b)}</span>
      {!locked ? (
        <button type="button" aria-label={t('ems_b_drag')} title={t('ems_b_drag')} className={cn(btn, 'cursor-grab touch-none')}
          onPointerDown={(e) => { e.stopPropagation(); onGrip(e); }}><GripVertical className="h-3.5 w-3.5" /></button>
      ) : null}
      {(b.type === 'text' || b.type === 'heading') && !locked ? (
        <button type="button" aria-label={t('ems_b_edit_text')} title={t('ems_b_edit_text')} className={btn} onClick={stop(() => ctx.onEdit(b.id))}><PencilLine className="h-3.5 w-3.5" /></button>
      ) : null}
      <button type="button" aria-label={t('ems_d_move_up')} title={t('ems_d_move_up')} className={btn} disabled={locked} onClick={stop(() => ctx.onNudge(b.id, -1))}><ArrowUp className="h-3.5 w-3.5" /></button>
      <button type="button" aria-label={t('ems_d_move_down')} title={t('ems_d_move_down')} className={btn} disabled={locked} onClick={stop(() => ctx.onNudge(b.id, 1))}><ArrowDown className="h-3.5 w-3.5" /></button>
      <button type="button" aria-label={t('ems_d_duplicate')} title={t('ems_d_duplicate')} className={btn} onClick={stop(() => ctx.onDuplicate(b.id))}><Copy className="h-3.5 w-3.5" /></button>
      {ctx.onSaveSection ? <button type="button" aria-label={t('ems_d_save_section')} title={t('ems_d_save_section')} className={btn} onClick={stop(() => ctx.onSaveSection?.(b))}><BookmarkPlus className="h-3.5 w-3.5" /></button> : null}
      <button type="button" aria-label={t('ems_d_delete')} title={t('ems_d_delete')} className={btn} disabled={locked} onClick={stop(() => ctx.onRemove(b.id))}><Trash2 className="h-3.5 w-3.5 text-red-600" /></button>
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
    <div style={{ padding: padStyle(b), backgroundColor: b.background ?? undefined, gridTemplateColumns: `${l}fr ${r}fr`, columnGap: b.gap }} className="grid">
      {([0, 1] as const).map((c) => (
        <Container key={c} ctx={ctx} dragIds={dragIds} keyName={columnKey(b.id, c)} blocks={b.columns[c]} className="rounded-sm outline-dashed outline-1 outline-foreground/10" />
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
          axis === 'w' ? 'end-1 top-1/2 h-8 w-2.5 -translate-y-1/2 cursor-ew-resize' : 'bottom-0 left-1/2 h-2.5 w-8 -translate-x-1/2 translate-y-1/2 cursor-ns-resize')}
      />
      {live ? (
        <>
          <span className="pointer-events-none absolute end-4 top-1 z-30 rounded bg-[#0C1119] px-1.5 py-0.5 font-mono text-2xs text-white" dir="ltr">
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

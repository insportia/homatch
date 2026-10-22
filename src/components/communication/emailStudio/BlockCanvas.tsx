// The design as an ordered list of sections. Click to select (the inspector
// edits it), drag to reorder, or use the keyboard-reachable move buttons;
// duplicate and remove are one click. "Add section" inserts below the selection.
import React, { useState } from 'react';
import {
  ArrowDown, ArrowUp, Copy, GripVertical, Heading, Image as ImageIcon, Images, LayoutPanelTop,
  ListChecks, Minus, MousePointerClick, MoveVertical, PanelBottom, Plus, Trash2, Type,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { type Block, type BlockType, BLOCK_TYPES, inlineToText } from '@/communication/emailDesign';

export const BLOCK_ICON: Record<BlockType, React.ComponentType<{ className?: string }>> = {
  header: LayoutPanelTop, heading: Heading, text: Type, image: ImageIcon, gallery: Images,
  button: MousePointerClick, facts: ListChecks, divider: Minus, spacer: MoveVertical, footer: PanelBottom,
};

function summary(b: Block, t: (k: string) => string): string {
  switch (b.type) {
    case 'header': return b.brand + (b.tagline ? ` · ${b.tagline}` : '');
    case 'heading': return b.text || t('es_empty_heading');
    case 'text': return inlineToText(b.html).slice(0, 140) || t('es_empty_text');
    case 'image': return b.src ? (b.alt || b.caption || t('es_image_set')) : t('es_image_missing');
    case 'gallery': return `${b.images.length}/3`;
    case 'button': return b.label || t('es_empty_button');
    case 'facts': return b.items.map((i) => i.label).join(' · ') || t('es_empty_facts');
    case 'footer': return b.text.slice(0, 80) || t('es_empty_footer');
    default: return '';
  }
}

export function BlockCanvas({ blocks, selectedId, onSelect, onMove, onReorder, onDuplicate, onRemove, onAdd }: {
  blocks: Block[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onReorder: (from: number, to: number) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: (type: BlockType) => void;
}) {
  const { t } = useLanguage();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const icon = 'grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="space-y-2">
      {blocks.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t('es_canvas_empty')}</p>
      ) : (
        <ol className="space-y-1.5" aria-label={t('es_sections')}>
          {blocks.map((b, i) => {
            const Icon = BLOCK_ICON[b.type];
            const on = b.id === selectedId;
            return (
              <li key={b.id}
                draggable
                onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(i); }}
                onDragLeave={() => setDragOver((v) => (v === i ? null : v))}
                onDrop={(e) => { e.preventDefault(); if (dragFrom !== null && dragFrom !== i) onReorder(dragFrom, i); setDragFrom(null); setDragOver(null); }}
                onDragEnd={() => { setDragFrom(null); setDragOver(null); }}
                className={cn('group flex min-w-0 items-center gap-1 rounded-xl bg-card ring-1 ring-inset transition-all',
                  on ? 'ring-2 ring-[hsl(38_92%_50%)] shadow-sm' : 'ring-border hover:ring-[hsl(40_70%_70%)]',
                  dragOver === i && dragFrom !== i && 'translate-y-0.5 ring-2 ring-dashed ring-[hsl(38_92%_50%)]',
                  dragFrom === i && 'opacity-50')}>
                <span className="cursor-grab ps-1.5 text-muted-foreground active:cursor-grabbing" aria-hidden="true"><GripVertical className="h-4 w-4" /></span>
                <button type="button" onClick={() => onSelect(b.id)} aria-pressed={on}
                  className="flex min-w-0 flex-1 items-center gap-2.5 py-2 text-start focus-visible:outline-none">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted"><Icon className="h-4 w-4" aria-hidden="true" /></span>
                  <span className="min-w-0">
                    <span className="block text-2xs font-bold uppercase tracking-[0.1em] text-muted-foreground">{t(`es_block_${b.type}`)}</span>
                    <span dir="auto" className="block truncate text-sm">{summary(b, t)}</span>
                  </span>
                </button>
                <span className="flex shrink-0 items-center pe-1 opacity-100 sm:opacity-60 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  <button type="button" className={icon} disabled={i === 0} onClick={() => onMove(b.id, -1)} aria-label={t('es_move_up')}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
                  <button type="button" className={icon} disabled={i === blocks.length - 1} onClick={() => onMove(b.id, 1)} aria-label={t('es_move_down')}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
                  <button type="button" className={icon} onClick={() => onDuplicate(b.id)} aria-label={t('es_duplicate')}><Copy className="h-4 w-4" aria-hidden="true" /></button>
                  <button type="button" className={icon} onClick={() => onRemove(b.id)} aria-label={t('es_remove')}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <div>
        <button type="button" onClick={() => setAdding((v) => !v)} aria-expanded={adding}
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed text-sm font-semibold hover:bg-muted/50">
          <Plus className="h-4 w-4" aria-hidden="true" />{t('es_add_section')}
        </button>
        {adding && (
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {BLOCK_TYPES.map((type) => {
              const Icon = BLOCK_ICON[type];
              return (
                <button key={type} type="button" onClick={() => { onAdd(type); setAdding(false); }}
                  className="flex min-h-10 min-w-0 items-center gap-2 rounded-lg px-2.5 text-start text-sm ring-1 ring-inset ring-border hover:bg-muted">
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 truncate">{t(`es_block_${type}`)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default BlockCanvas;

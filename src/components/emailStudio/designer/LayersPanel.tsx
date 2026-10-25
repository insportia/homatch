// EMAIL STUDIO — the Layers panel ("ფენები"): the design's outline, top to bottom.
//
// Select (Shift/Ctrl/⌘ to add), rename (double-click or F2), hide (left out of the email, kept in
// the design), lock (no edits, moves or deletes), move up/down (also Alt+↑/↓), duplicate, group
// selected blocks into a section, ungroup a section, delete. Everything here is a button or a
// keyboard command: it is the keyboard alternative to dragging on the canvas.

import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Group, Lock, LockOpen, Trash2, Ungroup } from 'lucide-react';
import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import type { Block } from '@/emailMarketing/designer/document';
import { isLockedPath, layerRows } from '@/emailMarketing/designer/tree';
import { cn } from '@/lib/utils';

export function LayersPanel({ blocks, selIds, label, onSelect, onPatch, onNudge, onDuplicate, onRemove, onGroup, onUngroup, canGroup, canUngroup, touch = false }: {
  blocks: Block[]; selIds: string[]; label: (b: Block) => string;
  onSelect: (id: string, additive: boolean) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onNudge: (id: string, dir: -1 | 1) => void;
  onDuplicate: () => void; onRemove: () => void; onGroup: () => void; onUngroup: () => void;
  canGroup: boolean; canUngroup: boolean;
  /** Phone sheet: 44 px rows and buttons. */
  touch?: boolean;
}) {
  const { t } = useLanguage();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const rows = layerRows(blocks);
  const primary = selIds[selIds.length - 1] ?? null;
  const anyLocked = selIds.some((id) => isLockedPath(blocks, id));
  const icon = cn('inline-flex shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30', touch ? 'h-11 w-11' : 'h-6 w-6');
  const action = cn('inline-flex items-center gap-1 rounded-md border px-2 hover:bg-muted disabled:pointer-events-none disabled:opacity-40', touch ? 'min-h-11 px-3 text-xs' : 'h-7 text-2xs');

  const commitName = (id: string) => { onPatch(id, { name: draft.trim() || null }); setRenaming(null); };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('ems_b_layers')}</p>
        <span className="text-2xs text-muted-foreground">{t('ems_d_blocks_count', { n: rows.length })}</span>
      </div>
      <div className="flex flex-wrap gap-1" role="toolbar" aria-label={t('ems_b_layer_actions')}>
        <button type="button" className={action} disabled={!primary || anyLocked} onClick={() => primary && onNudge(primary, -1)} aria-label={t('ems_d_move_up')}><ArrowUp className="h-3 w-3" /></button>
        <button type="button" className={action} disabled={!primary || anyLocked} onClick={() => primary && onNudge(primary, 1)} aria-label={t('ems_d_move_down')}><ArrowDown className="h-3 w-3" /></button>
        <button type="button" className={action} disabled={!selIds.length} onClick={onDuplicate}><Copy className="h-3 w-3" />{t('ems_d_duplicate')}</button>
        <button type="button" className={action} disabled={!canGroup} onClick={onGroup} title={t('ems_b_shortcut', { action: t('ems_b_group'), keys: 'Ctrl+G' })}><Group className="h-3 w-3" />{t('ems_b_group')}</button>
        <button type="button" className={action} disabled={!canUngroup} onClick={onUngroup} title={t('ems_b_shortcut', { action: t('ems_b_ungroup'), keys: 'Ctrl+Shift+G' })}><Ungroup className="h-3 w-3" />{t('ems_b_ungroup')}</button>
        <button type="button" className={cn(action, 'text-red-700')} disabled={!selIds.length || anyLocked} onClick={onRemove}><Trash2 className="h-3 w-3" />{t('ems_d_delete')}</button>
      </div>
      {rows.length === 0 ? <p className="text-xs text-muted-foreground">{t('ems_b_layers_empty')}</p> : (
        <ul className="space-y-px" aria-label={t('ems_b_layers')}>
          {rows.map((r) => {
            const b = r.block;
            const sel = selIds.includes(b.id);
            const locked = isLockedPath(blocks, b.id);
            return (
              <li key={b.id}>
                <div
                  role="button" tabIndex={0} aria-pressed={sel} aria-label={label(b)}
                  onClick={(e) => onSelect(b.id, e.shiftKey || e.metaKey || e.ctrlKey)}
                  onDoubleClick={() => { setRenaming(b.id); setDraft(b.name ?? ''); }}
                  onKeyDown={(e) => {
                    if (renaming === b.id) return;
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(b.id, e.shiftKey); }
                    else if (e.key === 'F2') { e.preventDefault(); setRenaming(b.id); setDraft(b.name ?? ''); }
                    else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); if (!locked) onNudge(b.id, e.key === 'ArrowUp' ? -1 : 1); }
                  }}
                  style={{ paddingInlineStart: 6 + r.depth * 14 }}
                  className={cn('flex items-center gap-1 rounded-md pe-1 text-xs outline-none', touch ? 'min-h-11 text-[13px]' : 'min-h-8', ' focus-visible:ring-2 focus-visible:ring-[hsl(38_85%_52%)]',
                    sel ? 'bg-[hsl(38_90%_94%)] text-foreground' : 'hover:bg-muted', b.hidden && 'text-muted-foreground')}
                >
                  {r.col != null && r.index === 0 ? <span className="me-0.5 rounded bg-muted px-1 text-2xs text-muted-foreground">{t('ems_b_column_n', { n: r.col + 1 })}</span> : null}
                  {renaming === b.id ? (
                    <Input autoFocus value={draft} maxLength={60} className="h-6 min-w-0 flex-1 px-1.5 text-xs" aria-label={t('ems_b_rename')}
                      onChange={(e) => setDraft(e.target.value)} onClick={(e) => e.stopPropagation()}
                      onBlur={() => commitName(b.id)}
                      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitName(b.id); if (e.key === 'Escape') setRenaming(null); }} />
                  ) : <span className={cn('min-w-0 flex-1 truncate', b.hidden && 'line-through')}>{label(b)}</span>}
                  <button type="button" className={icon} aria-label={t(b.hidden ? 'ems_b_show' : 'ems_b_hide')} title={t(b.hidden ? 'ems_b_show' : 'ems_b_hide')}
                    onClick={(e) => { e.stopPropagation(); onPatch(b.id, { hidden: !b.hidden }); }}>{b.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>
                  <button type="button" className={icon} aria-label={t(b.locked ? 'ems_b_unlock' : 'ems_b_lock')} title={t(b.locked ? 'ems_b_unlock' : 'ems_b_lock')}
                    onClick={(e) => { e.stopPropagation(); onPatch(b.id, { locked: !b.locked }); }}>{b.locked ? <Lock className="h-3.5 w-3.5 text-[hsl(32_60%_38%)]" /> : <LockOpen className="h-3.5 w-3.5" />}</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-2xs leading-snug text-muted-foreground">{t('ems_b_layers_hint')}</p>
    </div>
  );
}

// WHAT YOU CAN DO WITH THIS — the controls for one selected thing in the picture.
//
// Only what the piece really allows (its catalogue capabilities, the design's
// locks). Appearance first (colour, material), then moving it about. Moving
// is done in plain steps a person understands — "a little left", "turn" —
// and is checked by HOMATCH's placement rules before anything is redrawn.
// A card beside the selection on desktop; a short sheet on a phone.

import React, { useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Palette, Replace, RotateCw, Trash2, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { CatalogAsset, CatalogMaterial } from '@/lib/designStudio/catalog';
import type { MapEntry } from '@/lib/designStudio/renders/contract';
import type { EditAction, EditChoice } from '@/lib/designStudio/renders/edits';
import { cn } from '@/lib/utils';

const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]';
const STEP_M = 0.25;

export function EditPanel({
  entry, title, actions, colors, materials, variants = [], replacements, position, rotation, busy, error, onChoice, onClose,
}: {
  entry: MapEntry;
  title: string;
  actions: EditAction[];
  colors: string[];
  /** Floor or wall materials that fit this surface (catalogue). */
  materials: CatalogMaterial[];
  /** A piece's own finishes (its catalogue variants: fabrics, woods). */
  variants?: Array<{ id: string; name: string; colors: Record<string, string> }>;
  replacements: CatalogAsset[];
  /** The piece's current plan position (metres) and rotation, for MOVE / ROTATE. */
  position: { x: number; y: number } | null;
  rotation: number | null;
  busy: boolean;
  error: string | null;
  onChoice: (choice: EditChoice, label: string) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<'LOOK' | 'PLACE'>('LOOK');
  const hasLook = actions.some((a) => a === 'COLOR' || a === 'PAINT' || a === 'MATERIAL' || a === 'FINISH');
  const hasPlace = actions.some((a) => a === 'MOVE' || a === 'ROTATE' || a === 'REPLACE' || a === 'REMOVE');
  const show = hasLook ? tab : 'PLACE';
  const nudge = (dx: number, dy: number, label: string) => position && onChoice({ action: 'MOVE', to: { x: position.x + dx, y: position.y + dy }, roomId: entry.roomId }, label);

  return (
    <section
      className="fixed inset-x-0 bottom-0 z-30 max-h-[46dvh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-[#0C1119] shadow-2xl ring-1 ring-black/10 sm:absolute sm:inset-x-auto sm:bottom-4 sm:end-4 sm:w-[22rem] sm:rounded-2xl"
      aria-label={title} data-testid="edit-panel" aria-busy={busy}
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</p>
        <button type="button" onClick={onClose} aria-label={t('general_close')} className={cn('grid h-9 w-9 place-items-center rounded-md hover:bg-[#F0F2F5]', RING)}>
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {hasLook && hasPlace ? (
        <div className="mt-2 flex gap-1" role="tablist">
          {(['LOOK', 'PLACE'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={show === k} onClick={() => setTab(k)}
              className={cn('h-9 flex-1 rounded-full text-[13px] font-semibold', RING, show === k ? 'bg-[#0C1119] text-white' : 'bg-[#F1F3F6]')}>
              {t(k === 'LOOK' ? 'rend_tab_look' : 'rend_tab_place')}
            </button>
          ))}
        </div>
      ) : null}

      {show === 'LOOK' ? (
        <div className="mt-3 space-y-3">
          {actions.includes('COLOR') || actions.includes('PAINT') ? (
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-[#4A5263]"><Palette className="h-4 w-4" aria-hidden="true" />{t(entry.kind === 'OBJECT' ? 'rend_colour' : 'rend_paint')}</p>
              <div className="flex flex-wrap gap-2">
                {colors.map((c) => (
                  <button key={c} type="button" disabled={busy} onClick={() => onChoice({ action: entry.kind === 'OBJECT' ? 'COLOR' : 'PAINT', color: c }, c)}
                    aria-label={t('rend_use_colour', { colour: c })} className={cn('h-10 w-10 rounded-full ring-1 ring-black/10 disabled:opacity-50', RING)} style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          ) : null}
          {entry.kind === 'OBJECT' && actions.includes('MATERIAL') && variants.length ? (
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-[#4A5263]">{t('rend_material')}</p>
              <div className="grid grid-cols-3 gap-2">
                {variants.slice(0, 9).map((v) => (
                  <button key={v.id} type="button" disabled={busy} onClick={() => onChoice({ action: 'MATERIAL', variant: v.id }, v.name)}
                    className={cn('flex flex-col gap-1 rounded-lg p-1 text-start text-2xs ring-1 ring-[#E1E4E8] hover:ring-[#0C1119] disabled:opacity-50', RING)}>
                    <span className="flex h-9 overflow-hidden rounded-md" aria-hidden="true">{Object.values(v.colors).slice(0, 3).map((c) => <span key={c} className="flex-1" style={{ backgroundColor: c }} />)}</span>
                    <span className="truncate px-0.5">{v.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {entry.kind !== 'OBJECT' && (actions.includes('MATERIAL') || actions.includes('FINISH')) && materials.length ? (
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-[#4A5263]">{t('rend_material')}</p>
              <div className="grid grid-cols-3 gap-2">
                {materials.slice(0, 9).map((m) => (
                  <button key={m.id} type="button" disabled={busy} onClick={() => onChoice({ action: 'MATERIAL', materialId: m.id }, m.name)}
                    className={cn('flex flex-col gap-1 rounded-lg p-1 text-start text-2xs ring-1 ring-[#E1E4E8] hover:ring-[#0C1119] disabled:opacity-50', RING)}>
                    <span className="h-9 rounded-md" style={{ backgroundColor: m.pbr.baseColor }} aria-hidden="true" />
                    <span className="truncate px-0.5">{m.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {actions.includes('MOVE') && position ? (
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-[#4A5263]">{t('rend_move')}</p>
              <div className="grid w-40 grid-cols-3 gap-1.5">
                <span />
                <button type="button" disabled={busy} onClick={() => nudge(0, STEP_M, t('rend_move_north'))} aria-label={t('rend_move_north')} className={cn('grid h-10 place-items-center rounded-lg bg-[#F1F3F6] disabled:opacity-50', RING)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
                <span />
                <button type="button" disabled={busy} onClick={() => nudge(-STEP_M, 0, t('rend_move_west'))} aria-label={t('rend_move_west')} className={cn('grid h-10 place-items-center rounded-lg bg-[#F1F3F6] disabled:opacity-50', RING)}><ArrowLeft className="h-4 w-4" aria-hidden="true" /></button>
                <span />
                <button type="button" disabled={busy} onClick={() => nudge(STEP_M, 0, t('rend_move_east'))} aria-label={t('rend_move_east')} className={cn('grid h-10 place-items-center rounded-lg bg-[#F1F3F6] disabled:opacity-50', RING)}><ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
                <span />
                <button type="button" disabled={busy} onClick={() => nudge(0, -STEP_M, t('rend_move_south'))} aria-label={t('rend_move_south')} className={cn('grid h-10 place-items-center rounded-lg bg-[#F1F3F6] disabled:opacity-50', RING)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
                <span />
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {actions.includes('ROTATE') && rotation != null ? (
              <button type="button" disabled={busy} onClick={() => onChoice({ action: 'ROTATE', rotationY: rotation + Math.PI / 2 }, t('rend_rotate'))}
                className={cn('inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#D5D9E0] px-3 text-[14px] font-medium hover:bg-[#F4F5F7] disabled:opacity-50', RING)}>
                <RotateCw className="h-4 w-4" aria-hidden="true" />{t('rend_rotate')}
              </button>
            ) : null}
            {actions.includes('REMOVE') ? (
              <button type="button" disabled={busy} onClick={() => onChoice({ action: 'REMOVE' }, t('rend_remove'))}
                className={cn('inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#D5D9E0] px-3 text-[14px] font-medium hover:bg-[#F4F5F7] disabled:opacity-50', RING)}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />{t('rend_remove')}
              </button>
            ) : null}
          </div>
          {actions.includes('REPLACE') && replacements.length ? (
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-[#4A5263]"><Replace className="h-4 w-4" aria-hidden="true" />{t('rend_replace')}</p>
              <ul className="space-y-1">
                {replacements.slice(0, 5).map((a) => (
                  <li key={a.code}>
                    <button type="button" disabled={busy} onClick={() => onChoice({ action: 'REPLACE', assetId: a.code }, a.name)}
                      className={cn('flex w-full items-center justify-between rounded-lg px-3 py-2 text-start text-[14px] ring-1 ring-[#E1E4E8] hover:ring-[#0C1119] disabled:opacity-50', RING)}>
                      <span className="truncate">{a.name}</span>
                      <span className="shrink-0 text-2xs text-[#5B6472]">{a.widthM.toFixed(2)} × {a.depthM.toFixed(2)} m</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-2xs text-[#5B6472]">{t('rend_place_note')}</p>
        </div>
      )}
      {error ? <p role="alert" className="mt-3 rounded-lg bg-[hsl(0_66%_44%)]/10 px-3 py-2 text-[13px] text-[hsl(0_66%_34%)]">{error}</p> : null}
    </section>
  );
}

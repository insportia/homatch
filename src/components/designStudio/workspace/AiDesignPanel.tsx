// HOMATCH DESIGN STUDIO — THE AI DESIGNER PANEL.
//
// The customer states taste (style, a few words) and what to keep; HOMATCH
// AI proposes up to three alternatives; each is shown as what it would
// change, previewed on the canvas without touching the design, and then
// applied as ONE undoable step or saved as a new version — or discarded.
// Nothing the AI proposes reaches the design without the customer's click.

import React, { useState } from 'react';
import { Eye, EyeOff, Loader2, Sparkles } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { CatalogAsset } from '@/lib/designStudio/catalog';
import type { LockSet } from '@/lib/designStudio/designState';
import type { PlanAlternative, Proposal } from '@/lib/designStudio/aiPlan';
import { STYLE_CODES, STYLE_SWATCHES, type DesignNote } from '@/lib/designStudio/grammar';
import type { DesignBrief } from '@/services/designStudio/ai';
import { cn } from '@/lib/utils';

export interface AiProposalItem {
  alt: PlanAlternative;
  proposal: Proposal;
  notes: DesignNote[];
}

const KEEP: Array<{ key: keyof LockSet; label: string }> = [
  { key: 'layout', label: 'ds_keep_layout' },
  { key: 'furniture', label: 'ds_keep_furniture' },
  { key: 'walls', label: 'ds_keep_walls' },
  { key: 'floor', label: 'ds_keep_floor' },
  { key: 'kitchen', label: 'ds_keep_kitchen' },
  { key: 'colors', label: 'ds_keep_colors' },
  { key: 'lighting', label: 'ds_keep_lighting' },
];

const SKIP_KEY: Record<string, string> = {
  NO_SPACE: 'ds_ai_skip_no_space',
  ALREADY_THERE: 'ds_ai_skip_already',
  WRONG_ROOM: 'ds_ai_skip_wrong_room',
  OBJECT_LOCKED: 'ds_ai_skip_kept',
  CATEGORY_LOCKED: 'ds_ai_skip_kept',
  PLACEMENT_BLOCKED: 'ds_ai_skip_no_space',
};

const BUTTON = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[#D5D9E0] px-3 text-[13px] font-medium text-[#0C1119] hover:bg-[#F4F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] disabled:opacity-50';
const PRIMARY = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#0C1119] px-3 text-[13px] font-semibold text-white hover:bg-[#1a2230] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] disabled:opacity-50';

export function AiDesignPanel({
  locks, activeRoom, names, assets, busy, error, items, dropped, previewing,
  onKeep, onGenerate, onPreview, onApply, onSaveVersion, onDiscard,
}: {
  locks: LockSet;
  activeRoom: { id: string; name: string } | null;
  names: Map<string, string>;
  assets: Map<string, CatalogAsset>;
  busy: boolean;
  error: string | null;
  items: AiProposalItem[] | null;
  /** Suggestions HOMATCH removed before showing anything (unknown, unsuitable or kept). */
  dropped: number;
  previewing: number | null;
  onKeep: (key: keyof LockSet, value: boolean) => void;
  onGenerate: (brief: DesignBrief) => void;
  onPreview: (index: number | null) => void;
  onApply: (index: number) => void;
  onSaveVersion: (index: number) => void;
  onDiscard: () => void;
}) {
  const { t } = useLanguage();
  const [scope, setScope] = useState<'HOME' | 'ROOM'>('HOME');
  const [style, setStyle] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [count, setCount] = useState(2);
  const roomScoped = scope === 'ROOM' && activeRoom;

  const roomName = (id: string | null) => (id ? names.get(id) ?? '' : '');
  const noteText = (n: DesignNote) => {
    switch (n.code) {
      case 'MISSING_ESSENTIAL': return t(`ds_note_missing_${n.category.toLowerCase()}`, { room: roomName(n.roomId) });
      case 'SCATTERED_COLORS': return t('ds_note_scattered', { n: String(n.count) });
      case 'BLOCKS_DOOR': return t('ds_note_blocks_door', { room: roomName(n.roomId) });
      case 'TIGHT_ACCESS': return t('ds_note_tight', { room: roomName(n.roomId) });
    }
  };

  if (items) {
    return (
      <div className="space-y-3 px-4 py-4">
        <p className="text-[14px] leading-relaxed text-[#4A5263]">{t('ds_ai_results_intro')}</p>
        {dropped > 0 ? <p className="rounded-md bg-[#F4F5F7] px-3 py-2 text-[13px] text-[#4A5263]">{t('ds_ai_dropped', { n: String(dropped) })}</p> : null}
        {items.map((item, i) => {
          const s = item.proposal.summary;
          const left = item.proposal.skipped.filter((k) => k.what === 'FURNITURE' || k.what === 'WALLS' || k.what === 'FLOOR');
          return (
            <article key={i} aria-label={item.alt.title} className={cn('rounded-xl border p-3', previewing === i ? 'border-[hsl(38_92%_50%)] ring-2 ring-[hsl(38_92%_56%)]/40' : 'border-[#E4E6EA]')}>
              <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(34_90%_31%)]">{t('ds_ai_proposal_n', { n: String(i + 1) })}</p>
              <h3 className="mt-0.5 font-display text-[15px] font-semibold text-[#0C1119]">{item.alt.title}</h3>
              {item.alt.rationale ? <p className="mt-1 text-[13px] leading-relaxed text-[#4A5263]">{item.alt.rationale}</p> : null}
              {item.alt.palette.length ? (
                <div className="mt-2 flex gap-1" aria-hidden="true">
                  {item.alt.palette.map((c) => <span key={c} className="h-4 flex-1 rounded ring-1 ring-black/10" style={{ backgroundColor: c }} />)}
                </div>
              ) : null}
              <p className="mt-2 text-[13px] font-medium text-[#0C1119]">
                {t('ds_ai_summary', { added: String(s.added), removed: String(s.removed), surfaces: String(s.surfaces), rooms: String(s.rooms) })}
                {s.lighting ? ` · ${t('ds_ai_summary_lighting')}` : ''}
              </p>
              {left.length ? (
                <ul className="mt-2 space-y-0.5 text-[13px] text-[#4A5263]">
                  {left.slice(0, 4).map((k, j) => (
                    <li key={j}>
                      {t(SKIP_KEY[k.reason] ?? 'ds_ai_skip_generic', {
                        what: k.what === 'FURNITURE' ? assets.get(k.code ?? '')?.name ?? '' : t(k.what === 'WALLS' ? 'ds_scope_walls' : 'ds_scope_floors'),
                        room: roomName(k.roomId),
                      })}
                    </li>
                  ))}
                </ul>
              ) : null}
              {item.notes.length ? (
                <ul className="mt-2 space-y-0.5 text-[13px] text-[hsl(32_78%_30%)]">
                  {item.notes.slice(0, 3).map((n, j) => <li key={j}>{noteText(n)}</li>)}
                </ul>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button type="button" className={BUTTON} onClick={() => onPreview(previewing === i ? null : i)} aria-pressed={previewing === i}>
                  {previewing === i ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                  {t(previewing === i ? 'ds_ai_stop_preview' : 'ds_ai_preview')}
                </button>
                <button type="button" className={PRIMARY} disabled={!item.proposal.ops.length} onClick={() => onApply(i)}>{t('ds_ai_apply')}</button>
                <button type="button" className={BUTTON} disabled={!item.proposal.ops.length} onClick={() => onSaveVersion(i)}>{t('ds_ai_save_version')}</button>
              </div>
            </article>
          );
        })}
        <button type="button" onClick={onDiscard} className="text-[13px] font-medium text-[#0C1119] underline underline-offset-4">{t('ds_ai_discard')}</button>
      </div>
    );
  }

  return (
    <form
      className="space-y-5 px-4 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        onGenerate({ styleCode: style, palette: [], text: text.trim(), roomIds: roomScoped ? [activeRoom.id] : [], alternatives: count });
      }}
    >
      <p className="text-[14px] leading-relaxed text-[#4A5263]">{t('ds_ai_intro')}</p>

      <fieldset>
        <legend className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-[#4A5263]">{t('ds_ai_scope')}</legend>
        <label className="flex items-center gap-2 py-1 text-[14px]">
          <input type="radio" name="ds-ai-scope" checked={scope === 'HOME'} onChange={() => setScope('HOME')} className="accent-[#0C1119]" />
          {t('ds_ai_scope_home')}
        </label>
        <label className={cn('flex items-center gap-2 py-1 text-[14px]', !activeRoom && 'text-[#8A92A0]')}>
          <input type="radio" name="ds-ai-scope" disabled={!activeRoom} checked={scope === 'ROOM' && !!activeRoom} onChange={() => setScope('ROOM')} className="accent-[#0C1119]" />
          {activeRoom ? t('ds_ai_scope_room', { room: activeRoom.name }) : t('ds_ai_scope_room_pick')}
        </label>
      </fieldset>

      <fieldset>
        <legend className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-[#4A5263]">{t('ds_ai_style')}</legend>
        <div role="radiogroup" aria-label={t('ds_ai_style')} className="grid grid-cols-2 gap-1.5">
          {[null, ...STYLE_CODES].map((code) => (
            <button
              key={code ?? 'auto'}
              type="button"
              role="radio"
              aria-checked={style === code}
              onClick={() => setStyle(code)}
              className={cn('flex min-h-11 flex-col items-start justify-center gap-1 rounded-lg border px-2.5 py-1.5 text-start text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]',
                style === code ? 'border-[#0C1119] bg-[#F4F5F7]' : 'border-[#E4E6EA] hover:bg-[#F8F9FA]')}
            >
              {code ? (
                <span className="flex w-full gap-0.5" aria-hidden="true">
                  {STYLE_SWATCHES[code].map((c) => <span key={c} className="h-2 flex-1 rounded-sm" style={{ backgroundColor: c }} />)}
                </span>
              ) : null}
              {t(code ? `ds_style_${code.replace('-', '_')}` : 'ds_style_auto')}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-2xs font-semibold uppercase tracking-[0.12em] text-[#4A5263]">{t('ds_ai_keep')}</legend>
        <p className="mb-1.5 text-[13px] text-[#4A5263]">{t('ds_ai_keep_hint')}</p>
        {KEEP.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 py-1 text-[14px]">
            <input type="checkbox" checked={locks[key]} onChange={(e) => onKeep(key, e.target.checked)} className="accent-[#0C1119]" />
            {t(label)}
          </label>
        ))}
      </fieldset>

      <label className="block">
        <span className="mb-1.5 block text-2xs font-semibold uppercase tracking-[0.12em] text-[#4A5263]">{t('ds_ai_brief')}</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 600))}
          rows={3}
          maxLength={600}
          placeholder={t('ds_ai_brief_placeholder')}
          className="w-full rounded-lg border border-[#D5D9E0] px-3 py-2 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
        />
      </label>

      <div>
        <p className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-[#4A5263]">{t('ds_ai_count')}</p>
        <div role="radiogroup" aria-label={t('ds_ai_count')} className="grid grid-cols-3 gap-1 rounded-lg bg-[#F1F2F4] p-1">
          {[1, 2, 3].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={count === n} onClick={() => setCount(n)}
              className={cn('h-8 rounded-md text-[14px] font-medium', count === n ? 'bg-white shadow-sm' : 'text-[#4A5263]')}>
              {n}
            </button>
          ))}
        </div>
      </div>

      {error ? <p role="alert" className="rounded-lg bg-[hsl(0_66%_44%)]/10 px-3 py-2 text-[14px] text-[hsl(0_66%_34%)]">{error}</p> : null}
      <button type="submit" disabled={busy} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0C1119] text-[15px] font-semibold text-white hover:bg-[#1a2230] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
        {t(busy ? 'ds_ai_working' : 'ds_ai_generate')}
      </button>
      <p className="text-[13px] leading-relaxed text-[#4A5263]">{t('ds_ai_fine_print')}</p>
    </form>
  );
}

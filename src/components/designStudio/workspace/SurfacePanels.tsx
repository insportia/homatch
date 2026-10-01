import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { HEX, type CatalogMaterial, type Palette } from '@/lib/designStudio/catalog';
import type { LightingState } from '@/lib/designStudio/designState';
import { cn } from '@/lib/utils';
import { CatalogThumb } from './CatalogThumb';
import { useIncrementalList } from './useIncrementalList';

/** One colour chip; the selected one is marked with a check, never only by colour. */
export function Swatch({
  color, label, selected, onClick, size = 'md',
}: { color: string; label: string; selected?: boolean; onClick: () => void; size?: 'sm' | 'md' }) {
  const light = parseInt(color.slice(1, 3), 16) * 0.299 + parseInt(color.slice(3, 5), 16) * 0.587 + parseInt(color.slice(5, 7), 16) * 0.114 > 150;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={!!selected}
      title={label}
      className={cn(
        'grid shrink-0 place-items-center rounded-full ring-1 ring-black/15 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] focus-visible:ring-offset-2',
        size === 'sm' ? 'h-7 w-7' : 'h-9 w-9',
        selected && 'ring-2 ring-[#0C1119] ring-offset-2',
      )}
      style={{ backgroundColor: color }}
    >
      {selected ? <Check className={cn('h-4 w-4', light ? 'text-[#0C1119]' : 'text-white')} aria-hidden="true" /> : null}
    </button>
  );
}

/** Curated palettes, recent colours and a custom colour — the professional colour control. */
export function ColorPicker({
  palettes, recent, current, onPick, onReset,
}: {
  palettes: Palette[];
  recent: string[];
  current: string | null;
  onPick: (color: string) => void;
  onReset?: () => void;
}) {
  const { t } = useLanguage();
  const [custom, setCustom] = useState(current ?? '#d8d0c3');
  return (
    <div className="space-y-3">
      {recent.length ? (
        <div>
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-[#4A5263]">{t('ds_colors_recent')}</p>
          <div className="flex flex-wrap gap-2">
            {recent.map((c) => <Swatch key={c} color={c} label={c} selected={current?.toLowerCase() === c.toLowerCase()} onClick={() => onPick(c)} size="sm" />)}
          </div>
        </div>
      ) : null}
      {palettes.map((p) => (
        <div key={p.code}>
          <p className="mb-1.5 text-[13px] font-medium text-[#0C1119]">{p.name}</p>
          <div className="flex flex-wrap gap-2">
            {p.colors.map((c) => <Swatch key={c} color={c} label={`${p.name} ${c}`} selected={current?.toLowerCase() === c.toLowerCase()} onClick={() => onPick(c)} size="sm" />)}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-[13px] text-[#0C1119]">
          <input
            type="color"
            value={HEX.test(custom) ? custom : '#d8d0c3'}
            onChange={(e) => setCustom(e.target.value)}
            className="h-8 w-10 cursor-pointer rounded border border-[#D5D9E0] bg-white p-0.5"
            aria-label={t('ds_colors_custom')}
          />
          {t('ds_colors_custom')}
        </label>
        <button
          type="button"
          onClick={() => onPick(custom)}
          className="h-8 rounded-md border border-[#D5D9E0] px-2.5 text-[13px] font-medium text-[#0C1119] hover:bg-[#F4F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
        >
          {t('ds_action_apply')}
        </button>
        {onReset ? (
          <button type="button" onClick={onReset} className="ms-auto text-[13px] font-medium text-[#4A5263] underline underline-offset-4 hover:text-[#0C1119]">
            {t('ds_action_reset')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Materials for one surface kind: their picture (lazy, when they have one) or colour swatch, with names. Long lists draw a page at a time. */
export function MaterialList({
  materials, current, onPick, onReset,
}: { materials: CatalogMaterial[]; current: string | null; onPick: (m: CatalogMaterial) => void; onReset?: () => void }) {
  const { t } = useLanguage();
  const list = useIncrementalList(materials.length, `${materials.length}|${materials[0]?.id ?? ''}`);
  if (materials.length === 0) return <p className="text-[13px] text-[#4A5263]">{t('ds_materials_none')}</p>;
  return (
    <div>
      <ul className="grid grid-cols-2 gap-1.5">
        {materials.slice(0, list.shown).map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => onPick(m)}
              aria-pressed={current === m.id}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-start text-[13px] leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]',
                current === m.id ? 'border-[#0C1119] bg-[#F4F5F7] font-semibold' : 'border-[#E4E6EA] hover:bg-[#F7F8FA]',
              )}
            >
              <CatalogThumb
                thumbKey={m.thumbnailKey}
                className="h-9 w-9 ring-1 ring-black/10"
                fallback={<span className="h-full w-full" style={{ backgroundColor: m.pbr.baseColor }} aria-hidden="true" />}
              />
              <span className="min-w-0 break-words text-[#0C1119]">{m.name}</span>
            </button>
          </li>
        ))}
        {list.hasMore ? (
          <li ref={list.sentinelRef} className="col-span-2">
            <button
              type="button"
              onClick={list.more}
              className="w-full rounded-md border border-[#D5D9E0] px-3 py-1.5 text-[13px] font-medium text-[#0C1119] hover:bg-[#F4F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
            >
              {t('ds_library_show_more')}
            </button>
          </li>
        ) : null}
      </ul>
      {onReset ? (
        <button type="button" onClick={onReset} className="mt-2 text-[13px] font-medium text-[#4A5263] underline underline-offset-4 hover:text-[#0C1119]">
          {t('ds_action_reset')}
        </button>
      ) : null}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-flow-col gap-1 rounded-lg bg-[#F1F2F4] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]',
            value === o.value ? 'bg-white text-[#0C1119] shadow-sm' : 'text-[#4A5263] hover:text-[#0C1119]')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Design-preview lighting: time of day, colour temperature, interior intensity. Not a lux model. */
export function LightingPanel({
  lighting, locked, onChange,
}: { lighting: LightingState; locked: boolean; onChange: (l: Partial<LightingState>) => void }) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(lighting.interiorIntensity);
  return (
    <div className="space-y-5 px-4 py-4">
      {locked ? <p className="rounded-md bg-[#F4F5F7] px-3 py-2 text-[13px] text-[#4A5263]">{t('ds_locked_lighting')}</p> : null}
      <fieldset disabled={locked} className="space-y-5 disabled:opacity-50">
        <div>
          <p className="mb-1.5 text-[14px] font-medium text-[#0C1119]">{t('ds_light_time')}</p>
          <Segmented
            label={t('ds_light_time')}
            value={lighting.timeOfDay}
            onChange={(v) => onChange({ timeOfDay: v })}
            options={[
              { value: 'DAY', label: t('ds_light_day') },
              { value: 'EVENING', label: t('ds_light_evening') },
              { value: 'NIGHT', label: t('ds_light_night') },
            ]}
          />
        </div>
        <div>
          <p className="mb-1.5 text-[14px] font-medium text-[#0C1119]">{t('ds_light_temperature')}</p>
          <Segmented
            label={t('ds_light_temperature')}
            value={lighting.temperature}
            onChange={(v) => onChange({ temperature: v })}
            options={[
              { value: 'WARM', label: t('ds_light_warm') },
              { value: 'NEUTRAL', label: t('ds_light_neutral') },
              { value: 'COOL', label: t('ds_light_cool') },
            ]}
          />
        </div>
        <div>
          <label htmlFor="ds-intensity" className="mb-1.5 block text-[14px] font-medium text-[#0C1119]">{t('ds_light_intensity')}</label>
          <input
            id="ds-intensity"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={draft}
            onChange={(e) => setDraft(Number(e.target.value))}
            // One design change per gesture, not one per pixel of the slider.
            onPointerUp={() => onChange({ interiorIntensity: draft })}
            onKeyUp={() => onChange({ interiorIntensity: draft })}
            className="w-full accent-[hsl(38_92%_50%)]"
          />
        </div>
        <p className="text-[13px] leading-relaxed text-[#4A5263]">{t('ds_light_note')}</p>
      </fieldset>
    </div>
  );
}

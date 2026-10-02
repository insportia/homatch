// "HOW SHOULD IT LOOK?" — the customer's choices, as things they can see.
//
// Style is a card with its palette; mood, floor, walls and accents are
// swatches; furnishing is four plain levels. Every choice has a sensible
// default, so "Generate" works after a single tap, and the free-text brief is
// there for the customer who knows exactly what they want. Nothing here calls
// the AI: the choices are kept, and Generate sends them once.

import React from 'react';
import { Armchair, BedDouble, Package, Sofa, Sparkles } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { STYLE_CODES, STYLE_SWATCHES } from '@/lib/designStudio/grammar';
import {
  ACCENTS, FLOOR_DIRECTIONS, FURNISHING_LEVELS, MOODS, PALETTES, WALL_DIRECTIONS, type DesignPreferences,
} from '@/lib/designStudio/planToHome';
import { cn } from '@/lib/utils';

/** What each material direction looks like, drawn (never a photo that could pass for the result). */
export const FLOOR_SWATCH: Record<string, string> = {
  LIGHT_WOOD: 'repeating-linear-gradient(90deg,#d9bf98 0 14px,#cfb38b 14px 15px,#dcc49f 15px 30px,#c8ab82 30px 31px)',
  DARK_WOOD: 'repeating-linear-gradient(90deg,#6b4a32 0 14px,#5e4029 14px 15px,#73513a 15px 30px,#57391f 30px 31px)',
  STONE: 'radial-gradient(circle at 30% 30%,#d8d4cc,#bdb7ad)',
  MARBLE: 'linear-gradient(125deg,#f3f1ee 0%,#e7e3dd 40%,#cfc9c1 42%,#efece8 45%,#e9e5df 100%)',
  CONCRETE: 'radial-gradient(circle at 70% 40%,#b9b9b6,#9d9d9a)',
  TILE: 'repeating-linear-gradient(0deg,#e8e6e1 0 18px,#cfccc5 18px 19px),repeating-linear-gradient(90deg,transparent 0 18px,#cfccc5 18px 19px)',
};
export const WALL_SWATCH: Record<string, string> = { WARM_WHITE: '#f6f1e7', COOL_WHITE: '#f2f4f6', GREIGE: '#d9d2c7', PLASTER: '#e7dccd', DEEP: '#4b5a5c' };
export const ACCENT_SWATCH: Record<string, string> = { BLACK_METAL: '#1d1f22', BRASS: '#b08d57', CHROME: '#c7ccd1', NATURAL_WOOD: '#a77b52' };
const MOOD_SWATCH: Record<string, [string, string]> = {
  WARM: ['#f3d9b1', '#c98b55'], BRIGHT: ['#ffffff', '#dfe9f2'], CALM: ['#dfe7e3', '#a9bdb5'], DRAMATIC: ['#2b2f36', '#8a6b4a'],
  NATURAL: ['#e4dccb', '#8e9b74'], ELEGANT: ['#ece6dd', '#6d5a4a'], COZY: ['#e9cfb5', '#8c5a3c'],
};
const PALETTE_SWATCH: Record<string, string[]> = { WARM: ['#efe2cf', '#c99a6b', '#8c5a3c'], NEUTRAL: ['#f1efea', '#c9c4bb', '#6f6a62'], COOL: ['#eef2f5', '#a9b9c6', '#4b5d6b'] };
const LEVEL_ICON = { UNFURNISHED: Package, ESSENTIAL: BedDouble, FULL: Sofa, STAGED: Armchair } as const;

const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] focus-visible:ring-offset-2';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2.5">
      <legend className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-[#4A5263]">{title}</legend>
      {children}
    </fieldset>
  );
}

export function DesignChooser({ value, onChange, onGenerate, busy, onBack, price, priceUnavailable }: {
  value: DesignPreferences;
  onChange: (next: DesignPreferences) => void;
  onGenerate: () => void;
  busy: boolean;
  onBack: () => void;
  /** The server's quote for the master design, shown before anything is generated. */
  price?: { credits: number; charged: boolean } | null;
  priceUnavailable?: boolean;
}) {
  const { t } = useLanguage();
  const set = <K extends keyof DesignPreferences>(k: K, v: DesignPreferences[K]) => onChange({ ...value, [k]: v });
  const swatch = (on: boolean) => cn('relative flex flex-col items-stretch gap-1.5 rounded-xl p-1.5 text-start text-[13px] font-medium transition-shadow', RING,
    on ? 'ring-2 ring-[#0C1119]' : 'ring-1 ring-[#E1E4E8] hover:ring-[#9AA1AD]');

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="design-chooser">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6 sm:px-6">
          <div>
            <h2 className="font-display text-2xl font-semibold">{t('p2h_design_title')}</h2>
            <p className="mt-1 text-[15px] text-[#4A5263]">{t('p2h_design_body')}</p>
          </div>

          <Section title={t('p2h_style')}>
            <div role="radiogroup" aria-label={t('p2h_style')} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {STYLE_CODES.map((code) => (
                <button key={code} type="button" role="radio" aria-checked={value.style === code} onClick={() => set('style', code)} className={swatch(value.style === code)} data-testid={`style-${code}`}>
                  <span className="flex h-14 overflow-hidden rounded-lg" aria-hidden="true">
                    {STYLE_SWATCHES[code].map((c) => <span key={c} className="flex-1" style={{ backgroundColor: c }} />)}
                  </span>
                  <span className="px-1 pb-0.5">{t(`ds_style_${code.replace('-', '_')}`)}</span>
                </button>
              ))}
              <button type="button" role="radio" aria-checked={value.style === null} onClick={() => set('style', null)} className={swatch(value.style === null)} data-testid="style-custom">
                <span className="grid h-14 place-items-center rounded-lg bg-[#F1F3F6]" aria-hidden="true"><Sparkles className="h-5 w-5 text-[#4A5263]" /></span>
                <span className="px-1 pb-0.5">{t('p2h_style_custom')}</span>
              </button>
            </div>
          </Section>

          <Section title={t('p2h_mood')}>
            <div role="radiogroup" aria-label={t('p2h_mood')} className="flex flex-wrap gap-2">
              {MOODS.map((m) => (
                <button key={m} type="button" role="radio" aria-checked={value.mood === m} onClick={() => set('mood', m)}
                  className={cn('inline-flex h-11 items-center gap-2 rounded-full border px-3.5 text-[14px] font-medium', RING, value.mood === m ? 'border-[#0C1119] bg-[#0C1119] text-white' : 'border-[#D5D9E0] hover:border-[#0C1119]')}>
                  <span className="h-4 w-4 rounded-full ring-1 ring-black/10" style={{ background: `linear-gradient(135deg,${MOOD_SWATCH[m][0]},${MOOD_SWATCH[m][1]})` }} aria-hidden="true" />
                  {t(`p2h_mood_${m.toLowerCase()}`)}
                </button>
              ))}
            </div>
          </Section>

          <Section title={t('p2h_floors')}>
            <div role="radiogroup" aria-label={t('p2h_floors')} className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
              {FLOOR_DIRECTIONS.map((f) => (
                <button key={f} type="button" role="radio" aria-checked={value.floor === f} onClick={() => set('floor', f)} className={swatch(value.floor === f)}>
                  <span className="h-12 rounded-lg" style={{ background: FLOOR_SWATCH[f] }} aria-hidden="true" />
                  <span className="px-1 text-2xs">{t(`p2h_floor_${f.toLowerCase()}`)}</span>
                </button>
              ))}
            </div>
          </Section>

          <div className="grid gap-8 sm:grid-cols-2">
            <Section title={t('p2h_walls')}>
              <div role="radiogroup" aria-label={t('p2h_walls')} className="flex flex-wrap gap-2">
                {WALL_DIRECTIONS.map((w) => (
                  <button key={w} type="button" role="radio" aria-checked={value.walls === w} onClick={() => set('walls', w)} className={cn(swatch(value.walls === w), 'w-[5.5rem]')}>
                    <span className="h-10 rounded-lg ring-1 ring-inset ring-black/5" style={{ backgroundColor: WALL_SWATCH[w] }} aria-hidden="true" />
                    <span className="px-1 text-2xs">{t(`p2h_wall_${w.toLowerCase()}`)}</span>
                  </button>
                ))}
              </div>
            </Section>
            <Section title={t('p2h_accents')}>
              <div role="radiogroup" aria-label={t('p2h_accents')} className="flex flex-wrap gap-2">
                {ACCENTS.map((a) => (
                  <button key={a} type="button" role="radio" aria-checked={value.accent === a} onClick={() => set('accent', a)} className={cn(swatch(value.accent === a), 'w-[5.5rem]')}>
                    <span className="h-10 rounded-lg" style={{ background: `linear-gradient(135deg,${ACCENT_SWATCH[a]},#ffffff55)` , backgroundColor: ACCENT_SWATCH[a] }} aria-hidden="true" />
                    <span className="px-1 text-2xs">{t(`p2h_accent_${a.toLowerCase()}`)}</span>
                  </button>
                ))}
              </div>
            </Section>
          </div>

          <Section title={t('p2h_palette')}>
            <div role="radiogroup" aria-label={t('p2h_palette')} className="flex flex-wrap gap-2">
              {PALETTES.map((p) => (
                <button key={p} type="button" role="radio" aria-checked={value.palette === p} onClick={() => set('palette', p)}
                  className={cn('inline-flex h-11 items-center gap-2 rounded-full border px-3.5 text-[14px] font-medium', RING, value.palette === p ? 'border-[#0C1119] bg-[#0C1119] text-white' : 'border-[#D5D9E0] hover:border-[#0C1119]')}>
                  <span className="flex overflow-hidden rounded-full ring-1 ring-black/10" aria-hidden="true">{PALETTE_SWATCH[p].map((c) => <span key={c} className="h-4 w-2.5" style={{ backgroundColor: c }} />)}</span>
                  {t(`p2h_palette_${p.toLowerCase()}`)}
                </button>
              ))}
            </div>
          </Section>

          <Section title={t('p2h_furnishing')}>
            <div role="radiogroup" aria-label={t('p2h_furnishing')} className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {FURNISHING_LEVELS.map((l) => {
                const Icon = LEVEL_ICON[l];
                return (
                  <button key={l} type="button" role="radio" aria-checked={value.furnishing === l} onClick={() => set('furnishing', l)}
                    className={cn('flex flex-col items-start gap-1 rounded-xl border p-3 text-start', RING, value.furnishing === l ? 'border-[#0C1119] bg-[#F4F5F7]' : 'border-[#E1E4E8] hover:border-[#9AA1AD]')}
                    data-testid={`furnishing-${l.toLowerCase()}`}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                    <span className="text-[14px] font-semibold">{t(`p2h_level_${l.toLowerCase()}`)}</span>
                    <span className="text-2xs leading-snug text-[#5B6472]">{t(`p2h_level_${l.toLowerCase()}_hint`)}</span>
                  </button>
                );
              })}
            </div>
          </Section>

          <label className="block">
            <span className="mb-2.5 block text-[13px] font-semibold uppercase tracking-[0.1em] text-[#4A5263]">{t(value.style === null ? 'p2h_brief_custom' : 'p2h_brief')}</span>
            <textarea
              value={value.brief} maxLength={600} rows={3}
              onChange={(e) => set('brief', e.target.value)}
              placeholder={t('p2h_brief_placeholder')}
              className="w-full rounded-xl border border-[#D5D9E0] bg-white px-3.5 py-3 text-[15px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
              data-testid="design-brief"
            />
          </label>
        </div>
      </div>
      <div className="sticky bottom-0 border-t border-[#E4E6EA] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        {price ? (
          <p className="mx-auto w-full max-w-3xl px-4 pt-3 text-[13px] text-[#4A5263] sm:px-6" data-testid="design-price">
            {t(price.charged ? 'p2h_price_charged' : 'p2h_price_not_charged', { credits: String(price.credits) })}
          </p>
        ) : priceUnavailable ? (
          <p className="mx-auto w-full max-w-3xl px-4 pt-3 text-[13px] text-[hsl(32_78%_34%)] sm:px-6">{t('p2h_price_unavailable')}</p>
        ) : null}
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 p-4 sm:px-6">
          <button type="button" onClick={onBack} className={cn('h-12 rounded-xl border border-[#D5D9E0] px-4 text-[15px] font-medium hover:bg-[#F4F5F7]', RING)}>{t('p2h_back_to_plan')}</button>
          <button type="button" onClick={onGenerate} disabled={busy || !price || (value.style === null && value.brief.trim().length < 3)}
            className={cn('inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[hsl(38_92%_56%)] px-5 text-[16px] font-semibold text-[#0C1119] hover:bg-[hsl(38_92%_50%)] disabled:opacity-50', RING)}
            data-testid="design-generate">
            <Sparkles className="h-5 w-5" aria-hidden="true" />{price ? t('p2h_generate_credits', { credits: String(price.credits) }) : t('p2h_generate')}
          </button>
        </div>
      </div>
    </div>
  );
}

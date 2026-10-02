// HOMATCH INTELLIGENCE — optional, off until the owner turns it on. One card:
// what it does, the limits it can never cross (lib/metaAds/homatchIntelligence),
// and what it judges by. It suggests from the campaign's own results; the
// owner approves every change. Nothing here touches Meta or money.
import React from 'react';
import { ShieldCheck, Sparkles } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { prefsOf, type IntelligencePrefs } from '@/lib/metaAds/homatchIntelligence';

const NEVER = ['budget', 'places', 'objective', 'paused', 'policy', 'exclusions'] as const;

export function IntelligenceCard({ value, onChange, housingRestricted }: {
  value: unknown; onChange: (next: IntelligencePrefs) => void; housingRestricted: boolean;
}) {
  const { t } = useLanguage();
  const prefs = prefsOf(value);
  return (
    <section data-mm-intelligence={prefs.enabled ? 'on' : 'off'} aria-labelledby="mm-i-title"
      className="rounded-2xl border border-[hsl(var(--gold-border))]/60 bg-card p-3.5 shadow-sm sm:p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[hsl(var(--gold-soft))]"><Sparkles className="h-4 w-4 text-[hsl(var(--gold-ink))]" /></span>
        <div className="min-w-0 flex-1">
          <h3 id="mm-i-title" className="text-[15px] font-semibold leading-snug text-foreground">{t('mm_i_title')}</h3>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{t('mm_i_body')}</p>
        </div>
        <button type="button" role="switch" aria-checked={prefs.enabled} aria-labelledby="mm-i-title" data-mm-intelligence-toggle=""
          onClick={() => onChange({ ...prefs, enabled: !prefs.enabled })}
          className={cn('relative inline-flex h-11 w-16 shrink-0 items-center rounded-full border px-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]',
            prefs.enabled ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold))]' : 'border-border bg-[hsl(var(--secondary))]')}>
          <span className="sr-only">{t(prefs.enabled ? 'mm_f_on' : 'mm_f_off')}</span>
          <span aria-hidden className={cn('block h-8 w-8 rounded-full bg-background shadow transition-transform motion-reduce:transition-none', prefs.enabled ? 'translate-x-6 rtl:-translate-x-6' : 'translate-x-0')} />
        </button>
      </div>
      {prefs.enabled && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-foreground">{t('mm_i_judge_by')}</legend>
            <div className="flex flex-wrap gap-2">
              {(['QUALITY', 'VOLUME'] as const).map((k) => (
                <button key={k} type="button" aria-pressed={prefs.optimiseFor === k} data-mm-intelligence-for={k}
                  onClick={() => onChange({ ...prefs, optimiseFor: k })}
                  className={cn('inline-flex min-h-11 items-center rounded-full border px-3.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))]',
                    prefs.optimiseFor === k ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] font-semibold text-foreground' : 'border-border text-muted-foreground')}>
                  {t(`mm_i_for_${k}`)}
                </button>
              ))}
            </div>
          </fieldset>
          <div>
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground"><ShieldCheck className="h-4 w-4 text-[hsl(152_54%_30%)]" aria-hidden />{t('mm_i_never_title')}</p>
            <ul className="mt-1 grid gap-0.5 ps-6 text-[13px] leading-relaxed text-muted-foreground sm:grid-cols-2" data-mm-intelligence-never="">
              {NEVER.map((k) => <li key={k} className="list-disc">{t(`mm_i_never_${k}`)}</li>)}
            </ul>
          </div>
          <p className="text-2xs leading-relaxed text-muted-foreground">{t(housingRestricted ? 'mm_i_how_housing' : 'mm_i_how')}</p>
        </div>
      )}
    </section>
  );
}

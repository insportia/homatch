// HOMATCH Leads — how far internal matching may reach for one listing (smart match expansion).
//
// The owner chooses whether to see people searching a neighbouring area (measured from
// where listings actually are, up to the configured distance), people whose budget is
// close (the discovery tolerance — never presented as purchasing capacity), people
// searching elsewhere in the city for a property like this one, and people who searched the
// whole city. Applied on the server, free and instant; nothing here is charged.

import React, { useState } from 'react';
import { Loader2, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { setMatchPreferences, type MatchPreferences } from '@/services/homatchLeads';
import { bandLabels } from '@/leads/leadSummary';
import { EYEBROW, SURFACE } from './kit';
import { formatCreditsLabel, useLeadFormatters } from './LeadCard';

type Toggle = 'nearbyEnabled' | 'budgetTolerance' | 'similarEnabled' | 'cityWideEnabled';

export function MatchReachControls({ propertyId, preferences, onChanged }: {
  propertyId: string;
  preferences: MatchPreferences;
  onChanged: (next: MatchPreferences) => void;
}) {
  const { t, lang } = useLanguage();
  const { money } = useLeadFormatters();
  const [busy, setBusy] = useState<string | null>(null);
  const km = (n: number) => formatCreditsLabel(n, lang);
  const steps = [...new Set([1, 1.5, 2, preferences.maxNearbyKm].filter((x) => x > 0 && x <= preferences.maxNearbyKm))].sort((a, b) => a - b);
  const bands = bandLabels(preferences.saleBands, preferences.bandsCurrency, t, (n, c) => money(n, c));

  async function save(patch: Parameters<typeof setMatchPreferences>[1], which: string) {
    setBusy(which);
    try {
      const next = await setMatchPreferences(propertyId, patch);
      if (next) onChanged(next);
    } catch {
      toast.error(t('hl_error_generic'));
    } finally {
      setBusy(null);
    }
  }

  const rows: Array<{ key: Toggle; title: string; hint: string; available?: boolean }> = [
    { key: 'nearbyEnabled', title: t('hl_reach_nearby'), hint: t('hl_reach_nearby_hint', { km: km(preferences.maxNearbyKm) }) },
    { key: 'budgetTolerance', title: t('hl_reach_budget'), hint: t('hl_reach_budget_hint') },
    { key: 'similarEnabled', title: t('hl_reach_similar'), hint: t('hl_reach_similar_hint'), available: preferences.similarAvailable },
    { key: 'cityWideEnabled', title: t('hl_reach_citywide'), hint: t('hl_reach_citywide_hint') },
  ];

  return (
    <section className={cn(SURFACE, 'mt-4 p-4 sm:p-5')} aria-labelledby="hl-reach-title" data-testid="hl-reach">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--gold-soft))]">
          <SlidersHorizontal className="h-5 w-5 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="hl-reach-title" className={EYEBROW}>{t('hl_reach_title')}</h2>
          <p className="mt-1 text-sm leading-relaxed text-[hsl(224_14%_24%)]">{t('hl_reach_body')}</p>
        </div>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {rows.filter((r) => r.available !== false).map((r) => {
          const on = preferences[r.key];
          return (
            <li key={r.key} className="flex min-w-0 flex-col gap-2 rounded-xl border border-[hsl(var(--border))] bg-white p-3">
              <div className="flex min-h-11 items-start justify-between gap-3">
                <span className="min-w-0">
                  <span id={`hl-reach-${r.key}-t`} className="block text-sm font-semibold text-[hsl(224_14%_12%)]">{r.title}</span>
                  <span id={`hl-reach-${r.key}-h`} className="mt-0.5 block text-xs leading-relaxed text-[hsl(224_14%_32%)]">{r.hint}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {busy === r.key ? <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--gold-ink))]" aria-hidden="true" /> : null}
                  <button type="button" role="switch" aria-checked={on} disabled={busy != null} data-testid={`hl-reach-${r.key}`}
                    aria-labelledby={`hl-reach-${r.key}-t`} aria-describedby={`hl-reach-${r.key}-h`}
                    onClick={() => void save({ [r.key]: !on }, r.key)}
                    className={cn('relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors motion-reduce:transition-none',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)] focus-visible:ring-offset-2 disabled:opacity-60',
                      on ? 'justify-end bg-[hsl(38_92%_44%)]' : 'justify-start bg-[hsl(220_15%_78%)]')}>
                    <span className="h-6 w-6 rounded-full bg-white shadow" aria-hidden="true" />
                  </button>
                </span>
              </div>
              {r.key === 'nearbyEnabled' && on && steps.length > 1 ? (
                <label className="flex min-w-0 items-center justify-between gap-3 text-xs font-semibold text-[hsl(224_14%_30%)]">
                  <span>{t('hl_reach_km')}</span>
                  <select value={String(preferences.nearbyKm)} disabled={busy != null} data-testid="hl-reach-km"
                    onChange={(e) => void save({ nearbyKm: Number(e.target.value) }, 'nearbyKm')}
                    className="min-h-11 rounded-xl border border-[hsl(var(--border))] bg-white px-3 text-sm font-semibold text-[hsl(224_14%_12%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]">
                    {steps.map((s) => <option key={s} value={String(s)}>{t('hl_reach_km_n', { km: km(s) })}</option>)}
                  </select>
                </label>
              ) : null}
              {r.key === 'budgetTolerance' && on && bands.length ? (
                <ul className="space-y-0.5 text-2xs leading-relaxed text-[hsl(224_14%_30%)]" data-testid="hl-reach-bands">
                  {bands.map((b) => <li key={b} dir="auto">{b}</li>)}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-2xs leading-relaxed text-[hsl(224_14%_34%)]">{t('hl_reach_free')}</p>
    </section>
  );
}

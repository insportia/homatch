import { Lock, Telescope } from 'lucide-react';
import { PaidCampaignPanel } from '../PaidCampaignPanel';
import type { T } from '../format';
import { Eyebrow } from './primitives';

/**
 * Deep Search for one search: a graphite card holding the server-priced campaign
 * (preview → explicit approval → reservation → progress → settlement). While the
 * Admin switch is off it explains that and offers nothing to press.
 */
export function DeepSearchPanel({ t, searchId, available, initialCredits }: { t: T; searchId: string; available: boolean; initialCredits?: number | null }) {
  return (
    <section aria-labelledby="fpx-deep-panel" data-deep-panel className="relative overflow-hidden rounded-3xl border border-white/10 bg-[linear-gradient(160deg,#121A26_0%,#0C1119_70%)] p-5 text-white shadow-[0_20px_48px_-28px_rgba(12,17,25,0.8)] sm:p-6">
      <div className="pointer-events-none absolute -end-24 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(circle,hsl(var(--gold)/0.2),transparent_65%)]" aria-hidden="true" />
      <div className="relative mb-4 flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[hsl(var(--gold)/0.5)] text-[hsl(var(--gold))]" aria-hidden="true"><Telescope className="h-5 w-5" /></span>
        <div className="min-w-0">
          <Eyebrow className="text-[hsl(var(--gold))]">{t('fpx_deep_eyebrow')}</Eyebrow>
          <h2 id="fpx-deep-panel" className="font-display text-xl font-semibold">{t('fpx_deep_title')}</h2>
          <p className="mt-1 text-sm leading-relaxed text-white/70">{t('fpx_deep_body')}</p>
        </div>
      </div>
      <div className="relative">
        {available ? <PaidCampaignPanel t={t} searchId={searchId} initialCredits={initialCredits ?? undefined} />
          : <p className="flex items-start gap-2 rounded-2xl border border-white/10 bg-white/5 p-3.5 text-sm leading-relaxed text-white/75" role="note"><Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t('fpx_deep_off_note')}</p>}
      </div>
    </section>
  );
}

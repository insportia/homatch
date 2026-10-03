import { ArrowRight, Layers, Telescope } from 'lucide-react';
import type { T } from './format';

/**
 * Two searches, side by side. Marketplace Search is the primary, complete,
 * free product; Deep Search looks further and is presented as an addition,
 * never as the "real" search. Until Deep Search is activated its action is
 * honestly unavailable: no fake start, no invented price or date.
 */
export function SearchModeSelect({ t, onMarketplace, deepSearchAvailable }: {
  t: T;
  onMarketplace: () => void;
  deepSearchAvailable: boolean;
}) {
  return (
    <section aria-labelledby="mps-mode-title" className="space-y-6">
      <div className="max-w-3xl space-y-2">
        <h2 id="mps-mode-title" className="font-display text-2xl font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-[28px]">
          {t('mps_mode_title')}
        </h2>
        <p className="text-[15px] leading-relaxed text-muted-foreground">{t('mps_mode_subtitle')}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <article className="hm-discovery-panel hm-discovery-focus relative flex flex-col overflow-hidden p-6 sm:p-8">
          <div className="pointer-events-none absolute -end-16 -top-16 h-48 w-48 rounded-full bg-[hsl(var(--gold)/0.10)] blur-2xl" aria-hidden="true" />
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#0C1119] text-[hsl(38_92%_60%)]" aria-hidden="true">
              <Layers className="h-5 w-5" />
            </span>
            <h3 className="font-display text-xl font-semibold tracking-[-0.01em] text-foreground">{t('mps_marketplace_title')}</h3>
            <span className="rounded-full border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.12)] px-2.5 py-0.5 text-xs font-semibold text-[hsl(var(--gold-ink))]">
              {t('mps_marketplace_badge')}
            </span>
          </div>
          <p className="mt-4 max-w-[60ch] text-[15px] leading-relaxed text-foreground/80">{t('mps_marketplace_description')}</p>
          <div className="mt-6 flex-1" />
          <button
            type="button"
            onClick={onMarketplace}
            className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#0C1119] px-6 text-[15px] font-semibold text-white transition hover:bg-[#151d2a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] focus-visible:ring-offset-2 sm:w-auto"
          >
            <span>{t('mps_marketplace_cta')}</span>
            <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          </button>
        </article>

        <DeepSearchCard t={t} available={deepSearchAvailable} variant="mode" />
      </div>
    </section>
  );
}

/** Deep Search, in the mode selection and after results. Never a paywall. */
export function DeepSearchCard({ t, available, variant }: { t: T; available: boolean; variant: 'mode' | 'results' }) {
  const mode = variant === 'mode';
  return (
    <article
      aria-labelledby={`mps-deep-${variant}`}
      className="relative flex flex-col overflow-hidden rounded-2xl bg-[#0C1119] p-6 text-white shadow-hover sm:p-8"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_100%_0%,hsl(38_92%_56%/0.18),transparent_60%)]" aria-hidden="true" />
      <div className="relative flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl border border-white/15 text-[hsl(38_92%_60%)]" aria-hidden="true">
          <Telescope className="h-5 w-5" />
        </span>
        <h3 id={`mps-deep-${variant}`} className="font-display text-xl font-semibold tracking-[-0.01em]">
          {mode ? t('mps_deep_title') : t('mps_deep_results_title')}
        </h3>
      </div>
      <p className="relative mt-4 max-w-[60ch] text-[15px] leading-relaxed text-white/80">
        {mode ? t('mps_deep_description') : t('mps_deep_results_body')}
      </p>
      <p className="relative mt-3 max-w-[60ch] text-sm leading-relaxed text-white/60">
        {mode ? t('mps_deep_supporting') : t('mps_deep_results_secondary')}
      </p>
      <div className="relative mt-6 flex-1" />
      <div className="relative flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!available}
          aria-describedby={available ? undefined : `mps-deep-state-${variant}`}
          className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[hsl(38_92%_60%/0.6)] px-6 text-[15px] font-semibold text-[hsl(38_92%_66%)] transition enabled:hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_60%)]"
        >
          {t('mps_deep_cta')}
        </button>
        {!available && (
          <span id={`mps-deep-state-${variant}`} className="text-sm text-white/60">{t('mps_deep_unavailable')}</span>
        )}
      </div>
    </article>
  );
}

// HOMATCH Verify — "Market position".
//
// The MARKET prose first (the market explained in words), then what the
// deterministic market intelligence actually supports, decided by
// marketView() in src/verify/marketPresentation.ts:
//
//   - a headline range ONLY when the headline is a RANGE, with the tiers it
//     came from in plain words; otherwise an honest evidence-limited note
//   - the project's own asking prices, always labelled as asking prices
//   - the closest eligible comparables on one price scale, each opening to
//     the reasons it was chosen (and how it differs)
//   - context-only tiers, visually secondary: background, not this value
//
// The legacy ComparablesCard / MarketRangeCard are never rendered here.

import React from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { marketView, TIER_KEY, type MarketView } from '@/verify/marketPresentation';

export interface MarketPositionSection {
  key: string;
  title: string;
  body: string;
  metrics?: { label: string; value: string }[];
}

const LOCALE: Record<string, string> = { ka: 'ka-GE', en: 'en-US', ru: 'ru-RU', tr: 'tr-TR', ar: 'ar', he: 'he-IL' };
function useMoney() {
  const { lang } = useLanguage();
  return React.useCallback((v: number, cur: string) => {
    let num: string;
    try {
      num = new Intl.NumberFormat(LOCALE[lang] ?? lang, { maximumFractionDigits: 0, numberingSystem: 'latn' } as Intl.NumberFormatOptions).format(v);
    } catch {
      num = String(Math.round(v));
    }
    return `${num} ${cur}/m²`;
  }, [lang]);
}
const Money: React.FC<{ v: number; cur: string; className?: string }> = ({ v, cur, className }) => {
  const money = useMoney();
  return <bdi dir="ltr" className={`tabular-nums ${className ?? ''}`}>{money(v, cur)}</bdi>;
};
const day = (iso?: string | null) => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
};

/* ───────────── the scale: every same-currency price on one line ───────────── */

const Scale: React.FC<{ view: MarketView; selected: number | null; onSelect: (i: number) => void }> = ({ view, selected, onSelect }) => {
  const { t } = useLanguage();
  const cur = view.currency;
  const range = view.headline?.state === 'RANGE' ? view.headline : null;
  const points = view.comparables.map((c, i) => ({ i, v: c.currency === cur ? c.pricePerSqm : null })).filter((p) => p.v !== null) as Array<{ i: number; v: number }>;
  const asks = view.asking.filter((a) => a.currency === cur).map((a) => a.pricePerSqm);
  const all = [...points.map((p) => p.v), ...asks, ...(range ? [range.min, range.max] : [])];
  if (all.length < 2) return null;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  if (!(hi > lo)) return null;
  const pad = (hi - lo) * 0.06;
  const at = (v: number) => `${(((v - lo + pad) / (hi - lo + 2 * pad)) * 100).toFixed(2)}%`;
  return (
    <div className="space-y-2">
      <div className="relative h-12" role="img" aria-label={t('vrx_mkt_scale_label')} dir="ltr">
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
        {range ? (
          <span
            className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full bg-[hsl(var(--gold-soft))] ring-1 ring-[hsl(var(--gold-border))]"
            style={{ left: at(range.min), width: `calc(${at(range.max)} - ${at(range.min)})` }}
          />
        ) : null}
        {range ? <span className="absolute top-1.5 bottom-1.5 w-0.5 rounded bg-[hsl(var(--gold-ink))]" style={{ left: at(range.median) }} /> : null}
        {asks.map((v, k) => (
          <span key={`a${k}`} className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-[hsl(222_47%_11%)] bg-card" style={{ left: at(v) }} />
        ))}
        {points.map((p) => (
          // A pointer shortcut only: the list below is the keyboard path.
          <span
            key={p.i}
            aria-hidden="true"
            onClick={() => onSelect(p.i)}
            className={`absolute top-1/2 block -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full ring-2 ring-background motion-safe:transition-all ${
              selected === p.i ? 'h-4 w-4 bg-[hsl(222_47%_11%)]' : 'h-2.5 w-2.5 bg-[hsl(222_47%_11%/0.55)] hover:bg-[hsl(222_47%_11%)]'
            }`}
            style={{ left: at(p.v) }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted-foreground">
        {range ? <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-[hsl(var(--gold-soft))] ring-1 ring-[hsl(var(--gold-border))]" aria-hidden="true" />{t('vrx_mkt_legend_range')}</span> : null}
        {points.length ? <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[hsl(222_47%_11%/0.55)]" aria-hidden="true" />{t('vrx_mkt_legend_comparable')}</span> : null}
        {asks.length ? <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rotate-45 border-2 border-[hsl(222_47%_11%)]" aria-hidden="true" />{t('vrx_mkt_legend_asking')}</span> : null}
      </div>
    </div>
  );
};

/* ───────────── the card ───────────── */

const MarketCard: React.FC<{ view: MarketView }> = ({ view }) => {
  const { t } = useLanguage();
  const [selected, setSelected] = React.useState<number | null>(null);
  const h = view.headline;
  const tiers = h?.state === 'RANGE' ? h.tiers.map((x) => t(TIER_KEY[x])).join(' · ') : '';

  return (
    <div className="space-y-6 rounded-2xl border border-border bg-card p-5 sm:p-6">
      {/* Headline — or the honest statement that there is none. */}
      {h?.state === 'RANGE' ? (
        <div className="space-y-3">
          <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-[hsl(var(--gold-ink))]">{t('vrx_mkt_range_title')}</p>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{t('vrx_mkt_median')}</p>
              <p className="font-display text-3xl font-semibold leading-tight"><Money v={h.median} cur={view.currency} /></p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{t('vrx_mkt_range_label')}</p>
              <p className="text-lg font-semibold">
                <bdi dir="ltr"><Money v={h.min} cur={view.currency} /> – <Money v={h.max} cur={view.currency} /></bdi>
              </p>
            </div>
          </div>
          <p className="text-sm leading-6 text-foreground/85 break-words">{t('vrx_mkt_range_from', { count: String(h.count), tiers })}</p>
          {h.outliersTrimmed > 0 ? <p className="text-xs leading-5 text-muted-foreground">{t('vrx_mkt_trimmed', { count: String(h.outliersTrimmed) })}</p> : null}
        </div>
      ) : h ? (
        <div className="flex items-start gap-3 rounded-xl bg-muted/40 p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold break-words">{t('vrx_mkt_limited_title')}</p>
            <p className="text-sm leading-6 text-muted-foreground break-words">{t('vrx_mkt_limited_body', { count: String(h.count), min: String(h.minimumSample) })}</p>
          </div>
        </div>
      ) : null}

      <Scale view={view} selected={selected} onSelect={(i) => setSelected((s) => (s === i ? null : i))} />

      {/* The project's own asks — asks, never sales. */}
      {view.asking.length ? (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold">{t('vrx_mkt_project_asking_title')}</p>
            <p className="text-xs text-muted-foreground">{t('vrx_mkt_project_asking_note')}</p>
          </div>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {view.asking.map((a, i) => (
              <li key={i} className="min-w-0 rounded-xl border border-border px-4 py-3">
                <p className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
                  <span className="rounded-full bg-[hsl(222_47%_11%)] px-2 py-0.5 font-semibold uppercase tracking-wide text-[hsl(38_92%_66%)]">{t('vrx_mkt_asking_badge')}</span>
                  <span className="break-words">{t(a.originKey)}</span>
                </p>
                <p className="mt-1.5 text-base font-semibold"><Money v={a.pricePerSqm} cur={a.currency} /></p>
                {day(a.date) || a.expired ? (
                  <p className="text-2xs text-muted-foreground">
                    {day(a.date) ? <bdi dir="ltr">{day(a.date)}</bdi> : null}
                    {a.expired ? <span>{day(a.date) ? ' · ' : ''}{t('vrx_mkt_state_expired')}</span> : null}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {view.askingRange ? (
            <p className="text-xs text-muted-foreground">
              {t('vrx_mkt_project_range', { count: String(view.askingRange.count) })}{' '}
              <bdi dir="ltr"><Money v={view.askingRange.min} cur={view.askingRange.currency} /> – <Money v={view.askingRange.max} cur={view.askingRange.currency} /></bdi>
            </p>
          ) : null}
        </div>
      ) : null}

      {/* The closest eligible comparables, interactive. */}
      {view.comparables.length ? (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold">{t('vrx_mkt_comparables_title')}</p>
            <p className="text-xs text-muted-foreground">{t('vrx_mkt_comparables_hint')}</p>
          </div>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {view.comparables.map((c, i) => {
              const open = selected === i;
              const facts = [
                c.districtKey ? t(c.districtKey) : null,
                c.area ? `${Math.round(c.area)} m²` : null,
                c.rooms ? t('vrx_mkt_rooms', { count: String(c.rooms) }) : null,
              ].filter(Boolean).join(' · ');
              return (
                <li key={i}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setSelected(open ? null : i)}
                    className={`flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-start transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--gold-ink))] motion-reduce:transition-none ${open ? 'bg-muted/40' : ''}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium break-words">{t(TIER_KEY[c.tier])}</span>
                      {facts ? <span className="block text-xs text-muted-foreground break-words">{facts}</span> : null}
                    </span>
                    <span className="shrink-0 text-sm font-semibold"><Money v={c.pricePerSqm} cur={c.currency} /></span>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground motion-safe:transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button>
                  {open ? (
                    <div className="space-y-2 px-4 pb-3 text-xs leading-5">
                      {c.fits.length ? (
                        <p><span className="font-semibold">{t('vrx_mkt_why')}: </span>{c.fits.map((k) => t(k)).join(' · ')}</p>
                      ) : null}
                      {c.differs.length ? (
                        <p className="text-muted-foreground"><span className="font-semibold text-foreground">{t('vrx_mkt_differs')}: </span>{c.differs.map((k) => t(k)).join(' · ')}</p>
                      ) : null}
                      {c.expired ? <p className="text-muted-foreground">{t('vrx_mkt_state_expired')}</p> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* Background, not this property's value. */}
      {view.context.length ? (
        <div className="space-y-2 border-t border-dashed border-border pt-4 opacity-90">
          <p className="text-xs font-medium text-muted-foreground">{t('vrx_mkt_context_title')}</p>
          <ul className="flex flex-wrap gap-2">
            {view.context.map((c) => (
              <li key={c.tier} className="rounded-full border border-border px-3 py-1 text-2xs text-muted-foreground">
                {t(TIER_KEY[c.tier])} · <Money v={c.median} cur={view.currency} /> · {t('vrx_mkt_listings', { count: String(c.count) })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-2xs leading-relaxed text-muted-foreground">{t('vrx_mkt_asking_note')}</p>
    </div>
  );
};

export const MarketPosition: React.FC<{
  sections: MarketPositionSection[];
  /** synthesis.market — MarketIntelligence. An older shape yields prose only. */
  market?: unknown;
  renderSection: (s: MarketPositionSection) => React.ReactNode;
}> = ({ sections, market, renderSection }) => {
  const view = React.useMemo(() => marketView(market), [market]);
  if (!sections.length && !view) return null;
  return (
    <div className="space-y-8">
      {sections.map((s) => <React.Fragment key={s.key}>{renderSection(s)}</React.Fragment>)}
      {view ? <MarketCard view={view} /> : null}
    </div>
  );
};

/** Whether the market chapter has anything to show beyond prose. */
export const hasMarketView = (market: unknown): boolean => !!marketView(market);

// HOMATCH FOR EXPATS — what a budget reaches.
//
// THE SCREEN THAT COULD MOST EASILY HAVE BEEN A LIE
//
// "What can $150,000 buy in Tbilisi?" wants to answer with apartments.
// Homatch's production inventory is one property row, so answering with
// apartments would mean inventing them, and §84 puts invented property
// inventory on the list of things this product must never do.
//
// So it answers the question it can actually answer, and says so in the
// heading: at the price per square metre Homatch has OBSERVED in a
// district, what floor area does this budget correspond to? That is a real
// answer built on real evidence — 35 comparables in Vake, 6 in Krtsanisi,
// read on dates the card shows — and it is the number a foreign buyer
// actually needs before they start looking.
//
// EVERY DISTRICT WE CANNOT SPEAK ABOUT IS SHOWN
//
// Six of the eight are coverage gaps today. They are on the screen, below
// the two that are not, saying that Homatch has not read that market yet.
// Dropping them would let a reader conclude we looked at Saburtalo and
// found nothing worth reporting.

import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Layers, ShieldCheck, TrendingUp } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import {
  affordableArea,
  areaBand,
  coverage,
  rankByArea,
  readingsForCity,
  type Affordability,
  type LocatedSnapshot,
  type MarketReading,
} from '@/expats/marketContext';
import { cityName, findCity } from '@/expats/geography';

const PRESETS = [50_000, 100_000, 150_000, 300_000];

export function WhatCanIBuy({
  cityKey,
  snapshots,
}: {
  cityKey: string;
  snapshots: readonly LocatedSnapshot[];
}) {
  const { t, lang } = useLanguage();
  const [budget, setBudget] = React.useState(150_000);
  const [draft, setDraft] = React.useState('150000');

  const city = findCity(cityKey);
  const readings = React.useMemo(() => readingsForCity(cityKey, snapshots), [cityKey, snapshots]);
  // Every current snapshot in production is priced in USD, and there is no
  // FX rate on this surface, so the budget is stated in the currency the
  // evidence is in. Converting without a sourced rate would be the same
  // invention this whole screen exists to avoid.
  const currency = readings.find((r) => r.pricePerSqm)?.pricePerSqm?.currency ?? 'USD';
  const ranked = React.useMemo(
    () => rankByArea(budget, currency, readings),
    [budget, currency, readings],
  );
  const gaps = readings.filter((r) => r.availability !== 'ESTABLISHED');
  const cover = coverage(readings);

  const money = React.useCallback(
    (v: number) => {
      try {
        return new Intl.NumberFormat(lang, {
          style: 'currency',
          currency,
          maximumFractionDigits: 0,
        }).format(v);
      } catch {
        return `${Math.round(v)} ${currency}`;
      }
    },
    [lang, currency],
  );

  const commit = () => {
    const v = Number.parseFloat(draft.replace(/[^\d.]/g, ''));
    if (Number.isFinite(v) && v > 0) setBudget(v);
    else setDraft(String(budget));
  };

  return (
    <section
      data-expat-what-can-i-buy
      className="hm-workspace hm-workspace-canvas rounded-2xl border border-border p-5 sm:p-8"
    >
      <header className="mb-6">
        <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--gold-ink))]">
          {t('expat_wcib_eyebrow')}
        </p>
        <h2 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
          {t('expat_wcib_title', { city: city ? cityName(city, lang) : cityKey })}
        </h2>
        <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
          {t('expat_wcib_body')}
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Input
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          aria-label={t('expat_wcib_budget_label')}
          data-expat-budget-input
          className="h-10 w-40"
        />
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              setBudget(p);
              setDraft(String(p));
            }}
            aria-pressed={budget === p}
            className={cn(
              'rounded-full border px-3 py-1.5 text-2xs transition-colors',
              budget === p
                ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {money(p)}
          </button>
        ))}
      </div>

      <p className="mb-4 text-2xs text-muted-foreground" data-expat-wcib-coverage>
        {t('expat_wcib_coverage', { covered: cover.covered, total: cover.total })}
      </p>

      {ranked.length === 0 ? (
        <p className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          {t('expat_wcib_no_readings')}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {ranked.map((a) => (
            <AffordabilityCard key={a.reading.district.key} affordability={a} money={money} />
          ))}
        </ul>
      )}

      {gaps.length > 0 ? (
        <div className="mt-6 rounded-xl border border-border bg-muted/30 p-4" data-expat-wcib-gaps>
          <p className="text-sm font-medium text-foreground">{t('expat_wcib_gap_title')}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {t('expat_wcib_gap_body')}
          </p>
          <p className="mt-2 text-2xs text-muted-foreground">
            {gaps.map((g) => g.district.nameEn).join(' · ')}
          </p>
        </div>
      ) : null}

      <p className="mt-5 text-2xs leading-relaxed text-muted-foreground">
        {t('expat_wcib_excludes')}
      </p>
    </section>
  );
}

function AffordabilityCard({
  affordability,
  money,
}: {
  affordability: Affordability;
  money: (v: number) => string;
}) {
  const { t, lang } = useLanguage();
  const { reading, sqm, pricePerSqm } = affordability;
  if (!sqm || !pricePerSqm) return null;

  const band = areaBand(sqm.typical);
  const observed = reading.observedAt
    ? new Date(reading.observedAt).toISOString().slice(0, 10)
    : null;

  const area = (v: number) => `${Math.round(v)} m²`;

  return (
    <li
      data-expat-district-card={reading.district.key}
      className="rounded-xl border border-border bg-[hsl(var(--card))] p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold text-foreground">
            {reading.district.nameEn}
          </h3>
          <p className="text-2xs text-muted-foreground">{reading.district.nameKa}</p>
        </div>
        {band ? (
          <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-2xs text-muted-foreground">
            {t(`expat_area_band_${band.toLowerCase()}`)}
          </span>
        ) : null}
      </div>

      <p className="mt-4 font-display text-2xl font-semibold text-foreground">
        {area(sqm.low)} – {area(sqm.high)}
      </p>
      <p className="mt-1 text-2xs text-muted-foreground">
        {t('expat_wcib_typical', { area: area(sqm.typical) })}
      </p>

      <dl className="mt-4 space-y-1 border-t border-border pt-3 text-2xs text-muted-foreground">
        <div className="flex justify-between gap-3">
          <dt>{t('expat_wcib_observed_psm')}</dt>
          <dd className="tabular-nums text-foreground">
            {money(pricePerSqm.low)} – {money(pricePerSqm.high)}
          </dd>
        </div>
        {/* Two labelled numbers rather than a sentence. `t()` substitutes
            and does not inflect, so "1 sources" is what a sentence gives
            you, and teaching six languages to pluralise for one line is
            the wrong trade when a column of figures reads better. */}
        <div className="flex justify-between gap-3">
          <dt>{t('expat_wcib_comparables')}</dt>
          <dd className="tabular-nums text-foreground">{reading.sampleCount}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>{t('expat_wcib_sources')}</dt>
          <dd className="tabular-nums text-foreground">{reading.sourceCount}</dd>
        </div>
        {observed ? (
          <div className="flex justify-between gap-3">
            <dt>{t('expat_wcib_read_on')}</dt>
            <dd className="tabular-nums">{observed}</dd>
          </div>
        ) : null}
      </dl>

      {/* The basis, always. A project reading must never be mistaken for a
          district average — this line is the difference between evidence
          and a claim we cannot support. */}
      <p className="mt-3 flex items-start gap-1.5 text-2xs text-muted-foreground">
        <Layers className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        {reading.basis === 'PROJECT_IN_DISTRICT'
          ? t('expat_wcib_basis_project', { project: reading.scopeKey ?? '' })
          : t('expat_wcib_basis_district')}
      </p>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
        <Link
          to="/verify"
          data-expat-handoff="VERIFY"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-2xs text-foreground transition-colors hover:border-[hsl(var(--gold-border))]"
        >
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          {t('expat_handoff_verify')}
        </Link>
        <Link
          to="/investment"
          data-expat-handoff="INVESTMENT"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-2xs text-foreground transition-colors hover:border-[hsl(var(--gold-border))]"
        >
          <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
          {t('expat_handoff_investment')}
        </Link>
        <Link
          to="/mortgage"
          data-expat-handoff="MORTGAGE"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-2xs text-foreground transition-colors hover:border-[hsl(var(--gold-border))]"
        >
          <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
          {t('expat_handoff_mortgage')}
        </Link>
      </div>
    </li>
  );
}

export type { MarketReading };

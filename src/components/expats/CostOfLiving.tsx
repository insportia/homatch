// HOMATCH FOR EXPATS — what a month here would cost.
//
// The arithmetic is entirely in src/expats/costOfLiving.ts and runs in the
// browser. Nothing on the path from moving a slider to seeing a total
// touches the network, which is the same guarantee Investment Intelligence
// makes and for the same reason: a number that takes a round trip is a
// number somebody stops trusting when it takes two seconds.
//
// THE SCREEN'S MAIN JOB IS THE GAPS
//
// Two of seventeen categories have an observed price today. A budget tool
// in that state can do one of two things: quietly show a small total, or
// say plainly how much of the month it cannot yet price. The second is the
// only honest option and it turns out to be the more useful one — a reader
// who knows we have priced transport and internet and nothing else knows
// exactly what to do with the number.
//
// So the missing categories are not hidden, not greyed out at zero, and
// not sorted to the bottom. They sit in place, empty, with a control to
// type your own figure — which is the action that actually helps.

import React from 'react';
import { Info, Pencil, RotateCcw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  COST_CATEGORIES,
  annualise,
  housingShare,
  monthlyBudget,
  pricedShare,
  spreadRatio,
  totalIsMeaningful,
  type BudgetLine,
  type CostCategory,
  type MonthlyBudget,
} from '@/expats/costOfLiving';
import type { ExpatProfile, Household } from '@/expats/types';
import type { CostObservationRow } from '@/services/expats';
import { byCategory } from '@/services/expats';
import { SourceLine } from './Provenance';

const HOUSEHOLDS: Household[] = ['ALONE', 'COUPLE', 'FAMILY'];

function useMoneyFormat(currency: string) {
  const { lang } = useLanguage();
  return React.useCallback(
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
}

export function CostOfLiving({
  city,
  observations,
  profile,
}: {
  city: string;
  observations: readonly CostObservationRow[];
  profile: ExpatProfile;
}) {
  const { t } = useLanguage();
  const [household, setHousehold] = React.useState<Household>(profile.household ?? 'ALONE');
  const [overrides, setOverrides] = React.useState<Partial<Record<CostCategory, number>>>({});
  const [excluded, setExcluded] = React.useState<CostCategory[]>([]);

  const currency = observations[0]?.money.currency ?? 'GEL';
  const money = useMoneyFormat(currency);

  const budget = React.useMemo<MonthlyBudget>(
    () =>
      monthlyBudget({
        profile: { ...profile, household },
        observations: byCategory(observations),
        overrides,
        excluded,
        currency,
      }),
    [profile, household, observations, overrides, excluded, currency],
  );

  const sourceFor = React.useCallback(
    (category: CostCategory) => observations.find((o) => o.category === category)?.source ?? null,
    [observations],
  );

  const spread = spreadRatio(budget);
  const housing = housingShare(budget);
  const year = annualise(budget);
  const priced = budget.lines.length - budget.missing.length;
  /*
   * Whether the sum may hold the headline at all.
   *
   * Production had two of seventeen categories priced and this panel led
   * with "73 – 120 GEL" for a month in Tbilisi. Every caveat was on the
   * screen and none of them competes with a number that size. Below the
   * threshold the coverage becomes the headline and the sum is demoted to
   * what it is: the cost of the lines we can price.
   */
  const meaningful = totalIsMeaningful(budget);
  const share = Math.round(pricedShare(budget) * 100);

  return (
    <section
      data-expat-cost-of-living
      className="hm-workspace hm-workspace-canvas rounded-2xl border border-border p-5 sm:p-8"
    >
      <header className="mb-6">
        <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--gold-ink))]">
          {t('expat_col_eyebrow')}
        </p>
        <h2 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
          {t('expat_col_title', { city })}
        </h2>
        <p className="mt-3 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">
          {t('expat_col_body')}
        </p>
      </header>

      {/* Household. Three options, so a segmented control rather than a
          select: a select hides two of three choices behind a tap. */}
      <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label={t('expat_col_household_label')}>
        {HOUSEHOLDS.map((h) => (
          <button
            key={h}
            type="button"
            data-expat-household={h}
            aria-pressed={household === h}
            onClick={() => setHousehold(h)}
            className={cn(
              'rounded-full border px-4 py-2 text-sm transition-colors',
              household === h
                ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`expat_household_${h.toLowerCase()}`)}
          </button>
        ))}
      </div>

      {/* The answer, before the detail — but only when it IS the answer. */}
      <div
        data-expat-budget-panel={meaningful ? 'total' : 'partial'}
        className="mb-6 rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]/40 p-5"
      >
        {meaningful ? (
          <>
            <p className="text-2xs uppercase tracking-[0.14em] text-muted-foreground">
              {t('expat_col_total_label')}
            </p>
            <p
              data-expat-budget-total
              className="mt-1 font-display text-3xl font-semibold text-foreground sm:text-4xl"
            >
              {budget.low === budget.high
                ? money(budget.low)
                : `${money(budget.low)} – ${money(budget.high)}`}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('expat_col_total_year', { low: money(year.low), high: money(year.high) })}
            </p>
          </>
        ) : (
          <>
            {/* The coverage IS the headline. The sum is below it, in body
                size, described as a subtotal rather than as a month. */}
            <p className="text-2xs uppercase tracking-[0.14em] text-muted-foreground">
              {t('expat_col_partial_label')}
            </p>
            {/* text-xl at the base width, not text-2xl. This headline is a
                sentence rather than a number, and at 320px in Georgian
                კატეგორიიდან alone needs more than the column has at 24px —
                so the one string on this panel that is prose is the one
                that has to start smaller. */}
            <p
              data-expat-budget-partial
              className="mt-1 font-display text-xl font-semibold text-foreground sm:text-3xl"
            >
              {t('expat_col_partial_headline', { priced, total: budget.lines.length, percent: share })}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t('expat_col_partial_body')}
            </p>
            <p className="mt-3 text-sm text-foreground">
              {t('expat_col_partial_subtotal', {
                amount:
                  budget.low === budget.high
                    ? money(budget.low)
                    : `${money(budget.low)} – ${money(budget.high)}`,
              })}
            </p>
          </>
        )}

        {meaningful && spread >= 1.8 ? (
          <p className="mt-3 flex items-start gap-2 text-2xs text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            {t('expat_col_wide_spread')}
          </p>
        ) : null}

        {meaningful && housing !== null ? (
          <p className="mt-2 text-2xs text-muted-foreground">
            {t('expat_col_housing_share', { percent: Math.round(housing * 100) })}
          </p>
        ) : null}
      </div>

      {/* The honesty panel. Deliberately above the table, not below it. */}
      {budget.missing.length > 0 ? (
        <div
          data-expat-col-gaps
          className="mb-6 rounded-xl border border-border bg-muted/30 p-4"
        >
          <p className="text-sm font-medium text-foreground">
            {t('expat_col_gap_title', { priced, total: budget.lines.length })}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {t('expat_col_gap_body')}
          </p>
          <p className="mt-2 text-2xs text-muted-foreground">
            {budget.missing.map((c) => t(`expat_cost_cat_${c.toLowerCase()}`)).join(' · ')}
          </p>
        </div>
      ) : null}

      <ul className="divide-y divide-border rounded-xl border border-border">
        {budget.lines.map((line) => (
          <BudgetRow
            key={line.category}
            line={line}
            money={money}
            source={sourceFor(line.category)}
            note={observations.find((o) => o.category === line.category)?.notes ?? null}
            onOverride={(v) =>
              setOverrides((o) => {
                const next = { ...o };
                if (v === null) delete next[line.category];
                else next[line.category] = v;
                return next;
              })
            }
            onToggle={() =>
              setExcluded((e) =>
                e.includes(line.category) ? e.filter((c) => c !== line.category) : [...e, line.category],
              )
            }
          />
        ))}
      </ul>

      {excluded.length > 0 ? (
        <button
          type="button"
          onClick={() => setExcluded([])}
          className="mt-4 inline-flex items-center gap-1.5 text-2xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" aria-hidden="true" />
          {t('expat_col_restore_removed', { n: excluded.length })}
        </button>
      ) : null}

      {budget.oldestObservedAt ? (
        <p className="mt-5 text-2xs text-muted-foreground">
          {t('expat_col_oldest_observation', {
            date: new Date(budget.oldestObservedAt).toISOString().slice(0, 10),
          })}
        </p>
      ) : null}
    </section>
  );
}

function BudgetRow({
  line,
  money,
  source,
  note,
  onOverride,
  onToggle,
}: {
  line: BudgetLine;
  money: (v: number) => string;
  source: Parameters<typeof SourceLine>[0]['sources'][number] | null;
  note: string | null;
  onOverride: (v: number | null) => void;
  onToggle: () => void;
}) {
  const { t } = useLanguage();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');

  const commit = () => {
    const v = Number.parseFloat(draft.replace(',', '.'));
    onOverride(Number.isFinite(v) && v >= 0 ? v : null);
    setEditing(false);
    setDraft('');
  };

  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3" data-expat-cost-row={line.category}>
      {/* A real minimum, not `min-w-0`. `flex-1` alone resolves to
          `flex: 1 1 0%`, so this cell's hypothetical main size is zero, the
          row never exceeds the line and `flex-wrap` can therefore never
          fire — the price-and-buttons cluster beside it is `shrink-0` and
          simply crushes the prose, at 390px to thirty pixels and four
          characters a line. Giving the cell a floor makes the row wrap
          instead, which is what the wrap was there for. */}
      <div className="min-w-[12rem] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-foreground">
            {t(`expat_cost_cat_${line.category.toLowerCase()}`)}
          </span>
          <BasisMark basis={line.basis} scale={line.scale} />
        </div>

        {note && line.basis !== 'USER' ? (
          <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{note}</p>
        ) : null}

        {source && line.basis !== 'USER' && line.basis !== 'NO_DATA' ? (
          <SourceLine sources={[source]} factClass="PRICE" className="mt-1.5" />
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {editing ? (
          <>
            <Input
              autoFocus
              inputMode="decimal"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setEditing(false);
              }}
              className="h-8 w-24 text-end"
              aria-label={t('expat_col_your_figure')}
            />
            <Button size="sm" variant="secondary" className="h-8" onClick={commit}>
              {t('expat_col_save')}
            </Button>
          </>
        ) : (
          <>
            <span className="min-w-[7rem] text-end text-sm tabular-nums text-foreground">
              {line.low === null || line.high === null ? (
                <span className="text-muted-foreground">{t('expat_col_no_price')}</span>
              ) : line.low === line.high ? (
                money(line.low)
              ) : (
                `${money(line.low)} – ${money(line.high)}`
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                setDraft(line.low !== null ? String(Math.round(line.low)) : '');
                setEditing(true);
              }}
              aria-label={t('expat_col_edit_aria')}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onToggle}
              aria-label={t('expat_col_remove_aria')}
              className="rounded-md px-1.5 py-1 text-2xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('expat_col_remove')}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * Where this line's number came from.
 *
 * USER is the one that always shows: §25 requires a figure the person typed
 * to be visibly theirs. OBSERVED shows nothing, because "this came from our
 * data" is the default and a mark on every row is not a mark.
 */
function BasisMark({ basis, scale }: { basis: BudgetLine['basis']; scale: number | null }) {
  const { t } = useLanguage();
  if (basis === 'OBSERVED') return null;
  if (basis === 'NO_DATA') return null;

  return (
    <span
      data-expat-basis={basis}
      className={cn(
        'rounded-full border px-2 py-0.5 text-2xs',
        basis === 'USER'
          ? 'border-[hsl(var(--gold-border))] text-[hsl(var(--gold-ink))]'
          : 'border-border text-muted-foreground',
      )}
    >
      {basis === 'USER'
        ? t('expat_col_basis_user')
        : t('expat_col_basis_scaled', { factor: (scale ?? 1).toFixed(1) })}
    </span>
  );
}

export { COST_CATEGORIES };

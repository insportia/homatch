// HOMATCH HOME FINANCING — the pieces the glossary index and the term pages
// share: the category glyphs, the navy hero band and the live NBG limits
// table. Light customer canvas with a deep navy frame and a gold hairline,
// the same family as /mortgage itself.

import React, { useEffect, useState } from 'react';
import { Calculator, ExternalLink, Percent, Receipt, RefreshCw, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { getActiveLtvRules, getActivePtiRules } from '@/services/mortgageApi';
import type { LtvLimitRuleData, MortgageRule, PtiLimitRuleData } from '@/mortgage/types';
import type { TermCategory } from '@/mortgage/termPages';

export const CATEGORY_ICON: Record<TermCategory, LucideIcon> = {
  rates: Percent,
  basics: Calculator,
  limits: ShieldCheck,
  costs: Receipt,
  later: RefreshCw,
};

export function CategoryGlyph({ category, className }: { category: TermCategory; className?: string }) {
  const Icon = CATEGORY_ICON[category];
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[hsl(38_92%_56%/0.35)] bg-[hsl(38_92%_56%/0.12)] text-[hsl(38_92%_60%)]',
        className,
      )}
    >
      <Icon className="h-5 w-5" />
    </span>
  );
}

/** The navy band at the top of both glossary pages. No uppercase eyebrows: Georgian has no case. */
export function TermHero({ eyebrow, title, lead, children }: { eyebrow: React.ReactNode; title: string; lead?: string; children?: React.ReactNode }) {
  return (
    <header className="relative overflow-hidden rounded-3xl bg-[#0C1119] px-5 py-7 text-white shadow-hover sm:px-10 sm:py-11">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -end-24 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(circle,hsl(38_92%_56%/0.22),transparent_65%)]"
      />
      <div className="relative">
        <div className="text-sm font-semibold text-[hsl(38_92%_62%)]">{eyebrow}</div>
        <h1 className="mt-2 break-words font-display text-[1.75rem] font-bold leading-tight text-white sm:text-[2.5rem]">{title}</h1>
        {lead ? <p className="mt-3 max-w-[60ch] text-base leading-relaxed text-white/85 sm:text-lg">{lead}</p> : null}
        <span className="mt-6 block h-[3px] w-16 rounded-full bg-[hsl(38_92%_56%)]" aria-hidden="true" />
        {children}
      </div>
    </header>
  );
}

/**
 * The limits as the knowledge base holds them today, with their source and
 * the date somebody last checked them. The prose on the page states the same
 * numbers; this table is what proves them, and it updates when the rules do.
 */
export function LiveNbgLimits() {
  const { t, lang } = useLanguage();
  const [rules, setRules] = useState<{ pti: MortgageRule<PtiLimitRuleData>[]; ltv: MortgageRule<LtvLimitRuleData>[] } | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([getActivePtiRules(), getActiveLtvRules()])
      .then(([pti, ltv]) => { if (live) setRules({ pti, ltv }); })
      .catch(() => { if (live) setRules({ pti: [], ltv: [] }); });
    return () => { live = false; };
  }, []);

  if (!rules || (rules.pti.length === 0 && rules.ltv.length === 0)) return null;

  const pct = (v: number) => `${v.toLocaleString(lang)}%`;
  const classes: Array<'LOCAL' | 'FOREIGN'> = ['LOCAL', 'FOREIGN'];
  const source = rules.pti[0] ?? rules.ltv[0];
  const checked = new Date(`${source.lastVerifiedAt}T12:00:00Z`).toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <section aria-labelledby="nbg-live-title" className="hm-customer-panel p-5 sm:p-7">
      <h2 id="nbg-live-title" className="font-display text-xl font-semibold text-foreground">{t('mortgage_tp_live_title')}</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {classes.map((cls) => {
          const tiers = rules.pti
            .filter((r) => r.data.currencyClass === cls)
            .sort((a, b) => (a.data.incomeTierMaxMonthlyNet ?? Infinity) - (b.data.incomeTierMaxMonthlyNet ?? Infinity));
          const ltv = rules.ltv.find((r) => r.data.currencyClass === cls && (!r.data.propertyUse || r.data.propertyUse === 'RESIDENTIAL'));
          return (
            <div key={cls} className="rounded-2xl border border-border bg-background p-4">
              <p className="text-base font-semibold text-foreground">{t(cls === 'LOCAL' ? 'mortgage_tp_live_gel' : 'mortgage_tp_live_fx')}</p>
              <dl className="mt-3 grid gap-2 text-sm">
                {tiers.map((r, i) => {
                  const below = r.data.incomeTierMaxMonthlyNet;
                  const above = i > 0 ? tiers[i - 1].data.incomeTierMaxMonthlyNet : null;
                  const label = below !== null
                    ? t('mortgage_tp_live_income_below', { amount: below.toLocaleString(lang) })
                    : above !== null
                      ? t('mortgage_tp_live_income_above', { amount: above.toLocaleString(lang) })
                      : t('mortgage_tp_live_any_income');
                  return (
                    <div key={r.id} className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
                      <dt className="text-muted-foreground">{`PTI · ${label}`}</dt>
                      <dd className="font-display text-lg font-semibold tabular-nums text-foreground">{pct(r.data.maxPtiPercent)}</dd>
                    </div>
                  );
                })}
                {ltv ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">LTV</dt>
                    <dd className="font-display text-lg font-semibold tabular-nums text-foreground">{pct(ltv.data.maxLtvPercent)}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          );
        })}
      </div>
      <p className="mt-4 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        {t('mortgage_tp_source', {
          source: /National Bank of Georgia/i.test(source.sourceAuthority) ? t('mortgage_rd_nbg') : source.sourceAuthority,
          date: checked,
        })}
        <a href={source.officialSourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 font-medium text-[hsl(var(--gold-ink))] underline underline-offset-4">
          {t('mortgage_rd_source_link')} <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </p>
    </section>
  );
}

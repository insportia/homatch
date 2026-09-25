// HOMATCH — what each language actually reached.
//
// WHY THERE IS NO PERCENTAGE ON THIS PANEL
//
// A "source coverage: 73%" figure needs a denominator of all the relevant
// sources in the world. Nobody can produce one, and a number nobody can
// defend is worse on a customer's screen than an absence — because the
// customer cannot tell which kind it is, and will make decisions on it.
//
// So five counts, each of which a query can defend:
//
//   attempted   the plan intended to read this many
//   reached     this many answered with content
//   refused     this many said no: a wall, a block, a removal
//   found       raw items read
//   new         survived the filter AND were not already held
//
// attempted − reached − refused is sources still in flight, which is a real
// third state rather than a rounding error, and the panel simply does not
// claim it either way.
//
// THE EMPTY STATE IS NOT ZEROS
//
// A language that has never been searched and a language that was searched
// and found nothing are completely different facts, and rendering both as a
// row of noughts merges them. No rows means no discovery has run, and the
// panel says that in words instead.

import { Globe } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { type CampaignSearchLanguage, isCampaignSearchLanguage } from '@/campaign/searchLanguages';
import { languageNames } from '@/components/campaign/SearchLanguagePicker';
import { useLanguage } from '@/contexts/LanguageContext';
import { getCampaignLanguageCoverage, type LanguageCoverageRow } from '@/services/api';

export function LanguageCoveragePanel({
  propertyId,
  /** The campaign's resolved set, so a language with no rows is still named. */
  resolvedLanguages = [],
  className,
}: {
  propertyId: string;
  resolvedLanguages?: readonly string[];
  className?: string;
}) {
  const { t } = useLanguage();
  const [rows, setRows] = useState<LanguageCoverageRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    getCampaignLanguageCoverage(propertyId)
      .then((next) => { if (alive) setRows(next); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [propertyId]);

  if (rows === null) return null;

  const selected = resolvedLanguages.filter(isCampaignSearchLanguage) as CampaignSearchLanguage[];

  /*
   * NOTHING HAS RUN YET.
   *
   * Said in words rather than as six rows of zeros. External discovery is
   * gated off in production today, so this is the honest and current state
   * for every campaign — and a table of noughts would read as "we looked
   * everywhere and found nothing", which is the opposite of true.
   */
  if (rows.length === 0) {
    if (selected.length === 0) return null;
    return (
      <div className={className}>
        <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
          <Globe className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 text-xs">
            <div className="font-medium text-foreground">{t('campaign_langs_title')}</div>
            <p className="mt-0.5 text-muted-foreground">{languageNames(selected)}</p>
            <p className="mt-1 text-muted-foreground">{t('campaign_langs_none_reached')}</p>
          </div>
        </div>
      </div>
    );
  }

  const ordered = [...rows].sort((a, b) => b.signalsUnique - a.signalsUnique || a.language.localeCompare(b.language));

  return (
    <div className={className}>
      <div className="rounded-lg border border-border/60 bg-card/40 p-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-medium text-foreground">{t('campaign_langs_coverage_title')}</h3>
        </div>

        {/* Wide content scrolls inside its own box; the page never does. */}
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[30rem] text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="py-1 pr-3 font-normal">{t('campaign_langs_title')}</th>
                <th scope="col" className="py-1 pr-3 font-normal">{t('campaign_langs_attempted')}</th>
                <th scope="col" className="py-1 pr-3 font-normal">{t('campaign_langs_reached')}</th>
                <th scope="col" className="py-1 pr-3 font-normal">{t('campaign_langs_blocked')}</th>
                <th scope="col" className="py-1 pr-3 font-normal">{t('campaign_langs_found')}</th>
                <th scope="col" className="py-1 pr-3 font-normal">{t('campaign_langs_unique')}</th>
                <th scope="col" className="py-1 font-normal">{t('campaign_langs_duplicate')}</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((row) => (
                <tr key={row.language} className="border-t border-border/40">
                  <th scope="row" className="py-1.5 pr-3 text-left font-medium text-foreground">
                    {isCampaignSearchLanguage(row.language)
                      ? languageNames([row.language])
                      : row.language.toUpperCase()}
                  </th>
                  <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{row.attempted}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{row.reached}</td>
                  {/* Refusals are named, not hidden: a language that reached
                      nothing is the single most important thing on the page. */}
                  <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{row.blocked}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{row.signalsFound}</td>
                  <td className="py-1.5 pr-3 tabular-nums font-medium text-foreground">{row.signalsUnique}</td>
                  <td className="py-1.5 tabular-nums text-muted-foreground">{row.signalsDuplicate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {ordered.some((row) => row.attempted > 0 && row.reached === 0) && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
            {t('campaign_langs_none_reached')}
          </p>
        )}
      </div>
    </div>
  );
}

export default LanguageCoveragePanel;

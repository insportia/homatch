// HOMATCH — the one place a discovery campaign is configured before it runs.
//
// WHY THIS IS A COMPONENT AND NOT TWO COPIES
//
// A Find Clients search can be launched from the property page and from the
// matches page, and both opened the same budget dialog by hand. Adding search
// languages to one of them and not the other would produce a campaign whose
// language set depends on which button the customer happened to press —
// which is exactly the kind of difference nobody notices until the bill.
//
// So the launch surface is one component: what it costs and what it searches
// in are decided together, because they are the same decision. Choosing four
// languages and then choosing a budget without the two knowing about each
// other is how a customer authorises ten credits for work that needed thirty.

import React, { useEffect, useState } from 'react';
import { type CampaignSearchLanguage, isCampaignSearchLanguage } from '@/campaign/searchLanguages';

/** Find Buyers' six search languages, in the order the chips show them. */
const FIND_BUYERS_LANGUAGES: CampaignSearchLanguage[] = ['ka', 'ru', 'en', 'ar', 'he', 'tr'];
import { SearchBudgetOffer } from '@/components/billing/SearchBudgetOffer';
import { ResearchBudgetSelector } from '@/components/findBuyers/ResearchBudgetSelector';
import {
  DEFAULT_SEARCH_LANGUAGES,
  SearchLanguagePicker,
  type SearchLanguageValue,
} from '@/components/campaign/SearchLanguagePicker';
import { Separator } from '@/components/ui/separator';
import { useLanguage } from '@/contexts/LanguageContext';
import { brokerDiscoveryPricing, type BrokerDiscoveryPricing } from '@/services/brokers';
import { getFindBuyersConfig, type FindBuyersConfig } from '@/services/findBuyers';
import { CalendarCheck2, Radar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GOLD_FILL, NAVY_BAND } from '@/components/findBuyers/brand';
import {
  type CampaignLanguageState,
  type CampaignSearchLanguageChoice,
  getCampaignLanguageState,
} from '@/services/api';

export function CampaignLaunchPanel({
  propertyId,
  productCode,
  onRun,
  running = false,
  counterpart = null,
}: {
  propertyId: string;
  productCode: string;
  /** BUYER for a sale, TENANT for a rental: decides the words, never the price. */
  counterpart?: 'BUYER' | 'TENANT' | null;
  onRun: (
    authorizedMaxCredits: number | null,
    languages: CampaignSearchLanguageChoice,
    discoverBrokers?: boolean,
  ) => void;
  running?: boolean;
}) {
  const { t } = useLanguage();
  const [state, setState] = useState<CampaignLanguageState | null>(null);
  const [languages, setLanguages] = useState<SearchLanguageValue>(DEFAULT_SEARCH_LANGUAGES);
  /* OPTIONAL broker/agency discovery. Strictly opt-in, priced from the
     catalogue and shown before launch — never a silent extra spend. */
  const [discoverBrokers, setDiscoverBrokers] = useState(false);
  const [brokerPricing, setBrokerPricing] = useState<BrokerDiscoveryPricing | null>(null);
  /* FIND BUYERS / FIND TENANTS searches all six languages by default, and has
     a $10 minimum expressed in wallet credits (server-authoritative). The
     owner may narrow it to the audiences they want — then every paid search
     and the community discovery run only in those languages. */
  const findBuyers = productCode === 'FIND_CLIENTS';
  const [fbLanguages, setFbLanguages] = useState<CampaignSearchLanguage[]>([...FIND_BUYERS_LANGUAGES]);
  const toggleFbLanguage = (l: CampaignSearchLanguage) => setFbLanguages((cur) => (
    cur.includes(l) ? (cur.length > 1 ? cur.filter((x) => x !== l) : cur) : FIND_BUYERS_LANGUAGES.filter((x) => x === l || cur.includes(x))
  ));
  const fbAll = fbLanguages.length === FIND_BUYERS_LANGUAGES.length;
  const [fbConfig, setFbConfig] = useState<FindBuyersConfig | null>(null);
  useEffect(() => {
    if (!findBuyers) return;
    let alive = true;
    getFindBuyersConfig().then((c) => { if (alive) setFbConfig(c); }).catch(() => {});
    return () => { alive = false; };
  }, [findBuyers]);
  void counterpart; // the approved Research copy reads the same for buyers and tenants
  useEffect(() => {
    let alive = true;
    brokerDiscoveryPricing().then((p) => { if (alive) setBrokerPricing(p); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  /*
   * A RESUME OPENS ON THE CUSTOMER'S OWN CHOICE.
   *
   * Not on the recommendation. A campaign that was set to Hebrew and stopped
   * must reopen showing Hebrew, or the customer re-authorises a set they
   * never chose simply by pressing the same button again.
   */
  useEffect(() => {
    let alive = true;
    getCampaignLanguageState(propertyId)
      .then((next) => {
        if (!alive) return;
        setState(next);
        if (next.mode === 'EXPLICIT' && next.selected.length) {
          const chosen = FIND_BUYERS_LANGUAGES.filter((l) => next.selected.includes(l));
          if (chosen.length) setFbLanguages(chosen);
        }
        if (next.mode) {
          setLanguages({
            mode: next.mode,
            selected: next.selected.filter(isCampaignSearchLanguage) as CampaignSearchLanguage[],
          });
        }
      })
      .catch(() => {
        /*
         * The market lookup failing is not a reason to block a launch. The
         * picker falls back to the default market, the server resolves
         * authoritatively anyway, and the customer gets a search rather than
         * an error about a dropdown.
         */
      });
    return () => { alive = false; };
  }, [propertyId]);

  return (
    <div className="space-y-4">
      {findBuyers ? (
        <div className={cn('relative overflow-hidden rounded-2xl p-4 text-white ring-1 ring-inset ring-[hsl(40_80%_55%/0.4)]', NAVY_BAND)}>
          <div className="flex items-start gap-3">
            <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', GOLD_FILL)}>
              <Radar className="h-5 w-5 text-[hsl(218_52%_11%)]" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="font-display text-base font-semibold leading-snug">{t('fbx_heading')}</p>
              <p className="mt-1 text-sm leading-relaxed text-[hsl(218_40%_86%)]">{t('fbx_supporting')}</p>
            </div>
          </div>
          <p className="mt-3 text-2xs text-[hsl(218_40%_86%)]" id="fbx-lang-hint">{t(fbAll ? 'fbx_languages_choose' : 'fbx_languages_only', { list: fbLanguages.map((l) => l.toUpperCase()).join(', ') })}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={t('fbx_languages_note')} aria-describedby="fbx-lang-hint" data-testid="fbx-language-chips">
            {FIND_BUYERS_LANGUAGES.map((l) => {
              const on = fbLanguages.includes(l);
              return (
                <button key={l} type="button" aria-pressed={on} onClick={() => toggleFbLanguage(l)} data-testid={`fbx-lang-${l}`}
                  className={cn('min-h-8 min-w-10 rounded-lg px-2 py-0.5 text-2xs font-bold uppercase transition-colors',
                    on ? cn(GOLD_FILL, 'text-[hsl(218_52%_11%)]') : 'bg-white/5 text-[hsl(218_30%_70%)] ring-1 ring-inset ring-white/20 line-through')}>
                  {l}
                </button>
              );
            })}
            <span className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2 py-0.5 text-2xs font-semibold text-[hsl(40_94%_72%)] ring-1 ring-inset ring-white/15">
              <CalendarCheck2 className="h-3.5 w-3.5" aria-hidden="true" />{t('fbx_fresh_badge')}
            </span>
          </div>
          <p className="sr-only">{t('fbx_languages_note')}</p>
        </div>
      ) : (
        <SearchLanguagePicker
          value={languages}
          onChange={setLanguages}
          countryCode={state?.countryCode ?? 'GE'}
          evidence={state?.evidence as never}
          alreadyDiscovered={state?.discovered}
        />
      )}

      {brokerPricing?.active && (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-card p-3">
          <input
            type="checkbox"
            checked={discoverBrokers}
            onChange={(e) => setDiscoverBrokers(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[hsl(var(--gold))]"
          />
          <span className="min-w-0 text-sm leading-snug">
            <span className="font-medium text-foreground">{t('campaign_broker_opt_label')}</span>
            <span className="mt-0.5 block text-2xs leading-relaxed text-muted-foreground">
              {brokerPricing.charging && brokerPricing.unitCredits > 0
                ? t('campaign_broker_opt_price', { credits: brokerPricing.unitCredits.toFixed(2) })
                : t('campaign_broker_opt_free')}
              {' '}
              {t('campaign_broker_opt_dedup')}
            </span>
          </span>
        </label>
      )}

      <Separator />

      {findBuyers ? (
        /* FIND BUYERS: the Research budget in credits — 100 / 500 / 1,000 / 1,500 /
           2,000 or custom (≥ the server's minimum). The TOTAL is authorised as a
           ceiling; the campaign is charged for actual usage only. */
        <ResearchBudgetSelector
          minCredits={fbConfig?.minCredits}
          running={running}
          onRun={(total) => onRun(total, fbAll ? { mode: 'ALL', selected: [] } : { mode: 'EXPLICIT', selected: [...fbLanguages] }, discoverBrokers)}
        />
      ) : (
        <SearchBudgetOffer
          productCode={productCode}
          /*
           * What the budget is being asked to cover. Not the number of
           * languages: a Tbilisi expat group carries Russian and English at
           * once and is read once, so quoting six languages at six times one
           * would overprice the exact configuration this feature exists to
           * encourage. The server does the real estimate; this is the unit
           * count the offer is built from.
           */
          expectedUnits={1}
          onRun={(authorized) => onRun(authorized, {
            mode: languages.mode,
            // Under AUTO and ALL the ticks are irrelevant and the server
            // ignores them; sending them anyway keeps the payload the same
            // shape in every mode.
            selected: languages.selected,
          }, discoverBrokers)}
          running={running}
        />
      )}
    </div>
  );
}

export default CampaignLaunchPanel;

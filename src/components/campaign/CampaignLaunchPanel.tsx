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
import { SearchBudgetOffer } from '@/components/billing/SearchBudgetOffer';
import {
  DEFAULT_SEARCH_LANGUAGES,
  SearchLanguagePicker,
  type SearchLanguageValue,
} from '@/components/campaign/SearchLanguagePicker';
import { Separator } from '@/components/ui/separator';
import { useLanguage } from '@/contexts/LanguageContext';
import { brokerDiscoveryPricing, type BrokerDiscoveryPricing } from '@/services/brokers';
import { getFindBuyersConfig, type FindBuyersConfig } from '@/services/findBuyers';
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
  /* FIND BUYERS / FIND TENANTS searches all six languages, always, and has a
     $10 minimum expressed in wallet credits (server-authoritative). */
  const findBuyers = productCode === 'FIND_CLIENTS';
  const [fbConfig, setFbConfig] = useState<FindBuyersConfig | null>(null);
  useEffect(() => {
    if (!findBuyers) return;
    let alive = true;
    getFindBuyersConfig().then((c) => { if (alive) setFbConfig(c); }).catch(() => {});
    return () => { alive = false; };
  }, [findBuyers]);
  const tenant = counterpart === 'TENANT';
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
        <div className="space-y-1.5">
          <p className="font-display text-base font-semibold leading-snug text-foreground">{t('fbx_heading')}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{t('fbx_supporting')}</p>
          <p className="text-2xs text-muted-foreground">{t('fbx_languages_note')}</p>
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
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{t('fbx_budget_heading')}</p>
          {fbConfig ? (
            <p className="text-2xs font-medium text-foreground" dir="auto">
              {t('fbx_budget_minimum', { credits: fbConfig.minCredits.toLocaleString(), usd: String(fbConfig.minUsd) })}
            </p>
          ) : null}
          <p className="text-2xs leading-relaxed text-muted-foreground">{t('fbx_budget_helper')}</p>
        </div>
      ) : null}

      <SearchBudgetOffer
        minCredits={findBuyers ? fbConfig?.minCredits : undefined}
        ctaLabel={findBuyers ? t(tenant ? 'fbx_start_tenants' : 'fbx_start_buyers') : undefined}
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
        onRun={(authorized) => onRun(authorized, findBuyers ? { mode: 'ALL', selected: [] } : {
          mode: languages.mode,
          // Under AUTO and ALL the ticks are irrelevant and the server
          // ignores them; sending them anyway keeps the payload the same
          // shape in every mode.
          selected: languages.selected,
        }, discoverBrokers)}
        running={running}
      />
    </div>
  );
}

export default CampaignLaunchPanel;

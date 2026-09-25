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
}: {
  propertyId: string;
  productCode: string;
  onRun: (authorizedMaxCredits: number | null, languages: CampaignSearchLanguageChoice) => void;
  running?: boolean;
}) {
  const [state, setState] = useState<CampaignLanguageState | null>(null);
  const [languages, setLanguages] = useState<SearchLanguageValue>(DEFAULT_SEARCH_LANGUAGES);

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
      <SearchLanguagePicker
        value={languages}
        onChange={setLanguages}
        countryCode={state?.countryCode ?? 'GE'}
        evidence={state?.evidence as never}
        alreadyDiscovered={state?.discovered}
      />

      <Separator />

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
        })}
        running={running}
      />
    </div>
  );
}

export default CampaignLaunchPanel;

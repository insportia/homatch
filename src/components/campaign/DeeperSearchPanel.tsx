import React, { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { SearchBudgetOffer } from '@/components/billing/SearchBudgetOffer';
import { expandCampaignSearch } from '@/services/api';
import { customerFacingHeadroom } from '@/campaign/searchExpansion';
import { Layers, Loader2, Check } from 'lucide-react';

/**
 * "HOMATCH SEARCHED 8 RELEVANT SOURCES. MORE ARE AVAILABLE."
 *
 * The customer-facing half of discovery_headroom, which the server has been
 * writing for a while and nothing read. Before this, a customer whose plan
 * limited their search to three sources had no way to learn that five more
 * existed except by paying for another whole search and noticing it found more.
 *
 * WHAT THIS DELIBERATELY DOES NOT SAY
 *
 * No P0/P1/P2/P3. No adapter ids. No supplier or portal names. No internal cost,
 * provider budget or queue state. Not because they are hidden, but because the
 * component cannot reach them: everything it renders comes through
 * customerFacingHeadroom(), whose return type has three fields and nowhere to put
 * any of that. A screen cannot leak what it cannot address.
 *
 * AND IT IS NOT AN UPSELL
 *
 * There is no plan name on this panel and no route to a pricing page. Phase 1 is
 * pay-as-you-go: a customer authorises a budget for a deeper search and gets the
 * depth they paid for. Turning "more sources exist" into "subscribe to see them"
 * would rebuild the FREE-versus-VIP gate as the primary discovery product, which
 * is the thing this model replaced.
 *
 * THE MONEY IS AUTHORISED THE SAME WAY EVERY SEARCH IS
 *
 * SearchBudgetOffer, unchanged — the same ladder, the same "you only pay for
 * actual usage", the same top-up path when the balance is short. A second
 * bespoke payment surface for this one action is how two payment flows drift
 * apart until one of them forgets to release an unused reservation.
 */
export function DeeperSearchPanel({
  propertyId,
  campaignId,
  jobId,
  jobStatus,
  headroom,
  onStarted,
}: {
  propertyId: string;
  campaignId: string;
  /** The search being extended. */
  jobId: string;
  jobStatus: string;
  /** matching_jobs.discovery_headroom, or null when the sweep recorded none. */
  headroom: {
    searchDepth: string | null;
    sourcesSearched: number;
    sourcesAvailableDeeper: number;
    resultCeiling: number | null;
    moreAvailable: boolean;
  } | null;
  onStarted?: (newJobId: string) => void;
}) {
  const { t } = useLanguage();
  const [authorising, setAuthorising] = useState(false);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const shape = customerFacingHeadroom(headroom);

  /*
   * Nothing to offer, nothing rendered. Not a disabled button and not an
   * explanation nobody asked for: a campaign that has read everything available
   * is simply a finished campaign, and a panel saying so would be noise on every
   * successful search.
   *
   * The two reasons it might be absent are NOT collapsed, though — see the
   * refusal branch below, where "we did not record it" and "there is nothing
   * left" say different things once the customer has actually asked.
   */
  if (!shape.offerExpansion && !started && !refusal) return null;

  if (started) {
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Check className="h-4 w-4 text-emerald-600" />
          {t('deeper_started')}
        </p>
      </div>
    );
  }

  if (refusal) {
    /*
     * Each refusal gets its own sentence. NO_HEADROOM_RECORDED must never render
     * as "you have seen everything": the first sweep told us nothing, and
     * claiming it was complete would be inventing a fact in the direction that
     * happens to suit us.
     */
    const copy =
      refusal === 'NOTHING_DEEPER' ? t('deeper_none_left')
        : refusal === 'NO_HEADROOM_RECORDED' ? t('deeper_unknown')
          : refusal === 'CAMPAIGN_NOT_READY' ? t('deeper_not_ready')
            : refusal === 'ALREADY_EXPANDED' ? t('deeper_already')
              : t('deeper_failed');

    return (
      <div className="rounded-lg border border-border/70 bg-muted/30 p-4">
        <p className="text-sm text-muted-foreground" dir="auto">{copy}</p>
      </div>
    );
  }

  const start = async (authorizedMaxCredits: number | null) => {
    setRunning(true);
    try {
      const result = await expandCampaignSearch({
        propertyId, campaignId, expandFromJobId: jobId, authorizedMaxCredits,
      });
      setStarted(true);
      onStarted?.(result.jobId);
    } catch (error) {
      /*
       * The server's reasonCode when it has one, so the customer gets the actual
       * reason rather than a generic failure. A 409 here is not an error in the
       * usual sense — it is the server declining to sell something, which is the
       * outcome we want when there is nothing to sell.
       */
      const code = (error as { reasonCode?: string })?.reasonCode;
      setRefusal(code ?? 'FAILED');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card/50 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Layers className="h-4 w-4 text-muted-foreground" />
        {t('deeper_title')}
      </p>
      <p className="mt-1.5 text-sm text-muted-foreground" dir="auto">{t('deeper_body')}</p>

      {/*
        * Counts as labels rather than sentences. "1 more sources" is wrong in
        * English, and the plural rules of Georgian, Arabic and Hebrew do not
        * agree with each other either, so a single interpolated sentence would
        * be ungrammatical in at least one language at every count.
        */}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-md bg-muted/40 px-3 py-2">
          <dt className="text-xs text-muted-foreground" dir="auto">{t('deeper_searched_label')}</dt>
          <dd className="font-semibold tabular-nums">{shape.searched}</dd>
        </div>
        <div className="rounded-md bg-muted/40 px-3 py-2">
          <dt className="text-xs text-muted-foreground" dir="auto">{t('deeper_available_label')}</dt>
          <dd className="font-semibold tabular-nums">{shape.deeperAvailable}</dd>
        </div>
      </dl>

      {!authorising ? (
        <Button
          className="mt-3 w-full"
          variant="outline"
          onClick={() => setAuthorising(true)}
          disabled={jobStatus === 'running' || jobStatus === 'queued'}
        >
          <Layers className="me-2 h-4 w-4" />
          {t('deeper_cta')}
        </Button>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-semibold" dir="auto">{t('deeper_confirm_title')}</p>
          {/* THE INCREMENTAL BUDGET, BEFORE CONFIRMATION. Not after, and not as
              a number discovered on the receipt. */}
          <p className="text-xs text-muted-foreground" dir="auto">{t('deeper_confirm_body')}</p>
          <p className="text-xs text-muted-foreground" dir="auto">{t('deeper_only_new')}</p>

          <SearchBudgetOffer
            productCode="FIND_CLIENTS"
            onRun={start}
            running={running}
          />

          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => setAuthorising(false)}
            disabled={running}
          >
            {running ? (
              <><Loader2 className="me-2 h-4 w-4 animate-spin" />{t('deeper_running')}</>
            ) : t('deeper_cancel')}
          </Button>
        </div>
      )}
    </div>
  );
}

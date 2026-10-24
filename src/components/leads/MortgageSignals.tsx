// HOMATCH Leads — a member who opted in from Home Financing to receive property offers.
//
// The pill says where the lead came from; the signal lines (src/leads/mortgageSignals.ts) are
// only what the member agreed to share. Budget, area and property type are the search itself and
// appear in the card like any other. Nothing from the calculation exists to show.

import { Globe2, Landmark } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { expatSignalLines, isExpatOrigin, isMortgageOrigin, mortgageSignalLines, priceReasonLines } from '@/leads/mortgageSignals';
import { countryName } from '@/components/matching/workspace/format';
import type { LeadItem } from '@/services/homatchLeads';

export function MortgagePill({ lead }: { lead: Pick<LeadItem, 'origin' | 'segment'> }) {
  const { t } = useLanguage();
  /* A completed My Georgia profile: "potentially interested", never a confirmed buyer. */
  if (isExpatOrigin(lead)) {
    return (
      <span data-testid="lead-origin-expat" className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--gold-soft))] px-2.5 py-1 text-xs font-semibold text-[hsl(var(--gold-ink))]">
        <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />{t('hl_origin_expat')}
      </span>
    );
  }
  if (!isMortgageOrigin(lead)) return null;
  return (
    <span data-testid="lead-origin-mortgage" className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--gold-soft))] px-2.5 py-1 text-xs font-semibold text-[hsl(var(--gold-ink))]">
      <Landmark className="h-3.5 w-3.5" aria-hidden="true" />{t('hl_origin_mortgage')}
    </span>
  );
}

/** "Why this price": the evidence the server counted, next to the price it produced. */
export function PriceReasons({ lead, credits }: { lead: Pick<LeadItem, 'priceReasons'>; credits: string }) {
  const { t } = useLanguage();
  const lines = priceReasonLines(lead, t);
  if (lines.length === 0) return null;
  return (
    <p data-testid="lead-price-reasons" className="mt-1 text-2xs leading-relaxed text-[hsl(224_14%_30%)] [overflow-wrap:anywhere]" dir="auto">
      <span className="font-semibold text-[hsl(var(--gold-ink))]">{t('hl_price_why', { credits })}</span> {lines.join(' · ')}
    </p>
  );
}

export function MortgageSignals({ lead, compact = false }: { lead: Pick<LeadItem, 'mortgage' | 'expat'>; compact?: boolean }) {
  const { t, lang } = useLanguage();
  const locale = lang === 'ka' ? 'ka-GE' : lang;
  const lines = [
    ...expatSignalLines(lead, t, locale, (code) => countryName(code, lang)),
    ...mortgageSignalLines(lead, t, locale),
  ];
  if (lines.length === 0) return null;
  return (
    <ul data-testid="lead-mortgage-signals" className={compact ? 'mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-[hsl(224_14%_30%)]' : 'mt-1.5 grid gap-0.5 text-xs text-[hsl(224_14%_26%)]'}>
      {lines.map((line) => <li key={line} dir="auto">{line}</li>)}
    </ul>
  );
}

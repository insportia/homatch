// HOMATCH Leads — a member who opted in from Home Financing to receive property offers.
//
// The pill says where the lead came from; the signal lines (src/leads/mortgageSignals.ts) are
// only what the member agreed to share. Budget, area and property type are the search itself and
// appear in the card like any other. Nothing from the calculation exists to show.

import { Landmark } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { isMortgageOrigin, mortgageSignalLines } from '@/leads/mortgageSignals';
import type { LeadItem } from '@/services/homatchLeads';

export function MortgagePill({ lead }: { lead: Pick<LeadItem, 'origin' | 'segment'> }) {
  const { t } = useLanguage();
  if (!isMortgageOrigin(lead)) return null;
  return (
    <span data-testid="lead-origin-mortgage" className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--gold-soft))] px-2.5 py-1 text-xs font-semibold text-[hsl(var(--gold-ink))]">
      <Landmark className="h-3.5 w-3.5" aria-hidden="true" />{t('hl_origin_mortgage')}
    </span>
  );
}

export function MortgageSignals({ lead, compact = false }: { lead: Pick<LeadItem, 'mortgage'>; compact?: boolean }) {
  const { t, lang } = useLanguage();
  const lines = mortgageSignalLines(lead, t, lang === 'ka' ? 'ka-GE' : lang);
  if (lines.length === 0) return null;
  return (
    <ul data-testid="lead-mortgage-signals" className={compact ? 'mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-[hsl(224_14%_30%)]' : 'mt-1.5 grid gap-0.5 text-xs text-[hsl(224_14%_26%)]'}>
      {lines.map((line) => <li key={line} dir="auto">{line}</li>)}
    </ul>
  );
}

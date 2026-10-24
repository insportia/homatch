// HOMATCH Leads — what Matching may say about a member who opted in from Home Financing.
//
// Only what the member agreed to share and the engine can vouch for: that they used the mortgage
// calculator (once or repeatedly, and the month of the latest use), whether it was for this very
// listing, and when they plan to buy. Never the calculation itself.

import type { LeadItem } from '../services/homatchLeads';

export function isMortgageOrigin(lead: Pick<LeadItem, 'origin' | 'segment'>): boolean {
  return lead.origin === 'MORTGAGE' || lead.segment === 'MORTGAGE';
}

function monthLabel(month: string | null | undefined, locale: string): string | null {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return null;
  const [y, m] = month.split('-').map(Number);
  try {
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
  } catch {
    return month;
  }
}

/** The signal lines, each a sentence the member's own actions support. */
export function mortgageSignalLines(
  lead: Pick<LeadItem, 'mortgage'>,
  t: (k: string, v?: Record<string, string | number>) => string,
  locale: string,
): string[] {
  const m = lead.mortgage;
  if (!m) return [];
  const out: string[] = [];
  if (m.thisListing) out.push(t('hl_mortgage_this_listing'));
  const month = monthLabel(m.lastUseMonth, locale);
  if (month) out.push(t(m.calculatorUse === 'REPEATED' ? 'hl_mortgage_used_repeated' : 'hl_mortgage_used_once', { month }));
  if (m.timeframe) out.push(t(`hl_mortgage_tf_${m.timeframe.toLowerCase()}`));
  return out;
}

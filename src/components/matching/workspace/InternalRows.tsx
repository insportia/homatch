// HOMATCH Internal — the rows, Available (anonymised, priced 3 / 5 / 10, or 3 for a member who
// opted in from Home Financing, by the server) and
// Unlocked (the member's contact, read on demand and limited to what that member chose to
// share on unlock — getInternalContact re-checks it on every read).

import { Loader2, Mail, MessageSquare, Phone, UserRound } from 'lucide-react';
import { useState } from 'react';
import { CategoryPill, useLeadFormatters } from '@/components/leads/LeadCard';
import { MortgagePill, MortgageSignals } from '@/components/leads/MortgageSignals';
import { useLanguage } from '@/contexts/LanguageContext';
import { buildLeadSummary } from '@/leads/leadSummary';
import { cn } from '@/lib/utils';
import type { LeadContact } from '@/services/homatchLeads';
import { getInternalContact, type InternalLead } from '@/services/matchingWorkspace';
import { InterestChips } from './CuratedRows';
import { countryName, flagOf, formatCredits, languageName } from './format';
import { RowCheck } from './RowCheck';

function ContactBlock({ matchId }: { matchId: string }) {
  const { t } = useLanguage();
  const [contact, setContact] = useState<LeadContact | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const load = async () => {
    setState('loading');
    try { setContact(await getInternalContact(matchId)); setState('idle'); } catch { setState('failed'); }
  };
  if (!contact) {
    return (
      <button type="button" onClick={() => void load()} disabled={state === 'loading'} data-testid="mw-internal-contact-open"
        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-white px-3 text-xs font-semibold text-[hsl(218_45%_14%)] hover:border-[hsl(var(--gold-border))]">
        {state === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <UserRound className="h-3.5 w-3.5" aria-hidden="true" />}
        {state === 'failed' ? t('mw_contact_failed') : t('mw_contact_show')}
      </button>
    );
  }
  if (contact.restricted) {
    return <p className="text-xs text-[hsl(224_14%_32%)]" data-testid="mw-internal-contact">{t('mw_contact_restricted')}</p>;
  }
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-[hsl(218_45%_14%)]" data-testid="mw-internal-contact">
      {contact.phone ? <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1.5" dir="ltr"><Phone className="h-3.5 w-3.5" aria-hidden="true" />{contact.phone}</a> : null}
      {contact.email ? <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1.5 [overflow-wrap:anywhere]" dir="ltr"><Mail className="h-3.5 w-3.5" aria-hidden="true" />{contact.email}</a> : null}
      {contact.canMessage ? <span className="inline-flex items-center gap-1.5 text-xs text-[hsl(224_14%_32%)]"><MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />{t('mw_contact_message_ok')}</span> : null}
      {!contact.phone && !contact.email ? <span className="text-xs font-normal text-[hsl(224_14%_32%)]">{t('mw_contact_not_shared')}</span> : null}
    </div>
  );
}

export function InternalRows({
  items, view, isSelected, onToggle,
}: {
  items: InternalLead[];
  view: 'AVAILABLE' | 'UNLOCKED';
  isSelected: (id: string) => boolean;
  onToggle: (id: string) => void;
}) {
  const { t, lang, money, date } = useLeadFormatters();
  const unlocked = view === 'UNLOCKED';
  return (
    <div role="list" className="divide-y divide-[hsl(var(--border))] overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-white shadow-card" data-testid="mw-list" data-product="internal" data-view={view}>
      {items.map((lead) => {
        const selected = isSelected(lead.matchId);
        const name = unlocked ? (lead.displayName || t('mw_member')) : t('mw_member_private');
        return (
          <div key={lead.matchId} role="listitem" data-testid="mw-row" data-id={lead.matchId}
            className={cn('grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-3 py-3 sm:px-4 [content-visibility:auto] [contain-intrinsic-size:auto_96px]',
              'md:grid-cols-[auto_minmax(0,1.1fr)_minmax(0,2.4fr)_auto] md:items-center', selected && 'bg-[hsl(42_100%_97%)]')}>
            <RowCheck checked={selected} onChange={() => onToggle(lead.matchId)} label={t('mw_select_lead', { name })} />
            <div className="min-w-0">
              <p className="truncate font-semibold text-[hsl(218_45%_14%)]" dir="auto" data-testid="mw-row-name">{name}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <CategoryPill lead={lead} />
                <MortgagePill lead={lead} />
                <span className="text-2xs font-bold tabular-nums text-[hsl(218_45%_22%)]" dir="ltr">{lead.score}%</span>
              </div>
            </div>
            <div className="col-start-2 min-w-0 md:col-start-auto">
              <div className="flex flex-wrap items-center gap-1.5">
                <InterestChips interests={lead.interest ? [lead.interest] : []} />
                {lead.country ? <span className="text-2xs font-semibold text-[hsl(224_14%_32%)]">{flagOf(lead.country)} {countryName(lead.country, lang)}</span> : null}
                {unlocked && lead.language ? <span className="text-2xs font-semibold text-[hsl(224_14%_32%)]">{languageName(lead.language, lang)}</span> : null}
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[hsl(224_14%_26%)]" data-testid="mw-row-summary">{buildLeadSummary(lead, t, money)}</p>
              <MortgageSignals lead={lead} compact />
              {lead.matchedAt ? <p className="mt-0.5 text-2xs text-muted-foreground">{t('mw_matched_on', { date: date(lead.matchedAt) ?? '' })}</p> : null}
            </div>
            <div className="col-start-2 flex items-center gap-2 md:col-start-auto md:justify-end">
              {unlocked ? null : (
                <span className="inline-flex items-baseline gap-1 rounded-lg bg-[hsl(var(--gold-soft))] px-2 py-1 text-xs font-bold text-[hsl(var(--gold-ink))]" data-testid="mw-row-price" dir="ltr">
                  {t(lead.priceCredits === 1 ? 'mw_credit_one' : 'mw_credits_n', { n: formatCredits(lead.priceCredits, lang) })}
                </span>
              )}
            </div>
            {unlocked ? (
              <div className="col-span-2 rounded-xl bg-[hsl(218_30%_98%)] p-3 md:col-start-2 md:col-end-5">
                <ContactBlock matchId={lead.matchId} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

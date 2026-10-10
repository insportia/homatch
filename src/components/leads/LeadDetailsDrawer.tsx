// HOMATCH Leads — the details of one match.
//
// Before an unlock: the member's stated requirements, the engine's agreement dimension
// by dimension, freshness, segment, price and which channels would exist. After an
// unlock: exactly the contact the member allows today (internal_lead_contact re-checks
// consent and blocks on every read), the conversation and the CRM trail.

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, CircleDashed, CircleSlash, Loader2, Lock, Mail, MessageSquare, Phone, ShieldAlert } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { getLeadContact, openLeadConversation, UnlockError, type LeadContact, type LeadItem } from '@/services/homatchLeads';
import { budgetLabel, buildLeadSummary, DIMENSION_ORDER, locationLabel, propertyTypeLabel, requirementParts } from '@/leads/leadSummary';
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW } from './kit';
import { BandBadge, ContactOptions, formatCreditsLabel, SegmentPill, useLeadFormatters } from './LeadCard';

export function LeadDetailsDrawer({
  lead, propertyId, open, onClose, onUnlock,
}: {
  lead: LeadItem | null;
  propertyId: string;
  open: boolean;
  onClose: () => void;
  onUnlock: (matchId: string) => void;
}) {
  const { t, lang, isRTL } = useLanguage();
  const { money, date } = useLeadFormatters();
  const navigate = useNavigate();
  const [contact, setContact] = useState<LeadContact | null>(null);
  const [loadingContact, setLoadingContact] = useState(false);
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setContact(null); setNotice(null);
    if (!open || !lead?.unlocked) return;
    let alive = true;
    setLoadingContact(true);
    getLeadContact(lead.matchId)
      .then((c) => { if (alive) setContact(c); })
      .catch(() => { if (alive) setContact({ restricted: true, reason: 'UNAVAILABLE' }); })
      .finally(() => { if (alive) setLoadingContact(false); });
    return () => { alive = false; };
  }, [open, lead?.matchId, lead?.unlocked]);

  if (!lead) return null;
  const fmt = (n: number, c: string | null) => money(n, c);
  const agreed = new Set(lead.agreed.map((d) => d.toUpperCase()));
  const conflicted = new Set(lead.conflicted.map((d) => d.toUpperCase()));
  const unknown = new Set(lead.unknown.map((d) => d.toUpperCase()));

  async function openConversation() {
    if (!lead) return;
    setOpening(true); setNotice(null);
    try {
      const id = await openLeadConversation(lead.matchId);
      navigate(`/chat?conversation=${id}`);
    } catch (e) {
      setNotice(e instanceof UnlockError && e.code === 'RATE_LIMITED' ? 'hl_error_rate_limited' : 'hl_error_conversation');
    } finally {
      setOpening(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side={isRTL ? 'left' : 'right'} className="w-full max-w-full overflow-y-auto bg-white p-0 sm:max-w-lg" data-testid="lead-drawer">
        <div className="border-b border-[hsl(var(--border))] bg-[#0C1119] px-5 pb-5 pt-6 text-white">
          <SheetHeader className="space-y-1 text-start">
            <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-[hsl(38_92%_62%)]">{t('hl_details_eyebrow')}</p>
            <SheetTitle className="font-display text-xl font-semibold text-white">
              {lead.unlocked && (contact?.displayName || lead.displayName) ? (contact?.displayName || lead.displayName) : t('hl_member_anonymous')}
            </SheetTitle>
            <SheetDescription className="text-sm text-white/75">{buildLeadSummary(lead, t, fmt)}</SheetDescription>
          </SheetHeader>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <BandBadge band={lead.band} score={lead.score} />
            <SegmentPill segment={lead.segment} />
          </div>
        </div>

        <div className="space-y-6 px-5 py-5">
          <section>
            <h3 className={EYEBROW}>{t('hl_details_requirements')}</h3>
            <dl className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Item label={t('hl_label_looking_for')} value={t(lead.transaction === 'RENT' ? 'hl_looking_rent' : 'hl_looking_buy', { type: propertyTypeLabel(lead.propertyTypes, t) ?? t('hl_type_property') })} />
              <Item label={t('hl_label_location')} value={locationLabel(lead.locations) ?? t('hl_not_stated')} />
              <Item label={t('hl_label_budget')} value={budgetLabel(lead.budget, fmt, t) ?? t('hl_not_stated')} />
              <Item label={t('hl_label_requirements')} value={requirementParts(lead.requirements, t).join(', ') || t('hl_not_stated')} />
              <Item label={t('hl_label_updated')} value={date(lead.updatedAt ?? lead.demandAt) ?? t('hl_not_stated')} />
              <Item label={t('hl_details_matched_on')} value={date(lead.matchedAt) ?? t('hl_not_stated')} />
            </dl>
          </section>

          <section>
            <h3 className={EYEBROW}>{t('hl_details_breakdown')}</h3>
            <p className="mt-1 text-xs text-[hsl(224_14%_30%)]">{t('hl_details_breakdown_note')}</p>
            <ul className="mt-2 divide-y divide-[hsl(var(--border))] rounded-xl border border-[hsl(var(--border))]">
              {DIMENSION_ORDER.map((d) => {
                const state = agreed.has(d) ? 'AGREED' : conflicted.has(d) ? 'CONFLICT' : unknown.has(d) ? 'UNKNOWN' : null;
                if (!state) return null;
                const Icon = state === 'AGREED' ? CheckCircle2 : state === 'CONFLICT' ? CircleSlash : CircleDashed;
                return (
                  <li key={d} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <span>{t(`hl_dim_${d.toLowerCase()}`)}</span>
                    <span className={cn('inline-flex items-center gap-1 text-xs font-semibold',
                      state === 'AGREED' ? 'text-[hsl(152_55%_28%)]' : state === 'CONFLICT' ? 'text-[hsl(0_55%_40%)]' : 'text-[hsl(224_10%_40%)]')}>
                      <Icon className="h-4 w-4" aria-hidden="true" />{t(`hl_dim_state_${state.toLowerCase()}`)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <h3 className={EYEBROW}>{t('hl_label_contact_options')}</h3>
            <div className="mt-2"><ContactOptions options={lead.contactOptions} /></div>
            <p className="mt-2 text-xs leading-relaxed text-[hsl(224_14%_30%)]">
              {t(lead.segment === 'PREMIUM' ? 'hl_segment_premium_desc' : 'hl_segment_standard_desc')}
            </p>
          </section>

          {lead.unlocked ? (
            <section aria-live="polite">
              <h3 className={EYEBROW}>{t('hl_details_contact')}</h3>
              {loadingContact ? (
                <Loader2 className="mt-3 h-5 w-5 animate-spin text-[hsl(var(--gold-ink))]" />
              ) : contact?.restricted ? (
                <p className="mt-2 flex items-start gap-2 rounded-xl bg-[hsl(0_60%_97%)] px-3 py-2.5 text-sm text-[hsl(0_45%_32%)]">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t(`hl_restricted_${String(contact.reason ?? 'UNAVAILABLE').toLowerCase()}`)}
                </p>
              ) : contact ? (
                <div className="mt-2 space-y-2">
                  {contact.phone ? (
                    <a href={`tel:${contact.phone}`} className={cn(BTN_SECONDARY, 'w-full justify-start')} dir="ltr">
                      <Phone className="h-4 w-4" aria-hidden="true" />{contact.phone}
                    </a>
                  ) : null}
                  {contact.email ? (
                    <a href={`mailto:${contact.email}`} className={cn(BTN_SECONDARY, 'w-full justify-start [overflow-wrap:anywhere]')} dir="ltr">
                      <Mail className="h-4 w-4" aria-hidden="true" />{contact.email}
                    </a>
                  ) : null}
                  {!contact.phone && !contact.email ? (
                    <p className="text-sm text-[hsl(224_14%_30%)]">{t('hl_contact_message_only')}</p>
                  ) : null}
                  <button type="button" className={cn(BTN_PRIMARY, 'w-full')} onClick={openConversation} disabled={opening || !contact.canMessage}>
                    {opening ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MessageSquare className="h-4 w-4" aria-hidden="true" />}
                    {t('hl_cta_open_conversation')}
                  </button>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button type="button" className={cn(BTN_SECONDARY, 'sm:flex-1')} onClick={() => navigate(`/email-studio?property=${propertyId}&leads=${lead.matchId}`)}>
                      <Mail className="h-4 w-4" aria-hidden="true" />{t('hl_cta_create_email')}
                    </button>
                    {lead.crmEntryId ? (
                      <button type="button" className={cn(BTN_SECONDARY, 'sm:flex-1')} onClick={() => navigate(`/leads?entry=${lead.crmEntryId}`)}>
                        {t('hl_cta_view_crm')}
                      </button>
                    ) : null}
                  </div>
                  {notice ? <p role="alert" className="text-sm text-[hsl(0_55%_38%)]">{t(notice)}</p> : null}
                </div>
              ) : null}
            </section>
          ) : (
            <section className="rounded-2xl border border-[hsl(var(--gold-border))] bg-[hsl(42_60%_97%)] p-4">
              <p className="text-sm font-semibold">{t('hl_details_unlock_title')}</p>
              <p className="mt-1 text-xs leading-relaxed text-[hsl(224_14%_30%)]">{t('hl_unlock_privacy')}</p>
              <button type="button" className={cn(BTN_PRIMARY, 'mt-3 w-full')} onClick={() => onUnlock(lead.matchId)}>
                <Lock className="h-4 w-4" aria-hidden="true" />
                {t(lead.segment === 'PREMIUM' ? 'hl_cta_unlock_premium' : 'hl_cta_unlock_standard', { credits: formatCreditsLabel(lead.priceCredits, lang) })}
              </button>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(224_10%_40%)]">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-[hsl(224_14%_12%)] [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

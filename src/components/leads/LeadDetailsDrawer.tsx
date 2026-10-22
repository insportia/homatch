// HOMATCH Leads — the details of one match.
//
// Before an unlock: the member's stated requirements, why HOMATCH matched them (measured
// geography, budget difference, similarities) and what is uncertain, the engine's agreement
// dimension by dimension, freshness, category, price and which channels would exist. After an
// unlock: exactly the contact the member allows today (internal_lead_contact re-checks
// consent and blocks on every read), the conversation and the CRM trail.

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleDashed, CircleSlash, Compass, Loader2, Lock, Mail, MessageSquare, Phone, ShieldAlert } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { getLeadContact, openLeadConversation, UnlockError, type LeadContact, type LeadItem } from '@/services/homatchLeads';
import { budgetLabel, buildLeadSummary, DIMENSION_ORDER, featureParts, leadCategory, leadPriceKey, locationLabel, matchReasons, propertyTypeLabel, requirementParts } from '@/leads/leadSummary';
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW } from './kit';
import { BandBadge, CategoryPill, ContactOptions, formatCreditsLabel, SearcherPill, useLeadFormatters } from './LeadCard';

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
  const features = featureParts(lead.features, t);
  const why = matchReasons(lead, t, fmt, (n) => formatCreditsLabel(n, lang));
  const key = leadPriceKey(lead);
  const category = leadCategory(lead);

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
            <CategoryPill lead={lead} />
            <BandBadge band={lead.band} score={lead.score} />
            <SearcherPill searcher={lead.searcher} />
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
              <Item label={t('hl_label_active')} value={date(lead.activeAt ?? lead.updatedAt ?? lead.demandAt) ?? t('hl_not_stated')} />
              <Item label={t('hl_details_matched_on')} value={date(lead.matchedAt) ?? t('hl_not_stated')} />
            </dl>
            {features.must.length || features.nice.length || features.avoid.length || features.other.length ? (
              <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="lead-features">
                {features.must.length ? <Item label={t('hl_label_must_have')} value={features.must.join(', ')} /> : null}
                {features.nice.length ? <Item label={t('hl_label_nice_to_have')} value={features.nice.join(', ')} /> : null}
                {features.avoid.length ? <Item label={t('hl_label_avoid')} value={features.avoid.join(', ')} /> : null}
                {features.other.length ? <Item label={t('hl_label_preferences')} value={features.other.join(', ')} /> : null}
              </dl>
            ) : null}
            {lead.stale ? <p className="mt-3 rounded-xl bg-[hsl(220_20%_96%)] px-3 py-2 text-xs leading-relaxed text-[hsl(224_14%_28%)]" data-testid="lead-stale-note">{t('hl_stale_note')}</p> : null}
          </section>

          {why.reasons.length || why.uncertain.length ? (
            <section data-testid="lead-why-detail" aria-labelledby="lead-why-h">
              <h3 id="lead-why-h" className={EYEBROW}>{t('hl_why_title')}</h3>
              {lead.kind ? <p className="mt-1 text-xs font-semibold text-[hsl(224_14%_30%)]">{t(`hl_kind_${lead.kind}`)}</p> : null}
              <ul className="mt-2 space-y-1.5">
                {why.reasons.map((r) => (
                  <li key={r} className="flex items-start gap-2 text-sm leading-relaxed text-[hsl(224_14%_18%)]" dir="auto">
                    <Compass className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{r}
                  </li>
                ))}
              </ul>
              {why.uncertain.length ? (
                <div className="mt-3 rounded-xl bg-[hsl(42_60%_96%)] px-3 py-2.5" data-testid="lead-uncertain">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-[hsl(30_70%_28%)]">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />{t('hl_unc_title')}
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 ps-5 text-xs leading-relaxed text-[hsl(224_14%_26%)]">
                    {why.uncertain.map((u) => <li key={u}>{u}</li>)}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          <section data-testid="lead-source">
            <h3 className={EYEBROW}>{t('hl_details_source')}</h3>
            <p className="mt-1 text-sm leading-relaxed text-[hsl(224_14%_22%)]">{t('hl_details_source_body')}</p>
            {lead.searcher ? (
              <p className="mt-2 text-xs leading-relaxed text-[hsl(224_14%_30%)]">
                {t(lead.searcher === 'BROKER_FOR_CLIENT' ? 'hl_searcher_broker_client_note' : lead.searcher === 'PROFESSIONAL' ? 'hl_searcher_professional_note' : 'hl_searcher_direct_note')}
              </p>
            ) : null}
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
              {t(category ? `hl_cat_${category}_desc` : lead.segment === 'PREMIUM' ? 'hl_segment_premium_desc' : 'hl_segment_standard_desc')}
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
                {t(key === 'PREMIUM' ? 'hl_cta_unlock_premium' : key === 'EXACT' ? 'hl_cta_unlock_exact' : 'hl_cta_unlock_standard', { credits: formatCreditsLabel(lead.priceCredits, lang) })}
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

// HOMATCH Leads — one matched member, anonymised until unlocked.
//
// Everything on the card comes from the feed: the member's stated requirements, the
// engine's score and agreement, the price of their segment. No name, no free text, no
// identifier before an unlock (the server never sends one). Segment and score are shown
// side by side and never mixed: a Standard lead may match better than a Premium one.

import React from 'react';
import { Bookmark, BookmarkCheck, CalendarClock, Check, Lock, Mail, MapPin, MessageSquare, Phone, Sparkles, Unlock } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { formatMoney, intlLocaleFor, isolate } from '@/components/workspace/primitives';
import type { LeadItem } from '@/services/homatchLeads';
import {
  budgetLabel, buildLeadSummary, locationLabel, matchedCriteria, propertyTypeLabel, requirementParts,
} from '@/leads/leadSummary';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TERTIARY, SURFACE, SURFACE_HOVER } from './kit';

export function formatCreditsLabel(n: number, lang: string) {
  try {
    return new Intl.NumberFormat(intlLocaleFor(lang), { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(n);
  } catch {
    return String(n);
  }
}

export function useLeadFormatters() {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const money = (n: number, currency: string | null) => isolate(formatMoney(n, currency || 'USD', locale, { narrowSymbol: true }));
  const date = (iso: string | null) => {
    if (!iso) return null;
    try { return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)); } catch { return null; }
  };
  return { t, lang, locale, money, date };
}

export function BandBadge({ band, score }: { band: LeadItem['band']; score: number }) {
  const { t } = useLanguage();
  const tone = band === 'STRONG'
    ? 'bg-[hsl(152_45%_94%)] text-[hsl(152_55%_24%)] ring-[hsl(152_40%_78%)]'
    : band === 'POTENTIAL'
      ? 'bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))] ring-[hsl(var(--gold-border))]'
      : 'bg-[hsl(220_20%_96%)] text-[hsl(224_14%_28%)] ring-[hsl(220_15%_84%)]';
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset', tone)}>
      {t(band === 'STRONG' ? 'hl_band_strong' : band === 'POTENTIAL' ? 'hl_band_potential' : 'hl_band_weak')}
      <span className="font-bold tabular-nums" dir="ltr">{score}%</span>
    </span>
  );
}

export function SegmentPill({ segment }: { segment: LeadItem['segment'] }) {
  const { t } = useLanguage();
  return segment === 'PREMIUM' ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#0C1119] px-2.5 py-1 text-xs font-semibold text-[hsl(38_92%_62%)]">
      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{t('hl_segment_premium')}
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-white px-2.5 py-1 text-xs font-semibold text-[hsl(224_14%_22%)]">
      {t('hl_segment_standard')}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(224_10%_40%)]">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium leading-snug text-[hsl(224_14%_12%)] [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function ContactOptions({ options }: { options: LeadItem['contactOptions'] }) {
  const { t } = useLanguage();
  const rows: Array<[boolean, React.ComponentType<{ className?: string }>, string]> = [
    [options.message, MessageSquare, t('hl_contact_message')],
    [options.phone, Phone, t('hl_contact_phone')],
    [options.email, Mail, t('hl_contact_email')],
  ];
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t('hl_label_contact_options')}>
      {rows.filter(([on]) => on).map(([, Icon, label]) => (
        <li key={label} className="inline-flex items-center gap-1 rounded-lg bg-[hsl(42_60%_96%)] px-2 py-1 text-xs font-medium text-[hsl(224_14%_18%)]">
          <Icon className="h-3.5 w-3.5 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{label}
        </li>
      ))}
    </ul>
  );
}

export function LeadCard({
  lead, selected, onToggleSelect, onUnlock, onOpenDetails, onOpenContact, onOpenConversation, onToggleSave, onCreateEmail, busy,
}: {
  lead: LeadItem;
  selected: boolean;
  onToggleSelect: () => void;
  onUnlock: () => void;
  onOpenDetails: () => void;
  onOpenContact: () => void;
  onOpenConversation: () => void;
  onToggleSave: () => void;
  onCreateEmail: () => void;
  busy?: boolean;
}) {
  const { t, lang, money, date } = useLeadFormatters();
  const summary = buildLeadSummary(lead, t, (n, c) => money(n, c));
  const type = propertyTypeLabel(lead.propertyTypes, t) ?? t('hl_type_property');
  const where = locationLabel(lead.locations);
  const budget = budgetLabel(lead.budget, (n, c) => money(n, c), t);
  const reqs = requirementParts(lead.requirements, t);
  const why = matchedCriteria(lead.agreed, t);
  const updated = date(lead.updatedAt ?? lead.demandAt);
  const price = formatCreditsLabel(lead.priceCredits, lang);
  const titleId = `lead-${lead.matchId}-title`;

  return (
    <article aria-labelledby={titleId} data-testid="lead-card" data-segment={lead.segment} data-band={lead.band}
      className={cn(SURFACE, SURFACE_HOVER, 'flex min-w-0 flex-col p-4 sm:p-5', selected && 'ring-2 ring-[hsl(38_92%_54%)]')}>
      <div className="flex items-start gap-3">
        {!lead.unlocked ? (
          <label className="-m-2 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg focus-within:ring-2 focus-within:ring-[hsl(38_92%_50%)]">
            <input type="checkbox" checked={selected} onChange={onToggleSelect} className="h-5 w-5 accent-[hsl(38_92%_50%)]"
              aria-label={t('hl_select_lead', { type })} />
          </label>
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[hsl(152_45%_94%)]" title={t('hl_unlocked')}>
            <Check className="h-4 w-4 text-[hsl(152_55%_28%)]" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <BandBadge band={lead.band} score={lead.score} />
            <SegmentPill segment={lead.segment} />
            {lead.fresh ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(210_80%_96%)] px-2.5 py-1 text-xs font-semibold text-[hsl(212_70%_32%)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[hsl(212_80%_48%)] motion-safe:animate-pulse" aria-hidden="true" />{t('hl_fresh')}
              </span>
            ) : null}
            {lead.crmStatus && lead.crmStatus !== 'UNLOCKED' ? (
              <span className="inline-flex items-center rounded-full bg-[hsl(220_20%_96%)] px-2.5 py-1 text-xs font-semibold text-[hsl(224_14%_28%)]">{t('hl_contacted')}</span>
            ) : null}
          </div>
          <h3 id={titleId} className="mt-2 font-display text-base font-semibold leading-snug text-[hsl(224_14%_10%)]">
            {lead.unlocked && lead.displayName ? lead.displayName : t('hl_member_anonymous')}
          </h3>
        </div>
        <button type="button" onClick={onToggleSave} className={cn(BTN_TERTIARY, 'shrink-0 px-2')} aria-pressed={lead.saved}
          aria-label={lead.saved ? t('hl_saved') : t('hl_save_lead')}>
          {lead.saved ? <BookmarkCheck className="h-5 w-5" aria-hidden="true" /> : <Bookmark className="h-5 w-5" aria-hidden="true" />}
        </button>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-[hsl(224_14%_22%)]" dir="auto">{summary}</p>

      <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <Field label={t('hl_label_looking_for')}>{t(lead.transaction === 'RENT' ? 'hl_looking_rent' : 'hl_looking_buy', { type })}</Field>
        <Field label={t('hl_label_location')}>
          {where ? <span className="inline-flex items-start gap-1"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{where}</span> : t('hl_not_stated')}
        </Field>
        <Field label={t('hl_label_budget')}>{budget ?? t('hl_not_stated')}</Field>
        <Field label={t('hl_label_requirements')}>{reqs.length ? reqs.join(', ') : t('hl_not_stated')}</Field>
        <Field label={t('hl_label_why')}>{why.length ? why.join(', ') : t('hl_not_stated')}</Field>
        <Field label={t('hl_label_updated')}>
          {updated ? <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{updated}</span> : t('hl_not_stated')}
        </Field>
      </dl>

      <div className="mt-3">
        <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(224_10%_40%)]">{t('hl_label_contact_options')}</p>
        <div className="mt-1"><ContactOptions options={lead.contactOptions} /></div>
      </div>

      <p className="mt-3 rounded-xl bg-[hsl(42_60%_97%)] px-3 py-2 text-xs leading-relaxed text-[hsl(224_14%_26%)]">
        {t(lead.segment === 'PREMIUM' ? 'hl_segment_premium_desc' : 'hl_segment_standard_desc')}
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {lead.unlocked ? (
          <>
            <button type="button" className={cn(BTN_PRIMARY, 'sm:flex-1')} onClick={onOpenContact}>
              <Unlock className="h-4 w-4" aria-hidden="true" />{t('hl_cta_open_contact')}
            </button>
            <button type="button" className={BTN_SECONDARY} onClick={onOpenConversation}>
              <MessageSquare className="h-4 w-4" aria-hidden="true" />{t('hl_cta_open_conversation')}
            </button>
            <button type="button" className={BTN_SECONDARY} onClick={onCreateEmail}>
              <Mail className="h-4 w-4" aria-hidden="true" />{t('hl_cta_create_email')}
            </button>
          </>
        ) : (
          <button type="button" className={cn(BTN_PRIMARY, 'sm:flex-1')} onClick={onUnlock} disabled={busy} data-testid="lead-unlock">
            <Lock className="h-4 w-4" aria-hidden="true" />
            {t(lead.segment === 'PREMIUM' ? 'hl_cta_unlock_premium' : 'hl_cta_unlock_standard', { credits: price })}
          </button>
        )}
        <button type="button" className={BTN_SECONDARY} onClick={onOpenDetails}>
          {t('hl_cta_view_details')}
        </button>
      </div>
    </article>
  );
}

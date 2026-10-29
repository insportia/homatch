/*
 * THE UNLOCKED LEAD'S PROFILE (Find Buyers 2.0, owner 2026-10-18).
 *
 * What the member documented (their saved HOMATCH search), why HOMATCH matched it with the
 * owner's listing (the engine's agreement, dimension by dimension), where the lead came
 * from, when it was unlocked and for how much, and the contact details the member allows
 * TODAY — internal_lead_contact re-checks consent and blocks on every read, so a member
 * who withdrew sharing simply has no phone or email here any more.
 */

import { CheckCircle2, CircleDashed, CircleSlash, Mail, Phone, ShieldAlert, UserRound } from 'lucide-react';
import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { DIMENSION_ORDER, featureParts, matchReasons, propertyTypeLabel } from '@/leads/leadSummary';
import type { LeadContact } from '@/services/homatchLeads';
import type { CrmProfile } from '@/services/leadsCrm';
import { formatMoney, intlLocaleFor, isolate } from '@/components/workspace/primitives';
import { CopyEmailButton } from '@/components/leads/CopyEmailButton';
import { SectionCard, useCrmDateFormat } from './ui';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(218_15%_42%)]">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-[hsl(218_45%_14%)] [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

export function LeadProfileCard({ profile, contact }: { profile: CrmProfile; contact: LeadContact | null }) {
  const { t, lang } = useLanguage();
  const fmt = useCrmDateFormat();
  const d = profile.demand ?? {};
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : null);
  const money = (n: number, c: unknown) => isolate(formatMoney(n, String(c || 'USD'), intlLocaleFor(lang), { narrowSymbol: true }));
  const bMin = num(d.budgetMin); const bMax = num(d.budgetMax);
  const budget = bMin != null && bMax != null ? `${money(bMin, d.currency)} – ${money(bMax, d.currency)}`
    : bMax != null ? t('lp_budget_upto', { max: money(bMax, d.currency) }) : bMin != null ? t('lp_budget_from', { min: money(bMin, d.currency) }) : null;
  const places = [...new Set([...(Array.isArray(d.neighborhoods) ? d.neighborhoods.map(String) : []), d.district, d.city].filter(Boolean).map(String))].join(', ');
  const size = [
    num(d.bedroomsMin) != null ? t('hl_req_bedrooms_min', { n: num(d.bedroomsMin)! }) : null,
    num(d.roomsMin) != null ? t('hl_req_rooms_min', { n: num(d.roomsMin)! }) : null,
    num(d.areaMin) != null ? t('hl_req_area_min', { n: num(d.areaMin)! }) : null,
  ].filter(Boolean).join(', ');
  const features = featureParts((d.features ?? {}) as Record<string, unknown>, t);
  const types = Array.isArray(d.propertyTypes) ? propertyTypeLabel(d.propertyTypes.map(String), t) : null;
  const m = profile.match;
  const agreed = new Set((m?.agreed ?? []).map((x) => x.toUpperCase()));
  const conflicted = new Set((m?.conflicted ?? []).map((x) => x.toUpperCase()));
  const unknown = new Set((m?.unknown ?? []).map((x) => x.toUpperCase()));
  const why = m ? matchReasons({ explanation: m.explanation, kind: m.kind ?? undefined }, t, money, String) : { reasons: [], uncertain: [] };

  return (
    <SectionCard title={t('lp_title')} icon={UserRound} labelledBy="lp-h">
      <dl className="grid gap-3 sm:grid-cols-2" data-testid="lp-summary">
        <Row label={t('lp_source')} value={t('lp_source_member_search')} />
        <Row label={t('lp_unlocked')} value={<>
          {profile.unlockedAt ? fmt.dateTime(profile.unlockedAt) : '—'}
          {profile.segment ? <span className="ms-1.5 text-[hsl(34_90%_31%)]">· {t(profile.segment === 'PREMIUM' ? 'hl_cat_VIP' : profile.segment === 'EXACT' ? 'hl_cat_EXACT' : 'hl_cat_NEARBY_SIMILAR')}</span> : null}
        </>} />
        <Row label={t('lp_looking_for')} value={t(d.transaction === 'RENT' ? 'hl_looking_rent' : 'hl_looking_buy', { type: types ?? t('hl_type_property') })} />
        <Row label={t('hl_label_location')} value={places || t('hl_not_stated')} />
        <Row label={t('hl_label_budget')} value={budget ?? t('hl_not_stated')} />
        <Row label={t('hl_label_requirements')} value={size || t('hl_not_stated')} />
        {features.must.length ? <Row label={t('hl_label_must_have')} value={features.must.join(', ')} /> : null}
        {features.other.length ? <Row label={t('hl_label_preferences')} value={features.other.join(', ')} /> : null}
        {typeof d.activeAt === 'string' ? <Row label={t('hl_label_active')} value={fmt.dateTime(d.activeAt)} /> : null}
      </dl>

      {why.reasons.length || why.uncertain.length ? (
        <div className="mt-4" data-testid="lp-why-evidence">
          <p className="text-2xs font-bold uppercase tracking-[0.12em] text-[hsl(34_90%_34%)]">{t('hl_why_title')}</p>
          <ul className="mt-1.5 list-disc space-y-0.5 ps-5 text-sm leading-relaxed text-[hsl(218_45%_14%)]">
            {why.reasons.map((r) => <li key={r} dir="auto">{r}</li>)}
          </ul>
          {why.uncertain.length ? (
            <p className="mt-1.5 text-xs leading-relaxed text-[hsl(30_70%_28%)]">{t('hl_unc_title')}: {why.uncertain.join(' · ')}</p>
          ) : null}
        </div>
      ) : null}

      {m ? (
        <div className="mt-4">
          <p className="text-2xs font-bold uppercase tracking-[0.12em] text-[hsl(34_90%_34%)]">{t('lp_why', { score: String(m.score) })}</p>
          <ul className="mt-2 divide-y divide-[hsl(40_12%_88%)] rounded-xl border border-[hsl(40_12%_86%)]">
            {DIMENSION_ORDER.map((dim) => {
              const state = agreed.has(dim) ? 'AGREED' : conflicted.has(dim) ? 'CONFLICT' : unknown.has(dim) ? 'UNKNOWN' : null;
              if (!state) return null;
              const Icon = state === 'AGREED' ? CheckCircle2 : state === 'CONFLICT' ? CircleSlash : CircleDashed;
              return (
                <li key={dim} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 break-words">{t(`hl_dim_${dim.toLowerCase()}`)}</span>
                  <span className={cn('inline-flex shrink-0 items-center gap-1 text-xs font-semibold',
                    state === 'AGREED' ? 'text-[hsl(152_55%_28%)]' : state === 'CONFLICT' ? 'text-[hsl(0_55%_40%)]' : 'text-[hsl(218_15%_42%)]')}>
                    <Icon className="h-4 w-4" aria-hidden="true" />{t(`hl_dim_state_${state.toLowerCase()}`)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="mt-4" data-testid="lp-contact">
        <p className="text-2xs font-bold uppercase tracking-[0.12em] text-[hsl(34_90%_34%)]">{t('lp_contact')}</p>
        {!contact ? (
          <p className="mt-1 text-sm text-[hsl(218_15%_40%)]">{t('crm_loading')}</p>
        ) : contact.restricted ? (
          <p className="mt-1 flex items-start gap-2 rounded-xl bg-[hsl(0_60%_97%)] px-3 py-2 text-sm text-[hsl(0_45%_32%)]">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t(`hl_restricted_${String(contact.reason ?? 'UNAVAILABLE').toLowerCase()}`)}
          </p>
        ) : (
          <div className="mt-1.5 flex flex-col gap-1.5">
            {contact.phone ? <a href={`tel:${contact.phone}`} dir="ltr" className="inline-flex items-center gap-2 text-sm font-semibold text-[hsl(218_45%_14%)] underline-offset-2 hover:underline"><Phone className="h-4 w-4 text-[hsl(34_90%_36%)]" aria-hidden="true" />{contact.phone}</a> : null}
            {contact.email ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-testid="lp-contact-email">
                <a href={`mailto:${contact.email}`} dir="ltr" className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-[hsl(218_45%_14%)] underline-offset-2 hover:underline [overflow-wrap:anywhere]"><Mail className="h-4 w-4 shrink-0 text-[hsl(34_90%_36%)]" aria-hidden="true" />{contact.email}</a>
                <CopyEmailButton email={contact.email} size="sm" testId="lp-copy-email" />
              </div>
            ) : null}
            {!contact.phone && !contact.email ? <p className="text-sm text-[hsl(218_28%_34%)]">{t('hl_contact_message_only')}</p> : null}
            <p className="text-2xs leading-relaxed text-[hsl(218_15%_42%)]">{t('lp_contact_consent')}</p>
          </div>
        )}
      </div>

      {profile.drafts.length ? (
        <details className="mt-4 rounded-xl border border-[hsl(40_12%_86%)] p-3" data-testid="lp-drafts">
          <summary className="cursor-pointer text-sm font-semibold">{t('lp_drafts', { n: String(profile.drafts.length) })}</summary>
          <ul className="mt-2 space-y-2">
            {profile.drafts.map((dr, i) => (
              <li key={i} className="rounded-lg bg-[hsl(42_38%_98%)] p-2.5 text-xs">
                <p className="font-semibold text-[hsl(218_28%_30%)]">
                  {t(`lo_channel_${String(dr.detail.channel ?? 'HOMATCH_CHAT')}`)} · <time dateTime={dr.createdAt}>{fmt.dateTime(dr.createdAt)}</time>
                </p>
                {dr.detail.subject ? <p className="mt-1 font-semibold" dir="auto">{String(dr.detail.subject)}</p> : null}
                <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed" dir="auto">{String(dr.detail.body ?? '')}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </SectionCard>
  );
}

export default LeadProfileCard;

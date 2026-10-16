// POTENTIAL BUYER / TENANT / INTERESTED PERSON — the compact result card
// (owner, 2026-10-16): scannable in a list, about 150px tall on a 390px phone.
//
//   line 1   source mark · who · how long ago · evidence available
//   line 2-3 their own words, clamped (original language and direction kept)
//   line 4   what they are (one chip) · how relevant (one chip) · Details
//
// Everything else — why they may match, intent vs compatibility, every piece of
// evidence with its links, translation — lives on the lead's detail page
// (src/pages/property/LeadDetailPage.tsx). Logical properties throughout, so
// Arabic and Hebrew mirror; the excerpt takes its own direction.

import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, FileText, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import type { PotentialLead } from '@/services/findBuyers';
import { INK, INK_SOFT, sourceStyle } from '@/components/findBuyers/brand';
import { LEAD_LANGS, ageLabel, leadHref } from '@/components/findBuyers/leadText';
import type { TabPlacement } from '@/findBuyers/externalResults';

const CHIP = 'min-w-0 rounded-full px-1.5 py-0.5 text-2xs font-semibold ring-1 ring-inset';
const KIND_TONE = {
  qualified: 'bg-[hsl(218_70%_96%)] text-[hsl(220_60%_28%)] ring-[hsl(218_50%_84%)]',
  interested: 'bg-[hsl(200_70%_96%)] text-[hsl(205_70%_26%)] ring-[hsl(200_50%_82%)]',
  verify: 'bg-[hsl(42_100%_94%)] text-[hsl(34_90%_28%)] ring-[hsl(40_80%_74%)]',
} as const;
const REL_TONE: Record<string, string> = {
  STRONG: 'bg-[linear-gradient(135deg,hsl(42_96%_62%),hsl(34_90%_50%))] text-[hsl(218_52%_11%)] ring-transparent',
  POTENTIAL: 'bg-white text-[hsl(34_90%_28%)] ring-[hsl(40_80%_62%)]',
  WEAK: 'bg-white text-[hsl(218_28%_34%)] ring-[hsl(218_40%_84%)]',
  UNCATEGORISED: 'bg-white text-[hsl(218_28%_34%)] ring-[hsl(218_40%_84%)] italic',
};

/** The one classification word for a lead in its tab. */
export function leadKindKey(placement: TabPlacement, tenant: boolean): { key: string; tone: keyof typeof KIND_TONE } {
  if (placement.reason === 'TRANSACTION_UNCONFIRMED') return { key: 'fbx_kind_verify_transaction', tone: 'verify' };
  if (placement.needsVerification) return { key: 'fbx_kind_needs_verification', tone: 'verify' };
  if (placement.tab === 'direct') return { key: tenant ? 'fbx_kind_qualified_tenant' : 'fbx_kind_qualified_buyer', tone: 'qualified' };
  return { key: 'fbx_kind_interested', tone: 'interested' };
}

export const relevanceCategory = (lead: Pick<PotentialLead, 'match_category'>): 'STRONG' | 'POTENTIAL' | 'WEAK' | 'UNCATEGORISED' =>
  lead.match_category === 'STRONG' || lead.match_category === 'POTENTIAL' || lead.match_category === 'WEAK' ? lead.match_category : 'UNCATEGORISED';

export function PotentialBuyerCard({ lead, propertyId, placement, tenant }: {
  lead: PotentialLead;
  propertyId: string;
  placement: TabPlacement;
  tenant: boolean;
}) {
  const { t } = useLanguage();
  const best = lead.evidence[0];
  const src = sourceStyle(lead.source);
  const srcLang = best?.language && LEAD_LANGS.has(best.language) ? best.language : null;
  const age = ageLabel(best?.publishedAt ?? lead.signal_at, t);
  const kind = leadKindKey(placement, tenant);
  const rel = relevanceCategory(lead);
  const evidence = lead.evidence.length;
  const who = lead.author_name ?? t(kind.key);

  return (
    <article
      data-testid="fbx-lead-card" data-lead={lead.id} data-tab={placement.tab} data-verify={placement.needsVerification ? 'true' : 'false'}
      aria-label={t(kind.key)}
      className="flex min-w-0 flex-col gap-1.5 rounded-2xl bg-white p-3 shadow-[0_8px_24px_-20px_hsl(218_60%_15%/0.5)] ring-1 ring-inset ring-[hsl(40_60%_84%)] transition-shadow hover:shadow-[0_14px_30px_-20px_hsl(218_60%_15%/0.6)] motion-reduce:transition-none"
    >
      {/* line 1: where, who, when, evidence */}
      <div className="flex min-w-0 items-center gap-2 text-2xs">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white" style={{ backgroundColor: src.color }} title={src.label}>
          <src.Icon className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">{src.label}</span>
        </span>
        {lead.author_name ? null : <UserRound className={cn('h-3.5 w-3.5 shrink-0', INK_SOFT)} aria-hidden="true" />}
        <p dir="auto" className={cn('min-w-0 flex-1 truncate text-sm font-semibold', INK)}>{who}</p>
        {age ? <span className={cn('shrink-0 whitespace-nowrap', INK_SOFT)}>{age}</span> : null}
        {evidence > 0 ? (
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[hsl(42_100%_95%)] px-1.5 py-px font-semibold tabular-nums text-[hsl(34_90%_30%)]"
            data-testid="fbx-card-evidence" title={t('fbx_card_evidence', { n: String(evidence) })}>
            <FileText className="h-3 w-3" aria-hidden="true" /><span dir="ltr">{evidence}</span>
            <span className="sr-only">{t('fbx_card_evidence', { n: String(evidence) })}</span>
          </span>
        ) : null}
      </div>

      {/* line 2–3: their own words, in their own language and direction */}
      {best?.text ? (
        <p dir="auto" lang={srcLang ?? undefined} data-testid="fbx-card-excerpt"
          className={cn('line-clamp-2 min-w-0 break-words text-start text-sm leading-snug [unicode-bidi:plaintext]', INK)}>
          <bdi>{best.text}</bdi>
        </p>
      ) : null}

      {/* line 4: one classification, one relevance, one action */}
      <div className="flex min-w-0 items-center gap-1.5">
        {/* The two chips wrap to a second line before any label is cut; a chip truncates only
            when it alone is wider than the card (long labels at 320px). */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <span data-testid="fbx-card-kind" title={t(kind.key)} className={cn(CHIP, 'block max-w-full truncate', KIND_TONE[kind.tone])}>{t(kind.key)}</span>
          <span data-testid="fbx-card-relevance" data-category={rel} title={t(`fbx_rel_${rel}`)} className={cn(CHIP, 'inline-flex max-w-full items-center gap-1', REL_TONE[rel])}>
            <span className="truncate">{t(`fbx_rel_${rel}`)}</span>
            {rel !== 'UNCATEGORISED' ? <span className="hidden shrink-0 tabular-nums opacity-80 sm:inline" dir="ltr">{Math.round(lead.overall_score)}</span> : null}
          </span>
        </div>
        <Link to={leadHref(propertyId, lead.id)} data-testid="fbx-lead-details"
          className="inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-xl px-2.5 text-sm font-semibold text-[hsl(34_90%_30%)] ring-1 ring-inset ring-[hsl(40_80%_62%)] transition-colors hover:bg-[hsl(42_100%_96%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]">
          {t('fbx_card_details')}<ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

export default PotentialBuyerCard;

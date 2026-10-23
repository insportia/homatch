// External Leads Database — the rows, Available (masked, priced) and Unlocked (full detail).
//
// One element per lead that is a compact table row from md up and a selectable card below
// it; long pages (200 / 500) skip off-screen layout with content-visibility instead of a
// virtual list, so find-in-page and screen readers still see every row.

import { Facebook, Linkedin, Mail, MessageCircle, Phone, Send, Share2 } from 'lucide-react';
import { useMemo } from 'react';
import { formatMoney, intlLocaleFor, isolate } from '@/components/workspace/primitives';
import { useLanguage } from '@/contexts/LanguageContext';
import { curatedSummary, type SummaryContext } from '@/leads/curatedSummary';
import { cn } from '@/lib/utils';
import type { CuratedLead, CuratedPrice } from '@/services/matchingWorkspace';
import { countryName, creditsToUsd, flagOf, formatCredits, formatDate, formatList, formatUsd, languageName } from './format';
import { RowCheck } from './RowCheck';

export function useSummaryContext(): SummaryContext {
  const { t, lang } = useLanguage();
  return useMemo(() => ({
    t, lang,
    countryName: (c: string) => countryName(c, lang),
    languageName: (c: string) => languageName(c, lang),
    money: (n: number, cur: string | null) => isolate(formatMoney(n, cur || 'USD', intlLocaleFor(lang), { narrowSymbol: true, decimals: 0 })),
    list: (items: string[]) => formatList(items, lang),
  }), [t, lang]);
}

const CHANNEL_ICONS = [
  ['email', Mail, 'mw_ch_EMAIL'], ['phone', Phone, 'mw_ch_PHONE'], ['whatsapp', MessageCircle, 'mw_ch_WHATSAPP'],
  ['telegram', Send, 'mw_ch_TELEGRAM'], ['facebook', Facebook, 'mw_ch_FACEBOOK'], ['linkedin', Linkedin, 'mw_ch_LINKEDIN'],
  ['otherSocial', Share2, 'mw_ch_SOCIAL'],
] as const;

export function ChannelIcons({ channels }: { channels: CuratedLead['channels'] | null | undefined }) {
  const { t } = useLanguage();
  const on = CHANNEL_ICONS.filter(([k]) => channels?.[k]);
  if (!on.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1" data-testid="mw-channels">
      {on.map(([k, Icon, key]) => (
        <span key={k} title={t(key)} className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[hsl(218_30%_96%)] text-[hsl(218_45%_22%)]">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">{t(key)}</span>
        </span>
      ))}
    </span>
  );
}

export function InterestChips({ interests }: { interests: string[] | null | undefined }) {
  const { t } = useLanguage();
  if (!interests?.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {interests.map((i) => (
        <span key={i} className={cn('rounded-full px-2 py-0.5 text-2xs font-bold uppercase tracking-[0.06em]',
          i === 'INVEST' ? 'bg-[#0C1119] text-[hsl(38_92%_62%)]' : i === 'RENT' ? 'bg-[hsl(210_80%_95%)] text-[hsl(212_70%_30%)]' : 'bg-[hsl(152_45%_94%)] text-[hsl(152_55%_22%)]')}>
          {t(`mw_interest_${i}`)}
        </span>
      ))}
    </span>
  );
}

function Detail({ label, value, href, testId }: { label: string; value: string | null | undefined; href?: string | null; testId?: string }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-2xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm font-semibold text-[hsl(218_45%_14%)]" dir="ltr" data-testid={testId}>
        {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline [overflow-wrap:anywhere]">{value}</a> : <span className="[overflow-wrap:anywhere]">{value}</span>}
      </dd>
    </div>
  );
}

const safeHttp = (v: string | null | undefined) => (v && /^https?:\/\//i.test(v) ? v : null);

export function CuratedRows({
  items, view, price, isSelected, onToggle,
}: {
  items: CuratedLead[];
  view: 'AVAILABLE' | 'UNLOCKED';
  price: CuratedPrice | null;
  isSelected: (id: string) => boolean;
  onToggle: (id: string) => void;
}) {
  const { t, lang } = useLanguage();
  const ctx = useSummaryContext();
  const unlocked = view === 'UNLOCKED';
  return (
    <div role="list" className="divide-y divide-[hsl(var(--border))] overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-white shadow-card" data-testid="mw-list" data-product="external" data-view={view}>
      {items.map((lead) => {
        const name = unlocked ? [lead.firstName, lead.lastName].filter(Boolean).join(' ') : lead.displayName ?? '';
        const selected = isSelected(lead.id);
        const added = formatDate(lead.addedAt, lang);
        const verified = formatDate(lead.lastVerifiedAt, lang);
        return (
          <div key={lead.id} role="listitem" data-testid="mw-row" data-id={lead.id}
            className={cn('grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-3 py-3 sm:px-4 [content-visibility:auto] [contain-intrinsic-size:auto_96px]',
              'md:grid-cols-[auto_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,2fr)_auto] md:items-center',
              selected && 'bg-[hsl(42_100%_97%)]')}>
            <RowCheck checked={selected} onChange={() => onToggle(lead.id)} label={t('mw_select_lead', { name: name || lead.id })} />
            <div className="min-w-0">
              <p className="truncate font-semibold text-[hsl(218_45%_14%)]" dir="auto" data-testid="mw-row-name">{name || '—'}</p>
              <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-[hsl(224_14%_32%)]">
                <span aria-hidden="true">{flagOf(lead.country)}</span>
                <span className="truncate">{countryName(lead.country, lang)}</span>
              </p>
            </div>
            <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-1.5 md:col-start-auto">
              <InterestChips interests={lead.interests} />
              <ChannelIcons channels={lead.channels} />
              {lead.languages?.length ? (
                <span className="text-2xs font-semibold text-[hsl(224_14%_32%)]">{lead.languages.map((l) => languageName(l, lang)).join(' · ')}</span>
              ) : null}
            </div>
            <div className="col-start-2 min-w-0 md:col-start-auto">
              <p className="line-clamp-2 text-xs leading-relaxed text-[hsl(224_14%_26%)]" dir="auto" data-testid="mw-row-summary">{curatedSummary(lead, ctx)}</p>
              <p className="mt-1 text-2xs text-muted-foreground">
                {added ? t('mw_added_on', { date: added }) : null}
                {verified ? ` · ${t('mw_verified_on', { date: verified })}` : ''}
                {unlocked && lead.unlockedAt ? ` · ${t('mw_unlocked_on', { date: formatDate(lead.unlockedAt, lang) ?? '' })}` : ''}
              </p>
            </div>
            <div className="col-start-2 flex items-center justify-between gap-2 md:col-start-auto md:flex-col md:items-end md:justify-center">
              {unlocked ? (
                lead.creditsCharged != null ? (
                  <span className="text-2xs font-semibold text-[hsl(224_14%_32%)]" dir="ltr">{t('mw_paid_credits', { credits: formatCredits(lead.creditsCharged, lang) })}</span>
                ) : null
              ) : price ? (
                <span className="inline-flex items-baseline gap-1 rounded-lg bg-[hsl(var(--gold-soft))] px-2 py-1 text-xs font-bold text-[hsl(var(--gold-ink))]" data-testid="mw-row-price">
                  <span dir="ltr">{t(price.credits === 1 ? 'mw_credit_one' : 'mw_credits_n', { n: formatCredits(price.credits, lang) })}</span>
                  <span className="font-semibold opacity-80" dir="ltr">{formatUsd(price.cents ? price.cents / 100 : creditsToUsd(price.credits), lang)}</span>
                </span>
              ) : null}
            </div>
            {unlocked ? (
              <dl className="col-span-2 grid gap-x-4 gap-y-2 rounded-xl bg-[hsl(218_30%_98%)] p-3 sm:grid-cols-2 md:col-start-2 md:col-end-6 lg:grid-cols-4" data-testid="mw-contact">
                <Detail label={t('mw_field_email')} value={lead.email} href={lead.email ? `mailto:${lead.email}` : null} testId="mw-contact-email" />
                <Detail label={t('mw_field_phone')} value={lead.phone} href={lead.phone ? `tel:${lead.phone.replace(/[^\d+]/g, '')}` : null} />
                <Detail label={t('mw_ch_WHATSAPP')} value={lead.whatsapp} />
                <Detail label={t('mw_ch_TELEGRAM')} value={lead.telegram} />
                <Detail label={t('mw_ch_FACEBOOK')} value={lead.facebook} href={safeHttp(lead.facebook)} />
                <Detail label={t('mw_ch_LINKEDIN')} value={lead.linkedin} href={safeHttp(lead.linkedin)} />
                <Detail label={t('mw_ch_SOCIAL')} value={lead.otherSocial} href={safeHttp(lead.otherSocial)} />
              </dl>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

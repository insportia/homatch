// THE CONTACT PICKER — one searchable, selectable list of the owner's own
// contacts (my_contact_library), used by the contact library, Email Studio's
// recipient step and the message assistant.
//
// Every row shows where the contact came from (unlock, campaign result, import,
// HOMATCH member), the property and campaign it belongs to, and the channels it
// can ACTUALLY be reached on. When a composer needs one channel (Email Studio
// needs a sendable email), rows without it stay visible but cannot be selected,
// and say why — a profile link is never presented as an email address.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AtSign, CheckSquare, ExternalLink, Globe2, MessageCircle, Phone, Search, Square, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { SourceBadge } from '@/components/findBuyers/brand';
import { ServiceBadge } from '@/components/matching/ServiceIdentity';
import { safeExternalUrl, openExternal } from '@/lib/safeExternalUrl';
import {
  type Channel, type ContactKind, type LibraryContact, type LibraryFilter, channelsOf, filterContacts,
} from '@/services/contactLibrary';

const CHANNEL_ICON: Record<Channel, React.ComponentType<{ className?: string }>> = {
  EMAIL: AtSign, PHONE: Phone, PROFILE: Globe2, HOMATCH_CHAT: MessageCircle,
};
const KINDS: Array<ContactKind | 'ALL'> = ['ALL', 'OUTREACH_CONTACT', 'UNLOCKED_MATCH', 'CAMPAIGN_LEAD', 'HOMATCH_MEMBER'];

export function ChannelChips({ contact }: { contact: LibraryContact }) {
  const { t } = useLanguage();
  const channels = channelsOf(contact);
  if (!channels.length) return <span className="text-2xs text-muted-foreground">{t('cl_no_channel')}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {channels.map((ch) => {
        const Icon = CHANNEL_ICON[ch];
        return (
          <span key={ch} className="inline-flex items-center gap-1 rounded-full bg-[hsl(218_60%_96%)] px-2 py-0.5 text-2xs font-semibold text-[hsl(220_55%_30%)] ring-1 ring-inset ring-[hsl(218_50%_86%)]">
            <Icon className="h-3 w-3" aria-hidden="true" />{t(`cl_channel_${ch.toLowerCase()}`)}
          </span>
        );
      })}
    </span>
  );
}

export function ContactPicker({
  contacts, selected, onChange, requireChannel, compact = false, initialFilter,
}: {
  contacts: LibraryContact[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Rows without this channel are shown but cannot be selected. */
  requireChannel?: Channel;
  compact?: boolean;
  initialFilter?: LibraryFilter;
}) {
  const { t, lang } = useLanguage();
  const [filter, setFilter] = useState<LibraryFilter>({ q: '', kind: 'ALL', channel: 'ANY', propertyId: 'ALL', campaignJobId: 'ALL', ...initialFilter });
  const shown = useMemo(() => filterContacts(contacts, filter), [contacts, filter]);
  const properties = useMemo(() => {
    const m = new Map<string, string>();
    contacts.forEach((c) => { if (c.propertyId) m.set(c.propertyId, c.propertyTitle || t('matches_rail_untitled')); });
    return [...m.entries()];
  }, [contacts, t]);
  const campaigns = useMemo(() => {
    const ids = new Set<string>();
    contacts.forEach((c) => { if (c.campaignJobId && (filter.propertyId === 'ALL' || c.propertyId === filter.propertyId)) ids.add(c.campaignJobId); });
    return [...ids];
  }, [contacts, filter.propertyId]);

  const eligible = (c: LibraryContact) => !requireChannel || channelsOf(c).includes(requireChannel);
  const shownEligible = shown.filter(eligible);
  const allShownOn = shownEligible.length > 0 && shownEligible.every((c) => selected.has(c.key));
  const toggle = (c: LibraryContact) => {
    if (!eligible(c)) return;
    const next = new Set(selected);
    if (next.has(c.key)) next.delete(c.key); else next.add(c.key);
    onChange(next);
  };
  const toggleShown = () => {
    const next = new Set(selected);
    if (allShownOn) shownEligible.forEach((c) => next.delete(c.key)); else shownEligible.forEach((c) => next.add(c.key));
    onChange(next);
  };
  const select = 'h-10 min-w-0 rounded-xl bg-background px-3 text-sm ring-1 ring-inset ring-border focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="space-y-3">
      <div className={cn('grid gap-2', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-4')}>
        <label className={cn('relative min-w-0', compact ? 'sm:col-span-2' : 'sm:col-span-2 lg:col-span-1')}>
          <span className="sr-only">{t('cl_search')}</span>
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} placeholder={t('cl_search')} dir="auto"
            className="h-10 w-full rounded-xl bg-background pe-9 ps-9 text-sm ring-1 ring-inset ring-border focus:outline-none focus:ring-2 focus:ring-ring" />
          {filter.q ? (
            <button type="button" onClick={() => setFilter((f) => ({ ...f, q: '' }))} aria-label={t('cw_clear_search')}
              className="absolute end-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg hover:bg-muted"><X className="h-4 w-4" aria-hidden="true" /></button>
          ) : null}
        </label>
        <select className={select} value={filter.channel} aria-label={t('cl_filter_channel')}
          onChange={(e) => setFilter((f) => ({ ...f, channel: e.target.value as Channel | 'ANY' }))}>
          <option value="ANY">{t('cl_any_channel')}</option>
          {(['EMAIL', 'PHONE', 'PROFILE', 'HOMATCH_CHAT'] as Channel[]).map((ch) => <option key={ch} value={ch}>{t(`cl_channel_${ch.toLowerCase()}`)}</option>)}
        </select>
        <select className={select} value={filter.propertyId} aria-label={t('cl_filter_property')}
          onChange={(e) => setFilter((f) => ({ ...f, propertyId: e.target.value, campaignJobId: 'ALL' }))}>
          <option value="ALL">{t('cl_all_properties')}</option>
          {properties.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
        </select>
        {!compact && (
          <select className={select} value={filter.campaignJobId} aria-label={t('cl_filter_campaign')} disabled={!campaigns.length}
            onChange={(e) => setFilter((f) => ({ ...f, campaignJobId: e.target.value }))}>
            <option value="ALL">{t('cl_all_campaigns')}</option>
            {campaigns.map((id, i) => <option key={id} value={id}>{t('cl_campaign_n', { n: String(i + 1) })}</option>)}
          </select>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('cl_filter_kind')}>
        {KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={filter.kind === k} onClick={() => setFilter((f) => ({ ...f, kind: k }))}
            className={cn('min-h-8 rounded-full px-3 text-2xs font-semibold ring-1 ring-inset transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              filter.kind === k ? 'bg-foreground text-background ring-foreground' : 'bg-background text-foreground ring-border hover:bg-muted')}>
            {t(`cl_kind_${k.toLowerCase()}`)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-muted-foreground">
        <span aria-live="polite">{t('cl_showing', { shown: String(shown.length), total: String(contacts.length) })} · {t('cw_selected_n', { n: String(selected.size) })}</span>
        <button type="button" onClick={toggleShown} disabled={!shownEligible.length}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 font-semibold text-foreground hover:bg-muted disabled:opacity-50">
          {allShownOn ? <CheckSquare className="h-4 w-4" aria-hidden="true" /> : <Square className="h-4 w-4" aria-hidden="true" />}
          {t(allShownOn ? 'cl_unselect_shown' : 'cl_select_shown')}
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl bg-muted/40 p-4 text-center text-sm text-muted-foreground">{t(contacts.length ? 'cw_no_filtered_results' : 'cl_empty')}</p>
      ) : (
        <ul className={cn('divide-y divide-border overflow-y-auto rounded-xl ring-1 ring-inset ring-border', compact ? 'max-h-[45dvh]' : 'max-h-[65dvh]')}>
          {shown.map((c) => {
            const on = selected.has(c.key);
            const ok = eligible(c);
            const profile = safeExternalUrl(c.profileUrl);
            return (
              <li key={c.key} className={cn('flex min-w-0 items-start gap-3 px-3 py-2.5', on && 'bg-[hsl(42_100%_96%)]', !ok && 'opacity-70')}>
                <button type="button" role="checkbox" aria-checked={on} disabled={!ok} onClick={() => toggle(c)}
                  aria-label={t(on ? 'cw_unselect_one' : 'cw_select_one', { name: c.name ?? c.email ?? t('cl_unnamed') })}
                  className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed">
                  {on ? <CheckSquare className="h-5 w-5 text-[hsl(34_90%_40%)]" aria-hidden="true" /> : <Square className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
                </button>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span dir="auto" className="min-w-0 break-words text-sm font-semibold text-foreground">{c.name || c.email || t('cl_unnamed')}</span>
                    {c.kind === 'HOMATCH_MEMBER' ? <ServiceBadge service="internal" compact />
                      : c.kind === 'OUTREACH_CONTACT' ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-2xs font-semibold text-muted-foreground">{t('cl_kind_outreach_contact')}</span>
                      ) : <ServiceBadge service="external" compact />}
                  </div>
                  {c.email ? <p className="min-w-0 break-all text-2xs text-muted-foreground" dir="ltr">{c.email}</p> : null}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ChannelChips contact={c} />
                    {c.source && c.source !== 'IMPORT' && c.source !== 'HOMATCH' ? <SourceBadge source={c.source} /> : null}
                  </div>
                  <p className="min-w-0 text-2xs text-muted-foreground">
                    {t(`cl_provenance_${c.kind.toLowerCase()}`)}
                    {c.propertyTitle ? <> · <span className="break-words">{c.propertyTitle}</span></> : null}
                    {c.acquiredAt ? <> · {new Date(c.acquiredAt).toLocaleDateString(lang)}</> : null}
                  </p>
                  {!ok && requireChannel ? <p className="text-2xs font-medium text-[hsl(34_90%_34%)]">{t(`cl_needs_${requireChannel.toLowerCase()}`)}</p> : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {profile ? (
                    <button type="button" onClick={() => openExternal(c.profileUrl)} aria-label={t('cl_open_profile')}
                      className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : null}
                  {c.propertyId && c.campaignJobId ? (
                    <Link to={`/property/${c.propertyId}/campaigns/${c.campaignJobId}?view=results`} className="text-2xs font-semibold text-[hsl(34_90%_36%)] underline-offset-4 hover:underline">
                      {t('cl_open_campaign')}
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default ContactPicker;

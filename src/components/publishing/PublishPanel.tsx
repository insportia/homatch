// PUBLISH TO SELECTED PORTALS — the customer's one action.
//
// HOMATCH publishes through its OWN portal accounts. The customer picks portals,
// sees exactly what will be posted (the HOMATCH number in the portal's contact
// field, their own name and number once at the end of the description), gives
// consent, and presses one button. Each portal then shows its real status from
// the server — never a success the portal has not confirmed.

import { ExternalLink, Loader2, Send, ShieldCheck, Undo2 } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { CustomerStatusMark, Panel, PortalLogo, PortalPicker, dateTime } from '@/components/publishing/parts';
import { OWNER_PRIMARY, OWNER_SECONDARY } from '@/components/owner/portfolio';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { formatPhone, isE164 } from '@/publishing/contacts';
import {
  type ListingDraft, type ListingRow, type PortalId, type PortalInfo, type PublicationRow,
  canRequestPublish, centralDescription, copyLanguage, customerStatus,
} from '@/publishing/model';

export interface PublishPanelProps {
  portals: PortalInfo[];
  listing: ListingRow | null;
  publications: PublicationRow[];
  draft: ListingDraft;
  dirty: boolean;
  readOnly: boolean;
  busy: string | null;
  locale: string;
  onPublish: (portalIds: PortalId[]) => void;
  onWithdraw: (portal: PortalInfo) => void;
  onEdit: () => void;
}

export function PublishPanel({ portals, listing, publications, draft, dirty, readOnly, busy, locale, onPublish, onWithdraw, onEdit }: PublishPanelProps) {
  const { t } = useLanguage();
  const pubFor = (id: PortalId) => publications.find((p) => p.portal_id === id) ?? null;
  const central = publications.filter((p) => p.channel === 'HOMATCH_ACCOUNT');
  const initial = useMemo(() => draft.portalTargets.filter((id) => canRequestPublish(pubFor(id))), [draft.portalTargets.join(','), publications]);
  const [selected, setSelected] = useState<PortalId[]>(initial);
  const [consent, setConsent] = useState(false);
  useEffect(() => { setSelected(initial); }, [initial.join(',')]);

  const lang = copyLanguage(draft);
  const ownerPhone = draft.contacts[0]?.phone ?? '';
  const ownerReady = !!draft.contactName.trim() && isE164(ownerPhone);
  const ready = !!listing?.validation.ready;
  const choosable = portals.filter((p) => p.enabled && !p.homatch?.unavailable && canRequestPublish(pubFor(p.id)));
  const chosen = selected.filter((id) => choosable.some((p) => p.id === id));
  const portalProblems = Object.fromEntries(portals.map((p) => [p.id, listing?.validation.portals[p.id] ?? []]));
  const blockedBy = chosen.filter((id) => portalProblems[id]?.length);
  const homatchPhone = portals.find((p) => chosen.includes(p.id) && p.homatch?.contactPhone)?.homatch?.contactPhone ?? null;
  const reason = readOnly ? null : !listing ? 'pubw_publish_need_save' : dirty ? 'pubw_publish_need_save' : !ready ? 'pubw_publish_need_ready'
    : !ownerReady ? 'pubw_publish_need_owner' : !chosen.length ? 'pubw_publish_need_portal' : blockedBy.length ? 'pubw_publish_need_portal_fields' : !consent ? 'pubw_publish_need_consent' : null;
  const publishing = busy === 'publish';

  return (
    <div className="space-y-4" data-testid="pubw-publish">
      <Panel title={t('pubw_publish_title')} aside={<span className="text-2xs text-muted-foreground">{t('pubw_publish_selected', { n: chosen.length })}</span>}>
        <p className="mb-3 text-sm text-muted-foreground">{t('pubw_publish_intro')}</p>
        <PortalPicker
          portals={portals.filter((p) => canRequestPublish(pubFor(p.id)))}
          selected={chosen}
          disabled={readOnly || publishing}
          problems={portalProblems}
          onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
        />
      </Panel>

      <Panel title={t('pubw_publish_preview_title')}>
        <dl className="mb-3 grid gap-2 text-sm sm:grid-cols-2">
          <div className="min-w-0 rounded-xl border border-border bg-secondary/40 p-3">
            <dt className="text-2xs font-semibold text-muted-foreground">{t('pubw_publish_listing_phone')}</dt>
            <dd className="mt-0.5 font-semibold text-foreground" dir="ltr" data-testid="pubw-publish-homatch-phone">{homatchPhone ? formatPhone(homatchPhone) : t('pubw_publish_homatch_phone_pending')}</dd>
            <dd className="mt-0.5 text-2xs text-muted-foreground">{t('pubw_publish_listing_phone_note')}</dd>
          </div>
          <div className="min-w-0 rounded-xl border border-border bg-secondary/40 p-3">
            <dt className="text-2xs font-semibold text-muted-foreground">{t('pubw_publish_owner_contact')}</dt>
            <dd className="mt-0.5 font-semibold text-foreground break-words">{draft.contactName || '—'} · <span dir="ltr">{isE164(ownerPhone) ? formatPhone(ownerPhone) : '—'}</span></dd>
            <dd className="mt-0.5 text-2xs text-muted-foreground">{t('pubw_publish_owner_contact_note')}</dd>
          </div>
        </dl>
        <p className="mb-1 text-2xs font-semibold text-muted-foreground">{t('pubw_publish_description')}</p>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-[hsl(var(--card))] p-3 font-sans text-sm text-foreground" dir="auto" data-testid="pubw-publish-description">
          {centralDescription(draft, lang)}
        </pre>
        {!ownerReady ? <p className="mt-2 text-2xs font-medium text-amber-800">{t('pubw_publish_need_owner')} <button type="button" className="underline" onClick={onEdit}>{t('pubw_edit_listing')}</button></p> : null}
      </Panel>

      {!readOnly ? (
        <section className="rounded-2xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]/60 p-4 shadow-card sm:p-5">
          <label className="flex items-start gap-3 text-sm text-foreground">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#0C1119]" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="pubw-publish-consent" />
            <span>{t('pubw_publish_consent')}</span>
          </label>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-2xs text-muted-foreground" aria-live="polite">{reason ? t(reason) : t('pubw_publish_ready_note', { n: chosen.length })}</p>
            <button type="button" className={cn(OWNER_PRIMARY, 'min-h-12 w-full px-6 text-base sm:w-auto')} disabled={!!reason || publishing}
              onClick={() => onPublish(chosen)} data-testid="pubw-publish-button">
              {publishing ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Send className="h-5 w-5 rtl:-scale-x-100" aria-hidden="true" />}
              {t('pubw_publish_button')}
            </button>
          </div>
        </section>
      ) : null}

      {central.length ? (
        <Panel title={t('pubw_publish_status_title')}>
          <ul className="divide-y divide-border" data-testid="pubw-publish-status">
            {central.map((pub) => {
              const portal = portals.find((p) => p.id === pub.portal_id);
              if (!portal) return null;
              const status = customerStatus(listing, pub);
              const withdrawable = ['QUEUED', 'ADMIN_ACTION_REQUIRED', 'AUTH_REQUIRED', 'PUBLISHED', 'OWNER_CONFIRMED', 'VERIFYING', 'PUBLISHING'].includes(pub.status);
              return (
                <li key={pub.id} className="flex flex-wrap items-center gap-3 py-3" data-testid={`pubw-status-${portal.id}`}>
                  <PortalLogo portal={portal} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-sm font-semibold text-foreground">{portal.name}</span>
                      <CustomerStatusMark status={status} />
                    </span>
                    <span className="block text-2xs text-muted-foreground break-words">
                      {pub.status_reason && (status === 'REJECTED' || status === 'FAILED') ? pub.status_reason : t(`pubw_cs_${status.toLowerCase()}_note`)}
                      {' · '}{dateTime(pub.updated_at, locale)}
                    </span>
                    {pub.status === 'OWNER_CONFIRMED' ? <span className="mt-0.5 inline-flex items-center gap-1 text-2xs text-muted-foreground"><ShieldCheck className="h-3 w-3" aria-hidden="true" />{t('pubw_publish_attested')}</span> : null}
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {pub.external_url && status === 'PUBLISHED' ? (
                      <a href={pub.external_url} target="_blank" rel="noopener noreferrer" className={OWNER_SECONDARY}>
                        <ExternalLink className="h-4 w-4" aria-hidden="true" />{t('pubw_open_on_portal')}
                      </a>
                    ) : null}
                    {!readOnly && withdrawable ? (
                      <button type="button" className={OWNER_SECONDARY} disabled={busy !== null} onClick={() => onWithdraw(portal)} data-testid={`pubw-withdraw-${portal.id}`}>
                        <Undo2 className="h-4 w-4" aria-hidden="true" />{t(['QUEUED', 'ADMIN_ACTION_REQUIRED', 'AUTH_REQUIRED'].includes(pub.status) ? 'pubw_publish_withdraw' : 'pubw_publish_deactivate')}
                      </button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

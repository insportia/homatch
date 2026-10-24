// HOMATCH Leads — mortgage-interested buyers who fit this listing.
//
// Only people who opted in after a mortgage calculation, showing only what
// they chose to share. Before unlock: area, type, budget range, timing and
// how recent the interest is. Never a name, a channel or any financial
// figure. After unlock: the channels they allowed. One price per buyer
// per account: a buyer this account already unlocked, by any route, is
// shown as unlocked and never offered a second paid unlock.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Landmark, Lock, Mail, Phone, Unlock } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { UnlockError } from '@/services/homatchLeads';
import {
  getMortgageLeadContact, getMortgageLeadFeed, newMortgageUnlockKey, unlockMortgageLeads,
  type MortgageLeadContact, type MortgageLeadFeed, type MortgageLeadPreview,
} from '@/services/mortgageLeads';
import { formatCredits, formatUsd } from './format';

function money(v: number, currency: string | null, lang: string) {
  try { return new Intl.NumberFormat(lang === 'ka' ? 'ka-GE' : lang, { style: 'currency', currency: currency ?? 'GEL', maximumFractionDigits: 0 }).format(v); }
  catch { return `${Math.round(v)} ${currency ?? ''}`; }
}

export function MortgageBuyersSection({ propertyId }: { propertyId: string }) {
  const { t, lang } = useLanguage();
  const [feed, setFeed] = useState<MortgageLeadFeed | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirm, setConfirm] = useState<MortgageLeadPreview | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Record<string, MortgageLeadContact>>({});

  const load = useCallback(async () => {
    try { setFeed(await getMortgageLeadFeed(propertyId)); setFailed(false); } catch { setFailed(true); }
  }, [propertyId]);
  useEffect(() => { void load(); }, [load]);

  const price = feed?.price;
  const priceLabel = useMemo(() => price
    ? `${t(price.credits === 1 ? 'mw_credit_one' : 'mw_credits_n', { n: formatCredits(price.credits, lang) })} = ${formatUsd(price.cents / 100, lang)}`
    : '', [price, lang, t]);

  if (failed || !feed || (feed.items.length === 0)) return null;

  const showContact = async (ref: string) => {
    try { const c = await getMortgageLeadContact(ref); setContacts((m) => ({ ...m, [ref]: c })); }
    catch { setContacts((m) => ({ ...m, [ref]: { restricted: true, reason: 'UNAVAILABLE' } })); }
  };

  const doUnlock = async () => {
    if (!confirm || !price || !key) return;
    setBusy(true); setError(null);
    try {
      await unlockMortgageLeads({ propertyId, refs: [confirm.ref], expectedCredits: price.credits, idempotencyKey: key });
      setConfirm(null); setKey(null);
      await load();
      await showContact(confirm.ref);
    } catch (e) {
      const code = e instanceof UnlockError ? e.code : 'INTERNAL';
      setError(code === 'INSUFFICIENT_CREDITS' ? 'mw_err_insufficient' : code === 'PRICE_CHANGED' ? 'mortgage_buyer_err_price' : 'mortgage_buyer_err_unlock');
    } finally { setBusy(false); }
  };

  return (
    <section className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-card sm:p-5" data-testid="mw-mortgage-buyers">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-[hsl(218_45%_14%)]">
            <Landmark className="h-4 w-4 text-[hsl(var(--gold-ink))]" aria-hidden="true" />{t('mortgage_buyer_title')}
          </h2>
          <p className="mt-1 max-w-[70ch] text-sm leading-relaxed text-[hsl(224_14%_28%)]">{t('mortgage_buyer_body')}</p>
        </div>
        {price ? (
          <p className="shrink-0 rounded-xl bg-[#0C1119] px-3 py-2 text-sm font-bold text-white" dir="ltr">
            <span className="text-[hsl(38_92%_62%)]">{t('mortgage_buyer_price', { price: formatUsd(price.cents / 100, lang) })}</span>
          </p>
        ) : null}
      </div>

      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {feed.items.map((lead) => {
          const contact = contacts[lead.ref];
          return (
            <li key={lead.ref} className={cn('rounded-xl border p-4', lead.unlocked ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]/40' : 'border-[hsl(var(--border))]')} data-unlocked={lead.unlocked}>
              <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--gold-ink))]">{t('mortgage_buyer_eyebrow')}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-[hsl(218_45%_14%)]">{t('mortgage_buyer_card')}</span>
                {lead.propertySpecific ? <span className="rounded-full bg-[#0C1119] px-2 py-0.5 text-2xs font-semibold text-white">{t('mortgage_buyer_this_property')}</span> : null}
                <span className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-2xs text-muted-foreground">{t(`mortgage_buyer_fresh_${lead.freshness.toLowerCase()}`)}</span>
                {lead.research === 'REPEATED' ? <span className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-2xs text-muted-foreground">{t('mortgage_buyer_repeated')}</span> : null}
              </div>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">{t('mortgage_buyer_location')}</dt>
                <dd className="text-foreground">{[lead.city, lead.district].filter(Boolean).join(', ') || t('mortgage_buyer_not_stated')}</dd>
                <dt className="text-muted-foreground">{t('mortgage_buyer_budget')}</dt>
                <dd className="text-foreground tabular-nums">
                  {lead.budgetMax !== null ? `${lead.budgetMin !== null ? `${money(lead.budgetMin, lead.currency, lang)} - ` : ''}${money(lead.budgetMax, lead.currency, lang)}` : t('mortgage_buyer_not_stated')}
                  {lead.budgetFit === 'STRETCH' ? <span className="ms-1.5 text-xs text-[hsl(var(--gold-ink))]">{t('mortgage_buyer_stretch')}</span> : null}
                </dd>
                {lead.propertyTypes.length ? (<><dt className="text-muted-foreground">{t('mortgage_lead_types')}</dt><dd className="text-foreground">{lead.propertyTypes.map((p) => t(`prop_type_${p.toLowerCase()}`)).join(', ')}</dd></>) : null}
                {lead.roomsMin ? (<><dt className="text-muted-foreground">{t('mortgage_lead_rooms')}</dt><dd className="text-foreground">{lead.roomsMin}+</dd></>) : null}
                {lead.timeframe ? (<><dt className="text-muted-foreground">{t('mortgage_lead_timeframe')}</dt><dd className="text-foreground">{t(`mortgage_lead_tf_${lead.timeframe.toLowerCase()}`)}</dd></>) : null}
                <dt className="text-muted-foreground">{t('mortgage_buyer_signal')}</dt>
                <dd className="text-foreground">{t('mortgage_buyer_checked_mortgage')}</dd>
              </dl>

              {lead.unlocked ? (
                <div className="mt-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-800"><Unlock className="h-4 w-4" aria-hidden="true" />{t('mortgage_buyer_already')}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t('mortgage_buyer_already_note')}</p>
                  {contact ? (
                    contact.restricted ? (
                      <p className="mt-2 text-sm text-muted-foreground">{t(`mortgage_buyer_restricted_${(contact.reason ?? 'UNAVAILABLE').toLowerCase()}`)}</p>
                    ) : (
                      <div className="mt-2 space-y-1 text-sm">
                        {contact.displayName ? <p className="font-semibold text-foreground">{contact.displayName}</p> : null}
                        {contact.phone ? <a href={`tel:${contact.phone}`} className="flex min-h-11 items-center gap-2 text-foreground" dir="ltr"><Phone className="h-4 w-4" aria-hidden="true" />{contact.phone}</a> : null}
                        {contact.email ? <a href={`mailto:${contact.email}`} className="flex min-h-11 items-center gap-2 text-foreground" dir="ltr"><Mail className="h-4 w-4" aria-hidden="true" />{contact.email}</a> : null}
                        {contact.language ? <p className="text-xs text-muted-foreground">{t('mortgage_buyer_language')}: {contact.language.toUpperCase()}</p> : null}
                      </div>
                    )
                  ) : (
                    <button type="button" onClick={() => void showContact(lead.ref)} className="mt-2 min-h-11 rounded-full border border-[hsl(var(--border))] bg-white px-4 text-sm font-semibold">{t('mortgage_buyer_show_contact')}</button>
                  )}
                </div>
              ) : (
                <button type="button" disabled={!price?.active || feed.disabled}
                  onClick={() => { setConfirm(lead); setKey(newMortgageUnlockKey()); setError(null); }}
                  className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-[hsl(38_92%_54%)] px-4 text-sm font-bold text-[#161309] disabled:cursor-not-allowed disabled:opacity-50">
                  <Lock className="h-4 w-4" aria-hidden="true" />{t('mortgage_buyer_unlock')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">{t('mortgage_buyer_privacy')}</p>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => { if (!o && !busy) { setConfirm(null); setKey(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('mortgage_buyer_unlock')}</AlertDialogTitle>
            <AlertDialogDescription>{t('mortgage_buyer_confirm', { price: priceLabel })}</AlertDialogDescription>
          </AlertDialogHeader>
          {error ? <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{t(error)}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('mortgage_ws_cancel')}</AlertDialogCancel>
            {/* Retrying this confirmation reuses its key, so a timeout can never charge twice. */}
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void doUnlock(); }}>{t('mortgage_buyer_unlock_cta', { price: priceLabel })}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

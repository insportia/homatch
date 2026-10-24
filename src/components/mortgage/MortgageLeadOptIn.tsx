// HOMATCH HOME FINANCING — "should relevant sellers and brokers be able to reach me?"
//
// One step, asked once, after a calculation, and only ever answered by the person. What can
// be known already is filled in (the budget from the calculation, the area from the listing
// they calculated for); the only questions are the ones consent needs: which contact channels,
// if any, and the area when nothing gives it. Everything else is optional, behind "Adjust".
// Nothing is pre-ticked, the calculator and saving work the same whatever they answer, and
// income, debts, credit history and the mortgage figures are never on it: they cannot be
// shared because they are never sent. Accepting the Terms is not this permission: sharing a
// contact channel with sellers needs this explicit, specific choice, withdrawable any time.

import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { MortgageInput } from '@/mortgage/types';
import {
  getMyBuyerIntent, setMyBuyerIntent, withdrawMyBuyerIntent,
  type BuyerIntent, type BuyerIntentInput, type Timeframe,
} from '@/services/mortgageLeads';

const DISMISS_KEY = 'homatch.mortgage.leadOptIn.declined.v1';
const TYPES = ['APARTMENT', 'HOUSE', 'STUDIO', 'PENTHOUSE', 'TOWNHOUSE'] as const;
const TIMEFRAMES: Timeframe[] = ['NOW', 'MONTHS_3', 'MONTHS_6', 'LATER'];
const ROOMS = [1, 2, 3, 4, 5];

const chip = (on: boolean) => cn(
  'min-h-11 rounded-full border px-4 text-sm font-medium transition-colors',
  on ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold))] text-[hsl(var(--primary-foreground))]' : 'border-border bg-background text-foreground hover:border-[hsl(var(--gold-border))]',
);
const field = 'h-11 w-full max-w-sm rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-[hsl(var(--gold))]';

function readDeclined(): boolean {
  try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

export function MortgageLeadOptIn({ input, currency, propertyId = null }: { input: MortgageInput; currency: string; propertyId?: string | null }) {
  const { t, lang } = useLanguage();
  const { homatchUser } = useAuth();
  const navigate = useNavigate();
  const [intent, setIntent] = useState<BuyerIntent | null | undefined>(undefined);
  const [declined, setDeclined] = useState(readDeclined);
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<BuyerIntentInput>({
    city: null, district: null, propertyTypes: [], roomsMin: null,
    budgetMin: null, budgetMax: Math.round(input.propertyPrice / 1000) * 1000, currency,
    timeframe: null, propertyId, sharePhone: false, shareEmail: false,
  });

  useEffect(() => {
    if (!homatchUser) { setIntent(null); return; }
    getMyBuyerIntent().then(setIntent).catch(() => setIntent(null));
  }, [homatchUser]);

  const patch = (next: Partial<BuyerIntentInput>) => setForm((f) => ({ ...f, ...next }));
  const startEditing = () => {
    if (intent) {
      setForm({
        city: intent.city, district: intent.district, propertyTypes: intent.propertyTypes ?? [], roomsMin: intent.roomsMin,
        budgetMin: intent.budgetMin, budgetMax: intent.budgetMax, currency: intent.currency ?? currency,
        timeframe: intent.timeframe, propertyId: intent.propertyId ?? propertyId,
        sharePhone: intent.status === 'ACTIVE' && intent.sharePhone, shareEmail: intent.status === 'ACTIVE' && intent.shareEmail,
      });
    }
    setEditing(true);
  };

  /* The area is the one thing matching cannot do without: ask only when no listing gives it. */
  const needsArea = !form.propertyId && !form.city;

  const submit = async () => {
    if (!homatchUser) { navigate('/auth/login?next=/mortgage'); return; }
    if (!form.sharePhone && !form.shareEmail) { setError('mortgage_lead_err_channel'); return; }
    if (needsArea) { setError('mortgage_lead_need_area'); return; }
    setBusy(true); setError(null);
    try {
      setIntent(await setMyBuyerIntent(form));
      setEditing(false);
      setDetails(false);
    } catch {
      setError('mortgage_lead_err_save');
    } finally { setBusy(false); }
  };

  const withdraw = async () => {
    setBusy(true);
    try { setIntent(await withdrawMyBuyerIntent()); } catch { setError('mortgage_lead_err_save'); } finally { setBusy(false); }
  };

  const decline = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* storage unavailable */ }
    setDeclined(true);
    setEditing(false);
  };

  if (intent === undefined) return null;
  const active = intent?.status === 'ACTIVE';
  if (!active && declined && !editing) return null;
  const budget = form.budgetMax != null
    ? new Intl.NumberFormat(lang === 'ka' ? 'ka-GE' : lang, { style: 'currency', currency: form.currency ?? currency, maximumFractionDigits: 0 }).format(form.budgetMax)
    : null;

  return (
    <section aria-labelledby="lead-optin-title" className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6" data-testid="mortgage-lead-optin">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="lead-optin-title" className="font-display text-lg font-semibold text-foreground">
            {active ? t('mortgage_lead_active_title') : t('mortgage_lead_question')}
          </h2>
          <p className="mt-1.5 max-w-[64ch] text-sm leading-relaxed text-muted-foreground">{t('mortgage_lead_explain')}</p>
        </div>
      </div>

      {active && !editing ? (
        <div className="mt-4">
          <p className="flex items-center gap-2 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t('mortgage_lead_active_body')}</p>
          {/* Where this consent actually leads: into HOMATCH Matching, or not yet, and why. */}
          <p className="mt-2 text-sm text-muted-foreground" role="status" data-testid="mortgage-lead-matching-state">
            {intent?.acceptsOffers === false ? t('mortgage_lead_offers_off')
              : intent?.inMatching ? t('mortgage_lead_in_matching') : t('mortgage_lead_need_area')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={startEditing} className={chip(false)}>{t('mortgage_lead_manage')}</button>
            <button type="button" disabled={busy} onClick={() => void withdraw()} className={cn(chip(false), 'hover:border-[hsl(var(--destructive)/0.5)] hover:text-[hsl(var(--destructive))]')}>{t('mortgage_lead_withdraw')}</button>
          </div>
        </div>
      ) : (
        /* One step: what sellers would see, the channels, one confirmation. */
        <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }} data-testid="mortgage-lead-form">
          <div className="rounded-xl border border-border bg-background px-4 py-3 text-sm" data-testid="mortgage-lead-summary">
            <p className="font-semibold text-foreground">{t('mortgage_lead_form_lead')}</p>
            <ul className="mt-1 grid gap-0.5 text-muted-foreground">
              {budget ? <li>{t('mortgage_lead_summary_budget', { budget })}</li> : null}
              {form.city ? <li>{t('mortgage_lead_summary_area', { area: [form.district, form.city].filter(Boolean).join(', ') })}</li>
                : form.propertyId ? <li>{t('mortgage_lead_summary_area_listing')}</li> : null}
            </ul>
          </div>

          {needsArea || details ? (
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-foreground">{t('mortgage_lead_city')}</span>
              <input value={form.city ?? ''} maxLength={80} onChange={(e) => patch({ city: e.target.value || null })}
                placeholder={t('mortgage_lead_city_ph')} className={field} />
            </label>
          ) : null}

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-foreground">{t('mortgage_lead_channels')}</legend>
            {/* Toggles, not pre-ticked: each channel is shared only if the person turns it on. */}
            <div className="flex flex-wrap gap-2">
              <button type="button" role="checkbox" aria-checked={form.sharePhone} data-testid="mortgage-lead-share-phone"
                onClick={() => patch({ sharePhone: !form.sharePhone })} className={chip(form.sharePhone)}>{t('mortgage_lead_share_phone')}</button>
              <button type="button" role="checkbox" aria-checked={form.shareEmail} data-testid="mortgage-lead-share-email"
                onClick={() => patch({ shareEmail: !form.shareEmail })} className={chip(form.shareEmail)}>{t('mortgage_lead_share_email')}</button>
            </div>
          </fieldset>

          <button type="button" aria-expanded={details} onClick={() => setDetails((d) => !d)}
            className="min-h-11 text-sm font-medium text-[hsl(var(--gold-ink))] underline underline-offset-4">
            {t(details ? 'mortgage_lead_details_hide' : 'mortgage_lead_details')}
          </button>

          {details ? (
            <div className="space-y-5" data-testid="mortgage-lead-details">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-foreground">{t('mortgage_lead_district')}</span>
                <input value={form.district ?? ''} maxLength={80} onChange={(e) => patch({ district: e.target.value || null })} className={field} />
              </label>
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-foreground">{t('mortgage_lead_types')}</legend>
                <div className="flex flex-wrap gap-2">
                  {TYPES.map((type) => {
                    const on = form.propertyTypes.includes(type);
                    return <button key={type} type="button" aria-pressed={on} className={chip(on)}
                      onClick={() => patch({ propertyTypes: on ? form.propertyTypes.filter((x) => x !== type) : [...form.propertyTypes, type] })}>{t(`prop_type_${type.toLowerCase()}`)}</button>;
                  })}
                </div>
              </fieldset>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-foreground">{t('mortgage_lead_budget', { currency: form.currency ?? currency })}</span>
                <input type="number" inputMode="numeric" min={0} step={1000} value={form.budgetMax ?? ''} onChange={(e) => patch({ budgetMax: e.target.value ? Number(e.target.value) : null })}
                  className="h-11 w-full max-w-xs rounded-xl border border-border bg-background px-3 text-sm tabular-nums outline-none focus:border-[hsl(var(--gold))]" />
                <span className="mt-1 block text-xs text-muted-foreground">{t('mortgage_lead_budget_hint')}</span>
              </label>
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-foreground">{t('mortgage_lead_rooms')}</legend>
                <div className="flex flex-wrap gap-2">
                  {ROOMS.map((n) => <button key={n} type="button" aria-pressed={form.roomsMin === n} className={chip(form.roomsMin === n)} onClick={() => patch({ roomsMin: form.roomsMin === n ? null : n })}>{n === 5 ? '5+' : n}</button>)}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-foreground">{t('mortgage_lead_timeframe')}</legend>
                <div className="flex flex-wrap gap-2">
                  {TIMEFRAMES.map((tf) => <button key={tf} type="button" aria-pressed={form.timeframe === tf} className={chip(form.timeframe === tf)} onClick={() => patch({ timeframe: form.timeframe === tf ? null : tf })}>{t(`mortgage_lead_tf_${tf.toLowerCase()}`)}</button>)}
                </div>
              </fieldset>
            </div>
          ) : null}

          <p className="rounded-xl bg-[hsl(var(--gold-soft))] px-4 py-3 text-xs leading-relaxed text-[hsl(var(--gold-ink))]">
            {t('mortgage_lead_never_shared')}{' '}
            <Link to="/privacy#matching" className="inline-flex min-h-10 items-center font-semibold underline underline-offset-4">{t('mortgage_lead_privacy_link')}</Link>
          </p>
          {error ? <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{t(error)}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className="min-h-11 rounded-full bg-[hsl(var(--gold))] px-5 text-sm font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-60">
              {active ? t('mortgage_ws_save_changes') : t('mortgage_lead_yes')}
            </button>
            <button type="button" onClick={active ? () => setEditing(false) : decline} className={chip(false)}>
              {active ? t('mortgage_ws_cancel') : t('mortgage_lead_no')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

// HOMATCH HOME FINANCING — "should matching sellers be able to reach me?"
//
// Asked once, after a calculation, and only ever answered by the person.
// Nothing is pre-ticked, the calculator and saving work the same whatever
// they answer, and the form shows exactly what would be shared. Income,
// debts, credit history and the mortgage figures are never on it: they
// cannot be shared because they are never sent.

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

function readDeclined(): boolean {
  try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

export function MortgageLeadOptIn({ input, currency, propertyId = null }: { input: MortgageInput; currency: string; propertyId?: string | null }) {
  const { t } = useLanguage();
  const { homatchUser } = useAuth();
  const navigate = useNavigate();
  const [intent, setIntent] = useState<BuyerIntent | null | undefined>(undefined);
  const [declined, setDeclined] = useState(readDeclined);
  const [editing, setEditing] = useState(false);
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

  const submit = async () => {
    if (!form.sharePhone && !form.shareEmail) { setError('mortgage_lead_err_channel'); return; }
    setBusy(true); setError(null);
    try {
      setIntent(await setMyBuyerIntent(form));
      setEditing(false);
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
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={startEditing} className={chip(false)}>{t('mortgage_lead_manage')}</button>
            <button type="button" disabled={busy} onClick={() => void withdraw()} className={cn(chip(false), 'hover:border-[hsl(var(--destructive)/0.5)] hover:text-[hsl(var(--destructive))]')}>{t('mortgage_lead_withdraw')}</button>
          </div>
        </div>
      ) : !editing ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => (homatchUser ? startEditing() : navigate('/auth/login?next=/mortgage'))}
            className="min-h-11 rounded-full bg-[hsl(var(--gold))] px-5 text-sm font-semibold text-[hsl(var(--primary-foreground))]">
            {t('mortgage_lead_yes')}
          </button>
          <button type="button" onClick={decline} className={chip(false)}>{t('mortgage_lead_no')}</button>
        </div>
      ) : (
        <form className="mt-5 space-y-5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <p className="text-sm font-semibold text-foreground">{t('mortgage_lead_form_lead')}</p>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">{t('mortgage_lead_city')}</span>
            <input value={form.city ?? ''} maxLength={80} onChange={(e) => patch({ city: e.target.value || null })}
              placeholder={t('mortgage_lead_city_ph')} className="h-11 w-full max-w-sm rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-[hsl(var(--gold))]" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">{t('mortgage_lead_district')}</span>
            <input value={form.district ?? ''} maxLength={80} onChange={(e) => patch({ district: e.target.value || null })}
              className="h-11 w-full max-w-sm rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-[hsl(var(--gold))]" />
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
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-foreground">{t('mortgage_lead_channels')}</legend>
            <label className="flex min-h-11 items-center gap-3 text-sm text-foreground">
              <input type="checkbox" checked={form.sharePhone} onChange={(e) => patch({ sharePhone: e.target.checked })} className="h-5 w-5 accent-[hsl(var(--gold))]" />
              {t('mortgage_lead_share_phone')}
            </label>
            <label className="flex min-h-11 items-center gap-3 text-sm text-foreground">
              <input type="checkbox" checked={form.shareEmail} onChange={(e) => patch({ shareEmail: e.target.checked })} className="h-5 w-5 accent-[hsl(var(--gold))]" />
              {t('mortgage_lead_share_email')}
            </label>
          </fieldset>
          <p className="rounded-xl bg-[hsl(var(--gold-soft))] px-4 py-3 text-xs leading-relaxed text-[hsl(var(--gold-ink))]">{t('mortgage_lead_never_shared')}</p>
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

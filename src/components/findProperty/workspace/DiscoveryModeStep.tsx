/*
 * Free Search or Deep Search — chosen after the criteria are confirmed.
 *
 * Free Search starts at once. Deep Search starts the same free search and then
 * opens the paid campaign for it, where the server prices it and the customer
 * approves the exact maximum BEFORE anything is reserved. Nothing here reserves,
 * charges or computes a price: the numbers shown are the customer's own choice
 * (credits) and their wallet balance. Provider costs and margins never appear.
 * While Deep Search is switched off it says so and cannot be chosen.
 */
import { Check, CircleSlash, Layers, Loader2, Lock, Telescope, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getCreditAccount } from '@/services/api';
import type { T } from '../format';
import { btn, cx, Eyebrow, Pill } from './primitives';

export const DEEP_PRESETS = [50, 100, 300, 1000];
export const DEEP_MIN_CREDITS = 50;
const CREDITS_PER_USD = 10;

export function DiscoveryModeStep({ t, deepAvailable, activeSources, sourceNames = [], starting, onFree, onDeep, onBack }: {
  t: T; deepAvailable: boolean; activeSources: number | null; sourceNames?: string[]; starting: boolean;
  onFree: () => void; onDeep: (credits: number) => void; onBack: () => void;
}) {
  const [mode, setMode] = useState<'FREE' | 'DEEP'>('FREE');
  const [credits, setCredits] = useState(100);
  const [custom, setCustom] = useState('');
  const { homatchUser } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    if (!homatchUser?.id || !deepAvailable) return;
    let alive = true;
    void getCreditAccount(homatchUser.id).then((a) => { if (alive) setBalance(a ? Number(a.balance) : 0); }).catch(() => { if (alive) setBalance(null); });
    return () => { alive = false; };
  }, [homatchUser?.id, deepAvailable]);
  const chosen = custom ? Math.round(Number(custom) || 0) : credits;
  const tooLow = mode === 'DEEP' && chosen < DEEP_MIN_CREDITS;
  const short = mode === 'DEEP' && balance != null && chosen > balance;

  return (
    <section aria-labelledby="fpx-mode-title" className="space-y-5">
      <div className="space-y-1.5">
        <Eyebrow>{t('fpx_step_mode')}</Eyebrow>
        <h2 id="fpx-mode-title" className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-[28px]">{t('fpx_mode_title')}</h2>
        <p className="max-w-[65ch] text-[15px] leading-relaxed text-muted-foreground">{t('fpx_mode_body')}</p>
      </div>

      <div role="radiogroup" aria-label={t('fpx_mode_title')} className="grid gap-4 lg:grid-cols-2">
        {/* FREE */}
        <button type="button" role="radio" aria-checked={mode === 'FREE'} onClick={() => setMode('FREE')} data-mode="FREE"
          className={cx('relative flex min-w-0 flex-col gap-4 rounded-3xl border bg-card p-5 text-start shadow-sm transition sm:p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]',
            mode === 'FREE' ? 'border-[#0C1119] ring-1 ring-[#0C1119]' : 'border-border hover:border-[hsl(var(--gold-border))]')}>
          <div className="flex items-start justify-between gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#0C1119] text-[hsl(var(--gold))]" aria-hidden="true"><Layers className="h-5 w-5" /></span>
            <Radio on={mode === 'FREE'} />
          </div>
          <div className="space-y-1">
            <p className="flex flex-wrap items-center gap-2 font-display text-xl font-semibold text-foreground">{t('fpx_free_title')}<Pill tone="success">{t('fpx_free_price')}</Pill></p>
            <p className="text-sm leading-relaxed text-muted-foreground">{t('fpx_free_body')}</p>
          </div>
          <ul className="space-y-2 text-sm">
            <Li>{t('fpx_free_inc_homatch')}</Li>
            <Li>{activeSources ? t('fpv_sites_n', { n: activeSources }) : t('fpv_sites_generic')}</Li>
            <Li>{t('fpx_free_inc_dedupe')}</Li>
          </ul>
          {sourceNames.length ? (
            <div className="mt-auto space-y-2 border-t border-border pt-4">
              <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('fpx_live_sources')}</p>
              <ul className="flex flex-wrap gap-1.5" data-live-sources>
                <li className="rounded-full bg-[#0C1119] px-2.5 py-1 text-xs font-semibold text-white">HOMATCH</li>
                {/* The sites are never named before or during a search (owner, 2026-10-16); only how many. */}
                <li className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs font-semibold text-foreground" data-live-source-count={sourceNames.length}>{t('fpv_sites_n', { n: sourceNames.length })}</li>
              </ul>
            </div>
          ) : null}
        </button>

        {/* DEEP */}
        <div role="radio" aria-checked={mode === 'DEEP'} aria-disabled={!deepAvailable} tabIndex={deepAvailable ? 0 : -1} data-mode="DEEP"
          onClick={() => { if (deepAvailable) setMode('DEEP'); }}
          onKeyDown={(e) => { if (deepAvailable && (e.key === ' ' || e.key === 'Enter') && e.target === e.currentTarget) { e.preventDefault(); setMode('DEEP'); } }}
          className={cx('relative flex min-w-0 flex-col gap-4 overflow-hidden rounded-3xl border p-5 text-start shadow-sm transition sm:p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]',
            'bg-[linear-gradient(160deg,#121A26_0%,#0C1119_70%)] text-white',
            !deepAvailable ? 'cursor-not-allowed border-white/10' : mode === 'DEEP' ? 'cursor-pointer border-[hsl(var(--gold))] ring-1 ring-[hsl(var(--gold))]' : 'cursor-pointer border-white/10 hover:border-[hsl(var(--gold)/0.6)]')}>
          <div className="pointer-events-none absolute -end-20 -top-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,hsl(var(--gold)/0.22),transparent_65%)]" aria-hidden="true" />
          <div className="relative flex items-start justify-between gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl border border-[hsl(var(--gold)/0.5)] text-[hsl(var(--gold))]" aria-hidden="true"><Telescope className="h-5 w-5" /></span>
            {deepAvailable ? <Radio on={mode === 'DEEP'} dark /> : <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 text-xs font-semibold text-white/70"><Lock className="h-3 w-3" aria-hidden="true" />{t('fpx_deep_soon')}</span>}
          </div>
          <div className="relative space-y-1">
            <p className="flex flex-wrap items-center gap-2 font-display text-xl font-semibold">{t('fpx_deep_title')}<span className="rounded-full bg-[hsl(var(--gold)/0.18)] px-2 py-0.5 text-xs font-semibold text-[hsl(var(--gold))]">{t('fpx_deep_from')}</span></p>
            <p className="text-sm leading-relaxed text-white/75">{t('fpx_deep_body')}</p>
          </div>
          <ul className="relative space-y-1.5 text-xs leading-relaxed text-white/70">
            <li>{t('fpx_deep_finds')}</li>
            <li>{t('fpx_deep_charge')}</li>
            <li>{t('fpx_deep_limits')}</li>
          </ul>
          {!deepAvailable ? (
            <p className="relative flex items-start gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-xs leading-relaxed text-white/75" role="note">
              <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('fpx_deep_off_note')}
            </p>
          ) : mode === 'DEEP' ? (
            <div className="relative space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3.5" onClick={(e) => e.stopPropagation()}>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/60">{t('fpi_paid_budget')}</p>
              <div className="flex flex-wrap gap-2">
                {DEEP_PRESETS.map((q) => (
                  <button key={q} type="button" onClick={() => { setCredits(q); setCustom(''); }} aria-pressed={!custom && credits === q}
                    className={cx('min-h-[44px] rounded-xl border px-3 text-sm font-semibold tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]',
                      !custom && credits === q ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold)/0.15)] text-[hsl(var(--gold))]' : 'border-white/15 text-white/85 hover:bg-white/5')}>
                    ${(q / CREDITS_PER_USD).toFixed(0)}
                  </button>
                ))}
                <label className="flex min-h-[44px] items-center gap-1 rounded-xl border border-white/15 px-3 text-sm">
                  <span className="text-white/60">{t('fpx_custom')}</span>
                  <input type="number" inputMode="numeric" min={DEEP_MIN_CREDITS} step={10} value={custom} placeholder={String(DEEP_MIN_CREDITS)}
                    onChange={(e) => setCustom(e.target.value)} aria-label={t('fpx_custom_credits')}
                    className="w-20 bg-transparent text-end tabular-nums text-white placeholder:text-white/35 focus:outline-none" />
                  <span className="text-white/60">{t('fpx_credits_short')}</span>
                </label>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-xs text-white/55">{t('fpx_deep_max')}</dt><dd className="font-semibold tabular-nums text-[hsl(var(--gold))]">{t('fpi_paid_credits_n', { n: chosen })} · ${(chosen / CREDITS_PER_USD).toFixed(2)}</dd></div>
                <div><dt className="text-xs text-white/55">{t('fpx_wallet')}</dt><dd className="inline-flex items-center gap-1.5 font-semibold tabular-nums"><Wallet className="h-3.5 w-3.5 text-white/60" aria-hidden="true" />{balance == null ? '—' : t('fpi_paid_credits_n', { n: balance.toFixed(2) })}</dd></div>
              </dl>
              {tooLow ? <p role="alert" className="text-xs text-[hsl(var(--gold))]">{t('fpi_paid_minimum', { credits: DEEP_MIN_CREDITS, usd: (DEEP_MIN_CREDITS / CREDITS_PER_USD).toFixed(2) })}</p> : null}
              {short ? <p role="alert" className="text-xs text-[hsl(var(--gold))]">{t('fpx_deep_short')} <Link to="/credits" className="underline underline-offset-4">{t('fpi_paid_top_up')}</Link></p> : null}
              <p className="text-xs leading-relaxed text-white/60">{t('fpx_deep_next_confirm')}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={onBack} className={btn.ghost}>{t('mps_ready_change')}</button>
        <button type="button" data-action="mps-start" disabled={starting || tooLow || short}
          onClick={() => (mode === 'DEEP' && deepAvailable ? onDeep(chosen) : onFree())}
          className={cx(mode === 'DEEP' ? btn.gold : btn.primary, 'min-h-12 px-7 text-[15px]')}>
          {starting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {mode === 'DEEP' ? t('fpx_start_deep') : t('mps_ready_start')}
        </button>
      </div>
    </section>
  );
}

function Radio({ on, dark }: { on: boolean; dark?: boolean }) {
  return (
    <span aria-hidden="true" className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition',
      on ? (dark ? 'border-[hsl(var(--gold))] bg-[hsl(var(--gold))] text-[#0C1119]' : 'border-[#0C1119] bg-[#0C1119] text-white') : dark ? 'border-white/30' : 'border-border')}>
      {on ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
    </span>
  );
}
function Li({ children }: { children: React.ReactNode }) {
  return <li className="flex min-w-0 items-start gap-2 text-foreground/85"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" /><span className="min-w-0 flex-1">{children}</span></li>;
}

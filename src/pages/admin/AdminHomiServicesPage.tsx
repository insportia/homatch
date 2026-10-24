// HOMATCH Admin — HOMI and the services it reaches, measured.
//
// One page, six sections, each its own address so the navigation can list
// it where an admin would look for it (HOMI under AI, costs under money,
// mortgage buyers under property). Every number comes from an admin-only
// RPC that reads what the product already records. Nothing here is
// estimated without saying so, and nothing changes a price.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/db/supabase';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Confirm, Empty, ErrorNote, Field, PageHeader, inputClass } from '@/components/admin/control/AdminKit';
import { english, loadAdminStrings, loadFeatureStrings, loadLanguage } from '@/i18n/bundles';
import { LOCALES } from '@/i18n/locales';
import { isAdminOnlyKey, isStudioOnlyKey } from '@/i18n/adminSplit';
import MortgageBankProductsAdmin from '@/components/admin/MortgageBankProductsAdmin';
import { centsToUsd, costPerConversationUsd, costPerModelTurnUsd, creditsToUsd, formatCredits, formatUsd, marginState, toNumber } from '@/admin/money';
import { isHttpsUrl, ruleMoves } from '@/admin/mortgageBankProducts';

export type HomiAdminSection = 'homi' | 'ai-costs' | 'mortgage' | 'mortgage-leads' | 'contracts' | 'notifications' | 'languages';

const SECTIONS: { id: HomiAdminSection; path: string; labelKey: string }[] = [
  { id: 'homi', path: '/admin/homi', labelKey: 'admin_hs_tab_homi' },
  { id: 'ai-costs', path: '/admin/ai-costs', labelKey: 'admin_hs_tab_ai_costs' },
  { id: 'mortgage', path: '/admin/mortgage-rules', labelKey: 'admin_hs_tab_mortgage' },
  { id: 'mortgage-leads', path: '/admin/mortgage-buyers', labelKey: 'admin_hs_tab_mortgage_leads' },
  { id: 'contracts', path: '/admin/contract-costs', labelKey: 'admin_hs_tab_contracts' },
  { id: 'notifications', path: '/admin/notification-delivery', labelKey: 'admin_hs_tab_notifications' },
  { id: 'languages', path: '/admin/languages', labelKey: 'admin_hs_tab_languages' },
];

type Json = Record<string, any>;

function useRpc(fn: string, args: Record<string, unknown> | null) {
  const [data, setData] = useState<Json | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const key = JSON.stringify(args);
  const load = useCallback(async () => {
    if (!args) return;
    setLoading(true); setError(null);
    const { data: d, error: e } = await supabase.rpc(fn, args);
    if (e) setError(e.message); else setData(d as Json);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, key]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load };
}

function Tile({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: 'warn' }) {
  return (
    <div className={cn('rounded-xl border bg-card p-4', tone === 'warn' ? 'border-amber-500/50' : 'border-border')}>
      <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value ?? '—'}</p>
      {hint ? <p className="mt-1 text-2xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (!rows.length) return null;
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[32rem] text-sm">
        <thead className="bg-muted/50"><tr>{head.map((h) => <th key={h} scope="col" className="px-3 py-2 text-start text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-border">{r.map((c, j) => <td key={j} className="px-3 py-2 tabular-nums">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const pct = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && v !== '') ? `${(Number(v) * 100).toFixed(1)}%` : '—');
const usd = formatUsd;

/** A margin tile: a known percentage, or an explicit "unknown" warning (unknown COGS is never 0%). */
function MarginTile({ label, value }: { label: string; value: unknown }) {
  const { t } = useLanguage();
  const m = marginState(value);
  if (m.kind === 'unknown') {
    return (
      <Tile label={label} tone="warn" hint={t('admin_hs_margin_unknown_hint')}
        value={<span className="inline-flex items-center gap-1.5 text-amber-800"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{t('admin_hs_margin_unknown')}</span>} />
    );
  }
  return <Tile label={label} value={m.text} tone={m.pct < 50 ? 'warn' : undefined} />;
}
const ms = (v: unknown) => (v === null || v === undefined ? '—' : `${Math.round(Number(v)).toLocaleString()} ms`);
const num = (v: unknown) => (v === null || v === undefined ? '—' : Number(v).toLocaleString());

function DaysPicker({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  const { t } = useLanguage();
  return (
    <div className="flex gap-1" role="group" aria-label={t('admin_hs_period')}>
      {[7, 30, 90].map((d) => (
        <button key={d} type="button" aria-pressed={days === d} onClick={() => onChange(d)}
          className={cn('min-h-9 rounded-md border px-3 text-sm', days === d ? 'border-foreground bg-foreground text-background' : 'border-border')}>
          {t('admin_hs_days', { n: d })}
        </button>
      ))}
    </div>
  );
}

function HomiSection({ days, costs }: { days: number; costs: boolean }) {
  const { t } = useLanguage();
  const { data, error, loading, reload } = useRpc('homi_usage_summary', { p_days: days });
  if (error) return <ErrorNote message={error} />;
  if (!data) return <p className="text-sm text-muted-foreground">{loading ? t('admin_hs_loading') : ''}</p>;
  const tot = data.totals ?? {};
  const daily: Json[] = data.daily ?? [];
  const maxCost = Math.max(0.0001, ...daily.map((d) => Number(d.cost_usd ?? 0)));
  return (
    <div className="space-y-5">
      <div className="flex justify-end"><button type="button" onClick={() => void reload()} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />{t('admin_hs_refresh')}</button></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {costs ? (
          <>
            <Tile label={t('admin_hs_cost_total')} value={usd(tot.cost_usd)} hint={t('admin_hs_cost_total_hint')} />
            <Tile label={t('admin_hs_cost_month')} value={usd(data.estimated_monthly_usd)} hint={t('admin_hs_cost_month_hint')} />
            {/* Priced cost ÷ PRICED model turns: deterministic, unpriced and failed turns are not in the divisor. */}
            <Tile label={t('admin_hs_cost_per_turn')} value={costPerModelTurnUsd(tot) === null ? t('admin_hs_no_priced_turns') : usd(costPerModelTurnUsd(tot))}
              hint={t('admin_hs_cost_per_turn_hint', { n: num(tot.priced_model_turns ?? 0) })} />
            <Tile label={t('admin_hs_cost_per_conversation')} value={costPerConversationUsd(tot) === null ? '—' : usd(costPerConversationUsd(tot))}
              hint={t('admin_hs_conversations_n', { n: num(tot.conversations ?? 0) })} />
            <Tile label={t('admin_hs_unpriced')} value={num(tot.unpriced_turns)} hint={t('admin_hs_unpriced_hint')} tone={Number(tot.unpriced_turns) > 0 ? 'warn' : undefined} />
            {Number(tot.unpriced_turns) > 0 ? (
              <p role="note" className="flex items-start gap-1.5 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-xs sm:col-span-2 lg:col-span-4">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('admin_hs_cost_lower_bound', { n: num(tot.unpriced_turns) })}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <Tile label={t('admin_hs_requests')} value={num(tot.requests)} hint={t('admin_hs_conversations_n', { n: num(tot.conversations ?? 0) })} />
            <Tile label={t('admin_hs_deterministic')} value={pct(tot.deterministic_rate)} hint={t('admin_hs_deterministic_hint')} />
            <Tile label={t('admin_hs_latency')} value={`${ms(tot.avg_latency_ms)} · p95 ${ms(tot.p95_latency_ms)}`} />
            <Tile label={t('admin_hs_model_latency')} value={`${ms(tot.avg_model_latency_ms)} · p95 ${ms(tot.p95_model_latency_ms)}`} hint={t('admin_hs_ttft_n', { v: ms(tot.avg_ttft_ms) })} />
            <Tile label={t('admin_hs_failures')} value={pct(tot.failure_rate)} hint={t('admin_hs_failures_hint')} tone={Number(tot.failure_rate) > 0.05 ? 'warn' : undefined} />
            <Tile label={t('admin_hs_cancelled')} value={num(tot.cancelled_turns ?? 0)} hint={t('admin_hs_cancelled_hint')} />
            <Tile label={t('admin_hs_cache')} value={pct(tot.prompt_cache_rate)} hint={t('admin_hs_cache_hint')} />
            <Tile label={t('admin_hs_web')} value={num(tot.web_turns)} />
            <Tile label={t('admin_hs_billed')} value={num(tot.billed_turns)} hint={t('admin_hs_billed_hint')} />
            <Tile label={t('admin_hs_tokens')} value={`${num(tot.input_tokens)} / ${num(tot.output_tokens)}`} hint={t('admin_hs_tokens_hint')} />
          </>
        )}
      </div>
      {daily.length ? (
        <section aria-label={t('admin_hs_daily')}>
          <h2 className="mb-2 text-sm font-semibold">{t(costs ? 'admin_hs_daily_cost' : 'admin_hs_daily')}</h2>
          <div className="flex h-28 items-end gap-1 rounded-xl border border-border p-3">
            {daily.map((d) => {
              const v = costs ? Number(d.cost_usd ?? 0) / maxCost : Number(d.requests ?? 0) / Math.max(1, ...daily.map((x) => Number(x.requests ?? 0)));
              return <div key={d.day} title={`${d.day}: ${costs ? usd(d.cost_usd) : num(d.requests)}`} className="flex-1 rounded-t bg-[hsl(38_92%_56%)]" style={{ height: `${Math.max(2, v * 100)}%` }} />;
            })}
          </div>
        </section>
      ) : <Empty>{t('admin_hs_no_data')}</Empty>}
      <Table head={[t('admin_hs_col_model'), t('admin_hs_col_turns'), t('admin_hs_col_tokens'), t('admin_hs_col_cost')]}
        rows={(data.by_model ?? []).map((m: Json) => [m.model, num(m.turns), `${num(m.input_tokens)} / ${num(m.output_tokens)}`, Number(m.unpriced_turns) > 0 ? `${usd(m.cost_usd)} + ${num(m.unpriced_turns)} ${t('admin_hs_unpriced_short')}` : usd(m.cost_usd)])} />
      {!costs ? (
        <>
          <Table head={[t('admin_hs_col_route'), t('admin_hs_col_avg'), 'p95', t('admin_hs_col_ttft')]}
            rows={(data.latency ?? []).map((l: Json) => [t(`admin_hs_route_${String(l.route).toLowerCase()}`), ms(l.avg_ms), ms(l.p95_ms), ms(l.avg_ttft_ms)])} />
          <Table head={[t('admin_hs_col_surface'), t('admin_hs_col_turns'), t('admin_hs_deterministic'), t('admin_hs_col_cost'), t('admin_hs_failures')]}
            rows={(data.by_surface ?? []).map((s: Json) => [s.surface, num(s.turns), num(s.deterministic), usd(s.cost_usd), num(s.failures)])} />
          {/* Cancelled turns (the person pressed stop) are counted in their own tile, not listed as failures. */}
          <Table head={[t('admin_hs_col_error'), t('admin_hs_col_count')]} rows={(data.errors ?? []).filter((e: Json) => e.error_code !== 'CANCELLED').map((e: Json) => [<code key="c" dir="ltr">{e.error_code}</code>, num(e.n)])} />
        </>
      ) : null}
    </div>
  );
}

function MortgageRulesSection() {
  const { t } = useLanguage();
  const [rules, setRules] = useState<Json[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* The rule being moved, where to, the official source the admin checked, and why that failed if it did. */
  const [confirm, setConfirm] = useState<{ rule: Json; to: 'ACTIVE' | 'REJECTED'; source: string; note: string; problem: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await supabase.from('mortgage_rules').select('id,type,title,status,currency,effective_from,effective_to,last_verified_at,official_source_url,source_authority').in('type', ['PTI_LIMIT', 'LTV_LIMIT']).order('type').order('effective_from', { ascending: true, nullsFirst: true });
    if (r.error) setError(r.error.message); else { setError(null); setRules(r.data ?? []); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const stale = (d: string | null, days = 45) => !d || (Date.now() - Date.parse(d)) / 86_400_000 > days;
  /* Audited, transition-checked status change (mortgage_rule_admin_set_status, migration 20261201092000). */
  const move = async () => {
    if (!confirm) return;
    const source = confirm.source.trim();
    if (confirm.to === 'ACTIVE' && !isHttpsUrl(source)) { setConfirm({ ...confirm, problem: t('admin_hs_bp_err_https') }); return; }
    setBusy(true);
    try {
      const { data, error: e } = await supabase.rpc('mortgage_rule_admin_set_status', {
        p_rule_id: confirm.rule.id,
        p_status: confirm.to,
        p_official_source_url: confirm.to === 'ACTIVE' ? source : null,
        p_note: confirm.note.trim() || null,
      });
      if (e || !data) {
        const message = e?.message ?? t('admin_hs_bp_err_not_saved');
        setConfirm({ ...confirm, problem: message });
        toast.error(t('admin_hs_rule_move_failed'), { description: message });
        return;
      }
      toast.success(t(confirm.to === 'ACTIVE' ? 'admin_hs_rule_activated' : 'admin_hs_rule_rejected', { title: String(confirm.rule.title ?? '') }));
      setConfirm(null);
      await load();
    } finally { setBusy(false); }
  };
  if (error) return <ErrorNote message={error} />;
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('admin_hs_rules_title')}</h2>
        <p className="text-sm text-muted-foreground">{t('admin_hs_rules_sub')}</p>
        <Table head={[t('admin_hs_col_rule'), t('admin_hs_col_status'), t('admin_hs_col_effective'), t('admin_hs_col_verified'), t('admin_hs_col_source'), '']}
          rows={(rules ?? []).map((r) => [
            r.title,
            <span key="s" className={cn('rounded px-1.5 py-0.5 text-2xs font-semibold', r.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-800' : r.status === 'CANDIDATE' ? 'bg-amber-500/15 text-amber-800' : 'bg-muted text-muted-foreground')}>{t(`admin_hs_status_${String(r.status).toLowerCase()}`)}</span>,
            r.effective_from ?? t('admin_hs_in_force'),
            <span key="v" className={stale(r.last_verified_at) ? 'text-amber-700' : ''}>{r.last_verified_at}</span>,
            <a key="a" href={r.official_source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">{r.source_authority}<ExternalLink className="h-3 w-3" aria-hidden="true" /></a>,
            ruleMoves(String(r.status)).length ? (
              <div key="b" className="flex flex-wrap gap-1">
                <button type="button" onClick={() => setConfirm({ rule: r, to: 'ACTIVE', source: String(r.official_source_url ?? ''), note: '', problem: null })} className="min-h-9 rounded-md border border-border px-2 text-xs">{t('admin_hs_activate')}</button>
                <button type="button" onClick={() => setConfirm({ rule: r, to: 'REJECTED', source: '', note: '', problem: null })} className="min-h-9 rounded-md border border-destructive/40 px-2 text-xs text-destructive">{t('admin_hs_rule_reject')}</button>
              </div>
            ) : null,
          ])} />
      </section>
      <MortgageBankProductsAdmin />
      <Confirm open={confirm !== null} onOpenChange={(o) => { if (!o && !busy) setConfirm(null); }}
        title={t(confirm?.to === 'REJECTED' ? 'admin_hs_rule_reject_title' : 'admin_hs_activate_title')}
        description={confirm?.to === 'REJECTED'
          ? t('admin_hs_rule_reject_body', { title: String(confirm?.rule.title ?? '') })
          : t('admin_hs_activate_body', { title: String(confirm?.rule.title ?? ''), date: String(confirm?.rule.effective_from ?? t('admin_hs_in_force')) })}
        confirmLabel={t(confirm?.to === 'REJECTED' ? 'admin_hs_rule_reject' : 'admin_hs_activate')} destructive={confirm?.to === 'REJECTED'}
        onConfirm={() => void move()} busy={busy}>
        {confirm ? (
          <div className="grid gap-3">
            {confirm.to === 'ACTIVE' ? (
              <Field label={t('admin_hs_rule_official_source')}>
                <input className={inputClass} type="url" dir="ltr" value={confirm.source} onChange={(e) => setConfirm({ ...confirm, source: e.target.value, problem: null })} />
              </Field>
            ) : null}
            <Field label={t('admin_hs_rule_note')}>
              <input className={inputClass} value={confirm.note} maxLength={500} onChange={(e) => setConfirm({ ...confirm, note: e.target.value, problem: null })} />
            </Field>
            {confirm.problem ? <p role="alert" dir="auto" className="break-words text-xs text-destructive">{confirm.problem}</p> : null}
          </div>
        ) : null}
      </Confirm>
    </div>
  );
}

function MortgageLeadsSection() {
  const { t } = useLanguage();
  const { data, error } = useRpc('admin_mortgage_lead_stats', {});
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  const credits = (v: unknown) => formatCredits(v, (n) => t('admin_hs_credits_n', { n }));
  /* mortgage_lead_price() returns null when the MORTGAGE_BUYER_LEAD product row is missing: "not configured", never "$0". */
  const priceCents = toNumber(data.price?.cents);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Tile label={t('admin_hs_ml_saved')} value={num(data.savedScenarios)} hint={t('admin_hs_ml_saved_hint', { n: data.scenarioOwners ?? 0 })} />
      <Tile label={t('admin_hs_ml_consented')} value={num(data.consentedActive)} hint={t('admin_hs_ml_withdrawn', { n: data.withdrawn ?? 0 })} />
      <Tile label={t('admin_hs_ml_unlocks')} value={num(data.uniqueUnlocks)} />
      {/* Credits charged, at 10 credits = $1. */}
      <Tile label={t('admin_hs_ml_revenue')} value={usd(creditsToUsd(data.unlockCredits ?? 0))} hint={credits(data.unlockCredits ?? 0)} />
      <Tile label={t('admin_hs_ml_prevented')} value={num(data.repeatChargesPrevented)} hint={t('admin_hs_ml_prevented_hint')} />
      {priceCents === null ? (
        <Tile label={t('admin_hs_ml_price')} value={t('admin_hs_ml_price_missing')} tone="warn" />
      ) : (
        <Tile label={t('admin_hs_ml_price')} value={`${usd(centsToUsd(priceCents))} = ${credits(data.price?.credits)}`} hint={t(data.price?.active ? 'admin_hs_ml_price_on' : 'admin_hs_ml_price_off')} />
      )}
    </div>
  );
}

function ContractsSection({ days }: { days: number }) {
  const { t } = useLanguage();
  const { data, error } = useRpc('admin_contract_unit_costs', { p_days: days });
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  /* Unit costs arrive in US cents; shown as USD. */
  const cents = (v: unknown) => usd(centsToUsd(v));
  const unpriced = Number(data.unpricedRuns ?? 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={t('admin_hs_ct_runs')} value={num(data.analyses)} hint={t('admin_hs_ct_allowance', { n: data.allowanceFunded ?? 0 })} />
        <Tile label={t('admin_hs_ct_avg')} value={cents(data.avgCostCents)} hint={`p50 ${cents(data.p50CostCents)} · p95 ${cents(data.p95CostCents)}`} />
        <Tile label={t('admin_hs_ct_max')} value={cents(data.maxCostCents)} />
        <Tile label={t('admin_hs_ct_tokens')} value={`${num(data.avgInputTokens)} / ${num(data.avgOutputTokens)}`} hint={ms(data.avgDurationMs)} />
        <MarginTile label={t('admin_hs_ct_margin20')} value={data.marginAt20Cents} />
        <MarginTile label={t('admin_hs_ct_margin50')} value={data.marginAt50Cents} />
        <Tile label={t('admin_hs_ct_charged')} value={formatCredits(data.avgChargedCredits, (n) => t('admin_hs_credits_n', { n }))} hint={t('admin_hs_ct_charged_hint')} />
        <Tile label={t('admin_hs_unpriced')} value={num(unpriced)} hint={t('admin_hs_ct_unpriced_hint')} tone={unpriced > 0 ? 'warn' : undefined} />
      </div>
      <p className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">{t('admin_hs_ct_note')}</p>
      <ul className="list-disc space-y-1 ps-5 text-xs text-muted-foreground" dir="ltr">{(data.notes ?? []).map((n: string) => <li key={n}>{n}</li>)}</ul>
    </div>
  );
}

function NotificationsSection({ days }: { days: number }) {
  const { t } = useLanguage();
  const { data, error } = useRpc('admin_notification_delivery_stats', { p_days: days });
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  const email = data.byChannel?.EMAIL ?? {};
  const sent = Number(email.SENT ?? 0); const failed = Number(email.FAILED ?? 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={t('admin_hs_nt_inapp')} value={num(data.inApp)} />
        <Tile label={t('admin_hs_nt_push')} value={num(data.pushed)} />
        <Tile label={t('admin_hs_nt_email_sent')} value={num(sent)} hint={sent + failed ? t('admin_hs_nt_rate', { pct: ((sent / (sent + failed)) * 100).toFixed(1) }) : undefined} />
        <Tile label={t('admin_hs_nt_email_failed')} value={num(failed)} tone={failed > 0 ? 'warn' : undefined} hint={t('admin_hs_nt_skipped', { n: email.SKIPPED ?? 0 })} />
      </div>
      <Table head={[t('admin_hs_col_reason'), t('admin_hs_col_count')]} rows={(data.topFailureReasons ?? []).map((r: Json) => [<code key="r" dir="ltr">{r.reason}</code>, num(r.count)])} />
      <p className="text-xs text-muted-foreground">{t('admin_hs_nt_note')} <Link className="underline" to="/admin/notifications">{t('admin_hs_nt_link')}</Link></p>
    </div>
  );
}

function LanguagesSection() {
  const { t } = useLanguage();
  /* Each language arrives as its own chunk (src/i18n/bundles.ts), the same way the site loads it. */
  const [rows, setRows] = useState<{ lang: string; have: number; total: number }[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const order = ['ka', ...LOCALES.filter((l) => l !== 'ka')];
    /* Deterministic: the route-only feature half (Home Financing, Investment, For Expats) is merged into
       English only once loadFeatureStrings() resolves, and loadLanguage() brings a language's feature
       and admin halves only after loadFeatureStrings()/loadAdminStrings() were asked. So both are awaited
       FIRST; counting before that raced the merge and the key total changed between visits. */
    Promise.all([loadAdminStrings(), loadFeatureStrings()])
      .then(() => Promise.all(order.map((lang) => loadLanguage(lang as never).then((b) => ({ lang, b, ok: true }), () => ({ lang, b: {} as Record<string, string>, ok: false })))))
      .then((loaded) => {
        if (!alive) return;
        /* Customer-facing keys: the admin and Email Studio halves are not what visitors read. */
        const keys = Object.keys(english).filter((k) => !isAdminOnlyKey(k) && !isStudioOnlyKey(k));
        const failed = loaded.filter((l) => !l.ok).map((l) => l.lang.toUpperCase());
        if (failed.length) setLoadError(failed.join(', '));
        setRows(loaded.filter((l) => l.ok).map(({ lang, b }) => {
          const bundle = lang === 'en' ? english : b;
          const have = keys.filter((k) => typeof bundle[k] === 'string' && bundle[k].trim() !== '').length;
          return { lang, have, total: keys.length };
        }));
      })
      .catch((e: unknown) => { if (alive) setLoadError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, []);
  if (!rows) return loadError ? <ErrorNote message={loadError} /> : <p className="text-sm text-muted-foreground">{t('admin_hs_loading')}</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('admin_hs_lang_sub')}</p>
      {loadError ? <ErrorNote message={t('admin_hs_lang_not_loaded', { langs: loadError })} /> : null}
      <Table head={[t('admin_hs_col_lang'), t('admin_hs_col_coverage'), t('admin_hs_col_keys')]}
        rows={rows.map((r) => [<span key="l">{r.lang.toUpperCase()}{r.lang === 'ka' ? ` · ${t('admin_hs_default_lang')}` : ''}</span>, `${((r.have / Math.max(1, r.total)) * 100).toFixed(2)}%`, `${r.have.toLocaleString()} / ${r.total.toLocaleString()}`])} />
    </div>
  );
}

export default function AdminHomiServicesPage({ section }: { section: HomiAdminSection }) {
  const { t } = useLanguage();
  const [days, setDays] = useState(30);
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  const withDays = section === 'homi' || section === 'ai-costs' || section === 'contracts' || section === 'notifications';
  return (
    <div className="space-y-5" data-testid="admin-homi-services" data-section={section}>
      <PageHeader title={t(current.labelKey)} subtitle={t(`admin_hs_sub_${section.replace('-', '_')}`)} actions={withDays ? <DaysPicker days={days} onChange={setDays} /> : undefined} />
      <nav aria-label={t('admin_hs_nav')} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {SECTIONS.map((s) => (
          <Link key={s.id} to={s.path} aria-current={s.id === section ? 'page' : undefined}
            className={cn('whitespace-nowrap rounded-full border px-3 py-1.5 text-sm', s.id === section ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted')}>
            {t(s.labelKey)}
          </Link>
        ))}
      </nav>
      {section === 'homi' ? <HomiSection days={days} costs={false} /> : null}
      {section === 'ai-costs' ? <HomiSection days={days} costs /> : null}
      {section === 'mortgage' ? <MortgageRulesSection /> : null}
      {section === 'mortgage-leads' ? <MortgageLeadsSection /> : null}
      {section === 'contracts' ? <ContractsSection days={days} /> : null}
      {section === 'notifications' ? <NotificationsSection days={days} /> : null}
      {section === 'languages' ? <LanguagesSection /> : null}
    </div>
  );
}

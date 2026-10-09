// FIND BUYERS / FIND TENANTS — the admin control center inside /admin/discovery.
//
// Overview (revenue vs every attributable COGS line), Actors (health, pricing,
// yield, controls), Campaigns (per-run economics), Source and Language
// intelligence, and the cost ledger. Money arrives as integer microdollars and
// is formatted here only. No secret is read or shown; Actor ids are public
// Apify slugs.

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  getFindBuyersCenter, setFindBuyersSetting, updateActor, usd, verifyActorFromApify, type FindBuyersCenter,
} from '@/services/findBuyers';
import { actorLifecycle, classifyActor } from '@/findBuyers/actorCatalog';
import { SourceNetworkPanel } from './SourceNetworkPanel';

type Tab = 'overview' | 'actors' | 'campaigns' | 'network' | 'sources' | 'languages' | 'ledger';
const TABS: Tab[] = ['overview', 'actors', 'campaigns', 'network', 'sources', 'languages', 'ledger'];
const WINDOWS = [1, 7, 30, 0];

const n = (v: unknown) => Number(v ?? 0) || 0;
const pct = (num: number, den: number) => (den > 0 ? `${((num / den) * 100).toFixed(1)}%` : '—');
const per = (micros: number, count: number) => (count > 0 ? usd(micros / count, 3) : '—');
const when = (iso: unknown) => (iso ? new Date(String(iso)).toLocaleString() : '—');

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <p className="text-2xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-lg font-semibold tabular-nums" dir="ltr">{value}</p>
      {hint ? <p className="mt-0.5 text-2xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[720px] text-2xs">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>{head.map((h) => <th key={h} className="px-2.5 py-2 text-start font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td className="px-2.5 py-3 text-muted-foreground" colSpan={head.length}>—</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i} className="border-t border-border/60 align-top">
              {r.map((c, j) => <td key={j} className="px-2.5 py-2">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HealthDot({ health }: { health: string }) {
  const tone = health === 'HEALTHY' ? 'bg-emerald-500' : health === 'DEGRADED' ? 'bg-amber-500' : health === 'FAILED' ? 'bg-red-500' : 'bg-muted-foreground/50';
  return <span className="inline-flex items-center gap-1.5"><span className={cn('h-2 w-2 rounded-full', tone)} />{health}</span>;
}

function ActorEditor({ actor, onSaved }: { actor: Record<string, any>; onSaved: () => void }) {
  const { t } = useLanguage();
  const [f, setF] = useState(() => ({
    priority: String(actor.priority), maxResults: String(actor.max_results), probeSize: String(actor.probe_size),
    concurrency: String(actor.concurrency), timeoutSeconds: String(actor.timeout_seconds), retryCap: String(actor.retry_cap),
    dailyCapUsd: String(n(actor.daily_spend_cap_micros) / 1e6), campaignCapUsd: String(n(actor.campaign_spend_cap_micros) / 1e6),
    pricingModel: String(actor.pricing_model), pricePer1kUsd: actor.price_per_1k_micros == null ? '' : String(n(actor.price_per_1k_micros) / 1e6),
    startFeeUsd: String(n(actor.start_fee_micros) / 1e6), pricingVerified: false,
  }));
  const [busy, setBusy] = useState(false);
  const micros = (s: string) => Math.round(Number(s) * 1e6);
  const save = async () => {
    setBusy(true);
    try {
      const res = await updateActor(actor.actor_key, {
        priority: Number(f.priority), maxResults: Number(f.maxResults), probeSize: Number(f.probeSize),
        concurrency: Number(f.concurrency), timeoutSeconds: Number(f.timeoutSeconds), retryCap: Number(f.retryCap),
        dailySpendCapMicros: micros(f.dailyCapUsd), campaignSpendCapMicros: micros(f.campaignCapUsd),
        pricingModel: f.pricingModel, ...(f.pricePer1kUsd !== '' ? { pricePer1kMicros: micros(f.pricePer1kUsd) } : {}),
        startFeeMicros: micros(f.startFeeUsd), pricingVerified: f.pricingVerified,
      });
      toast.success(res.pricingReset ? t('fbx_admin_price_reset') : t('fbx_admin_saved'));
      onSaved();
    } catch (e) { toast.error(String((e as Error).message)); } finally { setBusy(false); }
  };
  const field = (key: keyof typeof f, label: string, type = 'number') => (
    <label className="flex flex-col gap-1 text-2xs">
      <span className="text-muted-foreground">{label}</span>
      <input type={type} step="any" dir="ltr" value={String(f[key])} onChange={(e) => setF({ ...f, [key]: e.target.value })}
        className="min-h-9 rounded-md border border-border bg-background px-2 text-xs" />
    </label>
  );
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-border bg-background/40 p-3 sm:grid-cols-4">
      {field('priority', t('fbx_admin_priority'))}
      {field('probeSize', t('fbx_admin_probe'))}
      {field('maxResults', t('fbx_admin_max_results'))}
      {field('concurrency', t('fbx_admin_concurrency'))}
      {field('timeoutSeconds', t('fbx_admin_timeout'))}
      {field('retryCap', t('fbx_admin_retry_cap'))}
      {field('dailyCapUsd', t('fbx_admin_daily_cap'))}
      {field('campaignCapUsd', t('fbx_admin_campaign_cap'))}
      <label className="flex flex-col gap-1 text-2xs">
        <span className="text-muted-foreground">{t('fbx_admin_price_model')}</span>
        <select value={f.pricingModel} onChange={(e) => setF({ ...f, pricingModel: e.target.value })} className="min-h-9 rounded-md border border-border bg-background px-2 text-xs">
          {['PAY_PER_RESULT', 'PAY_PER_EVENT', 'UNKNOWN'].map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      {field('pricePer1kUsd', t('fbx_admin_price_1k'))}
      {field('startFeeUsd', t('fbx_admin_start_fee'))}
      <label className="flex items-center gap-2 text-2xs sm:col-span-2">
        <input type="checkbox" checked={f.pricingVerified} onChange={(e) => setF({ ...f, pricingVerified: e.target.checked })} className="h-4 w-4" />
        <span>{t('fbx_admin_mark_verified')}</span>
      </label>
      <div className="col-span-2 flex justify-end sm:col-span-4">
        <Button size="sm" onClick={save} disabled={busy}>{busy ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}{t('fbx_admin_save')}</Button>
      </div>
    </div>
  );
}

export function FindBuyersControlCenter() {
  const { t } = useLanguage();
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<FindBuyersCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await getFindBuyersCenter(days)); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [days]);
  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusyKey(key);
    try { await fn(); toast.success(ok); await load(); } catch (e) { toast.error((e as Error).message); } finally { setBusyKey(null); }
  };

  const o = data?.overview;
  const cogs = o ? n(o.provider_micros) + n(o.ai_micros) + n(o.translation_micros) + n(o.other_micros) : 0;
  const contribution = o ? n(o.revenue_micros) - cogs : 0;
  const socialOn = data?.switches?.find_buyers_social_enabled === true;

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-card" aria-labelledby="fbx-admin-title" data-testid="find-buyers-center">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="fbx-admin-title" className="font-display text-base font-semibold">{t('fbx_admin_title')}</h2>
          <p className="text-2xs text-muted-foreground">{t('fbx_admin_subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Only with data: a switch drawn before the state is known would show a guess. */}
          {data ? (
            <label className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-2xs">
              <Switch checked={socialOn} disabled={busyKey === 'switch'}
                onCheckedChange={(v) => act('switch', () => setFindBuyersSetting('find_buyers_social_enabled', v), t('fbx_admin_saved'))} />
              <span>{t('fbx_admin_switch')}</span>
            </label>
          ) : null}
          <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label={t('fbx_admin_window')}>
            {WINDOWS.map((w) => (
              <button key={w} type="button" onClick={() => setDays(w)} aria-pressed={days === w}
                className={cn('min-h-8 rounded-md px-2.5 text-2xs font-medium', days === w ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
                {w === 0 ? t('fbx_admin_lifetime') : w === 1 ? t('fbx_admin_today') : `${w}d`}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1 border-b border-border" role="tablist">
        {TABS.map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)}
            className={cn('min-h-9 border-b-2 px-3 text-2xs font-semibold', tab === k ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground')}>
            {t(`fbx_admin_tab_${k}`)}
          </button>
        ))}
      </div>

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      {loading && !data ? <div className="mt-4 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div> : null}

      {data && tab === 'overview' && o ? (
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Kpi label={t('fbx_admin_revenue')} value={usd(o.revenue_micros)} hint={t('fbx_admin_revenue_hint')} />
          <Kpi label={t('fbx_admin_credits_committed')} value={n(o.credits_committed).toLocaleString()} hint={usd(o.customer_value_micros)} />
          <Kpi label={t('fbx_admin_provider_spend')} value={usd(o.provider_micros)} />
          <Kpi label={t('fbx_admin_ai_spend')} value={usd(o.ai_micros, 3)} />
          <Kpi label={t('fbx_admin_translation_spend')} value={usd(o.translation_micros, 3)} />
          <Kpi label={t('fbx_admin_other_cogs')} value={usd(o.other_micros)} />
          <Kpi label={t('fbx_admin_total_cogs')} value={usd(cogs)} />
          <Kpi label={t('fbx_admin_contribution')} value={usd(contribution)} hint={pct(contribution, n(o.revenue_micros))} />
          <Kpi label={t('fbx_admin_qualified')} value={String(n(o.qualified_leads))} />
          <Kpi label={t('fbx_admin_strong')} value={String(n(o.strong_leads))} />
          <Kpi label={t('fbx_admin_cpq')} value={per(cogs, n(o.qualified_leads))} />
          <Kpi label={t('fbx_admin_cps')} value={per(cogs, n(o.strong_leads))} />
        </div>
      ) : null}

      {data && tab === 'actors' ? (
        <div className="mt-4 space-y-2">
          {data.actors.map((a) => (
            <div key={a.actor_key} className="rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{a.actor_key} <span className="text-2xs font-normal text-muted-foreground">· {a.source} · {a.purpose} · {a.role}</span></p>
                  <p className="break-all text-2xs text-muted-foreground" dir="ltr">{a.actor_id}</p>
                  <p className="mt-1 flex flex-wrap gap-1.5 text-2xs" data-testid="fbx-actor-class">
                    <span className="rounded border border-border px-1.5 py-0.5">{t('fbx_admin_class')}: <b dir="ltr">{classifyActor(a.actor_key).cls}</b></span>
                    <span className="rounded border border-border px-1.5 py-0.5">{t('fbx_admin_lifecycle')}: <b dir="ltr">{actorLifecycle(a as Parameters<typeof actorLifecycle>[0])}</b></span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-2xs">
                  <HealthDot health={a.health} />
                  <label className="flex items-center gap-1.5">
                    <Switch checked={a.enabled === true} disabled={busyKey === a.actor_key}
                      onCheckedChange={(v) => act(a.actor_key, () => updateActor(a.actor_key, { enabled: v }), t('fbx_admin_saved'))} />
                    {t('fbx_admin_enabled')}
                  </label>
                  <Button size="sm" variant="outline" disabled={busyKey === a.actor_key}
                    onClick={() => act(a.actor_key, async () => { const r = await verifyActorFromApify(a.actor_key); if (!r.success) throw new Error(r.error ?? 'verify failed'); }, t('fbx_admin_verified'))}>
                    <ShieldCheck className="me-1 h-3.5 w-3.5" />{t('fbx_admin_verify')}
                  </Button>
                  <Button size="sm" variant={a.emergency_disabled ? 'default' : 'destructive'} disabled={busyKey === a.actor_key}
                    onClick={() => act(a.actor_key, () => updateActor(a.actor_key, { emergencyDisabled: !a.emergency_disabled }), t('fbx_admin_saved'))}>
                    <ShieldAlert className="me-1 h-3.5 w-3.5" />{a.emergency_disabled ? t('fbx_admin_emergency_clear') : t('fbx_admin_emergency')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(editing === a.actor_key ? null : a.actor_key)}>{t('fbx_admin_edit')}</Button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-2xs sm:grid-cols-4 lg:grid-cols-6">
                <span>{t('fbx_admin_price')}: <b dir="ltr">{a.pricing_model} {a.price_per_1k_micros == null ? '—' : `${usd(a.price_per_1k_micros, 3)}/1K`}</b></span>
                <span>{t('fbx_admin_price_verified')}: <b>{a.pricing_verified_at ? when(a.pricing_verified_at) : t('fbx_admin_not_verified')}</b></span>
                <span>{t('fbx_admin_output_proven')}: <b>{a.output_contract_verified_at ? when(a.output_contract_verified_at) : t('fbx_admin_not_verified')}</b></span>
                <span>{t('fbx_admin_last_verified')}: <b>{when(a.last_verified_at)}</b></span>
                <span>{t('fbx_admin_runs')}: <b>{n(a.runs)}</b></span>
                <span>{t('fbx_admin_success_rate')}: <b>{pct(n(a.succeeded), n(a.runs))}</b></span>
                <span>{t('fbx_admin_error_rate')}: <b>{pct(n(a.failed), n(a.runs))}</b></span>
                <span>{t('fbx_admin_results_billed')}: <b>{n(a.results_billed)}</b></span>
                <span>{t('fbx_admin_useful')}: <b>{n(a.useful_results)}</b></span>
                <span>{t('fbx_admin_qualified')}: <b>{n(a.qualified_leads)}</b></span>
                <span>{t('fbx_admin_strong')}: <b>{n(a.strong_leads)}</b></span>
                <span>{t('fbx_admin_spend')}: <b dir="ltr">{usd(a.spend_micros, 3)}</b></span>
                <span>{t('fbx_admin_cpu')}: <b dir="ltr">{per(n(a.spend_micros), n(a.useful_results))}</b></span>
                <span>{t('fbx_admin_cpq')}: <b dir="ltr">{per(n(a.spend_micros), n(a.qualified_leads))}</b></span>
                <span>{t('fbx_admin_latency')}: <b dir="ltr">{a.latency_p50_ms == null ? '—' : `${Math.round(n(a.latency_p50_ms) / 1000)}s`}</b></span>
                <span>{t('fbx_admin_last_run')}: <b>{when(a.last_run_at)}</b></span>
                <span className="col-span-2">{t('fbx_admin_caps')}: <b dir="ltr">{`${t('fbx_admin_daily_cap')}: ${usd(a.daily_spend_cap_micros)} · ${t('fbx_admin_campaign_cap')}: ${usd(a.campaign_spend_cap_micros)} · ${t('fbx_admin_probe')}: ${a.probe_size} · ${t('fbx_admin_max_results')}: ${a.max_results}`}</b></span>
              </div>
              {a.last_error ? <p className="mt-1.5 break-words text-2xs text-destructive">{t('fbx_admin_last_error')}: {a.last_error}</p> : null}
              {editing === a.actor_key ? <ActorEditor actor={a} onSaved={() => { setEditing(null); void load(); }} /> : null}
            </div>
          ))}
        </div>
      ) : null}

      {data && tab === 'campaigns' ? (
        <div className="mt-4">
          <Table
            head={[t('fbx_admin_started'), t('fbl_admin_state'), t('fbl_admin_work'), t('fbl_admin_signals'), t('fbl_admin_new'), t('fbl_admin_stop_reason'), t('fbx_admin_mode'), t('fbx_admin_credits_committed'), t('fbx_admin_revenue'), t('fbx_admin_reserved'), t('fbx_admin_provider_spend'), t('fbx_admin_ai_spend'), t('fbx_admin_translation_spend'), t('fbx_admin_total_cogs'), t('fbx_admin_contribution'), t('fbx_admin_qualified'), t('fbx_admin_strong'), t('fbx_admin_status'), t('fbx_admin_last_activity')]}
            rows={data.campaigns.map((c) => [
              <span key="s" title={`job ${c.matching_job_id} · campaign ${c.campaign_id ?? '—'} · property ${c.property_id}`}>{when(c.created_at)}</span>,
              /* The server's lifecycle (find_buyers_job_state), the same one the owner sees. */
              <span key="st" className="font-semibold">{String(c.lifecycle?.state ?? '—')}</span>,
              <span key="w" dir="ltr" title={t('fbl_admin_work_hint')} className="tabular-nums">
                {n(c.lifecycle?.queue?.queued)}/{n(c.lifecycle?.queue?.running)}/{n(c.lifecycle?.queue?.done)}/{n(c.lifecycle?.queue?.failed)}/{n(c.lifecycle?.queue?.paused)} · {n(c.lifecycle?.runs?.inFlight)}
              </span>,
              n(c.lifecycle?.signalsAnalyzed),
              n(c.lifecycle?.newResults),
              <span key="sr" dir="ltr">{String(c.stop_reason ?? c.lifecycle?.failureReason ?? '—')}</span>,
              c.transaction === 'RENT' ? t('fbx_find_tenants') : t('fbx_find_buyers'),
              <span key="cr" dir="ltr">{n(c.credits_committed)} ({usd(c.customer_value_micros)})</span>,
              <span key="rv" dir="ltr">{usd(c.revenue_micros)}</span>,
              <span key="rs" dir="ltr">{usd(c.reserved_micros)}/{usd(c.provider_budget_micros)}</span>,
              <span key="p" dir="ltr">{usd(c.provider_micros, 3)}</span>,
              <span key="a" dir="ltr">{usd(c.ai_micros, 3)}</span>,
              <span key="tr" dir="ltr">{usd(c.translation_micros, 3)}</span>,
              <span key="tc" dir="ltr">{usd(c.total_cogs_micros, 3)}</span>,
              <span key="gc" dir="ltr">{usd(n(c.revenue_micros) - n(c.total_cogs_micros), 3)}</span>,
              n(c.leads), n(c.strong), String(c.job_status ?? ''), when(c.last_activity_at),
            ])}
          />
        </div>
      ) : null}

      {tab === 'network' ? <SourceNetworkPanel days={days} /> : null}

      {data && tab === 'sources' ? (
        <div className="mt-4">
          <Table
            head={[t('fbx_admin_source'), t('fbx_admin_name'), t('fbx_admin_city'), t('fbx_admin_languages'), t('fbx_admin_members'), t('fbx_admin_first_discovered'), t('fbx_admin_last_checked'), t('fbx_admin_posts'), t('fbx_admin_spend'), t('fbx_admin_qualified'), t('fbx_admin_cpq'), t('fbx_admin_health')]}
            rows={data.sources.map((s) => [
              s.platform,
              <a key="n" href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="underline" dir="auto">{s.name}</a>,
              s.city ?? '—', (s.languages ?? []).join(', ') || '—', s.member_count ?? '—', when(s.first_discovered), when(s.last_checked_at),
              n(s.posts_observed), <span key="sp" dir="ltr">{usd(s.fb_spend_micros, 3)}</span>, n(s.fb_qualified_leads),
              <span key="c" dir="ltr">{s.cost_per_qualified_micros == null ? '—' : usd(s.cost_per_qualified_micros, 3)}</span>,
              `${s.access_state ?? ''} · ${s.lifecycle ?? ''}`,
            ])}
          />
        </div>
      ) : null}

      {data && tab === 'languages' ? (
        <div className="mt-4">
          <Table
            head={[t('fbx_admin_language'), t('fbx_admin_spend'), t('fbx_admin_signals'), t('fbx_admin_qualified'), t('fbx_admin_strong'), t('fbx_admin_cpq')]}
            rows={data.languages.map((l) => [
              <span key="l" className="font-semibold uppercase">{l.lang}</span>,
              <span key="s" dir="ltr">{usd(l.spend_micros, 3)}</span>, n(l.signals), n(l.qualified), n(l.strong),
              <span key="c" dir="ltr">{per(n(l.spend_micros), n(l.qualified))}</span>,
            ])}
          />
        </div>
      ) : null}

      {data && tab === 'ledger' ? (
        <div className="mt-4">
          <Table
            head={[t('fbx_admin_time'), t('fbx_admin_kind'), t('fbx_admin_source'), t('fbx_admin_actor'), t('fbx_admin_run'), t('fbx_admin_operation'), t('fbx_admin_requested'), t('fbx_admin_billed'), t('fbx_admin_estimated'), t('fbx_admin_actual'), t('fbx_admin_state'), t('fbx_admin_status')]}
            rows={data.ledger.map((l) => [
              when(l.occurred_at), l.kind, l.source ?? l.provider, l.actor_key ?? l.model ?? '—',
              <span key="r" className="break-all" dir="ltr" title={String(l.matching_job_id ?? '')}>{l.provider_run_id ?? '—'}</span>,
              l.operation, l.requested_limit ?? '—', l.billed_units ?? '—',
              <span key="e" dir="ltr">{usd(l.estimated_micros, 4)}</span>,
              <span key="a" dir="ltr">{l.actual_micros == null ? '—' : usd(l.actual_micros, 4)}</span>,
              `${l.cost_state}${l.cost_basis ? ` · ${l.cost_basis}` : ''}${l.after_settlement ? ' · post-settle' : ''}`,
              <span key="st" className={l.error ? 'text-destructive' : ''}>{l.status}{l.error ? ` · ${l.error}` : ''}{l.retry_of ? ' ↻' : ''}</span>,
            ])}
          />
        </div>
      ) : null}
    </section>
  );
}

export default FindBuyersControlCenter;

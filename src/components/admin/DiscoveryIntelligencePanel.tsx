// HOMATCH ADMIN — DISCOVERY INTELLIGENCE (Phase 2).
//
// Answers "is HOMATCH actually learning?" from one admin-only RPC
// (admin_discovery_intelligence): Find Property runs and their source jobs,
// the queue by provider / route / status with stale leases, the latest live
// check of every priority source on every route, supply by adapter (incl.
// community posts), entity clusters and resolution verdicts, and match
// volumes by shape. Counts, states and ids only -- no text, no contact, no
// token. Lives inside the existing Admin shell, under the Discovery page.
import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { intlLocaleFor } from '@/components/workspace/primitives';
import { SOURCE_CAPABILITIES, sourceStatus } from '@/research-core/discovery/source-capabilities.ts';
import {
  PHASE2_SWITCHES, getDiscoveryIntelligence, runSourceLiveChecks, setPhase2Switch, settingOn,
  type DiscoveryIntelligence, type Phase2Switch,
} from '@/services/adminDiscovery';
import { AdminMarketplacePanel } from '@/components/findProperty/AdminMarketplacePanel';

const Panel = ({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) => (
  <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {action}
    </div>
    {children}
  </section>
);

const Kpi = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="rounded-xl border border-border bg-[hsl(var(--secondary))] px-3 py-2.5">
    <p className="text-2xs text-muted-foreground">{label}</p>
    <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
  </div>
);

/* A table that scrolls inside its own box on a phone, never the page. */
const Scroll = ({ children }: { children: React.ReactNode }) => (
  <div className="-mx-1 overflow-x-auto px-1">{children}</div>
);

function when(iso: string | null | undefined, locale: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}
const yes = (v: boolean | null | undefined) => (v === true ? '✓' : v === false ? '✗' : '—');

function IntelligenceContent() {
  const { t, lang } = useLanguage();
  const locale = intlLocaleFor(lang);
  const [data, setData] = useState<DiscoveryIntelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await getDiscoveryIntelligence()); }
    catch (e) { toast.error(e instanceof Error ? e.message : t('admin_disc_load_failed')); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (key: Phase2Switch, on: boolean) => {
    setBusy(key);
    try { await setPhase2Switch(key, on); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : t('admin_disc_save_failed')); }
    finally { setBusy(null); }
  };

  const liveCheck = async () => {
    setBusy('live');
    try {
      const r = await runSourceLiveChecks();
      toast.success(t('p2d_admin_live_done', { count: String(r.checks) }));
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : t('admin_disc_action_failed')); }
    finally { setBusy(null); }
  };

  if (!data) {
    return loading ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : null;
  }
  const safe = (v: unknown) => (Array.isArray(v) ? v : []);
  data.runs = safe(data.runs) as never; data.queue = safe(data.queue) as never;
  data.live_checks = safe(data.live_checks) as never; data.supply_by_adapter = safe(data.supply_by_adapter) as never;
  data.entities.largest = safe(data.entities.largest) as never;
  data.switches = data.switches ?? {}; data.resolution_7d = data.resolution_7d ?? {};
  data.matches = data.matches ?? { external_listing: 0, external_intelligence: 0, internal_homatch: 0, demand_matches_30d: 0 };
  data.community_supply = data.community_supply ?? { listing_posts: 0, stored_as_supply: 0 };

  const e = data.entities;
  const dedupRate = e.observations > 0 ? Math.round((1 - e.total / Math.max(1, e.resolved_observations)) * 100) : null;

  return (
    <div className="space-y-4" data-testid="discovery-intelligence">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-foreground">{t('p2d_admin_title')}</h2>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{t('admin_disc_refresh')}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label={t('p2d_admin_kpi_observations')} value={e.observations} />
        <Kpi label={t('p2d_admin_kpi_entities')} value={e.total} />
        <Kpi label={t('p2d_admin_kpi_multi_source')} value={e.multi_source} />
        <Kpi label={t('p2d_admin_kpi_dedup')} value={dedupRate === null ? '—' : `${dedupRate}%`} />
        <Kpi label={t('p2d_admin_kpi_listing_matches')} value={data.matches.external_listing} />
        <Kpi label={t('p2d_admin_kpi_community_supply')} value={`${data.community_supply.stored_as_supply} / ${data.community_supply.listing_posts}`} />
      </div>

      <Panel title={t('admin_disc_switches')}>
        <ul className="space-y-3">
          {PHASE2_SWITCHES.map((key) => (
            <li key={key} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{t(`p2d_admin_sw_${key}` as never)}</p>
                <p className="text-xs leading-snug text-muted-foreground">{t(`p2d_admin_sw_${key}_d` as never)}</p>
              </div>
              <Switch checked={settingOn(data.switches[key])} disabled={busy === key}
                onCheckedChange={(on) => void toggle(key, on)} aria-label={t(`p2d_admin_sw_${key}` as never)} />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-2xs text-muted-foreground">
          {t('p2d_admin_worker_portals')}{' '}
          <code dir="ltr">{JSON.stringify(data.switches.discovery_worker_portal_adapters ?? [])}</code>
        </p>
      </Panel>

      <Panel title={t('p2d_admin_readiness')}>
        <p className="mb-2 text-2xs text-muted-foreground">{t('p2d_admin_readiness_note')}</p>
        <Scroll>
          <table className="w-full min-w-[40rem] text-xs">
            <thead><tr className="text-muted-foreground">
              {['p2d_admin_col_source', 'p2d_admin_col_status', 'p2d_admin_col_method', 'p2d_admin_col_live_tested', 'p2d_admin_col_checked', 'p2d_admin_col_reason']
                .map((k) => <th key={k} className="py-1 text-start font-medium">{t(k as never)}</th>)}
            </tr></thead>
            <tbody>
              {SOURCE_CAPABILITIES.map((cap) => {
                const lastCollectedAt = data.supply_by_adapter.find((a) => a.adapter_id === cap.adapterId)?.last_seen ?? null;
                const switchKey = cap.platform === 'FORUM' ? 'forum_discovery_enabled' : cap.platform === 'TELEGRAM' ? 'telegram_discovery_enabled' : null;
                const status = sourceStatus(cap, {
                  liveChecks: data.live_checks,
                  lastCollectedAt,
                  enabled: switchKey ? settingOn(data.switches[switchKey]) : undefined,
                });
                return (
                  <tr key={cap.key} className="border-t border-border/60 align-top">
                    <td className="py-1.5 font-medium" dir="ltr">{cap.label}</td>
                    <td className={cn('py-1.5 font-semibold', status.status === 'READY' ? 'text-[hsl(152_54%_30%)]' : status.status === 'DEGRADED' ? 'text-[hsl(38_92%_35%)]' : 'text-muted-foreground')} dir="ltr">{status.status}</td>
                    <td className="py-1.5" dir="ltr">{cap.retrieval}</td>
                    <td className="py-1.5">{yes(status.liveTested)}</td>
                    <td className="py-1.5 whitespace-nowrap">{status.lastProofAt ? when(status.lastProofAt, locale) : '—'}</td>
                    <td className="py-1.5 max-w-[22rem] break-words text-muted-foreground" dir="ltr">{status.reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Scroll>
      </Panel>

      <Panel
        title={t('p2d_admin_live_checks')}
        action={(
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void liveCheck()} disabled={busy === 'live'}>
            {busy === 'live' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}{t('p2d_admin_run_live')}
          </Button>
        )}
      >
        {data.live_checks.length === 0 ? <p className="text-xs text-muted-foreground">{t('p2d_admin_none')}</p> : (
          <Scroll>
            <table className="w-full min-w-[40rem] text-xs">
              <thead><tr className="text-muted-foreground">
                {['p2d_admin_col_source', 'p2d_admin_col_route', 'p2d_admin_col_result', 'p2d_admin_col_items',
                  'p2d_admin_col_detail', 'p2d_admin_col_normalized', 'p2d_admin_col_latency', 'p2d_admin_col_limit', 'p2d_admin_col_checked']
                  .map((k) => <th key={k} className="py-1 text-start font-medium">{t(k as never)}</th>)}
              </tr></thead>
              <tbody>
                {data.live_checks.map((c) => (
                  <tr key={`${c.source_key}:${c.route}`} className="border-t border-border/60 align-top">
                    <td className="py-1.5 font-medium" dir="ltr">{c.source_key}</td>
                    <td className="py-1.5" dir="ltr">{c.route}</td>
                    <td className={cn('py-1.5', c.ok ? 'text-[hsl(152_54%_30%)]' : 'text-destructive')}>
                      {c.ok ? t('p2d_admin_ok') : t('p2d_admin_failed')}{c.http_status ? ` · ${c.http_status}` : ''}
                    </td>
                    <td className="py-1.5 tabular-nums">{c.collection_items ?? '—'}</td>
                    <td className="py-1.5">{yes(c.detail_ok)}</td>
                    <td className="py-1.5">{yes(c.normalized_ok)}</td>
                    <td className="py-1.5 tabular-nums">{c.latency_ms != null ? `${c.latency_ms} ms` : '—'}</td>
                    <td className="py-1.5 max-w-[14rem] break-words text-muted-foreground" dir="ltr">{c.limitation ?? '—'}</td>
                    <td className="py-1.5 whitespace-nowrap">{when(c.checked_at, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        )}
      </Panel>

      <Panel title={t('p2d_admin_runs')}>
        {data.runs.length === 0 ? <p className="text-xs text-muted-foreground">{t('p2d_admin_none')}</p> : (
          <Scroll>
            <table className="w-full min-w-[40rem] text-xs">
              <thead><tr className="text-muted-foreground">
                {['admin_disc_col_started', 'admin_disc_col_state', 'p2d_admin_col_stage', 'p2d_admin_col_results',
                  'p2d_admin_col_charged', 'p2d_admin_col_cogs', 'admin_disc_col_sources']
                  .map((k) => <th key={k} className="py-1 text-start font-medium">{t(k as never)}</th>)}
              </tr></thead>
              <tbody>
                {data.runs.map((r) => (
                  <tr key={r.id} className="border-t border-border/60 align-top">
                    <td className="py-1.5 whitespace-nowrap">{when(r.started_at, locale)}</td>
                    <td className="py-1.5" dir="ltr">{r.status}{r.failure_reason ? <span className="block text-muted-foreground">{r.failure_reason}</span> : null}</td>
                    <td className="py-1.5" dir="ltr">{r.stage} · {r.progress}%</td>
                    <td className="py-1.5 tabular-nums">{r.results_found}</td>
                    <td className="py-1.5 tabular-nums">{r.credits_charged ?? '—'}</td>
                    <td className="py-1.5 tabular-nums">{r.provider_cost_usd == null ? t('p2d_admin_unknown') : `$${r.provider_cost_usd}`}</td>
                    <td className="py-1.5 text-muted-foreground" dir="ltr">
                      {Object.entries(r.source_jobs ?? {}).map(([k, n]) => `${k} ${n}`).join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('p2d_admin_queue')}>
          <Scroll>
            <table className="w-full min-w-[28rem] text-xs">
              <thead><tr className="text-muted-foreground">
                {['p2d_admin_col_provider', 'p2d_admin_col_route', 'admin_disc_col_state', 'p2d_admin_col_jobs', 'p2d_admin_col_oldest', 'p2d_admin_col_stale']
                  .map((k) => <th key={k} className="py-1 text-start font-medium">{t(k as never)}</th>)}
              </tr></thead>
              <tbody>
                {data.queue.map((q) => (
                  <tr key={`${q.provider}:${q.executor}:${q.status}`} className="border-t border-border/60">
                    <td className="py-1.5" dir="ltr">{q.provider}</td>
                    <td className="py-1.5" dir="ltr">{q.executor}</td>
                    <td className="py-1.5" dir="ltr">{q.status}</td>
                    <td className="py-1.5 tabular-nums">{q.jobs}</td>
                    <td className="py-1.5 whitespace-nowrap">{when(q.oldest_waiting, locale)}</td>
                    <td className={cn('py-1.5 tabular-nums', q.expired_leases > 0 && 'text-destructive')}>{q.expired_leases}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        </Panel>

        <Panel title={t('p2d_admin_supply')}>
          <Scroll>
            <table className="w-full min-w-[28rem] text-xs">
              <thead><tr className="text-muted-foreground">
                {['p2d_admin_col_source', 'p2d_admin_kpi_observations', 'p2d_admin_kpi_entities', 'p2d_admin_col_new7', 'p2d_admin_col_quality', 'p2d_admin_col_last_seen']
                  .map((k) => <th key={k} className="py-1 text-start font-medium">{t(k as never)}</th>)}
              </tr></thead>
              <tbody>
                {data.supply_by_adapter.map((s) => (
                  <tr key={s.adapter_id} className="border-t border-border/60">
                    <td className="py-1.5" dir="ltr">{s.adapter_id}</td>
                    <td className="py-1.5 tabular-nums">{s.observations}</td>
                    <td className="py-1.5 tabular-nums">{s.entities}</td>
                    <td className="py-1.5 tabular-nums">{s.new_7d}</td>
                    <td className="py-1.5 tabular-nums">{s.avg_quality ?? '—'}</td>
                    <td className="py-1.5 whitespace-nowrap">{when(s.last_seen, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        </Panel>
      </div>

      <Panel title={t('p2d_admin_entities')}>
        <p className="mb-2 text-xs text-muted-foreground" dir="ltr">
          {Object.entries(data.resolution_7d).map(([v, n]) => `${v} ${n}`).join(' · ') || '—'}
        </p>
        <Scroll>
          <table className="w-full min-w-[36rem] text-xs">
            <thead><tr className="text-muted-foreground">
              {['p2d_admin_col_city', 'p2d_admin_col_deal', 'p2d_admin_kpi_observations', 'p2d_admin_col_sources_n', 'p2d_admin_col_price', 'p2d_admin_col_last_seen']
                .map((k) => <th key={k} className="py-1 text-start font-medium">{t(k as never)}</th>)}
            </tr></thead>
            <tbody>
              {e.largest.map((x) => (
                <tr key={x.id} className="border-t border-border/60">
                  <td className="py-1.5">{x.city ?? '—'}</td>
                  <td className="py-1.5" dir="ltr">{[x.transaction, x.property_type].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="py-1.5 tabular-nums">{x.observation_count}</td>
                  <td className="py-1.5 tabular-nums">{x.source_count}</td>
                  <td className="py-1.5 tabular-nums" dir="ltr">
                    {x.min_price != null ? `${x.min_price}${x.max_price != null && x.max_price !== x.min_price ? `–${x.max_price}` : ''} ${x.price_currency ?? ''}` : '—'}
                  </td>
                  <td className="py-1.5 whitespace-nowrap">{when(x.last_seen_at, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
      </Panel>
    </div>
  );
}

/*
 * A fault in this panel must never take down the Admin shell around it: the
 * Discovery page's switches and Stop/Retry stay usable whatever this renders.
 */
class PanelBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error('DiscoveryIntelligencePanel failed', error); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function DiscoveryIntelligencePanel() {
  return (
    <>
      <PanelBoundary><IntelligenceContent /></PanelBoundary>
      {/* Marketplace Search observability: its own boundary and its own RPC. */}
      <div className="mt-4"><AdminMarketplacePanel /></div>
    </>
  );
}

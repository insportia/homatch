// ADMIN — META ADS CONTROL CENTER. The deep end: integration truth,
// campaigns with their REAL external topology, connections, leads,
// audiences, moderation, money, errors, funnel and every kill switch.
// Reads ride the is_admin RLS policies. Every write goes through a
// meta-ads-api admin action that checks the role, validates on the server,
// requires a reason and writes the audit log: settings and kill switches
// (admin_setting_set), moderation decisions (admin_moderation_decide), Guard
// acts, per-customer fee policies, manual balance adjustments and the manual
// campaign sync.
//
// Campaign state is the CANONICAL one (src/lib/metaAds/uiStatus.ts, through
// src/lib/metaAds/adminView.ts): the same function the customer dashboard
// counts with, so a campaign Meta reports paused is never counted as
// delivering here. HOMATCH's lifecycle and Meta's own word are shown beside
// it, with the sync's freshness and any disagreement between them.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { FilterRail } from '@/components/customer/surface';
import { RefreshCw, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { money } from '@/services/metaAds';
import { EconomicsPanel } from '@/components/admin/metaAds/EconomicsPanel';
import { FeePolicyPanel } from '@/components/admin/metaAds/FeePolicyPanel';
import { GuardPanel } from '@/components/admin/metaAds/GuardPanel';
import { ApiHealthPanel, IntegrationProbe } from '@/components/admin/metaAds/ApiHealthPanel';
import { AGO, MIN_REASON } from '@/components/admin/metaAds/kit';
import { IdChip } from '@/components/admin/control/AdminKit';
import { Owner, usePeople } from '@/components/admin/metaAds/people';
import { instantFormsCause as formsCause, missingInstantFormScopes, INSTANT_FORM_PERMISSIONS } from '@/lib/metaAds/instantForms';
import { searchUsers } from '@/services/adminControl';
import { CampaignStatusChip } from '@/components/metaAds/workspace/CampaignStatusChip';
import { ago } from '@/components/metaAds/workspace/format';
import { Textarea } from '@/components/ui/textarea';
import {
  adminCounts, campaignMatchesSearch, matchesAdminFilter, discrepancy, syncFreshness, isAdminFilter, ADMIN_FILTERS,
  type AdminCampaignRow, type AdminFilter, type Discrepancy, type Freshness,
} from '@/lib/metaAds/adminView';
import {
  ADMIN_KILL_SWITCHES, ADMIN_JSON_OBJECT_SETTINGS, ADMIN_NUMERIC_SETTINGS, isCredentialKey, validateSetting,
} from '@/lib/metaAds/adminSettings';

type Tab = 'overview' | 'campaigns' | 'connections' | 'leads' | 'audiences'
  | 'moderation' | 'finance' | 'errors' | 'guard' | 'fees' | 'economics' | 'api' | 'settings';
const TABS: Tab[] = ['overview', 'campaigns', 'connections', 'leads', 'audiences', 'moderation', 'finance', 'errors', 'guard', 'fees', 'economics', 'api', 'settings'];

const KILL_SWITCHES: readonly string[] = ADMIN_KILL_SWITCHES;
/* Parameter objects: code defaults apply when {}. Edited as JSON, saved only
   when the text parses to a plain object (and the server agrees). */
const JSON_OBJECT_SETTINGS: readonly string[] = ADMIN_JSON_OBJECT_SETTINGS;
const NUMERIC_SETTINGS = Object.keys(ADMIN_NUMERIC_SETTINGS);

/** Explicit maps, so every key is a literal the i18n checks can see. */
const FILTER_LABEL: Record<AdminFilter, string> = {
  all: 'mm_a_kpi_all', delivering: 'mm_a_kpi_delivering', paused: 'mm_a_kpi_paused', review: 'mm_a_kpi_review',
  drafts: 'mm_a_kpi_drafts', rejected: 'mm_a_kpi_rejected', failed: 'mm_a_kpi_failed', attention: 'mm_a_kpi_attention',
  discrepancy: 'mm_a_kpi_discrepancy', stale: 'mm_a_kpi_stale',
};
const DISCREPANCY_TEXT: Record<Discrepancy, string> = {
  META_PAUSED_HOMATCH_ACTIVE: 'mm_a_disc_paused_vs_active', META_ACTIVE_HOMATCH_PAUSED: 'mm_a_disc_active_vs_paused',
  META_GONE: 'mm_a_disc_gone', META_PROBLEM: 'mm_a_disc_problem', NO_META_STATE: 'mm_a_disc_no_state',
};
const SETTING_ERROR: Record<string, string> = {
  REASON_REQUIRED: 'mm_a_err_reason', UNKNOWN_SETTING: 'mm_a_err_unknown', NOT_BOOLEAN: 'mm_a_err_type', NOT_NUMBER: 'mm_a_err_type',
  NOT_OBJECT: 'mm_a_json_object_required', BAD_GOAL: 'mm_a_err_value', BAD_COUNTRY: 'mm_a_err_value', BAD_BILLING: 'mm_a_err_value',
  BAD_VERSION: 'mm_a_err_value', BAD_CONFIG_ID: 'mm_a_err_value', EMPTY_LIST: 'mm_a_err_value', OUT_OF_RANGE: 'mm_a_err_range', NOT_INTEGER: 'mm_a_err_integer',
  TOO_PRECISE: 'mm_a_err_precision', TOO_LARGE: 'mm_a_err_value', MIN_ABOVE_MAX: 'mm_a_err_min_max', AUDIT_FAILED: 'mm_a_err_audit',
  FORBIDDEN: 'mm_a_err_forbidden', NOT_OPEN: 'mm_a_err_not_open',
};

/** The error code an admin action returned, from the body Supabase hands back. */
async function actionError(error: unknown): Promise<string> {
  try {
    const ctx = (error as { context?: Response })?.context;
    const body = ctx && typeof ctx.json === 'function' ? await ctx.clone().json() : null;
    return String(body?.code ?? body?.error ?? 'FAILED');
  } catch { return 'FAILED'; }
}

export default function AdminMetaAdsPage() {
  const { t } = useLanguage();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? params.get('tab') as Tab : 'overview';
  const view: AdminFilter = isAdminFilter(params.get('view')) ? params.get('view') as AdminFilter : 'all';
  /** Tab and campaign view live in the URL: a KPI opens a shareable, reloadable list. */
  const go = useCallback((next: Tab, nextView?: AdminFilter) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    if (next === 'campaigns' && nextView && nextView !== 'all') p.set('view', nextView); else p.delete('view');
    setParams(p, { replace: false });
  }, [params, setParams]);
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header>
        <h1 className="font-display text-2xl font-bold text-foreground">{t('admin_mads_title')}</h1>
        <p className="text-sm text-muted-foreground">{t('admin_mads_sub')}</p>
      </header>
      <FilterRail<Tab>
        options={[
          { value: 'overview', label: t('admin_mads_tab_overview') }, { value: 'campaigns', label: t('admin_mads_tab_campaigns') },
          { value: 'connections', label: t('admin_mads_tab_connections') }, { value: 'leads', label: t('admin_mads_tab_leads') },
          { value: 'audiences', label: t('admin_mads_tab_audiences') }, { value: 'moderation', label: t('admin_mads_tab_moderation') },
          { value: 'finance', label: t('admin_mads_tab_finance') }, { value: 'errors', label: t('admin_mads_tab_errors') },
          { value: 'guard', label: t('mm_a_tab_guard') }, { value: 'fees', label: t('mm_a_tab_fees') },
          { value: 'economics', label: t('mm_a_tab_economics') }, { value: 'api', label: t('mm_a_tab_api') },
          { value: 'settings', label: t('admin_mads_tab_settings') },
        ]}
        value={tab} onChange={(v) => go(v)} ariaLabel="Meta Ads admin" />
      {tab === 'overview' && <Overview go={go} />}
      {tab === 'campaigns' && <Campaigns view={view} setView={(v) => go('campaigns', v)} />}
      {tab === 'connections' && <Connections />}
      {tab === 'leads' && <Leads />}
      {tab === 'audiences' && <Audiences />}
      {tab === 'moderation' && <Moderation />}
      {tab === 'finance' && <Finance />}
      {tab === 'errors' && <MetaErrors />}
      {tab === 'guard' && <GuardPanel />}
      {tab === 'fees' && <FeePolicyPanel />}
      {tab === 'economics' && <EconomicsPanel />}
      {tab === 'api' && <ApiHealthPanel />}
      {tab === 'settings' && <Settings />}
    </div>
  );
}

function useRows<T>(loader: () => Promise<T[]>, deps: unknown[] = []) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useLanguage();
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await loader()); } catch (e) { console.error(e); toast.error(t('admin_mads_load_failed')); }
    finally { setLoading(false); }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return { rows, loading, reload: load };
}

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('rounded-2xl border border-border bg-card p-4 shadow-card', className)}>{children}</div>
);
/** A plain figure (the funnel). */
const Kpi = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-xl border border-[hsl(var(--gold-border))]/50 bg-[hsl(var(--gold-soft))]/40 px-3 py-2.5">
    <p className="text-2xs text-muted-foreground">{label}</p>
    <p className="font-display text-xl font-bold tabular-nums text-foreground" dir="ltr">{value}</p>
  </div>
);

type Tone = 'success' | 'warning' | 'destructive' | 'gold' | undefined;
const TONE_DOT: Record<Exclude<Tone, undefined>, string> = {
  success: 'bg-[hsl(var(--success))]', warning: 'bg-[hsl(var(--warning))]', destructive: 'bg-destructive', gold: 'bg-[hsl(var(--gold))]',
};

/** A KPI that opens the records it counts. Navy and gold: the HOMATCH admin tile. */
function AdminKpi({ id, label, value, tone, onOpen }: { id: string; label: string; value: string | number; tone?: Tone; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} data-mm-admin-kpi={id} data-mm-admin-kpi-value={String(value)}
      className={cn(
        'group min-w-0 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-start transition-colors',
        'hover:border-[hsl(var(--gold))]/60 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]',
      )}>
      <span className="flex items-center gap-1.5 text-2xs text-white/70">
        {tone && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[tone])} aria-hidden="true" />}
        <span className="min-w-0 break-words">{label}</span>
      </span>
      <span className="mt-0.5 block font-display text-xl font-bold tabular-nums text-white group-hover:text-[hsl(var(--gold))]" dir="ltr">{value}</span>
    </button>
  );
}

const CAMPAIGN_COLUMNS = 'id,user_id,name,goal,status,external_status,guard_state,last_error,launched_at,external_campaign_id,last_synced_at,daily_budget_cents,duration_days,special_ad_categories,property_id,created_at';
const asRow = (c: any): AdminCampaignRow & Record<string, any> => ({ ...c, last_error_key: c.last_error?.key ?? null });

/* ── OVERVIEW: real KPIs + integration truth ─────────────────────────── */
function Overview({ go }: { go: (tab: Tab, view?: AdminFilter) => void }) {
  const { t } = useLanguage();
  const [k, setK] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    (async () => {
      const count = async (table: string, filter?: (q: any) => any) => {
        let q = supabase.from(table).select('*', { count: 'exact', head: true });
        if (filter) q = filter(q);
        const { count: n } = await q;
        return n ?? 0;
      };
      const [{ data: campaigns }, leads, audiences, moderation, errors] = await Promise.all([
        supabase.from('meta_campaigns').select(CAMPAIGN_COLUMNS).limit(5000),
        count('meta_leads'),
        count('meta_audiences'),
        count('meta_moderation_cases', q => q.eq('status', 'OPEN')),
        count('meta_api_errors'),
      ]);
      // Campaign counts: the canonical rule over the rows themselves, never a raw status filter.
      const c = adminCounts((campaigns ?? []).map(asRow), Date.now());
      const { data: ledger } = await supabase.from('meta_ads_ledger').select('entry_type, amount_cents');
      let spend = 0, fees = 0, liability = 0;
      for (const r of ledger ?? []) {
        liability += r.amount_cents;
        if (r.entry_type === 'META_SPEND') spend -= r.amount_cents;
        if (r.entry_type === 'HOMATCH_FEE') fees -= r.amount_cents;
      }
      setK({ ...c, leads, audiences, moderation, errors, spend, fees, liability });
    })();
  }, []);

  return (
    <div className="space-y-4">
      {!k ? <Skeleton className="h-32 rounded-2xl" /> : (
        <section aria-label={t('mm_a_kpi_group')} className="rounded-2xl border border-[hsl(var(--gold-border))]/40 bg-[#0C1119] p-4 shadow-card">
          <h2 className="mb-3 text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--gold))]">{t('mm_a_kpi_group')}</h2>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            <AdminKpi id="all" label={t('mm_a_kpi_all')} value={k.all} onOpen={() => go('campaigns', 'all')} />
            <AdminKpi id="delivering" label={t('mm_a_kpi_delivering')} value={k.delivering} tone="success" onOpen={() => go('campaigns', 'delivering')} />
            <AdminKpi id="paused" label={t('mm_a_kpi_paused')} value={k.paused} tone="warning" onOpen={() => go('campaigns', 'paused')} />
            <AdminKpi id="review" label={t('mm_a_kpi_review')} value={k.review} tone="gold" onOpen={() => go('campaigns', 'review')} />
            <AdminKpi id="drafts" label={t('mm_a_kpi_drafts')} value={k.drafts} onOpen={() => go('campaigns', 'drafts')} />
            <AdminKpi id="attention" label={t('mm_a_kpi_attention')} value={k.attention} tone="warning" onOpen={() => go('campaigns', 'attention')} />
            <AdminKpi id="rejected" label={t('mm_a_kpi_rejected')} value={k.rejected} tone="destructive" onOpen={() => go('campaigns', 'rejected')} />
            <AdminKpi id="failed" label={t('mm_a_kpi_failed')} value={k.failed} tone="destructive" onOpen={() => go('campaigns', 'failed')} />
            <AdminKpi id="discrepancy" label={t('mm_a_kpi_discrepancy')} value={k.discrepancy} tone="warning" onOpen={() => go('campaigns', 'discrepancy')} />
            <AdminKpi id="stale" label={t('mm_a_kpi_stale')} value={k.stale} tone="warning" onOpen={() => go('campaigns', 'stale')} />
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            <AdminKpi id="leads" label={t('admin_mads_kpi_leads')} value={k.leads} onOpen={() => go('leads')} />
            <AdminKpi id="moderation" label={t('admin_mads_kpi_moderation')} value={k.moderation} tone={k.moderation ? 'warning' : undefined} onOpen={() => go('moderation')} />
            <AdminKpi id="errors" label={t('admin_mads_kpi_errors')} value={k.errors} onOpen={() => go('errors')} />
            <AdminKpi id="audiences" label={t('admin_mads_kpi_audiences')} value={k.audiences} onOpen={() => go('audiences')} />
            <AdminKpi id="spend" label={t('admin_mads_kpi_spend')} value={money(k.spend)} onOpen={() => go('finance')} />
            <AdminKpi id="fees" label={t('admin_mads_kpi_fees')} value={money(k.fees)} onOpen={() => go('finance')} />
            <AdminKpi id="liability" label={t('admin_mads_kpi_liability')} value={money(k.liability)} onOpen={() => go('finance')} />
          </div>
        </section>
      )}
      <Card><IntegrationProbe /></Card>
      <Funnel />
    </div>
  );
}

function Funnel() {
  const { t } = useLanguage();
  const { rows, loading } = useRows(async () => {
    const { data } = await supabase.from('meta_funnel_events').select('event');
    const agg = new Map<string, number>();
    for (const r of data ?? []) agg.set(r.event, (agg.get(r.event) ?? 0) + 1);
    return [...agg.entries()].map(([event, n]) => ({ event, n }));
  });
  if (loading) return <Skeleton className="h-20 rounded-2xl" />;
  return (
    <Card>
      <h2 className="mb-2 font-semibold text-foreground">{t('admin_mads_funnel')}</h2>
      <div className="flex flex-wrap gap-2">
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t('admin_mads_no_events')}</p>
          : rows.map(r => <Kpi key={r.event} label={r.event} value={r.n} />)}
      </div>
    </Card>
  );
}

/** When HOMATCH last read this campaign from Meta, and whether that is still current. */
function SyncLine({ c, now }: { c: AdminCampaignRow; now: number }) {
  const { t } = useLanguage();
  const f: Freshness = syncFreshness(c, now);
  const a = ago(c.last_synced_at, now);
  const when = a ? t(AGO[a.key] ?? 'mm_a_ago_min', { n: a.n }) : '';
  const text = f === 'FRESH' ? t('mm_a_sync_fresh', { ago: when }) : f === 'STALE' ? t('mm_a_sync_stale', { ago: when })
    : f === 'NEVER' ? t('mm_a_sync_never') : t('mm_a_sync_not');
  return (
    <span data-mm-sync={f} className={cn('text-[13px]', f === 'FRESH' ? 'text-muted-foreground' : f === 'NOT_SYNCED' ? 'text-muted-foreground/80' : 'font-semibold text-[hsl(var(--warning))]')}>
      {text}
    </span>
  );
}

/* ── CAMPAIGNS: canonical filters + the real topology ────────────────── */
function Campaigns({ view, setView }: { view: AdminFilter; setView: (v: AdminFilter) => void }) {
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { rows: all, loading, reload } = useRows(async () => {
    const { data } = await supabase.from('meta_campaigns').select('*').order('created_at', { ascending: false }).limit(500);
    setNow(Date.now());
    return (data ?? []).map(asRow);
  }, []);
  const counts = useMemo(() => adminCounts(all, now), [all, now]);
  const people = usePeople(all.map((c: any) => c.user_id));
  // The same rule the KPI counted with: the list a KPI opens is exactly its number.
  // Search: owner email / name / username / user id, campaign name / id, Meta campaign id, ad account.
  const rows = all.filter((c: any) => matchesAdminFilter(c, view, now) && campaignMatchesSearch(c, people[c.user_id], search));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder={t('mm_a_search_ph')} aria-label={t('mm_a_search_ph')} value={search} onChange={e => setSearch(e.target.value)} className="w-full max-w-md" data-mm-admin-search="" />
        <Button size="sm" variant="outline" onClick={reload} aria-label={t('mm_a_refresh')}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>
      <FilterRail<AdminFilter> options={ADMIN_FILTERS.map(f => ({ value: f, label: t(FILTER_LABEL[f]), count: counts[f] }))}
        value={view} onChange={setView} ariaLabel={t('mm_a_kpi_group')} />
      {loading ? <Skeleton className="h-40 rounded-2xl" /> : rows.length === 0 ? (
        <Card className="text-sm text-muted-foreground" >
          <p data-mm-admin-empty={view}>{t('mm_a_filtered_empty')}</p>
          {view !== 'all' && <Button size="sm" variant="outline" className="mt-2" onClick={() => setView('all')}>{t('mm_a_show_all')}</Button>}
        </Card>
      ) : rows.map((c: any) => {
        const d = discrepancy(c);
        const paused = matchesAdminFilter(c, 'paused', now);
        return (
          <Card key={c.id} className={cn(paused && 'border-s-4 border-s-[hsl(var(--warning))]')}>
            <button type="button" data-mm-admin-campaign={c.id} aria-expanded={open === c.id}
              className="flex w-full flex-col gap-1.5 text-start" onClick={() => setOpen(open === c.id ? null : c.id)}>
              <span className="flex w-full flex-wrap items-center gap-2">
                <b className="min-w-0 flex-1 truncate">{c.name || c.goal}</b>
                <CampaignStatusChip campaign={c} />
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                <span data-mm-lifecycle={c.status}><span className="text-muted-foreground">{t('mm_a_col_homatch')}: </span><b className="font-mono" dir="ltr">{c.status}</b></span>
                <span data-mm-meta-status={c.external_status ?? ''}><span className="text-muted-foreground">{t('mm_a_col_meta')}: </span>
                  <b className="font-mono" dir="ltr">{c.external_status || t('mm_a_meta_none')}</b></span>
                <SyncLine c={c} now={now} />
                {c.daily_budget_cents ? <span className="tabular-nums text-muted-foreground" dir="ltr">{`${money(c.daily_budget_cents)}/d ×${c.duration_days}`}</span> : null}
              </span>
              {d && (
                <span data-mm-discrepancy={d} className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--warning))]/40 bg-[hsl(var(--warning))]/10 px-2 py-1 text-[13px] font-semibold text-[hsl(var(--warning))]">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {t(DISCREPANCY_TEXT[d], { meta: String(c.external_status ?? '') })}
                </span>
              )}
            </button>
            {/* Who and where: outside the toggle, so its copyable ids are real buttons of their own. */}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-[13px]" data-mm-admin-identity={c.id}>
              <span className="min-w-0"><span className="text-muted-foreground">{t('mm_a_owner')}: </span><Owner id={c.user_id} person={people[c.user_id]} /></span>
              <span><span className="text-muted-foreground">{t('mm_a_campaign_id')}: </span><IdChip id={c.id} /></span>
              {c.external_campaign_id && <span><span className="text-muted-foreground">{t('mm_a_meta_campaign_id')}: </span><IdChip id={String(c.external_campaign_id)} label={String(c.external_campaign_id)} /></span>}
              {c.ad_account_external_id && <span><span className="text-muted-foreground">{t('mm_a_account')}: </span><IdChip id={String(c.ad_account_external_id)} label={String(c.ad_account_external_id)} /></span>}
              <span data-mm-admin-connection={people[c.user_id]?.connection?.status ?? 'NONE'}><span className="text-muted-foreground">{t('mm_a_connection')}: </span>
                <b className="font-mono" dir="ltr">{people[c.user_id]?.connection?.status ?? '—'}</b></span>
            </div>
            {open === c.id && <CampaignDrill c={c} onSynced={reload} />}
          </Card>
        );
      })}
    </div>
  );
}

function CampaignDrill({ c, onSynced }: { c: any; onSynced: () => void }) {
  const { t } = useLanguage();
  const { rows } = useRows(async () => {
    const { data } = await supabase.from('meta_ad_entities').select('*').eq('campaign_id', c.id).order('kind');
    return data ?? [];
  }, [c.id]);
  const { rows: decisions } = useRows(async () => {
    const { data } = await supabase.from('meta_optimization_decisions').select('*').eq('campaign_id', c.id);
    return data ?? [];
  }, [c.id]);
  const { rows: ledger } = useRows(async () => {
    const { data } = await supabase.from('meta_ads_ledger').select('entry_type,amount_cents,created_at').eq('campaign_id', c.id).order('created_at');
    return data ?? [];
  }, [c.id]);
  const { rows: leadCount } = useRows(async () => {
    const { count } = await supabase.from('meta_leads').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id);
    return [{ n: count ?? 0 }];
  }, [c.id]);
  const [syncing, setSyncing] = useState(false);
  const adminSync = async () => {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke('meta-ads-api', { body: { action: 'admin_sync', campaignId: c.id } });
      if (error) throw error;
      toast.success(t('admin_mads_synced'));
      onSynced();
    } catch { toast.error(t('admin_mads_sync_failed')); } finally { setSyncing(false); }
  };
  const sum = (type: string) => ledger.filter((l: any) => l.entry_type === type).reduce((n: number, l: any) => n + Number(l.amount_cents), 0);
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3 text-[13px]">
      <p><b>{t('admin_mads_user')}</b> <Owner id={c.user_id} /> · <b>{t('admin_mads_property')}</b> {c.property_id ?? '—'} · <b>{t('admin_mads_objective')}</b> {c.objective ?? '—'} · <b>{t('admin_mads_plan')}</b> {c.plan_version ?? '—'} · <b>{t('admin_mads_external')}</b> {c.external_campaign_id ?? '—'} · <b>{t('admin_mads_launch_key')}</b> {c.launch_idempotency_key ?? '—'}</p>
      <p><b>{t('admin_mads_preflight')}</b> {c.preflight?.status ?? '—'} {c.preflight?.checks?.map((ch: any) => `${ch.state === 'WARNING' ? '!' : ch.ok ? '✓' : '✗'}${ch.key}${ch.detail && !ch.ok ? `(${ch.detail})` : ''}`).join(' ')}</p>
      <p><b>{t('admin_mads_placements')}</b> {JSON.stringify(c.placements)} · <b>{t('admin_mads_destination')}</b> {JSON.stringify(c.destination)} · <b>{t('admin_mads_spend')}</b> {money(c.spend_cents)} · <b>{t('admin_mads_error')}</b> {c.last_error?.key ?? '—'}{c.last_error?.code ? ` (${c.last_error.code})` : ''}{c.last_error?.detail ? ` — ${c.last_error.detail}` : ''}</p>
      <p><b>{t('admin_mads_timeline')}</b> {t('admin_mads_created')} {new Date(c.created_at).toLocaleString()} · {t('admin_mads_launched')} {c.launched_at ? new Date(c.launched_at).toLocaleString() : '—'} · {t('admin_mads_synced_at')} {c.last_synced_at ? new Date(c.last_synced_at).toLocaleString() : '—'} · {t('admin_mads_settled')} {c.settled_at ? new Date(c.settled_at).toLocaleString() : '—'}</p>
      <p><b>{t('admin_mads_money')}</b> {t('admin_mads_reserved')} {money(-sum('RESERVE'))} · {t('admin_mads_fee')} {money(-sum('HOMATCH_FEE'))} · {t('admin_mads_released')} {money(sum('RELEASE'))} · {t('admin_mads_meta_spend')} {money(-sum('META_SPEND'))} · {t('mm_a_released')} {money(sum('FEE_RELEASE') + sum('REFUND'))} · {t('admin_mads_leads')} {leadCount[0]?.n ?? 0}</p>
      {c.last_error?.review && <p className="break-words"><b>{t('admin_mads_review_feedback')}</b> {JSON.stringify(c.last_error.review)}</p>}
      {c.external_campaign_id && (
        <Button size="sm" variant="outline" onClick={adminSync} disabled={syncing} className="gap-1.5">
          <RefreshCw className={syncing ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />{t('admin_mads_sync_now')}
        </Button>
      )}
      <div>
        <b>{t('admin_mads_topology')}</b>
        {rows.length === 0 ? <span className="text-muted-foreground"> — {t('admin_mads_not_published')}</span> : (
          <ul className="mt-1 space-y-0.5">
            {rows.map((e: any) => (
              <li key={e.id} className="font-mono text-[13px]">{e.kind} · {e.external_id} · {e.status ?? '—'} · {e.name ?? ''}</li>
            ))}
          </ul>
        )}
      </div>
      {decisions.length > 0 && (
        <div><b>{t('admin_mads_autopilot')}</b>
          <ul className="mt-1 space-y-0.5">{decisions.map((d: any) => (
            <li key={d.id}>{d.decision} → {d.target_entity} · {t('admin_mads_executed')}:{String(d.executed)} · {d.internal_reason}</li>
          ))}</ul>
        </div>
      )}
    </div>
  );
}

/* ── CONNECTIONS ─────────────────────────────────────────────────────── */
function Connections() {
  const { t } = useLanguage();
  const { rows, loading } = useRows(async () => {
    // Explicit columns: the single-use OAuth nonce is never pulled into Admin.
    const { data: conns } = await supabase.from('meta_connections')
      .select('id,user_id,status,granted_scopes,declined_scopes,token_expires_at,last_checked_at,last_error,updated_at')
      .order('updated_at', { ascending: false }).limit(200);
    const { data: assets } = await supabase.from('meta_assets').select('user_id,kind,name,external_id,selected');
    return (conns ?? []).map((c: any) => ({
      ...c,
      assets: (assets ?? []).filter((a: any) => a.user_id === c.user_id),
    }));
  });
  if (loading) return <Skeleton className="h-40 rounded-2xl" />;
  return (
    <div className="space-y-2">
      {rows.map((c: any) => (
        <Card key={c.id}>
          <p className="text-sm"><Owner id={c.user_id} /></p>
          {/* Admin sees the technical reason Leads on Facebook/Instagram is unavailable for this connection. */}
          {c.status === 'CONNECTED' && missingInstantFormScopes(c.granted_scopes, INSTANT_FORM_PERMISSIONS).length > 0 && (
            <p className="mt-1 text-[13px] text-[hsl(var(--warning))]" data-mm-admin-forms-missing={c.user_id}>
              {t('mm_a_forms_missing')}: <span className="font-mono" dir="ltr">{missingInstantFormScopes(c.granted_scopes, INSTANT_FORM_PERMISSIONS).join(', ')}</span>
              {/* The diagnosis: declined by the customer, or never asked for by the Login for Business configuration. */}
              <span className="mt-0.5 block text-2xs text-muted-foreground" data-mm-admin-forms-cause={formsCause(c)}>{t(`mm_m_admin_forms_${formsCause(c)}`)}</span>
            </p>
          )}
          <p className="mt-1 text-sm">{c.status} · {t('admin_mads_scopes')}: {c.granted_scopes?.join(', ') || '—'}
            {c.token_expires_at ? ` · token exp ${new Date(c.token_expires_at).toLocaleDateString()}` : ''}
            {c.declined_scopes?.length ? ` · ${t('admin_mads_declined')}: ${c.declined_scopes.join(', ')}` : ''}
            {c.last_error ? ` · err ${c.last_error}` : ''}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {c.assets.map((a: any) => `${a.selected ? '★' : ''}${a.kind}:${a.name ?? a.external_id}`).join(' · ') || t('admin_mads_no_assets')}
          </p>
        </Card>
      ))}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('admin_mads_no_connections')}</p>}
    </div>
  );
}

/* ── LEADS / AUDIENCES ───────────────────────────────────────────────── */
function Leads() {
  const { t } = useLanguage();
  const [source, setSource] = useState('ALL');
  const { rows, loading } = useRows(async () => {
    let q = supabase.from('meta_leads').select('id,user_id,campaign_id,source,status,received_at,external_lead_id')
      .order('received_at', { ascending: false }).limit(300);
    if (source !== 'ALL') q = q.eq('source', source);
    const { data } = await q; return data ?? [];
  }, [source]);
  return (
    <div className="space-y-3">
      <FilterRail options={['ALL', 'META_LEADGEN', 'IMPORT'].map(s => ({ value: s, label: s }))}
        value={source} onChange={setSource} ariaLabel="source" />
      {loading ? <Skeleton className="h-40 rounded-2xl" /> : (
        <Card>
          <table className="w-full text-start text-[13px]">
            <thead><tr className="text-muted-foreground"><th className="text-start">{t('admin_mads_received')}</th><th className="text-start">{t('admin_mads_user')}</th><th className="text-start">{t('admin_mads_source')}</th><th className="text-start">{t('admin_mads_status')}</th><th className="text-start">{t('admin_mads_campaign')}</th></tr></thead>
            <tbody>
              {rows.map((l: any) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="py-1.5">{new Date(l.received_at).toLocaleString()}</td>
                  <td className="py-1.5 pe-2"><Owner id={l.user_id} /></td>
                  <td>{l.source}</td><td>{l.status}</td>
                  <td className="font-mono">{l.campaign_id ? String(l.campaign_id).slice(0, 8) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('admin_mads_no_leads')}</p>}
        </Card>
      )}
    </div>
  );
}

function Audiences() {
  const { t } = useLanguage();
  const { rows, loading } = useRows(async () => {
    const { data } = await supabase.from('meta_audiences').select('*').order('created_at', { ascending: false }).limit(200);
    return data ?? [];
  });
  if (loading) return <Skeleton className="h-40 rounded-2xl" />;
  return (
    <div className="space-y-2">
      {rows.map((a: any) => (
        <Card key={a.id}>
          <p className="text-sm"><b>{a.name}</b> · {a.source} · {a.sync_status} · {t('admin_mads_records')}:{a.known_record_count ?? '—'}
            · {t('admin_mads_ext')}:{a.external_audience_id ?? '—'} · {t('admin_mads_acct')}:{a.ad_account_external_id ?? '—'} · v{a.version}
            {a.last_error ? ` · err ${a.last_error}` : ''}</p>
        </Card>
      ))}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('admin_mads_no_audiences')}</p>}
    </div>
  );
}

/* ── MODERATION ──────────────────────────────────────────────────────── */
function Moderation() {
  const { t } = useLanguage();
  const { rows, loading, reload } = useRows(async () => {
    const { data } = await supabase.from('meta_moderation_cases').select('*').order('created_at', { ascending: false }).limit(100);
    return data ?? [];
  });
  if (loading) return <Skeleton className="h-40 rounded-2xl" />;
  return (
    <div className="space-y-2">
      {rows.map((m: any) => (
        <Card key={m.id}>
          <p className="text-sm"><b>{m.reason}</b> · {m.severity} · {m.status} · {t('admin_mads_user')} <Owner id={m.user_id} /> · {new Date(m.created_at).toLocaleString()}</p>
          {/* Real-estate scope evidence (domainScope.ts): classification, reason, source, when. */}
          {m.reason === 'DOMAIN_SCOPE' && m.findings && (
            <p className="text-[13px] font-medium" data-mm-admin-domain={m.findings.domain}>
              {t('mm_m_admin_domain')}: {m.findings.domain} · {m.findings.domain_reason} · {m.findings.source}
              {m.findings.checked_at ? ` · ${new Date(m.findings.checked_at).toLocaleString()}` : ''}
              {m.decided_by ? ` · ${m.status}` : ''}
            </p>
          )}
          <p className="text-[13px] text-muted-foreground">{JSON.stringify(m.findings)}</p>
          {m.status === 'OPEN' && <ModerationDecision caseId={m.id} onDone={reload} />}
          {m.decision_note && <p className="mt-1 text-[13px]">{t('admin_mads_note')}: {m.decision_note}</p>}
        </Card>
      ))}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('admin_mads_queue_empty')}</p>}
    </div>
  );
}

/** A decision is a server act: OPEN cases only, a note on record, audited. */
function ModerationDecision({ caseId, onDone }: { caseId: string; onDone: () => void }) {
  const { t } = useLanguage();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const id = `mm-mod-${caseId}`;
  const decide = async (decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED') => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('meta-ads-api', { body: { action: 'admin_moderation_decide', caseId, decision, note } });
      if (error) { toast.error(t(SETTING_ERROR[await actionError(error)] ?? 'admin_mads_action_failed')); return; }
      toast.success(data?.next === 'RUN_PREFLIGHT' ? t('mm_a_mod_next_preflight') : data?.next === 'OTHER_REVIEWS_OPEN' ? t('mm_a_mod_next_other')
        : data?.campaignStatus ? t('mm_a_mod_campaign_moved', { status: data.campaignStatus }) : t('mm_a_saved'));
      onDone();
    } finally { setBusy(false); }
  };
  const ok = note.trim().length >= MIN_REASON && !busy;
  return (
    <div className="mt-2 space-y-2">
      <label htmlFor={id} className="block text-2xs font-semibold text-muted-foreground">{t('mm_a_mod_note_label')}</label>
      <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('mm_a_reason_ph')} className="max-w-xl" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!ok} onClick={() => decide('APPROVED')}>{t('admin_mads_approve')}</Button>
        <Button size="sm" variant="outline" disabled={!ok} onClick={() => decide('CHANGES_REQUESTED')}>{t('admin_mads_request_changes')}</Button>
        <Button size="sm" variant="destructive" disabled={!ok} onClick={() => decide('REJECTED')}>{t('admin_mads_reject')}</Button>
      </div>
    </div>
  );
}

/* ── FINANCE ─────────────────────────────────────────────────────────── */
function Finance() {
  const { t } = useLanguage();
  const [userFilter, setUserFilter] = useState('');
  const { rows, loading } = useRows(async () => {
    let q = supabase.from('meta_ads_ledger').select('*').order('created_at', { ascending: false }).limit(300);
    const f = userFilter.trim();
    if (f) {
      // A user id directly; anything else (email, name, username) through the admin user search.
      const ids = /^[0-9a-f-]{36}$/i.test(f) ? [f] : (await searchUsers(f, 25).catch(() => [])).map((u) => u.id);
      if (!ids.length) return [];
      q = q.in('user_id', ids);
    }
    const { data } = await q; return data ?? [];
  }, [userFilter]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input placeholder={t('mm_a_fin_filter_ph')} aria-label={t('mm_a_fin_filter_ph')} value={userFilter} onChange={e => setUserFilter(e.target.value)} className="w-full max-w-md" />
        {/* Adjustments live with the customer (Fees & finance): direction, reason and balance before/after, audited. */}
        <p className="self-center text-2xs text-muted-foreground">{t('mm_a_fin_adjust_where')}</p>
      </div>
      {loading ? <Skeleton className="h-40 rounded-2xl" /> : (
        <Card>
          <table className="w-full text-[13px]">
            <thead><tr className="text-muted-foreground"><th className="text-start">{t('admin_mads_at')}</th><th className="text-start">{t('admin_mads_user')}</th><th className="text-start">{t('admin_mads_type')}</th><th className="text-end">{t('admin_mads_amount')}</th><th className="text-start">{t('admin_mads_campaign')}</th><th className="text-start">{t('admin_mads_key')}</th></tr></thead>
            <tbody>
              {rows.map((e: any) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="py-1.5">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="py-1.5 pe-2"><Owner id={e.user_id} /></td>
                  <td>{e.entry_type}</td>
                  <td className={cn('text-end tabular-nums', e.amount_cents < 0 ? 'text-destructive' : 'text-[hsl(var(--success))]')} dir="ltr">{money(e.amount_cents)}</td>
                  <td className="font-mono">{e.campaign_id ? String(e.campaign_id).slice(0, 8) : '—'}</td>
                  <td className="max-w-[10rem] truncate font-mono">{e.idempotency_key ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('admin_mads_ledger_empty')}</p>}
        </Card>
      )}
    </div>
  );
}

/* ── ERRORS ──────────────────────────────────────────────────────────── */
function MetaErrors() {
  const { t } = useLanguage();
  const { rows, loading } = useRows(async () => {
    const { data } = await supabase.from('meta_api_errors').select('*').order('created_at', { ascending: false }).limit(200);
    return data ?? [];
  });
  if (loading) return <Skeleton className="h-40 rounded-2xl" />;
  return (
    <div className="space-y-2">
      {rows.map((e: any) => (
        <Card key={e.id}>
          <p className="text-sm"><b>{e.endpoint}</b> · {t('admin_mads_code')} {e.code}{e.subcode ? `/${e.subcode}` : ''} · {e.customer_message_key} · {new Date(e.created_at).toLocaleString()}</p>
          <p className="truncate text-[13px] text-muted-foreground">{e.message}</p>
          {e.user_id && <p className="mt-1 text-[13px]"><Owner id={e.user_id} /></p>}
        </Card>
      ))}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('admin_mads_no_errors')}</p>}
    </div>
  );
}

/* ── SETTINGS: fee, limits, goals, kill switches ─────────────────────── */
function Settings() {
  const { t } = useLanguage();
  const { rows, loading, reload } = useRows(async () => {
    const { data } = await supabase.from('admin_settings').select('key,value').like('key', 'meta_ads_%').not('key', 'ilike', '%token%').order('key');
    // Worker/cron tokens are credentials, not settings: never rendered here.
    return (data ?? []).filter((s: any) => !isCredentialKey(String(s.key)));
  });
  const current = useMemo(() => Object.fromEntries(rows.map((s: any) => [s.key, s.value])), [rows]);
  if (loading) return <Skeleton className="h-40 rounded-2xl" />;
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-muted-foreground">{t('mm_a_settings_lead')}</p>
      {rows.map((s: any) => <SettingRow key={s.key} settingKey={s.key} value={s.value} current={current} onSaved={reload} />)}
    </div>
  );
}

/**
 * One setting. A change is staged first, checked with the same rules the
 * server applies, and only saved with a reason — through admin_setting_set,
 * which validates again, writes the value and the audit row together.
 */
function SettingRow({ settingKey, value, current, onSaved }: {
  settingKey: string; value: unknown; current: Record<string, unknown>; onSaved: () => void;
}) {
  const { t } = useLanguage();
  const isSwitch = KILL_SWITCHES.includes(settingKey);
  const isObject = JSON_OBJECT_SETTINGS.includes(settingKey);
  const isNumber = NUMERIC_SETTINGS.includes(settingKey);
  const initialText = isObject ? JSON.stringify(value ?? {}, null, 2) : isNumber ? String(value) : JSON.stringify(value);
  const [text, setText] = useState(initialText);
  const [flip, setFlip] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(initialText); setFlip(false); setReason(''); setProblem(null); }, [initialText]);

  const parse = (): { ok: true; v: unknown } | { ok: false } => {
    if (isSwitch) return { ok: true, v: flip ? value !== true : value === true };
    if (isNumber) { const n = Number(text); return text.trim() !== '' && Number.isFinite(n) ? { ok: true, v: n } : { ok: false }; }
    try { return { ok: true, v: JSON.parse(text) }; } catch { return { ok: false }; }
  };
  const staged = isSwitch ? flip : text !== initialText;
  const cancel = () => { setText(initialText); setFlip(false); setReason(''); setProblem(null); };
  const save = async () => {
    const p = parse();
    if (!p.ok) { setProblem(t('admin_mads_invalid_json')); return; }
    const check = validateSetting(settingKey, p.v, current);
    if (!check.ok) { setProblem(t(SETTING_ERROR[check.error] ?? 'mm_a_err_value')); return; }
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke('meta-ads-api', { body: { action: 'admin_setting_set', key: settingKey, value: check.value, reason } });
      if (error) { setProblem(t(SETTING_ERROR[await actionError(error)] ?? 'admin_mads_action_failed')); return; }
      toast.success(t('mm_a_saved'));
      onSaved();
    } finally { setBusy(false); }
  };
  const id = `mm-setting-${settingKey}`;
  const on = isSwitch && (flip ? value !== true : value === true);
  return (
    <Card>
      <div className="flex flex-wrap items-start gap-3" data-mm-setting={settingKey}>
        <div className="min-w-0 flex-1">
          <p className="break-all font-mono text-sm font-semibold" dir="ltr">{settingKey}</p>
        </div>
        {isSwitch ? (
          <Button size="sm" variant={on ? 'default' : 'outline'} aria-pressed={on} data-mm-switch={on ? 'on' : 'off'}
            onClick={() => { setFlip(!flip); setProblem(null); }}>
            {on ? t('admin_mads_enabled') : t('admin_mads_disabled')}
          </Button>
        ) : isObject ? (
          <Textarea id={id} aria-label={settingKey} dir="ltr" rows={5} className="w-full min-w-0 font-mono text-2xs sm:w-96" value={text}
            onChange={e => { setText(e.target.value); setProblem(null); }} aria-invalid={problem !== null} />
        ) : (
          <Input id={id} className="w-full max-w-72 font-mono sm:w-72" dir="ltr" aria-label={settingKey} value={text}
            inputMode={isNumber ? 'decimal' : undefined}
            onChange={e => { setText(e.target.value); setProblem(null); }} aria-invalid={problem !== null} />
        )}
      </div>
      {isObject && !staged && <p className="mt-1 text-2xs text-muted-foreground">{t('mm_a_json_hint')}</p>}
      {staged && (
        <div className="mt-3 space-y-2 border-t border-border pt-3" data-mm-setting-staged={settingKey}>
          <label htmlFor={`${id}-reason`} className="block text-2xs font-semibold text-muted-foreground">{t('mm_a_reason_label')}</label>
          <Input id={`${id}-reason`} value={reason} onChange={e => setReason(e.target.value)} placeholder={t('mm_a_reason_ph')} className="max-w-xl" />
          {problem && <p className="text-2xs text-destructive" role="alert">{problem}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={save} disabled={busy || reason.trim().length < MIN_REASON}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t('mm_a_save')}
            </Button>
            <Button size="sm" variant="outline" onClick={cancel} disabled={busy}>{t('mm_a_cancel')}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

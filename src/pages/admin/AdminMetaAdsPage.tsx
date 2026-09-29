// ADMIN — META ADS CONTROL CENTER. The deep end: integration truth,
// campaigns with their REAL external topology, connections, leads,
// audiences, moderation, money, errors, funnel and every kill switch.
// Reads ride the is_admin RLS policies; the only writes are moderation
// decisions, settings values and audited manual ledger adjustments.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { FilterRail } from '@/components/customer/surface';
import { RefreshCw, Loader2, ShieldAlert, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { money } from '@/services/metaAds';

type Tab = 'overview' | 'campaigns' | 'connections' | 'leads' | 'audiences'
  | 'moderation' | 'finance' | 'errors' | 'settings';

const KILL_SWITCHES = [
  'meta_ads_enabled', 'meta_ads_publishing_enabled', 'meta_ads_lead_sync_enabled',
  'meta_ads_lead_import_enabled', 'meta_ads_audience_creation_enabled',
  'meta_ads_retargeting_enabled', 'meta_ads_lookalike_enabled',
  'meta_ads_autopilot_enabled', 'meta_ads_ai_assist_enabled',
];
const NUMERIC_SETTINGS = [
  'meta_ads_fee_percent', 'meta_ads_min_duration_days',
  'meta_ads_daily_budget_min_cents', 'meta_ads_daily_budget_max_cents',
];

export default function AdminMetaAdsPage() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>('overview');
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
          { value: 'settings', label: t('admin_mads_tab_settings') },
        ]}
        value={tab} onChange={setTab} ariaLabel="Meta Ads admin" />
      {tab === 'overview' && <Overview />}
      {tab === 'campaigns' && <Campaigns />}
      {tab === 'connections' && <Connections />}
      {tab === 'leads' && <Leads />}
      {tab === 'audiences' && <Audiences />}
      {tab === 'moderation' && <Moderation />}
      {tab === 'finance' && <Finance />}
      {tab === 'errors' && <MetaErrors />}
      {tab === 'settings' && <Settings />}
    </div>
  );
}

function useRows<T>(loader: () => Promise<T[]>, deps: unknown[] = []) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await loader()); } catch (e) { console.error(e); toast.error('load failed'); }
    finally { setLoading(false); }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return { rows, loading, reload: load };
}

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('rounded-2xl border border-border bg-card p-4 shadow-card', className)}>{children}</div>
);
const Kpi = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-xl border border-border bg-[hsl(var(--secondary))] px-3 py-2.5">
    <p className="text-2xs text-muted-foreground">{label}</p>
    <p className="font-display text-xl font-bold tabular-nums" dir="ltr">{value}</p>
  </div>
);

/* ── OVERVIEW: real KPIs + integration truth ─────────────────────────── */
function Overview() {
  const { t } = useLanguage();
  const [k, setK] = useState<Record<string, number> | null>(null);
  const [probe, setProbe] = useState<any>(null);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    (async () => {
      const count = async (table: string, filter?: (q: any) => any) => {
        let q = supabase.from(table).select('*', { count: 'exact', head: true });
        if (filter) q = filter(q);
        const { count: n } = await q;
        return n ?? 0;
      };
      const [active, drafts, review, rejected, failed, leads, audiences, moderation, errors] = await Promise.all([
        count('meta_campaigns', q => q.eq('status', 'ACTIVE')),
        count('meta_campaigns', q => q.eq('status', 'DRAFT')),
        count('meta_campaigns', q => q.in('status', ['META_REVIEW', 'SUBMITTED', 'MANUAL_REVIEW'])),
        count('meta_campaigns', q => q.eq('status', 'REJECTED')),
        count('meta_campaigns', q => q.eq('status', 'FAILED')),
        count('meta_leads'),
        count('meta_audiences'),
        count('meta_moderation_cases', q => q.eq('status', 'OPEN')),
        count('meta_api_errors'),
      ]);
      const { data: ledger } = await supabase.from('meta_ads_ledger').select('entry_type, amount_cents');
      let spend = 0, fees = 0, liability = 0;
      for (const r of ledger ?? []) {
        liability += r.amount_cents;
        if (r.entry_type === 'META_SPEND') spend -= r.amount_cents;
        if (r.entry_type === 'HOMATCH_FEE') fees -= r.amount_cents;
      }
      setK({ active, drafts, review, rejected, failed, leads, audiences, moderation, errors, spend, fees, liability });
    })();
  }, []);

  const testConnection = async () => {
    setProbing(true);
    try {
      const { data } = await supabase.functions.invoke('meta-ads-api', { body: { action: 'admin_test_connection' } });
      setProbe(data);
    } catch { toast.error('probe failed'); }
    finally { setProbing(false); }
  };

  return (
    <div className="space-y-4">
      {!k ? <Skeleton className="h-32 rounded-2xl" /> : (
        <Card>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            <Kpi label={t('admin_mads_kpi_active')} value={k.active} />
            <Kpi label={t('admin_mads_kpi_drafts')} value={k.drafts} />
            <Kpi label={t('admin_mads_kpi_review')} value={k.review} />
            <Kpi label={t('admin_mads_kpi_rejected')} value={k.rejected} />
            <Kpi label={t('admin_mads_kpi_failed')} value={k.failed} />
            <Kpi label={t('admin_mads_kpi_leads')} value={k.leads} />
            <Kpi label={t('admin_mads_kpi_audiences')} value={k.audiences} />
            <Kpi label={t('admin_mads_kpi_moderation')} value={k.moderation} />
            <Kpi label={t('admin_mads_kpi_errors')} value={k.errors} />
            <Kpi label={t('admin_mads_kpi_spend')} value={money(k.spend)} />
            <Kpi label={t('admin_mads_kpi_fees')} value={money(k.fees)} />
            <Kpi label={t('admin_mads_kpi_liability')} value={money(k.liability)} />
          </div>
        </Card>
      )}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-foreground">{t('admin_mads_integration')}</h2>
          <Button size="sm" variant="outline" onClick={testConnection} disabled={probing} className="gap-1.5">
            {probing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {t('admin_mads_test_conn')}
          </Button>
        </div>
        {probe && (
          <div className="mt-3 space-y-2 text-sm">
            <p>{t('admin_mads_mode')}: <b className={probe.mode === 'REAL' ? 'text-[hsl(152_54%_26%)]' : 'text-[hsl(var(--gold-ink))]'}>{probe.mode}</b>
              {' · '}{t('admin_mads_secrets')}: {String(probe.secretsConfigured)} · {t('admin_mads_webhook_token')}: {String(probe.webhookVerifyTokenConfigured)}</p>
            <div className="space-y-1">
              {(probe.capabilities ?? []).map((c: any) => (
                <div key={c.key} className="flex items-start gap-2 text-[13px]">
                  {c.status === 'VERIFIED_SUPPORTED' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(152_54%_30%)]" />
                    : c.status === 'UNSUPPORTED' ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                      : <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--gold-ink))]" />}
                  <span><b>{c.key}</b> — {c.status}{c.requirement ? `: ${c.requirement}` : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
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

/* ── CAMPAIGNS: filters + the real topology ──────────────────────────── */
function Campaigns() {
  const { t } = useLanguage();
  const [status, setStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { rows, loading, reload } = useRows(async () => {
    let q = supabase.from('meta_campaigns').select('*').order('created_at', { ascending: false }).limit(200);
    if (status !== 'ALL') q = q.eq('status', status);
    const { data } = await q;
    return (data ?? []).filter((c: any) =>
      !search || `${c.name} ${c.user_id} ${c.property_id ?? ''} ${c.external_campaign_id ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  }, [status, search]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder={t('admin_mads_search_ph')} value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
        <FilterRail options={['ALL', 'DRAFT', 'READY', 'META_REVIEW', 'ACTIVE', 'PAUSED', 'REJECTED', 'FAILED', 'COMPLETED'].map(s => ({ value: s, label: s }))}
          value={status} onChange={setStatus} ariaLabel="status" />
        <Button size="sm" variant="outline" onClick={reload}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>
      {loading ? <Skeleton className="h-40 rounded-2xl" /> : rows.map((c: any) => (
        <Card key={c.id}>
          <button type="button" className="flex w-full flex-wrap items-center gap-2 text-start" onClick={() => setOpen(open === c.id ? null : c.id)}>
            <b className="min-w-0 flex-1 truncate">{c.name || c.goal}</b>
            <span className="text-[13px] text-muted-foreground">{c.status} / {c.external_status ?? '—'}</span>
            <span className="text-[13px] tabular-nums" dir="ltr">{c.daily_budget_cents ? `${money(c.daily_budget_cents)}/d ×${c.duration_days}` : ''}</span>
            <span className="text-[13px] text-muted-foreground">{c.special_ad_categories?.join(',') || 'no-cat'}</span>
          </button>
          {open === c.id && <CampaignDrill c={c} />}
        </Card>
      ))}
    </div>
  );
}

function CampaignDrill({ c }: { c: any }) {
  const { t } = useLanguage();
  const { rows } = useRows(async () => {
    const { data } = await supabase.from('meta_ad_entities').select('*').eq('campaign_id', c.id).order('kind');
    return data ?? [];
  }, [c.id]);
  const { rows: decisions } = useRows(async () => {
    const { data } = await supabase.from('meta_optimization_decisions').select('*').eq('campaign_id', c.id);
    return data ?? [];
  }, [c.id]);
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3 text-[13px]">
      <p><b>{t('admin_mads_user')}</b> {c.user_id} · <b>{t('admin_mads_property')}</b> {c.property_id ?? '—'} · <b>{t('admin_mads_objective')}</b> {c.objective ?? '—'} · <b>{t('admin_mads_plan')}</b> {c.plan_version ?? '—'} · <b>{t('admin_mads_external')}</b> {c.external_campaign_id ?? '—'} · <b>{t('admin_mads_launch_key')}</b> {c.launch_idempotency_key ?? '—'}</p>
      <p><b>{t('admin_mads_preflight')}</b> {c.preflight?.status ?? '—'} {c.preflight?.checks?.map((ch: any) => `${ch.ok ? '✓' : '✗'}${ch.key}`).join(' ')}</p>
      <p><b>{t('admin_mads_placements')}</b> {JSON.stringify(c.placements)} · <b>{t('admin_mads_spend')}</b> {money(c.spend_cents)} · <b>{t('admin_mads_error')}</b> {c.last_error?.key ?? '—'}</p>
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
    const { data: conns } = await supabase.from('meta_connections').select('*').order('updated_at', { ascending: false }).limit(200);
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
          <p className="text-sm"><b>{c.user_id}</b> · {c.status} · {t('admin_mads_scopes')}: {c.granted_scopes?.join(', ') || '—'}
            {c.token_expires_at ? ` · token exp ${new Date(c.token_expires_at).toLocaleDateString()}` : ''}
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
                  <td className="font-mono">{String(l.user_id).slice(0, 8)}</td>
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
  const decide = async (id: string, status: string) => {
    const note = window.prompt('Decision note (audited):') ?? '';
    const { error } = await supabase.from('meta_moderation_cases')
      .update({ status, decided_at: new Date().toISOString(), decision_note: note }).eq('id', id);
    if (error) toast.error('failed'); else { toast.success(status); reload(); }
  };
  if (loading) return <Skeleton className="h-40 rounded-2xl" />;
  return (
    <div className="space-y-2">
      {rows.map((m: any) => (
        <Card key={m.id}>
          <p className="text-sm"><b>{m.reason}</b> · {m.severity} · {m.status} · {t('admin_mads_user')} {String(m.user_id).slice(0, 8)} · {new Date(m.created_at).toLocaleString()}</p>
          <p className="text-[13px] text-muted-foreground">{JSON.stringify(m.findings)}</p>
          {m.status === 'OPEN' && (
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => decide(m.id, 'APPROVED')}>{t('admin_mads_approve')}</Button>
              <Button size="sm" variant="outline" onClick={() => decide(m.id, 'CHANGES_REQUESTED')}>{t('admin_mads_request_changes')}</Button>
              <Button size="sm" variant="destructive" onClick={() => decide(m.id, 'REJECTED')}>{t('admin_mads_reject')}</Button>
            </div>
          )}
          {m.decision_note && <p className="mt-1 text-[13px]">{t('admin_mads_note')}: {m.decision_note}</p>}
        </Card>
      ))}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('admin_mads_queue_empty')}</p>}
    </div>
  );
}

/* ── FINANCE ─────────────────────────────────────────────────────────── */
function Finance() {
  const { t } = useLanguage();
  const [userFilter, setUserFilter] = useState('');
  const { rows, loading, reload } = useRows(async () => {
    let q = supabase.from('meta_ads_ledger').select('*').order('created_at', { ascending: false }).limit(300);
    if (userFilter) q = q.eq('user_id', userFilter);
    const { data } = await q; return data ?? [];
  }, [userFilter]);
  const adjust = async () => {
    const user = window.prompt('User id:'); if (!user) return;
    const amount = Number(window.prompt('Amount in cents (positive = credit, negative = debit):') ?? '');
    const reason = window.prompt('Reason (required, audited):') ?? '';
    if (!Number.isFinite(amount) || amount === 0 || !reason.trim()) { toast.error('amount + reason required'); return; }
    const { data, error } = await supabase.functions.invoke('meta-ads-api', {
      body: { action: 'admin_adjust', targetUserId: user, amountCents: Math.round(amount), reason },
    });
    if (error || (data as any)?.error) toast.error('adjust failed'); else { toast.success('adjusted'); reload(); }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input placeholder={t('admin_mads_filter_user_ph')} value={userFilter} onChange={e => setUserFilter(e.target.value)} className="max-w-sm font-mono" />
        <Button size="sm" variant="outline" onClick={adjust}>{t('admin_mads_manual_adjust')}</Button>
      </div>
      {loading ? <Skeleton className="h-40 rounded-2xl" /> : (
        <Card>
          <table className="w-full text-[13px]">
            <thead><tr className="text-muted-foreground"><th className="text-start">{t('admin_mads_at')}</th><th className="text-start">{t('admin_mads_user')}</th><th className="text-start">{t('admin_mads_type')}</th><th className="text-end">{t('admin_mads_amount')}</th><th className="text-start">{t('admin_mads_campaign')}</th><th className="text-start">{t('admin_mads_key')}</th></tr></thead>
            <tbody>
              {rows.map((e: any) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="py-1.5">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="font-mono">{String(e.user_id).slice(0, 8)}</td>
                  <td>{e.entry_type}</td>
                  <td className={cn('text-end tabular-nums', e.amount_cents < 0 ? 'text-destructive' : 'text-[hsl(152_54%_26%)]')} dir="ltr">{money(e.amount_cents)}</td>
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
    const { data } = await supabase.from('admin_settings').select('*').like('key', 'meta_ads_%').order('key');
    return data ?? [];
  });
  const save = async (key: string, value: unknown) => {
    const { error } = await supabase.from('admin_settings').update({ value }).eq('key', key);
    if (error) toast.error('save failed'); else { toast.success(key); reload(); }
  };
  if (loading) return <Skeleton className="h-40 rounded-2xl" />;
  return (
    <div className="space-y-2">
      {rows.map((s: any) => (
        <Card key={s.key}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-sm font-semibold">{s.key}</p>
              <p className="text-[13px] text-muted-foreground">{s.description}</p>
            </div>
            {KILL_SWITCHES.includes(s.key) ? (
              <Button size="sm" variant={s.value === true ? 'default' : 'outline'}
                onClick={() => save(s.key, s.value !== true)}>
                {s.value === true ? t('admin_mads_enabled') : t('admin_mads_disabled')}
              </Button>
            ) : NUMERIC_SETTINGS.includes(s.key) ? (
              <Input className="w-32 font-mono" dir="ltr" defaultValue={String(s.value)}
                onBlur={e => { const n = Number(e.target.value); if (Number.isFinite(n)) save(s.key, n); }} />
            ) : (
              <Input className="w-72 font-mono" dir="ltr" defaultValue={JSON.stringify(s.value)}
                onBlur={e => { try { save(s.key, JSON.parse(e.target.value)); } catch { toast.error('invalid JSON'); } }} />
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

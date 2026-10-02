// META ADS — Leads Center. Every lead from Meta (and imports) with its
// pipeline status, per-status counts, campaign / status / search filters,
// a private record drawer and CSV export. The campaign filter also reads
// ?campaign=<id>, so a campaign page can deep-link into its own leads.
//
// A real-estate pipeline, not a generic CRM (lib/metaAds/leadCenter.ts):
// the funnel with its costs (Meta's spend ÷ HOMATCH outcomes — no revenue, so
// no ROAS), follow-ups today / overdue / upcoming in the owner's time zone,
// "call first" order, explainable quality, one person's submissions counted
// but never merged. New leads arrive through Realtime (RLS-scoped), no polling.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Upload, Users, ChevronRight, Clock, Flame } from 'lucide-react';
import { supabase } from '@/db/supabase';
import { breakdownOf, followUpBucket, funnelOf, priorityOf, submissionsByContact } from '@/lib/metaAds/leadCenter';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { EmptyState, FilterRail } from '@/components/customer/surface';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  exportLeadsCsv, listMetaLeads, updateMetaLead, LEAD_STATUSES, type MetaCampaignRow, type MetaLeadRow,
} from '@/services/metaAds';
import { dateTime, SELECT_CLASS } from './format';
import { LeadRecordDrawer, leadName } from './LeadRecordDrawer';
import { LeadStatusSelect } from './LeadStatusSelect';

const UUID = /^[0-9a-f-]{36}$/i;
const PAGE = 50;

export function LeadsCenter({ campaigns, importEnabled, onImport, reloadKey = 0 }: {
  campaigns: MetaCampaignRow[];
  importEnabled: boolean;
  onImport: () => void;
  reloadKey?: number;
}) {
  const { t, lang } = useLanguage();
  const [params, setParams] = useSearchParams();
  const urlCampaign = params.get('campaign');
  const campaignId = urlCampaign && UUID.test(urlCampaign) ? urlCampaign : '';
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [leads, setLeads] = useState<MetaLeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [due, setDue] = useState<'ALL' | 'OVERDUE' | 'TODAY' | 'UPCOMING'>('ALL');
  const [pageSize, setPageSize] = useState(PAGE);
  const tz = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } }, []);

  /* Realtime: a new or changed lead appears without a reload or a poller.
     RLS decides what this owner receives; the row is merged by id. */
  useEffect(() => {
    const ch = supabase.channel('meta_leads_center')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meta_leads' }, (payload) => {
        const row = payload.new as MetaLeadRow | undefined;
        if (!row?.id) return;
        if (campaignId && row.campaign_id !== campaignId) return;
        setLeads((prev) => {
          const i = prev.findIndex((l) => l.id === row.id);
          if (i >= 0) { const next = [...prev]; next[i] = { ...prev[i], ...row }; return next; }
          return [row, ...prev];
        });
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [campaignId]);

  // Debounce the search so each keystroke is not a query.
  useEffect(() => { const h = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(h); }, [search]);

  const setCampaign = (id: string) => setParams(prev => {
    if (id) prev.set('campaign', id); else prev.delete('campaign');
    return prev;
  }, { replace: true });

  /* Status is filtered on the client so the per-status counts stay whole. */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLeads(await listMetaLeads({ campaignId: campaignId || undefined, search: query || undefined }));
    } catch { toast.error(t('mads_load_failed')); }
    finally { setLoading(false); }
  }, [campaignId, query, t]);
  useEffect(() => { void load(); }, [load, reloadKey]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of leads) c[l.status] = (c[l.status] ?? 0) + 1;
    return c;
  }, [leads]);
  const now = new Date();
  const byStatus = statusFilter === 'ALL' ? leads : leads.filter(l => l.status === statusFilter);
  const dueCounts = useMemo(() => {
    const c = { OVERDUE: 0, TODAY: 0, UPCOMING: 0 } as Record<string, number>;
    for (const l of leads) { const b = followUpBucket(l.follow_up_at, new Date(), tz); if (b && !['WON', 'LOST'].includes(l.status)) c[b] += 1; }
    return c;
  }, [leads, tz]);
  /* "Call first": overdue follow-ups, fresh uncontacted leads, today's follow-ups, then quality. */
  const ranked = useMemo(() => byStatus
    .filter(l => due === 'ALL' || (followUpBucket(l.follow_up_at, now, tz) === due && !['WON', 'LOST'].includes(l.status)))
    .map(l => ({ l, p: priorityOf(l as never, now, tz) }))
    .sort((a, b) => b.p.score - a.p.score || Date.parse(b.l.received_at) - Date.parse(a.l.received_at)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [byStatus, due, tz, leads]);
  const visible = ranked.slice(0, pageSize);
  const repeats = useMemo(() => submissionsByContact(leads as never), [leads]);
  /* The funnel for what is filtered by campaign; spend is Meta's reported spend of those campaigns. */
  const spend = useMemo(() => {
    const pool = campaignId ? campaigns.filter(c => c.id === campaignId) : campaigns;
    const sum = pool.reduce((n, c) => n + Number(c.spend_cents ?? 0), 0);
    return sum > 0 ? sum : null;
  }, [campaigns, campaignId]);
  const funnel = useMemo(() => funnelOf(leads as never, spend), [leads, spend]);
  const byCampaign = useMemo(() => (campaignId ? [] : breakdownOf(leads as never, 'campaign_id')), [leads, campaignId]);
  const money = (minor: number | null) => (minor == null ? '—' : new Intl.NumberFormat(lang, { style: 'currency', currency: campaigns[0]?.currency || 'USD' }).format(minor / 100));
  const open = leads.find(l => l.id === openId) ?? null;

  const names = useMemo(() => new Map(campaigns.map(c => [c.id, c.name || t(`mads_goal_${c.goal.toLowerCase()}`)])), [campaigns, t]);
  const campaignName = useCallback((id: string | null) => (id ? names.get(id) ?? null : null), [names]);

  /** Resolves true only once the database accepted the change; then the UI moves. */
  const changeStatus = async (lead: MetaLeadRow, status: string) => {
    try {
      await updateMetaLead(lead.id, { status });
      setLeads(prev => prev.map(l => (l.id === lead.id ? { ...l, status } : l)));
      toast.success(t('mm_w_lead_status_saved'));
      return true;
    } catch {
      toast.error(t('mm_w_lead_save_failed'));
      return false;
    }
  };
  const noteSaved = (lead: MetaLeadRow, note: string) =>
    setLeads(prev => prev.map(l => (l.id === lead.id ? { ...l, note } : l)));
  const leadPatched = (lead: MetaLeadRow, patch: Partial<MetaLeadRow>) =>
    setLeads(prev => prev.map(l => (l.id === lead.id ? { ...l, ...patch } : l)));

  const doExport = async () => {
    try {
      const { csv, rows } = await exportLeadsCsv({
        campaignId: campaignId || undefined, status: statusFilter === 'ALL' ? undefined : statusFilter,
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `homatch-meta-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(t('mads_export_done', { count: String(rows) }));
    } catch { toast.error(t('mads_export_failed')); }
  };

  return (
    <div className="space-y-3">
      <p className="max-w-[70ch] text-[13px] leading-relaxed text-muted-foreground">{t('mm_w_leads_intro')}</p>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="min-w-0 space-y-1 text-2xs text-muted-foreground">
          <span>{t('mm_w_leads_campaign')}</span>
          <select className={SELECT_CLASS} value={campaignId} onChange={e => setCampaign(e.target.value)}>
            <option value="">{t('mm_w_leads_all_campaigns')}</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{names.get(c.id)}</option>)}
            {campaignId && !names.has(campaignId) && <option value={campaignId}>{campaignId.slice(0, 8)}</option>}
          </select>
        </label>
        <label className="min-w-0 space-y-1 text-2xs text-muted-foreground">
          <span>{t('mm_w_leads_search_label')}</span>
          <Input type="search" placeholder={t('mads_leads_search')} value={search} onChange={e => setSearch(e.target.value)} />
        </label>
        <div className="flex items-end gap-2">
          <Button variant="outline" size="sm" onClick={doExport} className="h-10 gap-1.5"><Download className="h-3.5 w-3.5" aria-hidden="true" />{t('mads_export')}</Button>
          {importEnabled && (
            <Button variant="outline" size="sm" onClick={onImport} className="h-10 gap-1.5"><Upload className="h-3.5 w-3.5" aria-hidden="true" />{t('mads_import')}</Button>
          )}
        </div>
      </div>

      {/* THE FUNNEL — counts and rates from HOMATCH outcomes; costs from Meta's spend. No revenue → no ROAS. */}
      {leads.length > 0 && (
        <section aria-labelledby="mm-lc-funnel" data-mm-lc-funnel="" className="rounded-2xl border border-border bg-card p-3.5 shadow-card">
          <h3 id="mm-lc-funnel" className="text-sm font-semibold text-foreground">{t('mm_lc_funnel_title')}</h3>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([['leads', funnel.leads, null, funnel.cost.perLead], ['qualified', funnel.qualified, funnel.rates.qualified, funnel.cost.perQualified],
              ['viewing', funnel.viewing, funnel.rates.viewing, funnel.cost.perViewing], ['won', funnel.won, funnel.rates.won, funnel.cost.perWon]] as const)
              .map(([k, n, rate, cost]) => (
                <div key={k} className="rounded-xl bg-[hsl(var(--secondary))]/50 px-3 py-2" data-mm-lc-stage={k}>
                  <dt className="text-2xs text-muted-foreground">{t(`mm_lc_stage_${k}`)}</dt>
                  <dd className="text-lg font-bold tabular-nums text-foreground" dir="ltr">{n}{rate != null && <span className="ms-1 text-2xs font-medium text-muted-foreground">{rate}%</span>}</dd>
                  <dd className="text-2xs text-muted-foreground">{t('mm_lc_cost_each', { amount: money(cost) })}</dd>
                </div>
              ))}
          </dl>
          <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">{t(spend == null ? 'mm_lc_cost_unknown' : 'mm_lc_no_roas')}</p>
          {byCampaign.length > 1 && (
            <ul className="mt-2 space-y-1 text-[13px]" data-mm-lc-breakdown="">
              {byCampaign.slice(0, 5).map(b => (
                <li key={b.key} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate" dir="auto">{campaignName(b.key) ?? '—'}</span>
                  <span className="shrink-0 text-2xs text-muted-foreground">
                    {t('mm_lc_breakdown_row', { leads: String(b.leads), qualified: String(b.qualified) })}
                    {' · '}{b.enough ? `${b.qualifiedRate}%` : t('mm_lc_not_enough')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* FOLLOW-UPS — by the owner's own calendar day. */}
      <FilterRail<'ALL' | 'OVERDUE' | 'TODAY' | 'UPCOMING'>
        ariaLabel={t('mm_lc_followups')}
        value={due}
        onChange={(v) => { setDue(v); setPageSize(PAGE); }}
        options={[
          { value: 'ALL', label: t('mm_lc_due_ALL') },
          { value: 'OVERDUE', label: t('mm_lc_due_OVERDUE'), count: dueCounts.OVERDUE },
          { value: 'TODAY', label: t('mm_lc_due_TODAY'), count: dueCounts.TODAY },
          { value: 'UPCOMING', label: t('mm_lc_due_UPCOMING'), count: dueCounts.UPCOMING },
        ]}
      />

      {/* Counts per status double as the status filter. */}
      <FilterRail<string>
        ariaLabel={t('mm_w_leads_counts_label')}
        value={statusFilter}
        onChange={(v) => { setStatusFilter(v); setPageSize(PAGE); }}
        options={[
          { value: 'ALL', label: t('mads_filter_all'), count: leads.length },
          ...LEAD_STATUSES.map(s => ({ value: s, label: t(`mm_w_lead_status_${s}`), count: counts[s] ?? 0 })),
        ]}
      />

      {loading ? <Skeleton className="h-40 rounded-2xl" /> : ranked.length === 0 ? (
        <EmptyState icon={Users} title={t('mads_leads_empty_title')} body={t('mads_leads_empty_body')} />
      ) : (
        <ul className="space-y-2">
          {visible.map(({ l, p }) => (
            <li key={l.id} className="rounded-2xl border border-border bg-card shadow-card" data-mm-lc-lead={l.id} data-mm-lc-priority={p.reason ?? ''}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <button type="button" onClick={() => setOpenId(l.id)} title={t('mm_w_lead_open')}
                  className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-foreground">{leadName(l) || t('mads_lead_unnamed')}</span>
                    <span className="block truncate text-2xs text-muted-foreground">
                      {[campaignName(l.campaign_id), dateTime(l.received_at, lang)].filter(Boolean).join(' · ')}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5 text-2xs">
                      {p.reason && <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--gold-soft))] px-2 py-0.5 font-semibold text-[hsl(var(--gold-ink))]"><Flame className="h-3 w-3" aria-hidden />{t(`mm_lc_pri_${p.reason}`)}</span>}
                      {l.quality && l.quality !== 'UNRATED' && <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground" data-mm-lc-quality={l.quality}>{t(`mm_lc_q_${l.quality}`)}</span>}
                      {l.follow_up_at && !['WON', 'LOST'].includes(l.status) && <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-muted-foreground"><Clock className="h-3 w-3" aria-hidden />{dateTime(l.follow_up_at, lang)}</span>}
                      {l.contact_key && (repeats.get(l.contact_key) ?? 0) > 1 && <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground" data-mm-lc-repeat="">{t('mm_lc_repeat', { n: String(repeats.get(l.contact_key)) })}</span>}
                    </span>
                  </span>
                  <span className={cn('hidden shrink-0 rounded-full border px-2 py-0.5 text-[13px] font-medium sm:inline',
                    l.source === 'IMPORT' ? 'border-border bg-[hsl(var(--secondary))] text-muted-foreground'
                      : 'border-[hsl(var(--gold-border))]/60 bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]')}>
                    {t(l.source === 'IMPORT' ? 'mads_source_import' : 'mads_source_meta')}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
                </button>
                <div className="w-full sm:w-44">
                  <LeadStatusSelect lead={l} onChange={s => changeStatus(l, s)} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {ranked.length > visible.length && (
        <Button variant="outline" className="min-h-11 w-full" onClick={() => setPageSize(n => n + PAGE)} data-mm-lc-more="">
          {t('mm_lc_more', { n: String(ranked.length - visible.length) })}
        </Button>
      )}

      <LeadRecordDrawer lead={open} campaignName={campaignName} onClose={() => setOpenId(null)}
        onStatus={changeStatus} onNote={noteSaved} onPatch={leadPatched}
        repeats={open?.contact_key ? repeats.get(open.contact_key) ?? 1 : 1} />
    </div>
  );
}

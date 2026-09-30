// META ADS — Leads Center. Every lead from Meta (and imports) with its
// pipeline status, per-status counts, campaign / status / search filters,
// a private record drawer and CSV export. The campaign filter also reads
// ?campaign=<id>, so a campaign page can deep-link into its own leads.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Upload, Users, ChevronRight } from 'lucide-react';
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
  const visible = statusFilter === 'ALL' ? leads : leads.filter(l => l.status === statusFilter);
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

      {/* Counts per status double as the status filter. */}
      <FilterRail<string>
        ariaLabel={t('mm_w_leads_counts_label')}
        value={statusFilter}
        onChange={setStatusFilter}
        options={[
          { value: 'ALL', label: t('mads_filter_all'), count: leads.length },
          ...LEAD_STATUSES.map(s => ({ value: s, label: t(`mm_w_lead_status_${s}`), count: counts[s] ?? 0 })),
        ]}
      />

      {loading ? <Skeleton className="h-40 rounded-2xl" /> : visible.length === 0 ? (
        <EmptyState icon={Users} title={t('mads_leads_empty_title')} body={t('mads_leads_empty_body')} />
      ) : (
        <ul className="space-y-2">
          {visible.map(l => (
            <li key={l.id} className="rounded-2xl border border-border bg-card shadow-card">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <button type="button" onClick={() => setOpenId(l.id)} title={t('mm_w_lead_open')}
                  className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-foreground">{leadName(l) || t('mads_lead_unnamed')}</span>
                    <span className="block truncate text-2xs text-muted-foreground">
                      {[campaignName(l.campaign_id), dateTime(l.received_at, lang)].filter(Boolean).join(' · ')}
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

      <LeadRecordDrawer lead={open} campaignName={campaignName} onClose={() => setOpenId(null)}
        onStatus={changeStatus} onNote={noteSaved} />
    </div>
  );
}

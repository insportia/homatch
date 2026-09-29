// META ADS — the customer workspace. Simple on purpose: the customer sees
// goals, budgets, creatives, leads and audiences in human words; every
// technical decision (objectives, topology, policy categories, hashing)
// lives behind the meta-ads-api boundary. Complexity belongs to HOMATCH.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { EmptyState, FilterRail, PageHero } from '@/components/customer/surface';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Megaphone, Plus, Users, Bookmark, Link2, CircleHelp, RefreshCw, Download, Upload,
  CheckCircle2, Circle, Loader2, ChevronRight, Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  getMetaStatus, startMetaOAuth, mockConnect, refreshMetaAssets, selectMetaAsset,
  listMetaCampaigns, listMetaLeads, updateMetaLead, exportLeadsCsv, importLeads,
  listAudiences, acceptAudienceTerms, createAudience, depositCheckout, listHelp, money,
  type MetaStatus, type MetaCampaignRow, type MetaLeadRow, type MetaAudienceRow,
} from '@/services/metaAds';

type Tab = 'overview' | 'campaigns' | 'leads' | 'audiences' | 'connections' | 'help';

const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'bg-[hsl(152_54%_28%)]/10 text-[hsl(152_54%_26%)] border-[hsl(152_40%_40%)]/30',
  META_REVIEW: 'bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))] border-[hsl(var(--gold-border))]/60',
  SUBMITTED: 'bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))] border-[hsl(var(--gold-border))]/60',
  PAUSED: 'bg-[hsl(var(--secondary))] text-muted-foreground border-border',
  DRAFT: 'bg-card text-muted-foreground border-border',
  READY: 'bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))] border-[hsl(var(--gold-border))]/60',
  NEEDS_CHANGES: 'bg-[hsl(32_78%_36%)]/10 text-[hsl(32_78%_32%)] border-[hsl(32_78%_36%)]/30',
  REJECTED: 'bg-destructive/10 text-destructive border-destructive/30',
  FAILED: 'bg-destructive/10 text-destructive border-destructive/30',
  COMPLETED: 'bg-[hsl(var(--secondary))] text-foreground border-border',
};

export function CampaignStatusChip({ status }: { status: string }) {
  const { t } = useLanguage();
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[13px] font-semibold',
      STATUS_TONE[status] ?? 'bg-card text-muted-foreground border-border')}>
      {t(`mads_status_${status.toLowerCase()}` as never)}
    </span>
  );
}

export default function MetaAdsPage() {
  const { homatchUser } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
  const setTab = (next: Tab) => setParams(prev => { prev.set('tab', next); return prev; }, { replace: true });

  const [status, setStatus] = useState<MetaStatus | null>(null);
  const [campaigns, setCampaigns] = useState<MetaCampaignRow[]>([]);
  const [loading, setLoading] = useState(true);

  const boot = useCallback(async () => {
    setLoading(true);
    try {
      const [st, cs] = await Promise.all([getMetaStatus(), listMetaCampaigns()]);
      setStatus(st); setCampaigns(cs);
    } catch (e) {
      toast.error(t('mads_load_failed'));
    } finally { setLoading(false); }
  }, [t]);
  useEffect(() => { boot(); }, [boot]);

  useEffect(() => {
    if (params.get('deposit') === 'ok') toast.success(t('mads_deposit_ok'));
    if (params.get('connect') === 'ok') toast.success(t('mads_connected_ok'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connected = status?.connection?.status === 'CONNECTED';

  return (
    <RouteGuard>
      <AppLayout noPadding>
        <div className="mx-auto w-full max-w-[86rem] space-y-4 px-4 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
          <PageHero
            compact
            eyebrow={t('mads_eyebrow')}
            title={t('nav_meta_ads')}
            subtitle={t('mads_subtitle')}
            actions={
              <button
                type="button"
                onClick={() => navigate('/outreach/meta/create')}
                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-[hsl(38_92%_54%)] px-3.5 py-1.5 text-2xs font-bold text-[#161309] transition-colors hover:bg-[hsl(38_92%_60%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <Plus className="h-3.5 w-3.5" />{t('mads_create_cta')}
              </button>
            }
          />

          {/* MOCK banner: the truth about the integration, never hidden. */}
          {status?.mode === 'MOCK' && (
            <div className="rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-4 py-2.5 text-[13px] text-[hsl(var(--gold-ink))]">
              {t('mads_mock_banner')}
            </div>
          )}

          <FilterRail<Tab>
            options={[
              { value: 'overview', label: t('mads_tab_overview') },
              { value: 'campaigns', label: t('mads_tab_campaigns'), count: campaigns.length },
              { value: 'leads', label: t('mads_tab_leads') },
              { value: 'audiences', label: t('mads_tab_audiences') },
              { value: 'connections', label: t('mads_tab_connections') },
              { value: 'help', label: t('mads_tab_help') },
            ]}
            value={tab}
            onChange={setTab}
            ariaLabel="Meta Ads"
          />

          {loading ? (
            <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
          ) : tab === 'overview' ? (
            <OverviewTab status={status} campaigns={campaigns} onDeposit={boot} onCreate={() => navigate('/outreach/meta/create')} />
          ) : tab === 'campaigns' ? (
            <CampaignsTab campaigns={campaigns} onCreate={() => navigate('/outreach/meta/create')} />
          ) : tab === 'leads' ? (
            <LeadsTab campaigns={campaigns} importEnabled={status?.settings.leadImportEnabled ?? true} />
          ) : tab === 'audiences' ? (
            <AudiencesTab enabled={status?.settings.audienceCreationEnabled ?? true} connected={connected}
              campaigns={campaigns} onRetarget={(audienceId) => navigate(`/outreach/meta/create?audience=${audienceId}`)} />
          ) : tab === 'connections' ? (
            <ConnectionsTab status={status} onChanged={boot} />
          ) : (
            <HelpTab locale={lang} />
          )}
        </div>
      </AppLayout>
    </RouteGuard>
  );
}

/* ── OVERVIEW ─────────────────────────────────────────────────────────── */

function OverviewTab({ status, campaigns, onDeposit, onCreate }: {
  status: MetaStatus | null; campaigns: MetaCampaignRow[]; onDeposit: () => void; onCreate: () => void;
}) {
  const { t } = useLanguage();
  const [depositOpen, setDepositOpen] = useState(false);
  const [amount, setAmount] = useState('50');
  const [busy, setBusy] = useState(false);
  const wallet = status?.wallet;
  const active = campaigns.filter(c => ['ACTIVE', 'META_REVIEW', 'SUBMITTED'].includes(c.status)).length;

  const deposit = async () => {
    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents < 500) { toast.error(t('mads_deposit_min')); return; }
    setBusy(true);
    try {
      const { url } = await depositCheckout(cents);
      window.location.href = url;
    } catch (e: any) {
      toast.error(t('mads_deposit_unavailable'));
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Ads balance — the separate money domain, fully visible. */}
      <div className="overflow-hidden rounded-2xl bg-[#0C1119] p-5 text-white shadow-hover">
        <p className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-[hsl(38_92%_60%)]">
          <Wallet className="h-4 w-4" />{t('mads_balance_title')}
        </p>
        <p className="mt-3 font-display text-3xl font-bold tabular-nums" dir="ltr">
          {money(wallet?.available_cents ?? 0)}
        </p>
        <dl className="mt-3 space-y-1 text-[13px] text-white/75 tabular-nums">
          <div className="flex justify-between"><dt>{t('mads_balance_reserved')}</dt><dd dir="ltr">{money(wallet?.reserved_cents ?? 0)}</dd></div>
          <div className="flex justify-between"><dt>{t('mads_balance_spent')}</dt><dd dir="ltr">{money(wallet?.spent_cents ?? 0)}</dd></div>
          <div className="flex justify-between"><dt>{t('mads_balance_fees')}</dt><dd dir="ltr">{money(wallet?.fees_cents ?? 0)}</dd></div>
        </dl>
        <Button onClick={() => setDepositOpen(true)}
          className="mt-4 w-full bg-[hsl(38_92%_54%)] font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)]">
          {t('mads_add_funds')}
        </Button>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-card lg:col-span-2">
        <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('mads_overview_now')}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label={t('mads_stat_active')} value={String(active)} />
          <Stat label={t('mads_stat_total')} value={String(campaigns.length)} />
          <Stat label={t('mads_stat_fee')} value={`${status?.settings.feePercent ?? 9}%`} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={onCreate} className="gap-1.5"><Plus className="h-4 w-4" />{t('mads_create_cta')}</Button>
        </div>
        <p className="mt-4 max-w-[60ch] text-[13px] leading-relaxed text-muted-foreground">{t('mads_overview_hint')}</p>
      </div>

      <Dialog open={depositOpen} onOpenChange={setDepositOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
          <DialogHeader><DialogTitle>{t('mads_add_funds')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t('mads_deposit_desc')}</p>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">$</span>
            <Input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} dir="ltr" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDepositOpen(false)}>{t('general_cancel')}</Button>
            <Button onClick={deposit} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('mads_deposit_go')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-[hsl(var(--secondary))] px-3 py-2.5">
      <p className="text-2xs text-muted-foreground">{label}</p>
      <p className="font-display text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

/* ── CAMPAIGNS ────────────────────────────────────────────────────────── */

function CampaignsTab({ campaigns, onCreate }: { campaigns: MetaCampaignRow[]; onCreate: () => void }) {
  const { t } = useLanguage();
  if (campaigns.length === 0) {
    return (
      <EmptyState icon={Megaphone} title={t('mads_empty_title')} body={t('mads_empty_body')}
        actions={<Button onClick={onCreate} className="gap-1.5"><Plus className="h-4 w-4" />{t('mads_create_cta')}</Button>} />
    );
  }
  return (
    <div className="space-y-2.5">
      {campaigns.map(c => (
        <Link key={c.id} to={`/outreach/meta/campaigns/${c.id}`}
          className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 shadow-card transition-colors hover:border-[hsl(var(--gold-border))]">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-semibold text-foreground">{c.name || t(`mads_goal_${c.goal.toLowerCase()}` as never)}</p>
              <CampaignStatusChip status={c.status} />
            </div>
            <p className="mt-0.5 text-2xs text-muted-foreground tabular-nums" dir="ltr">
              {c.daily_budget_cents ? `${money(c.daily_budget_cents)}/day · ${c.duration_days ?? '—'}d` : ''}
              {c.spend_cents > 0 ? ` · ${t('mads_spent')} ${money(c.spend_cents)}` : ''}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" />
        </Link>
      ))}
    </div>
  );
}

/* ── LEADS ────────────────────────────────────────────────────────────── */

function LeadsTab({ campaigns, importEnabled }: { campaigns: MetaCampaignRow[]; importEnabled: boolean }) {
  const { t } = useLanguage();
  const [leads, setLeads] = useState<MetaLeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'ALL' | string>('ALL');
  const [search, setSearch] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLeads(await listMetaLeads({ status: statusFilter === 'ALL' ? undefined : statusFilter, search }));
    } catch { toast.error(t('mads_load_failed')); }
    finally { setLoading(false); }
  }, [statusFilter, search, t]);
  useEffect(() => { load(); }, [load]);

  const doExport = async () => {
    try {
      const { csv, rows } = await exportLeadsCsv({ status: statusFilter === 'ALL' ? undefined : statusFilter });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `homatch-meta-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(t('mads_export_done', { count: String(rows) }));
    } catch { toast.error(t('mads_export_failed')); }
  };

  const STATUSES = ['NEW', 'CONTACTED', 'INTERESTED', 'NOT_INTERESTED', 'CLOSED'];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder={t('mads_leads_search')} value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
        <FilterRail options={[{ value: 'ALL', label: t('mads_filter_all') }, ...STATUSES.map(s => ({ value: s, label: t(`mads_lead_${s.toLowerCase()}` as never) }))]}
          value={statusFilter} onChange={setStatusFilter} ariaLabel={t('mads_tab_leads')} />
        <div className="ms-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={doExport} className="gap-1.5"><Download className="h-3.5 w-3.5" />{t('mads_export')}</Button>
          {importEnabled && (
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} className="gap-1.5"><Upload className="h-3.5 w-3.5" />{t('mads_import')}</Button>
          )}
        </div>
      </div>

      {loading ? <Skeleton className="h-40 rounded-2xl" /> : leads.length === 0 ? (
        <EmptyState icon={Users} title={t('mads_leads_empty_title')} body={t('mads_leads_empty_body')} />
      ) : (
        <div className="space-y-2">
          {leads.map(l => <LeadRow key={l.id} lead={l} onChanged={load} />)}
        </div>
      )}

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onDone={load} />
    </div>
  );
}

function LeadRow({ lead, onChanged }: { lead: MetaLeadRow; onChanged: () => void }) {
  const { t } = useLanguage();
  const f = lead.fields ?? {};
  const name = (f.full_name ?? f.name ?? '') as string;
  const contact = [f.email, f.phone_number ?? f.phone].filter(Boolean).join(' · ');
  const STATUSES = ['NEW', 'CONTACTED', 'INTERESTED', 'NOT_INTERESTED', 'CLOSED'];
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-semibold text-foreground">{name || t('mads_lead_unnamed')}</p>
        <span className="text-2xs text-muted-foreground">{new Date(lead.received_at).toLocaleDateString()}</span>
        <span className={cn('rounded-full border px-2 py-0.5 text-[13px] font-medium',
          lead.source === 'IMPORT' ? 'border-border bg-[hsl(var(--secondary))] text-muted-foreground'
            : 'border-[hsl(var(--gold-border))]/60 bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]')}>
          {t(lead.source === 'IMPORT' ? 'mads_source_import' : 'mads_source_meta')}
        </span>
      </div>
      {contact && <p className="mt-0.5 truncate text-sm text-muted-foreground" dir="ltr">{contact}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {STATUSES.map(s => (
          <button key={s} type="button"
            onClick={async () => { await updateMetaLead(lead.id, { status: s }).catch(() => toast.error(t('mads_load_failed'))); onChanged(); }}
            className={cn('rounded-full border px-2.5 py-1 text-[13px] transition-colors',
              lead.status === s
                ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] font-semibold text-[hsl(var(--gold-ink))]'
                : 'border-border bg-card text-muted-foreground hover:border-[hsl(var(--gold-border))]')}>
            {t(`mads_lead_${s.toLowerCase()}` as never)}
          </button>
        ))}
      </div>
    </div>
  );
}

function ImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Array<{ name?: string; email?: string; phone?: string }>>([]);
  const [filename, setFilename] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  const parse = async (file: File) => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) { toast.error(t('mads_import_invalid')); return; }
    const split = (l: string) => l.split(/[,;\t]/).map(c => c.replace(/^"|"$/g, '').trim());
    const header = split(lines[0]).map(h => h.toLowerCase());
    const idx = {
      name: header.findIndex(h => /name|სახელ/.test(h)),
      email: header.findIndex(h => /mail/.test(h)),
      phone: header.findIndex(h => /phone|tel|ტელ/.test(h)),
    };
    if (idx.email === -1 && idx.phone === -1) { toast.error(t('mads_import_needs_contact')); return; }
    const parsed = lines.slice(1, 10001).map(l => {
      const c = split(l);
      return {
        name: idx.name >= 0 ? c[idx.name] : undefined,
        email: idx.email >= 0 ? c[idx.email] : undefined,
        phone: idx.phone >= 0 ? c[idx.phone] : undefined,
      };
    });
    setRows(parsed); setFilename(file.name);
  };

  const submit = async () => {
    if (!consent) { toast.error(t('mads_import_consent_needed')); return; }
    setBusy(true);
    try {
      const r = await importLeads(rows, filename, true);
      toast.success(t('mads_import_done', { accepted: String(r.accepted), duplicates: String(r.duplicates), invalid: String(r.invalid) }));
      setRows([]); setConsent(false); onClose(); onDone();
    } catch { toast.error(t('mads_import_failed')); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
        <DialogHeader><DialogTitle>{t('mads_import_title')}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{t('mads_import_desc')}</p>
        <input type="file" accept=".csv,text/csv" className="text-sm"
          onChange={e => e.target.files?.[0] && parse(e.target.files[0])} />
        {rows.length > 0 && (
          <>
            <p className="text-sm text-foreground">{t('mads_import_preview', { count: String(rows.length) })}</p>
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[hsl(var(--gold-border))]/60 bg-[hsl(var(--gold-soft))] p-3 text-[13px] leading-relaxed text-foreground">
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5" />
              {t('mads_import_consent')}
            </label>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('general_cancel')}</Button>
          <Button onClick={submit} disabled={busy || rows.length === 0}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('mads_import_go')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── AUDIENCES ────────────────────────────────────────────────────────── */

function AudiencesTab({ enabled, connected, campaigns, onRetarget }: {
  enabled: boolean; connected: boolean; campaigns: MetaCampaignRow[]; onRetarget: (audienceId: string) => void;
}) {
  const { t } = useLanguage();
  const [audiences, setAudiences] = useState<MetaAudienceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [source, setSource] = useState<'UPLOADED_LIST' | 'HOMATCH_LEADS'>('UPLOADED_LIST');
  const [busy, setBusy] = useState(false);
  const [termsNeeded, setTermsNeeded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setAudiences(await listAudiences()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const r = await createAudience(name.trim(), source);
      toast.success(t('mads_aud_created', { accepted: String(r.accepted) }));
      setCreateOpen(false); setName(''); load();
    } catch (e: any) {
      if (e?.code === 'TERMS_REQUIRED' || String(e.message).includes('TERMS_REQUIRED')) setTermsNeeded(true);
      else if (String(e.message).includes('NO_VALID_IDENTIFIERS')) toast.error(t('mads_aud_no_people'));
      else if (String(e.message).includes('NO_AD_ACCOUNT')) toast.error(t('mads_aud_no_account'));
      else toast.error(t('mads_load_failed'));
    } finally { setBusy(false); }
  };

  const acceptTerms = async () => {
    setBusy(true);
    try { await acceptAudienceTerms(); setTermsNeeded(false); toast.success(t('mads_terms_done')); }
    catch { toast.error(t('mads_load_failed')); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="max-w-[60ch] text-[13px] leading-relaxed text-muted-foreground">{t('mads_aud_intro')}</p>
        {enabled && <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5 shrink-0"><Plus className="h-3.5 w-3.5" />{t('mads_aud_create')}</Button>}
      </div>

      {loading ? <Skeleton className="h-32 rounded-2xl" /> : audiences.length === 0 ? (
        <EmptyState icon={Bookmark} title={t('mads_aud_empty_title')} body={t('mads_aud_empty_body')} />
      ) : (
        <div className="space-y-2">
          {audiences.map(a => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-card">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-foreground">{a.name}</p>
                <p className="text-2xs text-muted-foreground">
                  {t(`mads_aud_src_${a.source.toLowerCase()}` as never)}
                  {a.known_record_count != null ? ` · ${t('mads_aud_people', { count: String(a.known_record_count) })}` : ''}
                </p>
              </div>
              <span className={cn('rounded-full border px-2 py-0.5 text-[13px] font-medium',
                a.sync_status === 'READY' ? 'border-[hsl(152_40%_40%)]/30 bg-[hsl(152_54%_28%)]/10 text-[hsl(152_54%_26%)]'
                  : a.sync_status === 'FAILED' ? 'border-destructive/30 bg-destructive/10 text-destructive'
                    : 'border-border bg-[hsl(var(--secondary))] text-muted-foreground')}>
                {t(`mads_aud_${a.sync_status.toLowerCase()}` as never)}
              </span>
              {a.sync_status === 'READY' && (
                <Button size="sm" variant="outline" onClick={() => onRetarget(a.id)} className="gap-1.5">
                  <Megaphone className="h-3.5 w-3.5" />{t('mads_aud_retarget')}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
          <DialogHeader><DialogTitle>{t('mads_aud_create')}</DialogTitle></DialogHeader>
          {termsNeeded ? (
            <>
              <p className="text-sm leading-relaxed text-foreground">{t('mads_terms_body')}</p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setTermsNeeded(false)}>{t('general_cancel')}</Button>
                <Button onClick={acceptTerms} disabled={busy}>{t('mads_terms_accept')}</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <Input placeholder={t('mads_aud_name_ph')} value={name} onChange={e => setName(e.target.value)} maxLength={80} />
              <div className="flex gap-2">
                {(['UPLOADED_LIST', 'HOMATCH_LEADS'] as const).map(s => (
                  <button key={s} type="button" onClick={() => setSource(s)}
                    className={cn('flex-1 rounded-xl border px-3 py-2.5 text-start text-sm transition-colors',
                      source === s ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] font-semibold text-foreground'
                        : 'border-border bg-card text-muted-foreground hover:border-[hsl(var(--gold-border))]')}>
                    {t(`mads_aud_src_${s.toLowerCase()}` as never)}
                  </button>
                ))}
              </div>
              <p className="text-[13px] leading-relaxed text-muted-foreground">{t('mads_aud_privacy')}</p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('general_cancel')}</Button>
                <Button onClick={create} disabled={busy || !name.trim()}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('mads_aud_create')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── CONNECTIONS ──────────────────────────────────────────────────────── */

function ConnectionsTab({ status, onChanged }: { status: MetaStatus | null; onChanged: () => void }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const connected = status?.connection?.status === 'CONNECTED';
  const kinds: Array<{ kind: string; labelKey: string }> = [
    { kind: 'BUSINESS', labelKey: 'mads_conn_business' },
    { kind: 'PAGE', labelKey: 'mads_conn_page' },
    { kind: 'INSTAGRAM', labelKey: 'mads_conn_instagram' },
    { kind: 'AD_ACCOUNT', labelKey: 'mads_conn_ad_account' },
  ];

  const connect = async () => {
    setBusy(true);
    try {
      const r = await startMetaOAuth();
      if (r.url) { window.location.href = r.url; return; }
      if (r.mockConnect) { await mockConnect(); toast.success(t('mads_connected_ok')); onChanged(); }
    } catch { toast.error(t('mads_load_failed')); }
    finally { setBusy(false); }
  };

  const refresh = async () => {
    setBusy(true);
    try { await refreshMetaAssets(); onChanged(); }
    catch (e: any) { toast.error(t(String(e.message).startsWith('meta_err') ? e.message : 'mads_load_failed')); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {connected
              ? <CheckCircle2 className="h-5 w-5 text-[hsl(152_54%_30%)]" />
              : <Circle className="h-5 w-5 text-muted-foreground" />}
            <div>
              <p className="font-semibold text-foreground">{t(connected ? 'mads_conn_connected' : 'mads_conn_disconnected')}</p>
              <p className="text-2xs text-muted-foreground">{t('mads_conn_hint')}</p>
            </div>
          </div>
          <div className="flex gap-2">
            {connected && (
              <Button variant="outline" size="sm" onClick={refresh} disabled={busy} className="gap-1.5">
                <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />{t('mads_conn_refresh')}
              </Button>
            )}
            <Button size="sm" onClick={connect} disabled={busy} className="gap-1.5">
              <Link2 className="h-3.5 w-3.5" />{t(connected ? 'mads_conn_reconnect' : 'mads_conn_connect')}
            </Button>
          </div>
        </div>
      </div>

      {connected && kinds.map(({ kind, labelKey }) => {
        const options = (status?.assets ?? []).filter(a => a.kind === kind);
        const selected = options.find(a => a.selected);
        return (
          <div key={kind} className="rounded-2xl border border-border bg-card px-4 py-3.5 shadow-card">
            <div className="flex flex-wrap items-center gap-3">
              {selected ? <CheckCircle2 className="h-[1.1rem] w-[1.1rem] text-[hsl(152_54%_30%)]" /> : <Circle className="h-[1.1rem] w-[1.1rem] text-muted-foreground" />}
              <p className="min-w-[9rem] font-medium text-foreground">{t(labelKey as never)}</p>
              {options.length === 0 ? (
                kind === 'AD_ACCOUNT' ? (
                  <div className="min-w-0 flex-1 rounded-xl border border-[hsl(var(--gold-border))]/60 bg-[hsl(var(--gold-soft))] px-3 py-2 text-[13px] leading-relaxed text-foreground">
                    {t('mads_conn_no_ad_account')}
                    <Button variant="outline" size="sm" onClick={refresh} className="ms-2 mt-1 gap-1.5">
                      <RefreshCw className="h-3.5 w-3.5" />{t('mads_conn_check_again')}
                    </Button>
                  </div>
                ) : <p className="text-[13px] text-muted-foreground">{t('mads_conn_none_found')}</p>
              ) : (
                <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                  {options.map(o => (
                    <button key={o.id} type="button"
                      onClick={async () => { await selectMetaAsset(kind, o.id).catch(() => {}); onChanged(); }}
                      className={cn('max-w-full truncate rounded-full border px-3 py-1 text-[13px] transition-colors',
                        o.selected ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] font-semibold text-[hsl(var(--gold-ink))]'
                          : 'border-border bg-card text-muted-foreground hover:border-[hsl(var(--gold-border))]')}>
                      {o.name ?? o.external_id}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── HELP ─────────────────────────────────────────────────────────────── */

function HelpTab({ locale }: { locale: string }) {
  const { t } = useLanguage();
  const [items, setItems] = useState<Array<{ id: string; title: string; body: string; video_url: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    listHelp(locale).then(rows => setItems(rows as never)).finally(() => setLoading(false));
  }, [locale]);
  if (loading) return <Skeleton className="h-32 rounded-2xl" />;
  if (items.length === 0) {
    return <EmptyState icon={CircleHelp} title={t('mads_help_empty_title')} body={t('mads_help_empty_body')} />;
  }
  return (
    <div className="space-y-2.5">
      {items.map(h => (
        <details key={h.id} className="group rounded-2xl border border-border bg-card px-4 py-3.5 shadow-card">
          <summary className="cursor-pointer list-none font-semibold text-foreground">{h.title}</summary>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{h.body}</p>
          {h.video_url && (
            <a href={h.video_url} target="_blank" rel="noopener noreferrer"
              className="mt-2 inline-block text-sm font-medium text-[hsl(var(--gold-ink))] hover:underline">
              {t('mads_help_video')}
            </a>
          )}
        </details>
      ))}
    </div>
  );
}

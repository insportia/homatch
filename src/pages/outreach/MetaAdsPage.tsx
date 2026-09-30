// META ADS — the customer workspace. Simple on purpose: the customer sees
// goals, budgets, creatives, leads and audiences in human words; every
// technical decision (objectives, topology, policy categories, hashing)
// lives behind the meta-ads-api boundary. Complexity belongs to HOMATCH.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { EmptyState, FilterRail, PageHero } from '@/components/customer/surface';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Megaphone, Plus, Bookmark, CircleHelp, Loader2, ChevronRight, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { AccountPanel, RETURN_KEY } from '@/components/metaAds/builder/AccountPanel';
import { CampaignStatusChip } from '@/components/metaAds/workspace/CampaignStatusChip';
import { GlobalDashboard } from '@/components/metaAds/workspace/GlobalDashboard';
import { GuardBanner } from '@/components/metaAds/workspace/GuardBanner';
import { LeadsCenter } from '@/components/metaAds/workspace/LeadsCenter';
import { ServiceBalanceCard } from '@/components/metaAds/workspace/ServiceBalanceCard';
import {
  getMetaStatus, refreshMetaAssets, EDITABLE_STATUSES,
  listMetaCampaigns, importLeads,
  listAudiences, acceptAudienceTerms, createAudience, listHelp, money,
  type MetaStatus, type MetaCampaignRow, type MetaAudienceRow,
} from '@/services/metaAds';

type Tab = 'overview' | 'campaigns' | 'leads' | 'balance' | 'audiences' | 'connections' | 'help';
const TABS: Tab[] = ['overview', 'campaigns', 'leads', 'balance', 'audiences', 'connections', 'help'];

/* The chip moved to the workspace folder; kept exported here for the
   campaign drill-down, which imports it from this page. */
export { CampaignStatusChip };

export default function MetaAdsPage() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab') as Tab | null;
  const tab: Tab = rawTab && TABS.includes(rawTab) ? rawTab : 'overview';
  const setTab = (next: Tab) => setParams(prev => { prev.set('tab', next); return prev; }, { replace: true });

  const [status, setStatus] = useState<MetaStatus | null>(null);
  const [campaigns, setCampaigns] = useState<MetaCampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [leadsReload, setLeadsReload] = useState(0);

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
    const connect = params.get('connect');
    if (connect === 'ok') {
      toast.success(t('mads_connected_ok'));
      /* Read the Businesses, Pages and Ad Accounts the owner just granted, so
         the builder offers them without a manual refresh. */
      void refreshMetaAssets().catch(() => undefined).then(() => boot());
    }
    else if (connect) toast.error(t(`madsb_connect_${connect}` as never));
    // Back into the campaign builder the customer left for Facebook login.
    if (connect) {
      let back: string | null = null;
      try { back = localStorage.getItem(RETURN_KEY); localStorage.removeItem(RETURN_KEY); } catch { /* fine */ }
      if (back && back.startsWith('/outreach/meta/create')) navigate(back, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connected = status?.connection?.status === 'CONNECTED';
  const serviceBalance = status?.serviceBalance ?? [];
  const feePercent = status?.settings.feePercent ?? null;

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

          {/* Guard: calm, and only when an ad account is on WATCH or SUSPENDED. */}
          <GuardBanner guard={status?.guard} />

          <FilterRail<Tab>
            options={[
              { value: 'overview', label: t('mads_tab_overview') },
              { value: 'campaigns', label: t('mads_tab_campaigns'), count: campaigns.length },
              { value: 'leads', label: t('mads_tab_leads') },
              { value: 'balance', label: t('mm_w_tab_balance') },
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
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="min-w-0 lg:col-span-2"><GlobalDashboard goals={status?.settings.goalsEnabled} /></div>
              <div className="min-w-0"><ServiceBalanceCard rows={serviceBalance} feePercent={feePercent} /></div>
            </div>
          ) : tab === 'campaigns' ? (
            <CampaignsTab campaigns={campaigns} onCreate={() => navigate('/outreach/meta/create')} />
          ) : tab === 'leads' ? (
            <>
              <LeadsCenter campaigns={campaigns} importEnabled={status?.settings.leadImportEnabled ?? true}
                onImport={() => setImportOpen(true)} reloadKey={leadsReload} />
              <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onDone={() => setLeadsReload(n => n + 1)} />
            </>
          ) : tab === 'balance' ? (
            <BalanceTab status={status} />
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

/* ── BALANCE ──────────────────────────────────────────────────────────── */

function BalanceTab({ status }: { status: MetaStatus | null }) {
  const { t } = useLanguage();
  const wallet = status?.wallet;
  /* The ad-budget wallet matters only when HOMATCH pays Meta for the budget;
     otherwise the customer's own ad account pays and only the service
     balance applies. */
  const showAdWallet = status?.settings.budgetBilling === 'HOMATCH_WALLET' && wallet;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ServiceBalanceCard rows={status?.serviceBalance ?? []} feePercent={status?.settings.feePercent ?? null} />
      {showAdWallet && (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <p className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <Wallet className="h-4 w-4" aria-hidden="true" />{t('mads_balance_title')}
          </p>
          <p className="mt-3 font-display text-3xl font-bold tabular-nums" dir="ltr">{money(wallet.available_cents, wallet.currency || 'USD')}</p>
          <dl className="mt-3 space-y-1 text-[13px] text-muted-foreground tabular-nums">
            <div className="flex justify-between gap-3"><dt>{t('mads_balance_reserved')}</dt><dd dir="ltr">{money(wallet.reserved_cents, wallet.currency || 'USD')}</dd></div>
            <div className="flex justify-between gap-3"><dt>{t('mads_balance_spent')}</dt><dd dir="ltr">{money(wallet.spent_cents, wallet.currency || 'USD')}</dd></div>
          </dl>
        </div>
      )}
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
        <Link key={c.id} to={EDITABLE_STATUSES.includes(c.status) && !c.external_campaign_id ? `/outreach/meta/create?draft=${c.id}&step=review` : `/outreach/meta/campaigns/${c.id}`}
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

/* ── LEADS: import (the Leads Center lives in components/metaAds/workspace) ── */

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
  return <AccountPanel status={status} onChanged={onChanged} />;
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

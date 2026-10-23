// EMAIL STUDIO — Campaigns (/outreach/email/campaigns). Every campaign the owner has, by phase,
// searchable; open, duplicate, analytics, cancel. Existing campaigns (sent before Email Studio)
// appear here too and open read-only.

import { BarChart3, Copy, Loader2, Mail, MoreHorizontal, Plus, Search, XCircle } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CommsWorkspace } from '@/components/communications/CommsWorkspace';
import { EmptyState, ErrorState, PageHeader } from '@/components/communications/primitives';
import { PhaseBadge, pct } from '@/components/emailStudio/shared';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { type EmailPhase, emailPhase } from '@/emailMarketing/reviewState';
import { cn } from '@/lib/utils';
import { getCampaign, listCampaigns, type StudioCampaign, saveCampaign, setCampaignStatus } from '@/services/emailCampaignStudio';

const TABS: Array<{ key: string; phases: EmailPhase[] | null }> = [
  { key: 'all', phases: null },
  { key: 'drafts', phases: ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'] },
  { key: 'review', phases: ['READY_FOR_REVIEW', 'UNDER_REVIEW'] },
  { key: 'approved', phases: ['APPROVED', 'SCHEDULED'] },
  { key: 'sending', phases: ['SENDING', 'PAUSED'] },
  { key: 'sent', phases: ['SENT', 'PARTIALLY_SENT', 'FAILED', 'CANCELLED'] },
];

export default function EmailCampaignListPage() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((x) => x.key === params.get('tab')) ?? TABS[0];
  const [q, setQ] = useState(params.get('q') ?? '');
  const [rows, setRows] = useState<StudioCampaign[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try { setRows(await listCampaigns()); } catch { setError(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => Object.fromEntries(TABS.map((tb) => [tb.key, (rows ?? []).filter((r) => !tb.phases || tb.phases.includes(emailPhase(r.status))).length])), [rows]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => (!tab.phases || tab.phases.includes(emailPhase(r.status)))
      && (!needle || `${r.name} ${r.subject ?? ''}`.toLowerCase().includes(needle)));
  }, [rows, tab, q]);

  const setTab = (key: string) => { const n = new URLSearchParams(params); n.set('tab', key); setParams(n, { replace: true }); };

  const duplicate = async (c: StudioCampaign) => {
    setBusy(c.id);
    try {
      const full = await getCampaign(c.id);
      if (!full) throw new Error('missing');
      const copy = await saveCampaign(null, {
        name: `${full.name} (${t('ems_copy')})`.slice(0, 160), objective: full.objective, description: full.description, audience_note: full.audience_note ?? null,
        language: full.language, subject: full.subject, preview_text: full.preview_text, sender_name: full.sender_name, sender_email: full.sender_email,
        reply_to: full.reply_to, contact_list_ids: full.contact_list_ids?.length ? full.contact_list_ids : full.contact_list_id ? [full.contact_list_id] : [],
        audience_filter: full.audience_filter, ...(full.design ? { design: full.design } : {}),
      });
      toast.success(t('ems_duplicated'));
      navigate(`/outreach/email/campaigns/${copy.id}`);
    } catch { toast.error(t('ems_err_save_failed')); } finally { setBusy(null); }
  };
  const cancel = async (c: StudioCampaign) => {
    if (!window.confirm(t('ems_cancel_confirm'))) return;
    setBusy(c.id);
    try { await setCampaignStatus(c.id, 'CANCELLED'); await load(); } catch { toast.error(t('ems_err_status_failed')); } finally { setBusy(null); }
  };

  return (
    <CommsWorkspace product="email" header={
      <PageHeader eyebrow={t('dnav_email')} title={t('ems_nav_campaigns')} subtitle={t('ems_list_subtitle')}
        primary={{ label: t('ems_new_campaign'), onClick: () => navigate('/outreach/email/campaigns/new'), icon: Plus }} />
    }>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label={t('ems_nav_campaigns')}>
          {TABS.map((tb) => (
            <button key={tb.key} type="button" role="tab" aria-selected={tab.key === tb.key} onClick={() => setTab(tb.key)}
              className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px]', tab.key === tb.key ? 'bg-[#0C1119] text-white' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
              {t(`ems_tab_${tb.key}`)}
              <span className={cn('rounded-full px-1.5 text-2xs tabular-nums', tab.key === tb.key ? 'bg-white/15' : 'bg-muted')}>{rows ? counts[tb.key] : '·'}</span>
            </button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ems_search')} className="ps-8" aria-label={t('ems_search')} />
        </div>
      </div>

      {error ? <ErrorState messageKey="ems_load_failed" onRetry={() => void load()} /> : null}

      {rows === null ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
      ) : shown.length === 0 ? (
        <EmptyState icon={Mail} titleKey={rows.length ? 'ems_list_none_match' : 'ems_empty_title'} bodyKey={rows.length ? undefined : 'ems_empty_body'}
          action={{ labelKey: 'ems_new_campaign', onClick: () => navigate('/outreach/email/campaigns/new') }} />
      ) : (
        <ul className="space-y-2">
          {shown.map((c) => {
            const ph = emailPhase(c.status);
            const sent = c.sent_count ?? 0;
            return (
              <li key={c.id} className="flex flex-col gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-foreground/25 lg:flex-row lg:items-center">
                <button type="button" onClick={() => navigate(`/outreach/email/campaigns/${c.id}`)} className="w-full min-w-0 flex-1 text-start">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 text-[15px] font-semibold leading-snug [overflow-wrap:anywhere]">{c.name || t('ems_untitled')}</span>
                    <PhaseBadge status={c.status} />
                    {c.send_eligibility === 'LEGACY_MOCK' ? <span className="rounded-full bg-muted px-2 py-0.5 text-2xs text-muted-foreground">{t('ems_legacy')}</span> : null}
                  </div>
                  <p className="mt-0.5 text-[13px] text-muted-foreground [overflow-wrap:anywhere]">{c.subject || t('ems_no_subject')}</p>
                  <p className="mt-1 text-2xs text-muted-foreground">
                    {ph === 'SCHEDULED' && c.scheduled_at ? t('ems_scheduled_for', { when: new Date(c.scheduled_at).toLocaleString(lang) }) : t('ems_updated', { when: new Date(c.updated_at).toLocaleDateString(lang) })}
                  </p>
                </button>
                <dl className="grid shrink-0 grid-cols-3 gap-4 text-center text-2xs lg:w-64">
                  <div><dt className="text-muted-foreground">{t('ems_col_audience')}</dt><dd className="text-sm font-semibold tabular-nums">{c.audience_count ?? '—'}</dd></div>
                  <div><dt className="text-muted-foreground">{t('ems_col_accepted')}</dt><dd className="text-sm font-semibold tabular-nums">{sent || '—'}</dd></div>
                  <div><dt className="text-muted-foreground">{t('ems_col_delivered')}</dt><dd className="text-sm font-semibold tabular-nums">{sent ? pct((c.delivered_count ?? 0) / sent) : '—'}</dd></div>
                </dl>
                <div className="flex shrink-0 items-center gap-1">
                  {sent ? <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => navigate(`/outreach/email/analytics?campaign=${c.id}`)}><BarChart3 className="h-4 w-4" /><span className="sr-only sm:not-sr-only">{t('ems_analytics')}</span></Button> : null}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('ems_more_actions')} disabled={busy === c.id}>
                        {busy === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => void duplicate(c)}><Copy className="me-2 h-4 w-4" />{t('ems_duplicate')}</DropdownMenuItem>
                      {!['SENDING', 'SENT', 'PARTIALLY_SENT', 'CANCELLED'].includes(ph) ? (
                        <DropdownMenuItem onClick={() => void cancel(c)} className="text-red-700"><XCircle className="me-2 h-4 w-4" />{t('ems_cancel_campaign')}</DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </CommsWorkspace>
  );
}

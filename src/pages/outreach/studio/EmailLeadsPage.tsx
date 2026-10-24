// EMAIL STUDIO — Leads (UX pass §3): /outreach/email/contacts (leads) and /outreach/email/lists.
//
// One workspace answers, at a glance: how many leads, how many can receive email, who is
// unsubscribed or suppressed, which lists exist — and lets the owner add, import, edit, delete
// and select leads, alone or in bulk. Every count comes from my_email_contacts_overview (the same
// eligibility rules the send path applies). Each KPI is a filter; each list opens its leads. The
// URL carries the view (?status=&list=&q=), so a link from another screen lands on exactly it.
// Recording consent is explicit, per lead, with a lawful basis — never a side effect of adding.

import {
  BadgeCheck, CircleSlash, FolderPlus, Inbox, ListPlus, Loader2, Mail, MailX, Pencil, Search, ShieldAlert, ShieldCheck, Trash2, Upload, UserPlus, Users,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CommsWorkspace } from '@/components/communications/CommsWorkspace';
import { PageHeader } from '@/components/communications/primitives';
import { HomiHelp } from '@/components/emailStudio/HomiPanel';
import { LeadDialog, LeadStatusChip } from '@/components/emailStudio/LeadDialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  addLeadsToList, createList, deleteLeads, type Lead, leadsOverview, type LeadsOverview, type LeadStatus, listLeads, PRESELECT_KEY, recordConsent, renameList, unsubscribeLeads,
} from '@/services/emailLeads';
import type { LawfulBasis } from '@/services/emailMarketing';

const STATUSES: Array<LeadStatus | 'ALL'> = ['ALL', 'CAN_RECEIVE', 'CONSENT_MISSING', 'UNSUBSCRIBED', 'SUPPRESSED', 'NO_EMAIL'];
const PAGE = 50;
const BASES: LawfulBasis[] = ['CONSENT', 'CONTRACT', 'LEGITIMATE_INTEREST_EXISTING_CUSTOMER'];


export default function EmailLeadsPage() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const loc = useLocation();
  const [params, setParams] = useSearchParams();
  const tab: 'leads' | 'lists' = loc.pathname.endsWith('/lists') ? 'lists' : 'leads';
  const status = (STATUSES.includes(params.get('status') as LeadStatus) ? params.get('status') : 'ALL') as LeadStatus | 'ALL';
  const listId = params.get('list');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [page, setPage] = useState(0);
  const [overview, setOverview] = useState<LeadsOverview | null>(null);
  const [rows, setRows] = useState<Lead[] | null>(null);
  const [total, setTotal] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Lead | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bulk, setBulk] = useState<null | 'list' | 'consent' | 'unsubscribe' | 'delete'>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [targetList, setTargetList] = useState('');
  const [newList, setNewList] = useState('');
  const [basis, setBasis] = useState<LawfulBasis | ''>('');
  const [attest, setAttest] = useState(false);
  const [listDialog, setListDialog] = useState<null | { id?: string; name: string }>(null);

  const setParam = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v); else n.delete(k);
    setParams(n, { replace: true });
    setPage(0); setSel(new Set());
  };

  const loadOverview = useCallback(() => { void leadsOverview().then(setOverview).catch(() => setOverview(null)); }, []);
  const loadRows = useCallback(() => {
    setRows(null);
    void listLeads({ search: q, status, listId, page, pageSize: PAGE }).then((r) => { setRows(r.rows); setTotal(r.total); }).catch(() => { setRows([]); setTotal(0); });
  }, [q, status, listId, page]);
  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { if (tab !== 'leads') return; const h = window.setTimeout(loadRows, 200); return () => window.clearTimeout(h); }, [loadRows, tab]);
  const refresh = () => { loadOverview(); loadRows(); };

  const lists = overview?.lists ?? [];
  const listName = useMemo(() => new Map(lists.map((l) => [l.id, l.name])), [lists]);
  const ids = [...sel];
  const allOnPage = Boolean(rows?.length) && rows!.every((r) => sel.has(r.id));

  const runBulk = async () => {
    if (!bulk) return;
    setBulkBusy(true);
    try {
      if (bulk === 'list') {
        const dest = targetList === '__new__' ? (await createList(newList)).id : targetList;
        const r = await addLeadsToList(ids, dest);
        toast.success(t('ems_leads_added_to_list', { n: r.added, skipped: r.skipped }));
      } else if (bulk === 'consent') {
        if (!basis || !attest) return;
        const r = await recordConsent(ids, basis);
        toast[r.failed.length ? 'warning' : 'success'](t('ems_leads_consent_done', { ok: r.ok, failed: r.failed.length }));
      } else if (bulk === 'unsubscribe') {
        await unsubscribeLeads(ids);
        toast.success(t('ems_leads_unsubscribed', { n: ids.length }));
      } else if (bulk === 'delete') {
        const r = await deleteLeads(ids);
        toast[r.kept.length ? 'warning' : 'success'](r.kept.length ? t('ems_leads_deleted_kept', { n: r.deleted, kept: r.kept.length }) : t('ems_leads_deleted', { n: r.deleted }));
      }
      setSel(new Set()); setBulk(null); setBasis(''); setAttest(false); setTargetList(''); setNewList('');
      refresh();
    } catch { toast.error(t('ems_leads_bulk_failed')); } finally { setBulkBusy(false); }
  };

  const emailSelected = () => {
    try { sessionStorage.setItem(PRESELECT_KEY, JSON.stringify(ids.slice(0, 1000))); } catch { /* the campaign starts without a preselection */ }
    navigate('/outreach/email/campaigns/new?step=design&leads=session');
  };

  const kpis: Array<{ key: string; value: number | undefined; filter: LeadStatus | 'ALL'; icon: React.ComponentType<{ className?: string }>; tone?: string }> = [
    { key: 'ems_leads_k_total', value: overview?.total, filter: 'ALL', icon: Users },
    { key: 'ems_leads_k_can', value: overview?.canReceive, filter: 'CAN_RECEIVE', icon: ShieldCheck, tone: 'text-emerald-700' },
    { key: 'ems_leads_k_consent', value: overview?.consentMissing, filter: 'CONSENT_MISSING', icon: ShieldAlert, tone: 'text-amber-700' },
    { key: 'ems_leads_k_unsub', value: overview?.unsubscribed, filter: 'UNSUBSCRIBED', icon: MailX },
    { key: 'ems_leads_k_supp', value: overview?.suppressed, filter: 'SUPPRESSED', icon: CircleSlash, tone: 'text-red-700' },
  ];
  const helpFacts = overview ? `Leads: ${overview.total}; can receive email: ${overview.canReceive}; consent not recorded: ${overview.consentMissing}; unsubscribed: ${overview.unsubscribed}; suppressed: ${overview.suppressed}; invalid email: ${overview.invalidEmail}; lists: ${overview.lists.length}` : '';

  return (
    <CommsWorkspace product="email" header={
      <PageHeader eyebrow={t('dnav_email')} title={t('ems_leads_title')} subtitle={t('ems_leads_subtitle')}
        secondary={{ label: t('ems_import_contacts'), onClick: () => navigate('/outreach/email/contacts/import'), icon: Upload }}
        primary={{ label: t('ems_lead_add'), onClick: () => { setEditing(null); setDialogOpen(true); }, icon: UserPlus }}>
        <Button size="sm" variant="outline" className="h-9 gap-1.5 border-white/30 bg-transparent text-white hover:bg-white/10" onClick={() => setListDialog({ name: '' })}>
          <FolderPlus className="h-3.5 w-3.5" />{t('ems_leads_new_list')}
        </Button>
      </PageHeader>
    }>
      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5" aria-label={t('ems_leads_overview')}>
        {kpis.map(({ key, value, filter, icon: Icon, tone }) => (
          <button key={key} type="button" onClick={() => { if (tab !== 'leads') navigate(`/outreach/email/contacts${filter !== 'ALL' ? `?status=${filter}` : ''}`); else setParam('status', filter === 'ALL' ? null : filter); }}
            aria-pressed={tab === 'leads' && status === filter}
            className={cn('rounded-2xl border bg-card p-3.5 text-start transition-colors hover:border-[hsl(38_70%_60%)]', tab === 'leads' && status === filter && 'border-[#0C1119] ring-1 ring-[#0C1119]')}>
            <span className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground"><Icon className={cn('h-3.5 w-3.5', tone)} aria-hidden="true" />{t(key)}</span>
            <span className="mt-1 block font-display text-2xl font-bold tabular-nums">{value == null ? <Skeleton className="h-7 w-14" /> : value.toLocaleString(lang)}</span>
          </button>
        ))}
      </section>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 2xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <div className="inline-flex rounded-lg border bg-card p-0.5" role="tablist" aria-label={t('ems_leads_title')}>
            {(['leads', 'lists'] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => navigate(k === 'leads' ? '/outreach/email/contacts' : '/outreach/email/lists')}
                className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium', tab === k ? 'bg-[#0C1119] text-white' : 'text-muted-foreground hover:text-foreground')}>
                {k === 'leads' ? <Users className="h-3.5 w-3.5" /> : <Inbox className="h-3.5 w-3.5" />}{t(`ems_leads_tab_${k}`)}
                {k === 'lists' && overview ? <span className="rounded-full bg-white/20 px-1.5 text-2xs">{overview.lists.length}</span> : null}
              </button>
            ))}
          </div>

          {tab === 'leads' ? (
            <section className="rounded-2xl border bg-card">
              <div className="flex flex-wrap items-center gap-2 border-b p-3">
                <div className="relative min-w-0 flex-1 basis-60">
                  <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} onBlur={() => setParam('q', q.trim() || null)} placeholder={t('ems_leads_search')} className="ps-8" aria-label={t('ems_leads_search')} />
                </div>
                <Select value={status} onValueChange={(v) => setParam('status', v === 'ALL' ? null : v)}>
                  <SelectTrigger className="w-auto min-w-[11rem]" aria-label={t('ems_leads_col_status')}><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s === 'ALL' ? t('ems_leads_f_all') : t(`ems_lead_st_${s.toLowerCase()}`)}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={listId ?? '__all'} onValueChange={(v) => setParam('list', v === '__all' ? null : v)}>
                  <SelectTrigger className="w-auto min-w-[10rem] max-w-[16rem]" aria-label={t('ems_lead_list')}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">{t('ems_leads_all_lists')}</SelectItem>
                    {lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {sel.size ? (
                <div className="flex flex-wrap items-center gap-2 border-b bg-[hsl(38_90%_97%)] px-3 py-2 text-sm" role="region" aria-label={t('ems_leads_bulk')}>
                  <span className="me-auto font-medium">{t('ems_leads_selected', { n: sel.size })}</span>
                  <Button size="sm" className="h-8 gap-1.5 bg-[#0C1119] text-white hover:bg-[#1B2230]" onClick={emailSelected}><Mail className="h-3.5 w-3.5" />{t('ems_leads_email_these')}</Button>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setBulk('list')}><ListPlus className="h-3.5 w-3.5" />{t('ems_leads_to_list')}</Button>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setBulk('consent')}><BadgeCheck className="h-3.5 w-3.5" />{t('ems_lead_consent_record')}</Button>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setBulk('unsubscribe')}><MailX className="h-3.5 w-3.5" />{t('ems_leads_unsubscribe')}</Button>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-red-700" onClick={() => setBulk('delete')}><Trash2 className="h-3.5 w-3.5" />{t('ems_d_delete')}</Button>
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => setSel(new Set())}>{t('ems_leads_clear')}</Button>
                </div>
              ) : null}

              {rows === null ? <div className="space-y-2 p-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div> : rows.length === 0 ? (
                <div className="p-8 text-center">
                  <Users className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
                  <p className="mt-2 font-medium">{overview?.total ? t('ems_leads_none_match') : t('ems_leads_empty_title')}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{overview?.total ? t('ems_leads_none_match_sub') : t('ems_leads_empty_sub')}</p>
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    <Button className="gap-1.5" onClick={() => { setEditing(null); setDialogOpen(true); }}><UserPlus className="h-4 w-4" />{t('ems_lead_add')}</Button>
                    <Button variant="outline" className="gap-1.5" onClick={() => navigate('/outreach/email/contacts/import')}><Upload className="h-4 w-4" />{t('ems_import_contacts')}</Button>
                  </div>
                </div>
              ) : (
                <div className="relative w-full max-w-full overflow-x-auto">
                  <div className="min-w-[48rem]">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-2xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="w-10 p-2.5"><Checkbox className="min-h-0" aria-label={t('ems_leads_select_all')} checked={allOnPage} onCheckedChange={() => setSel((s) => { const n = new Set(s); if (allOnPage) rows.forEach((r) => n.delete(r.id)); else rows.forEach((r) => n.add(r.id)); return n; })} /></th>
                        <th className="p-2.5 text-start font-medium">{t('ems_leads_col_name')}</th>
                        <th className="p-2.5 text-start font-medium">{t('ems_leads_col_email')}</th>
                        <th className="p-2.5 text-start font-medium">{t('ems_leads_col_status')}</th>
                        <th className="p-2.5 text-start font-medium">{t('ems_lead_list')}</th>
                        <th className="p-2.5 text-start font-medium">{t('ems_leads_col_source')}</th>
                        <th className="p-2.5 text-start font-medium">{t('ems_leads_col_added')}</th>
                        <th className="w-10 p-2.5"><span className="sr-only">{t('ems_edit')}</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((l) => (
                        <tr key={l.id} className={cn('cursor-pointer border-t transition-colors hover:bg-muted/40', sel.has(l.id) && 'bg-[hsl(38_90%_97%)]')} onClick={() => { setEditing(l); setDialogOpen(true); }}>
                          <td className="p-2.5" onClick={(e) => e.stopPropagation()}><Checkbox className="min-h-0" aria-label={l.full_name ?? l.email ?? ''} checked={sel.has(l.id)} onCheckedChange={() => setSel((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })} /></td>
                          <td className="min-w-[9rem] p-2.5"><span className="block font-medium">{l.full_name || '—'}</span>{l.company ? <span className="block text-2xs text-muted-foreground">{l.company}</span> : null}</td>
                          <td className="whitespace-nowrap p-2.5 text-[13px] text-foreground/80" dir="ltr">{l.email || '—'}</td>
                          <td className="p-2.5"><LeadStatusChip lead={l} /></td>
                          <td className="min-w-[8rem] p-2.5 text-[13px] text-muted-foreground">{(l.list_id && listName.get(l.list_id)) || '—'}</td>
                          <td className="min-w-[8rem] p-2.5 text-[13px] text-muted-foreground">{t(`ems_src_${(l.source_kind ?? 'import').toLowerCase()}`)}</td>
                          <td className="whitespace-nowrap p-2.5 text-[13px] text-muted-foreground">{new Date(l.created_at).toLocaleDateString(lang)}</td>
                          <td className="p-2.5"><Pencil className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>
              )}
              {rows && total > PAGE ? (
                <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
                  <span>{t('ems_leads_page', { from: page * PAGE + 1, to: Math.min(total, (page + 1) * PAGE), total })}</span>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" className="h-8" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>{t('ems_back')}</Button>
                    <Button size="sm" variant="outline" className="h-8" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>{t('ems_next')}</Button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : (
            <section className="grid gap-3 sm:grid-cols-2">
              {overview === null ? <Skeleton className="h-28 w-full" /> : lists.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-8 text-center sm:col-span-2">
                  <p className="font-medium">{t('ems_no_lists')}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t('ems_leads_lists_empty')}</p>
                  <Button className="mt-3 gap-1.5" onClick={() => setListDialog({ name: '' })}><FolderPlus className="h-4 w-4" />{t('ems_leads_new_list')}</Button>
                </div>
              ) : lists.map((l) => (
                <article key={l.id} className="flex flex-col rounded-2xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold [overflow-wrap:anywhere]">{l.name}</h3>
                      <p className="text-2xs text-muted-foreground">{t('ems_leads_list_created', { when: new Date(l.createdAt).toLocaleDateString(lang) })}</p>
                    </div>
                    <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={t('ems_leads_rename')} onClick={() => setListDialog({ id: l.id, name: l.name })}><Pencil className="h-3.5 w-3.5" /></Button>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-lg bg-muted/50 px-2.5 py-1.5"><dt className="text-2xs text-muted-foreground">{t('ems_leads_k_total')}</dt><dd className="font-semibold tabular-nums">{l.total.toLocaleString(lang)}</dd></div>
                    <div className="rounded-lg bg-emerald-50 px-2.5 py-1.5"><dt className="text-2xs text-emerald-800">{t('ems_leads_k_can')}</dt><dd className="font-semibold tabular-nums text-emerald-900">{l.canReceive.toLocaleString(lang)}</dd></div>
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" className="h-8" onClick={() => navigate(`/outreach/email/contacts?list=${l.id}`)}>{t('ems_leads_open_list')}</Button>
                    <Button size="sm" className="h-8 gap-1.5 bg-[#0C1119] text-white hover:bg-[#1B2230]" disabled={!l.canReceive} onClick={() => navigate(`/outreach/email/campaigns/new?step=design&list=${l.id}`)}><Mail className="h-3.5 w-3.5" />{t('ems_leads_email_list')}</Button>
                  </div>
                </article>
              ))}
            </section>
          )}
        </div>

        <aside className="grid min-w-0 content-start gap-3 sm:grid-cols-2 2xl:grid-cols-1">
          <HomiHelp context="leads" facts={helpFacts} questions={['ems_homi_l_consent', 'ems_homi_l_why', 'ems_homi_l_import']} />
          <div className="rounded-2xl border bg-card p-4 text-[13px] leading-relaxed text-muted-foreground">
            <p className="mb-1 flex items-center gap-1.5 font-semibold text-foreground"><ShieldCheck className="h-4 w-4 text-[hsl(32_60%_38%)]" />{t('ems_leads_rules_title')}</p>
            {t('ems_leads_rules')}
          </div>
        </aside>
      </div>

      <LeadDialog open={dialogOpen} onOpenChange={setDialogOpen} lead={editing} lists={lists} defaultListId={listId}
        onListCreated={() => loadOverview()} onSaved={(l) => { setEditing(editing ? l : null); refresh(); }} />

      <Dialog open={Boolean(listDialog)} onOpenChange={(o) => { if (!o) setListDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{listDialog?.id ? t('ems_leads_rename') : t('ems_leads_new_list')}</DialogTitle>
            <DialogDescription>{t('ems_leads_list_sub')}</DialogDescription>
          </DialogHeader>
          <Input autoFocus value={listDialog?.name ?? ''} maxLength={120} onChange={(e) => setListDialog((d) => (d ? { ...d, name: e.target.value } : d))} aria-label={t('ems_lead_list_new_ph')} placeholder={t('ems_lead_list_new_ph')} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setListDialog(null)}>{t('ems_cancel')}</Button>
            <Button disabled={!listDialog?.name.trim()} onClick={async () => {
              try { if (listDialog?.id) await renameList(listDialog.id, listDialog.name); else await createList(listDialog?.name ?? ''); setListDialog(null); loadOverview(); toast.success(t('ems_leads_list_saved')); }
              catch { toast.error(t('ems_leads_bulk_failed')); }
            }}>{t('ems_lead_save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(bulk)} onOpenChange={(o) => { if (!o) setBulk(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{bulk ? t(`ems_leads_bulk_${bulk}_title`, { n: sel.size }) : ''}</AlertDialogTitle>
            <AlertDialogDescription>{bulk ? t(`ems_leads_bulk_${bulk}_body`, { n: sel.size }) : ''}</AlertDialogDescription>
          </AlertDialogHeader>
          {bulk === 'list' ? (
            <div className="space-y-2">
              <Select value={targetList} onValueChange={setTargetList}>
                <SelectTrigger><SelectValue placeholder={t('ems_leads_pick_list')} /></SelectTrigger>
                <SelectContent>{lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}<SelectItem value="__new__">{t('ems_lead_list_new')}</SelectItem></SelectContent>
              </Select>
              {targetList === '__new__' ? <Input value={newList} maxLength={120} placeholder={t('ems_lead_list_new_ph')} onChange={(e) => setNewList(e.target.value)} aria-label={t('ems_lead_list_new')} /> : null}
            </div>
          ) : null}
          {bulk === 'consent' ? (
            <div className="space-y-2">
              <Select value={basis} onValueChange={(v) => setBasis(v as LawfulBasis)}>
                <SelectTrigger><SelectValue placeholder={t('ems_lead_basis_pick')} /></SelectTrigger>
                <SelectContent>{BASES.map((b) => <SelectItem key={b} value={b}>{t(`ems_basis_${b.toLowerCase()}`)}</SelectItem>)}</SelectContent>
              </Select>
              <label className="flex items-start gap-2 text-[13px] leading-snug"><Checkbox checked={attest} onCheckedChange={(v) => setAttest(v === true)} className="min-h-0 mt-0.5" /><span>{t('ems_leads_consent_attest_n', { n: sel.size })}</span></label>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{t('ems_cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkBusy || (bulk === 'list' && (!targetList || (targetList === '__new__' && !newList.trim()))) || (bulk === 'consent' && (!basis || !attest))}
              className={bulk === 'delete' ? 'bg-red-700 hover:bg-red-800' : undefined}
              onClick={(e) => { e.preventDefault(); void runBulk(); }}>
              {bulkBusy ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}{bulk ? t(`ems_leads_bulk_${bulk}_go`) : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CommsWorkspace>
  );
}

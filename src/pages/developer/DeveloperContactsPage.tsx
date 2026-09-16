import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Users, Plus, Search, Rows3, Columns3, Clock, Building2, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDebounce } from '@/hooks/use-debounce';
import { DeveloperShell } from '@/components/developer/DeveloperShell';
import {
  Panel, EmptyState, LoadingRows, ErrorState, TableScroll, Th, Td,
  StagePill, Money, relativeTime, formatMoney, formatNumber,
} from '@/components/developer/primitives';
import { Headline, Funnel } from '@/components/developer/visuals';
import { LeadDrawer } from '@/components/developer/LeadDrawer';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { listLeads, createLead, type LeadWithContact } from '@/services/developer/crm';
import { listProjects, listUnits } from '@/services/developer/inventory';
import { listLeadUnits } from '@/services/developer/crm';
import { devErrorText } from '@/services/developer/client';
import { PIPELINE_STAGES } from '@/services/developer/types';
import type { LeadStage, DevProject } from '@/services/developer/types';

/**
 * THE CRM.
 *
 * Two views over ONE set of rows (§44). The pipeline is a board of the same
 * leads the table lists; neither has its own store and neither can show a
 * number the other disagrees with.
 *
 * The board is deliberately NOT drag-and-drop. Three of the twelve columns —
 * Reservation, Contract, Sold — are set by the reservation and deal workflow
 * and refuse to be set any other way, so a card dragged into them would snap
 * back. An affordance that works for nine columns and silently fails for
 * three is worse than no affordance: stage is changed in the drawer, where
 * the reason for the change can be recorded with it.
 */

type View = 'pipeline' | 'table';

/** The columns a board shows. The workflow stages are included because a lead
 *  genuinely sits in them; they just cannot be dragged into. */
const BOARD_STAGES: LeadStage[] = [
  'NEW', 'QUALIFIED', 'CONTACTED', 'INTERESTED', 'VIEWING_SCHEDULED',
  'VIEWING_COMPLETED', 'NEGOTIATION', 'RESERVATION', 'CONTRACT', 'SOLD',
];

export default function DeveloperContactsPage() {
  const { t, lang: language } = useLanguage();
  const [params, setParams] = useSearchParams();
  const { workspace, can } = useDeveloperWorkspace();

  const [leads, setLeads] = useState<LeadWithContact[]>([]);
  /* Which apartments each buyer is on. "Which one?" is the first question
     anybody asks about a buyer, and the card could not answer it. */
  const [interest, setInterest] = useState<Map<string, string[]>>(new Map());
  const [projects, setProjects] = useState<DevProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('pipeline');
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>('ALL');
  const [overdueOnly, setOverdueOnly] = useState(params.get('overdue') === '1');
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const [creating, setCreating] = useState(params.get('new') === '1');

  const debouncedSearch = useDebounce(search, 250);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      const [rows, projectRows, unitRows] = await Promise.all([
        listLeads(workspace.id, {
          search: debouncedSearch || undefined,
          projectId: projectFilter === 'ALL' ? undefined : projectFilter,
          overdueOnly: overdueOnly || undefined,
          limit: 400,
        }),
        listProjects(workspace.id),
        listUnits(workspace.id, { limit: 5000, orderBy: 'unit_number' }),
      ]);
      setLeads(rows);
      setProjects(projectRows);

      /* The apartments behind each buyer. One request per buyer would be
         seventy on a real workspace, so the links are fetched in parallel and
         only for the rows this screen can show, then resolved against the one
         inventory read above rather than a lookup each. */
      const numbers = new Map(unitRows.rows.map((u) => [u.id, u.unit_number]));
      const pairs = await Promise.all(rows.slice(0, 60).map(async (lead) => {
        const links = await listLeadUnits(lead.id).catch(() => []);
        const labels = links
          .filter((l) => l.interest !== 'REJECTED')
          .map((l) => numbers.get(l.unit_id))
          .filter((n): n is string => Boolean(n));
        return [lead.id, labels] as const;
      }));
      setInterest(new Map(pairs));
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [workspace, debouncedSearch, projectFilter, overdueOnly]);

  useEffect(() => { void load(); }, [load]);

  /**
   * THE CRM'S OWN POSITION.
   *
   * Live is everything not won and not lost. Budget adds the TOP of each live
   * buyer's stated range — it is what this pipeline could be worth if every
   * one of them bought at their ceiling, which is a real number and is
   * labelled as the ceiling rather than as a forecast.
   */
  const crmSummary = useMemo(() => {
    const live = leads.filter((l) => !['SOLD', 'LOST'].includes(l.stage));
    const now = Date.now();
    const seen = (stages: LeadStage[]) => leads.filter((l) => stages.includes(l.stage)).length;
    return {
      live: live.length,
      won: leads.filter((l) => l.stage === 'SOLD').length,
      lost: leads.filter((l) => l.stage === 'LOST').length,
      overdue: live.filter(
        (l) => l.next_follow_up_at && new Date(l.next_follow_up_at).getTime() < now).length,
      budget: live.reduce((sum, l) => sum + Number(l.budget_max ?? l.budget_min ?? 0), 0),
      funnel: leads.length === 0 ? [] : [
        { label: t('dev_funnel_leads'), value: leads.length },
        {
          label: t('dev_funnel_viewings'),
          value: seen(['VIEWING_SCHEDULED', 'VIEWING_COMPLETED', 'NEGOTIATION',
            'RESERVATION', 'CONTRACT', 'PAYMENT_PENDING', 'SOLD']),
        },
        {
          label: t('dev_funnel_reserved'),
          value: seen(['RESERVATION', 'CONTRACT', 'PAYMENT_PENDING', 'SOLD']),
        },
        { label: t('dev_funnel_sold'), value: seen(['SOLD']) },
      ],
    };
  }, [leads, t]);

  const byStage = useMemo(() => {
    const map = new Map<LeadStage, LeadWithContact[]>();
    for (const stage of BOARD_STAGES) map.set(stage, []);
    for (const lead of leads) {
      if (lead.stage === 'LOST') continue;
      const list = map.get(lead.stage);
      if (list) list.push(lead);
    }
    return map;
  }, [leads]);

  const closeCreate = () => {
    setCreating(false);
    if (params.has('new')) { params.delete('new'); setParams(params, { replace: true }); }
  };

  return (
    <DeveloperShell
      title={t('dev_nav_contacts')}
      description={t('dev_contacts_subtitle')}
      requires="crm"
      actions={can('crm') ? (
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-2 h-4 w-4" />
          {t('dev_action_add_lead')}
        </Button>
      ) : undefined}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={t('dev_search_buyers')} aria-label={t('dev_search_buyers')}
            className="pl-8"
          />
        </div>

        {projects.length > 1 && (
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="w-auto min-w-[10rem]" aria-label={t('dev_filter_project')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('dev_all_projects')}</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button
          size="sm"
          variant={overdueOnly ? 'default' : 'outline'}
          onClick={() => setOverdueOnly((v) => !v)}
          aria-pressed={overdueOnly}
        >
          <Clock className="mr-1.5 h-3.5 w-3.5" />
          {t('dev_filter_overdue')}
        </Button>

        <div className="ml-auto flex items-center rounded-md border border-border p-0.5" role="group" aria-label={t('dev_view_mode')}>
          <button
            type="button" onClick={() => setView('pipeline')} aria-pressed={view === 'pipeline'}
            className={cn('flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors',
              view === 'pipeline' ? 'bg-muted font-semibold' : 'text-muted-foreground hover:text-foreground')}
          >
            <Columns3 className="h-3.5 w-3.5" aria-hidden="true" />
            {t('dev_view_pipeline')}
          </button>
          <button
            type="button" onClick={() => setView('table')} aria-pressed={view === 'table'}
            className={cn('flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors',
              view === 'table' ? 'bg-muted font-semibold' : 'text-muted-foreground hover:text-foreground')}
          >
            <Rows3 className="h-3.5 w-3.5" aria-hidden="true" />
            {t('dev_view_table')}
          </button>
        </div>
      </div>

      {!loading && !error && leads.length > 0 && (
        <Headline
          className="mb-6"
          metrics={[
            {
              label: t('dev_stat_live_pipeline'),
              value: formatNumber(crmSummary.live, language),
              hint: crmSummary.budget > 0
                ? `${formatMoney(crmSummary.budget, workspace?.default_currency, language)} ${t('dev_crm_budget_note')}`
                : undefined,
            },
            {
              label: t('dev_crm_needs_action'),
              value: formatNumber(crmSummary.overdue, language),
              tone: crmSummary.overdue > 0 ? 'attention' : undefined,
              hint: t('dev_crm_needs_action_hint'),
            },
            {
              label: t('dev_stat_sold'),
              value: formatNumber(crmSummary.won, language),
              hint: crmSummary.lost > 0
                ? `${formatNumber(crmSummary.lost, language)} ${t('dev_stage_lost').toLowerCase()}`
                : undefined,
            },
          ]}
        >
          <Funnel steps={crmSummary.funnel} />
        </Headline>
      )}

      {loading && <LoadingRows rows={8} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && leads.length === 0 && (
        <Panel>
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title={debouncedSearch || overdueOnly ? t('dev_no_matching_leads') : t('dev_empty_leads_title')}
            description={debouncedSearch || overdueOnly ? undefined : t('dev_empty_leads_body')}
            action={can('crm') && !debouncedSearch && !overdueOnly ? (
              <Button onClick={() => setCreating(true)}>
                <Plus className="mr-2 h-4 w-4" />{t('dev_action_add_lead')}
              </Button>
            ) : undefined}
          />
        </Panel>
      )}

      {!loading && !error && leads.length > 0 && view === 'pipeline' && (
        <div className="-mx-3 overflow-x-auto px-3 pb-2 sm:mx-0 sm:px-0">
          <div className="flex min-w-max gap-3">
            {BOARD_STAGES.map((stage) => {
              const items = byStage.get(stage) ?? [];
              return (
                <section
                  key={stage}
                  className="flex w-64 shrink-0 flex-col rounded-lg border border-border bg-card"
                  aria-labelledby={`dev-col-${stage}`}
                >
                  <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                    <h2 id={`dev-col-${stage}`} className="truncate text-xs font-semibold uppercase tracking-wider">
                      {t(`dev_stage_${stage.toLowerCase()}`)}
                    </h2>
                    <span className="shrink-0 tabular text-xs text-muted-foreground">{items.length}</span>
                  </header>
                  <ul className="flex-1 space-y-1.5 p-1.5">
                    {items.map((lead) => (
                      <li key={lead.id}>
                        <button
                          type="button"
                          onClick={() => setOpenLeadId(lead.id)}
                          className="w-full rounded-md border border-border bg-background p-2.5 text-left transition-colors hover:border-gold-border/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <p className="truncate text-sm font-medium">
                            {lead.contact?.full_name || lead.contact?.phone || t('dev_unnamed_buyer')}
                          </p>
                          {(lead.budget_min || lead.budget_max) && (
                            <p className="truncate text-2xs text-muted-foreground">
                              <Money amount={lead.budget_min} currency={lead.currency} />
                              {' – '}
                              <Money amount={lead.budget_max} currency={lead.currency} />
                            </p>
                          )}
                          {/* THE APARTMENTS. A buyer with no apartment against
                              them is a buyer nobody has matched yet, and that
                              is worth seeing at a glance too. */}
                          {(interest.get(lead.id) ?? []).length > 0 && (
                            <p className="mt-1.5 flex items-center gap-1 truncate text-2xs text-gold-ink">
                              <Building2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                              <span className="truncate tabular">
                                {(interest.get(lead.id) ?? []).slice(0, 3).join(', ')}
                              </span>
                            </p>
                          )}
                          <p className="mt-1.5 flex items-center justify-between gap-2 text-2xs text-muted-foreground">
                            <span className="truncate">{relativeTime(lead.last_activity_at, language)}</span>
                            {lead.next_follow_up_at
                              && new Date(lead.next_follow_up_at).getTime() < Date.now() && (
                              <span className="inline-flex shrink-0 items-center gap-1 text-amber-700 dark:text-amber-400">
                                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                                {t('dev_stat_overdue')}
                              </span>
                            )}
                          </p>
                        </button>
                      </li>
                    ))}
                    {items.length === 0 && (
                      <li className="px-2 py-4 text-center text-2xs text-muted-foreground">
                        {t('dev_column_empty')}
                      </li>
                    )}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {!loading && !error && leads.length > 0 && view === 'table' && (
        <Panel>
          <TableScroll>
            <table className="w-full text-sm" data-tabular>
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <Th>{t('dev_buyer')}</Th>
                  <Th>{t('dev_lead_phone')}</Th>
                  <Th>{t('dev_lead_stage')}</Th>
                  <Th>{t('dev_lead_source')}</Th>
                  <Th className="text-right">{t('dev_lead_budget')}</Th>
                  <Th>{t('dev_lead_follow_up')}</Th>
                  <Th>{t('dev_lead_last_activity')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leads.map((lead) => {
                  const overdue = lead.next_follow_up_at
                    && new Date(lead.next_follow_up_at) < new Date()
                    && !['LOST', 'SOLD'].includes(lead.stage);
                  return (
                    <tr
                      key={lead.id}
                      onClick={() => setOpenLeadId(lead.id)}
                      className="cursor-pointer transition-colors hover:bg-muted/40"
                    >
                      <Td className="font-medium">
                        {lead.contact?.full_name || t('dev_unnamed_buyer')}
                      </Td>
                      <Td className="tabular text-muted-foreground">{lead.contact?.phone ?? '—'}</Td>
                      <Td><StagePill stage={lead.stage} /></Td>
                      <Td className="text-muted-foreground">{lead.source ?? '—'}</Td>
                      <Td className="text-right">
                        {lead.budget_max ? <Money amount={lead.budget_max} currency={lead.currency} /> : '—'}
                      </Td>
                      <Td className={cn(overdue && 'text-amber-700 font-medium')}>
                        {lead.next_follow_up_at ? relativeTime(lead.next_follow_up_at, language) : '—'}
                      </Td>
                      <Td className="text-muted-foreground">
                        {relativeTime(lead.last_activity_at, language)}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}

      <LeadDrawer
        leadId={openLeadId}
        onClose={() => setOpenLeadId(null)}
        onChanged={() => { void load(); }}
      />

      <CreateLeadDialog
        open={creating}
        projects={projects}
        onClose={closeCreate}
        onCreated={(id) => { closeCreate(); void load(); setOpenLeadId(id); }}
      />
    </DeveloperShell>
  );
}

function CreateLeadDialog({
  open, projects, onClose, onCreated,
}: {
  open: boolean;
  projects: DevProject[];
  onClose: () => void;
  onCreated: (leadId: string) => void;
}) {
  const { t } = useLanguage();
  const { workspace } = useDeveloperWorkspace();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [projectId, setProjectId] = useState<string>('NONE');
  const [source, setSource] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setFullName(''); setPhone(''); setEmail('');
      setProjectId(projects.length === 1 ? projects[0].id : 'NONE');
      setSource(''); setBudgetMax(''); setNotes('');
    }
  }, [open, projects]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!workspace || saving) return;
    if (!fullName.trim() && !phone.trim() && !email.trim()) {
      toast.error(t('dev_lead_need_something'));
      return;
    }
    setSaving(true);
    try {
      const id = await createLead(workspace.id, {
        fullName: fullName.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        projectId: projectId === 'NONE' ? null : projectId,
        source: source.trim() || null,
        budgetMax: budgetMax.trim() ? Number(budgetMax) : null,
        currency: workspace.default_currency,
        notes: notes.trim() || null,
      });
      toast.success(t('dev_lead_created'));
      onCreated(id);
    } catch (error) {
      toast.error(devErrorText(error, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('dev_action_add_lead')}</DialogTitle>
          <DialogDescription>{t('dev_lead_create_hint')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dev-l-name">{t('dev_lead_name')}</Label>
            <Input id="dev-l-name" value={fullName} onChange={(e) => setFullName(e.target.value)}
              autoFocus maxLength={160} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dev-l-phone">{t('dev_lead_phone')}</Label>
              <Input id="dev-l-phone" type="tel" inputMode="tel" value={phone}
                onChange={(e) => setPhone(e.target.value)} maxLength={40} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dev-l-email">{t('dev_lead_email')}</Label>
              <Input id="dev-l-email" type="email" value={email}
                onChange={(e) => setEmail(e.target.value)} maxLength={200} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dev-l-project">{t('dev_lead_project')}</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="dev-l-project"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">{t('dev_lead_no_project')}</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dev-l-source">{t('dev_lead_source')}</Label>
              <Input id="dev-l-source" value={source} onChange={(e) => setSource(e.target.value)}
                placeholder={t('dev_lead_source_placeholder')} maxLength={60} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dev-l-budget">{t('dev_lead_budget_max')}</Label>
            <Input id="dev-l-budget" inputMode="decimal" value={budgetMax}
              onChange={(e) => setBudgetMax(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dev-l-notes">{t('dev_unit_notes')}</Label>
            <Textarea id="dev-l-notes" rows={2} value={notes}
              onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          </div>

          {/* A buyer entered by a salesperson has not consented to marketing.
              Saying so here is cheaper than explaining it after a campaign. */}
          <p className="text-2xs text-muted-foreground">{t('dev_lead_consent_note')}</p>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>{t('dev_cancel')}</Button>
            <Button type="submit" disabled={saving}>
              {saving ? t('dev_saving') : t('dev_create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

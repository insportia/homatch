import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  X, Phone, MessageCircle, Mail, StickyNote, CalendarClock, CheckSquare,
  Home, FileText, KeyRound, Banknote, Share2, User, AlertTriangle, ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import {
  Panel, Fact, StagePill, EmptyState, LoadingRows, Eyebrow, GoldRule,
  formatDateTime, relativeTime, Money,
} from './primitives';
import {
  getLead, listActivities, addActivity, setLeadStage, recordDisposition,
  listTasks, createTask, completeTask, listViewings, scheduleViewing,
  reassignLead, type LeadWithContact,
} from '@/services/developer/crm';
import { listTeam } from '@/services/developer/workspace';
import { devErrorText } from '@/services/developer/client';
import {
  DISPOSITIONS, PIPELINE_STAGES, WORKFLOW_ONLY_STAGES,
} from '@/services/developer/types';
import type {
  DevActivity, DevTask, DevViewing, LeadStage, LostReason, DevMember,
} from '@/services/developer/types';

/**
 * ONE BUYER, ONE RECORD (§26).
 *
 * The timeline below is the whole argument for this product. A call placed
 * through Homatch's AI Calls stack, an email sent through its email stack, a
 * note a manager typed, a document somebody uploaded, a payment finance
 * confirmed, and the fact that this buyer opened the 3D tour twice last night
 * — all of it is dev_activities rows, in one column, in time order.
 *
 * CONTACTING SOMEBODY DOES NOT HAPPEN HERE (§27, §97, §100).
 *
 * The action bar hands off to the Communications product that already exists.
 * There is no second calling engine, no second WhatsApp integration and no
 * second email sender in this workstream — those are live products with their
 * own consent handling, their own provider routing and their own kill
 * switches, and a copy of any of them would be a copy that does not honour an
 * opt-out recorded in the original.
 *
 * WHICH IS WHY THE CONSENT FLAGS ARE ON SCREEN. A buyer who has asked not to
 * be called shows a disabled Call button with the reason next to it, rather
 * than an enabled one that fails somewhere else (§104).
 */

export interface LeadDrawerProps {
  leadId: string | null;
  onClose: () => void;
  onChanged: () => void;
}

export function LeadDrawer({ leadId, onClose, onChanged }: LeadDrawerProps) {
  const { t, lang: language } = useLanguage();
  const { workspace, can } = useDeveloperWorkspace();

  const [lead, setLead] = useState<LeadWithContact | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!leadId) { setLead(null); return; }
    setLoading(true);
    try {
      setLead(await getLead(leadId));
    } catch (error) {
      toast.error(devErrorText(error, t));
      onClose();
    } finally {
      setLoading(false);
    }
  }, [leadId, onClose, t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!leadId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leadId, onClose]);

  if (!leadId) return null;

  const contact = lead?.contact;
  const name = contact?.full_name || contact?.phone || t('dev_unnamed_buyer');

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button" aria-label={t('dev_close')} onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
      />
      <aside
        role="dialog" aria-modal="true" aria-label={name}
        className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-border bg-background shadow-2xl"
      >
        <header className="shrink-0 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Eyebrow>{t('dev_buyer')}</Eyebrow>
              <h2 className="mt-1 truncate text-xl font-semibold tracking-tight">{name}</h2>
              {contact?.phone && (
                <p className="truncate text-xs text-muted-foreground tabular">{contact.phone}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {lead && <StagePill stage={lead.stage} />}
              <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('dev_close')}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {lead && contact && <ActionBar lead={lead} onLogged={load} />}
        </header>

        {loading && <LoadingRows rows={6} />}

        {!loading && lead && (
          <Tabs defaultValue="timeline" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="mx-4 mt-3 w-[calc(100%-2rem)] justify-start overflow-x-auto sm:mx-5 sm:w-[calc(100%-2.5rem)]">
              <TabsTrigger value="timeline">{t('dev_tab_timeline')}</TabsTrigger>
              <TabsTrigger value="details">{t('dev_tab_details')}</TabsTrigger>
              <TabsTrigger value="tasks">{t('dev_tab_tasks')}</TabsTrigger>
              <TabsTrigger value="viewings">{t('dev_tab_viewings')}</TabsTrigger>
            </TabsList>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              <TabsContent value="timeline" className="mt-0">
                <TimelineTab lead={lead} language={language} onChanged={() => { void load(); onChanged(); }} />
              </TabsContent>
              <TabsContent value="details" className="mt-0">
                <DetailsTab lead={lead} canEdit={can('crm')} canReassign={can('crm_all')}
                  onChanged={() => { void load(); onChanged(); }} />
              </TabsContent>
              <TabsContent value="tasks" className="mt-0">
                <TasksTab leadId={lead.id} language={language} />
              </TabsContent>
              <TabsContent value="viewings" className="mt-0">
                <ViewingsTab lead={lead} language={language} onChanged={() => { void load(); onChanged(); }} />
              </TabsContent>
            </div>
          </Tabs>
        )}
      </aside>
    </div>
  );
}

/**
 * The action bar. Each button hands the buyer's details to the Communications
 * product that owns that channel, and records on the timeline that it did.
 */
function ActionBar({ lead, onLogged }: { lead: LeadWithContact; onLogged: () => void }) {
  const { t } = useLanguage();
  const { workspace } = useDeveloperWorkspace();
  const contact = lead.contact;
  if (!contact || !workspace) return null;

  const log = async (kind: 'CALL' | 'WHATSAPP' | 'EMAIL', title: string) => {
    try {
      await addActivity(workspace.id, {
        leadId: lead.id, contactId: lead.contact_id, kind,
        provenance: 'HOMATCH', direction: 'OUT', title,
      });
      onLogged();
    } catch (error) {
      toast.error(devErrorText(error, t));
    }
  };

  const blocked = {
    call: contact.do_not_call || contact.do_not_contact,
    whatsapp: contact.whatsapp_opted_out || contact.do_not_contact,
    email: contact.unsubscribed || contact.suppressed || contact.do_not_contact,
  };

  const items = [
    {
      key: 'call', icon: Phone, labelKey: 'dev_action_call',
      available: Boolean(contact.phone), blocked: blocked.call,
      blockedKey: 'dev_blocked_call',
      // The AI Call Center, scoped to this contact. Homatch's own product,
      // not a second dialler.
      to: `/outreach/calls?contact=${contact.contact_id}`,
      onGo: () => log('CALL', t('dev_logged_call')),
    },
    {
      key: 'whatsapp', icon: MessageCircle, labelKey: 'dev_action_whatsapp',
      available: Boolean(contact.phone), blocked: blocked.whatsapp,
      blockedKey: 'dev_blocked_whatsapp',
      to: `/outreach/whatsapp/inbox?contact=${contact.contact_id}`,
      onGo: () => log('WHATSAPP', t('dev_logged_whatsapp')),
    },
    {
      key: 'email', icon: Mail, labelKey: 'dev_action_email',
      available: Boolean(contact.email), blocked: blocked.email,
      blockedKey: 'dev_blocked_email',
      to: `/outreach/email?contact=${contact.contact_id}`,
      onGo: () => log('EMAIL', t('dev_logged_email')),
    },
  ];

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {items.map((item) => {
        const Icon = item.icon;
        if (!item.available) return null;
        if (item.blocked) {
          return (
            <span
              key={item.key}
              className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground"
              title={t(item.blockedKey)}
            >
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              {t(item.blockedKey)}
            </span>
          );
        }
        return (
          <Button key={item.key} size="sm" variant="outline" asChild onClick={item.onGo}>
            <Link to={item.to}>
              <Icon className="mr-1.5 h-3.5 w-3.5" />
              {t(item.labelKey)}
            </Link>
          </Button>
        );
      })}
    </div>
  );
}

// ── Timeline ───────────────────────────────────────────────────────────────

const ACTIVITY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  NOTE: StickyNote, CALL: Phone, WHATSAPP: MessageCircle, EMAIL: Mail,
  VIEWING: CalendarClock, OFFER: FileText, RESERVATION: KeyRound,
  DOCUMENT: FileText, PAYMENT: Banknote, SHARE: Share2, TASK: CheckSquare,
  ASSIGNMENT: User, STAGE_CHANGE: Home, SYSTEM: Home, MEETING: CalendarClock, SMS: MessageCircle,
};

function TimelineTab({
  lead, language, onChanged,
}: { lead: LeadWithContact; language: string; onChanged: () => void }) {
  const { t } = useLanguage();
  const { workspace, can } = useDeveloperWorkspace();
  const [items, setItems] = useState<DevActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listActivities(lead.id));
    } catch (error) {
      toast.error(devErrorText(error, t));
    } finally {
      setLoading(false);
    }
  }, [lead.id, t]);

  useEffect(() => { void load(); }, [load]);

  const submitNote = async () => {
    if (!workspace || !note.trim()) return;
    setSaving(true);
    try {
      await addActivity(workspace.id, {
        leadId: lead.id, contactId: lead.contact_id, kind: 'NOTE',
        provenance: 'MANUAL', title: t('dev_note'), body: note.trim(),
      });
      setNote('');
      await load();
      onChanged();
    } catch (error) {
      toast.error(devErrorText(error, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {can('crm') && (
        <div className="space-y-2">
          <Label htmlFor="dev-note" className="sr-only">{t('dev_add_note')}</Label>
          <Textarea
            id="dev-note" rows={2} value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('dev_add_note')} maxLength={4000}
          />
          <div className="flex justify-end">
            <Button size="sm" disabled={!note.trim() || saving} onClick={submitNote}>
              {saving ? t('dev_saving') : t('dev_add_note')}
            </Button>
          </div>
        </div>
      )}

      {loading && <LoadingRows rows={4} />}
      {!loading && items.length === 0 && <EmptyState title={t('dev_timeline_empty')} />}

      {!loading && items.length > 0 && (
        <ol className="space-y-0">
          {items.map((item, index) => {
            const Icon = ACTIVITY_ICON[item.kind] ?? StickyNote;
            return (
              <li key={item.id} className="relative flex gap-3 pb-4">
                {index < items.length - 1 && (
                  <span aria-hidden="true" className="absolute left-[11px] top-6 h-full w-px bg-border" />
                )}
                <span className="relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-card">
                  <Icon className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <p className="text-sm font-medium">{item.title}</p>
                    {/* Provenance, because "who says so" is a different
                        question from "what happened" (§96). */}
                    <span className="text-2xs uppercase tracking-wider text-muted-foreground">
                      {t(`dev_prov_${item.provenance.toLowerCase()}`)}
                    </span>
                  </div>
                  {item.body && (
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</p>
                  )}
                  <time dateTime={item.occurred_at} title={formatDateTime(item.occurred_at, language)}
                    className="text-2xs text-muted-foreground">
                    {relativeTime(item.occurred_at, language)}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ── Details ────────────────────────────────────────────────────────────────

function DetailsTab({
  lead, canEdit, canReassign, onChanged,
}: { lead: LeadWithContact; canEdit: boolean; canReassign: boolean; onChanged: () => void }) {
  const { t, lang: language } = useLanguage();
  const { workspace } = useDeveloperWorkspace();
  const [team, setTeam] = useState<DevMember[]>([]);
  const [stage, setStage] = useState<LeadStage>(lead.stage);
  const [lostReason, setLostReason] = useState<LostReason | ''>('');
  const [lostNote, setLostNote] = useState('');
  const [disposition, setDisposition] = useState(lead.disposition ?? '');

  useEffect(() => {
    if (!workspace) return;
    listTeam(workspace.id).then(setTeam).catch(() => {
      // The roster is a convenience on this tab; the rest of it still works
      // without it, and the failure is already reported by the service layer.
    });
  }, [workspace]);

  const applyStage = async (next: LeadStage) => {
    if (WORKFLOW_ONLY_STAGES.includes(next)) return;
    if (next === 'LOST' && !lostReason) { setStage('LOST'); return; }
    try {
      await setLeadStage(lead.id, next, next === 'LOST' ? (lostReason as LostReason) : null,
        next === 'LOST' ? lostNote.trim() || null : null);
      toast.success(t('dev_saved'));
      onChanged();
    } catch (error) {
      toast.error(devErrorText(error, t));
    }
  };

  const applyDisposition = async (value: string) => {
    if (!workspace) return;
    setDisposition(value);
    try {
      await recordDisposition(workspace.id, lead.id, value);
      onChanged();
    } catch (error) {
      toast.error(devErrorText(error, t));
    }
  };

  const contact = lead.contact;

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label={t('dev_lead_source')} value={lead.source ?? '—'} />
        <Fact label={t('dev_lead_created')} value={formatDateTime(lead.created_at, language)} />
        <Fact label={t('dev_lead_budget')} value={
          lead.budget_min || lead.budget_max ? (
            <>
              <Money amount={lead.budget_min} currency={lead.currency} />
              {' – '}
              <Money amount={lead.budget_max} currency={lead.currency} />
            </>
          ) : '—'
        } />
        <Fact label={t('dev_lead_language')} value={contact?.language?.toUpperCase() ?? '—'} />
        <Fact label={t('dev_lead_email')} value={contact?.email ?? '—'} />
        <Fact label={t('dev_lead_last_activity')} value={relativeTime(lead.last_activity_at, language)} />
      </dl>

      {canEdit && (
        <section className="space-y-3">
          <div>
            <Eyebrow>{t('dev_lead_pipeline')}</Eyebrow>
            <GoldRule className="mt-2" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dev-lead-stage">{t('dev_lead_stage')}</Label>
              <Select
                value={stage}
                onValueChange={(v) => { setStage(v as LeadStage); void applyStage(v as LeadStage); }}
              >
                <SelectTrigger id="dev-lead-stage"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PIPELINE_STAGES.map((s) => (
                    <SelectItem
                      key={s} value={s}
                      // The three workflow stages appear so the current one can
                      // be displayed, and cannot be chosen (§24).
                      disabled={WORKFLOW_ONLY_STAGES.includes(s) && s !== lead.stage}
                    >
                      {t(`dev_stage_${s.toLowerCase()}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {WORKFLOW_ONLY_STAGES.includes(lead.stage) && (
                <p className="text-2xs text-muted-foreground">{t('dev_stage_workflow_note')}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dev-lead-disp">{t('dev_lead_disposition')}</Label>
              <Select value={disposition} onValueChange={applyDisposition}>
                <SelectTrigger id="dev-lead-disp">
                  <SelectValue placeholder={t('dev_lead_disposition_none')} />
                </SelectTrigger>
                <SelectContent>
                  {DISPOSITIONS.map((d) => (
                    <SelectItem key={d} value={d}>{t(`dev_disp_${d.toLowerCase()}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-2xs text-muted-foreground">{t('dev_disposition_hint')}</p>
            </div>
          </div>

          {stage === 'LOST' && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="space-y-1.5">
                <Label htmlFor="dev-lost-reason">{t('dev_lost_reason')}</Label>
                <Select value={lostReason} onValueChange={(v) => setLostReason(v as LostReason)}>
                  <SelectTrigger id="dev-lost-reason">
                    <SelectValue placeholder={t('dev_lost_reason_pick')} />
                  </SelectTrigger>
                  <SelectContent>
                    {(['PRICE', 'LOCATION', 'FINANCING', 'TIMING', 'COMPETITOR',
                      'UNIT_UNAVAILABLE', 'NO_RESPONSE', 'OTHER'] as LostReason[]).map((r) => (
                      <SelectItem key={r} value={r}>{t(`dev_lost_${r.toLowerCase()}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Textarea
                rows={2} value={lostNote} onChange={(e) => setLostNote(e.target.value)}
                placeholder={t('dev_lost_note')} maxLength={500}
                aria-label={t('dev_lost_note')}
              />
              <Button size="sm" disabled={!lostReason} onClick={() => applyStage('LOST')}>
                {t('dev_mark_lost')}
              </Button>
            </div>
          )}

          {canReassign && team.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="dev-lead-owner">{t('dev_lead_assigned')}</Label>
              <Select
                value={lead.assigned_to ?? ''}
                onValueChange={async (v) => {
                  try {
                    await reassignLead(lead.id, v);
                    toast.success(t('dev_reassigned'));
                    onChanged();
                  } catch (error) {
                    toast.error(devErrorText(error, t));
                  }
                }}
              >
                <SelectTrigger id="dev-lead-owner"><SelectValue placeholder={t('dev_unassigned')} /></SelectTrigger>
                <SelectContent>
                  {team.map((member) => (
                    <SelectItem key={member.user_id} value={member.user_id}>
                      {member.full_name || member.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ── Tasks ──────────────────────────────────────────────────────────────────

function TasksTab({ leadId, language }: { leadId: string; language: string }) {
  const { t } = useLanguage();
  const { workspace, can } = useDeveloperWorkspace();
  const [tasks, setTasks] = useState<DevTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      setTasks(await listTasks(workspace.id, { leadId }));
    } catch (error) {
      toast.error(devErrorText(error, t));
    } finally {
      setLoading(false);
    }
  }, [workspace, leadId, t]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!workspace || !title.trim()) return;
    try {
      await createTask(workspace.id, {
        lead_id: leadId, title: title.trim(),
        due_at: due ? new Date(`${due}T09:00:00`).toISOString() : null,
      });
      setTitle(''); setDue('');
      await load();
    } catch (error) {
      toast.error(devErrorText(error, t));
    }
  };

  if (loading) return <LoadingRows rows={3} />;

  return (
    <div className="space-y-4">
      {can('crm') && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[10rem] flex-1 space-y-1.5">
            <Label htmlFor="dev-task-title">{t('dev_task_title')}</Label>
            <Input id="dev-task-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dev-task-due">{t('dev_task_due')}</Label>
            <Input id="dev-task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <Button size="sm" disabled={!title.trim()} onClick={add}>{t('dev_add')}</Button>
        </div>
      )}

      {tasks.length === 0 ? (
        <EmptyState title={t('dev_tasks_empty')} />
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => {
            const overdue = task.status === 'OPEN' && task.due_at && new Date(task.due_at) < new Date();
            return (
              <li key={task.id}>
                <Panel className={cn('flex items-start gap-3 p-3', overdue && 'border-amber-600/40')}>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm', task.status === 'DONE' && 'line-through text-muted-foreground')}>
                      {task.title}
                    </p>
                    {task.due_at && (
                      <p className={cn('text-2xs', overdue ? 'text-amber-700' : 'text-muted-foreground')}>
                        {t('dev_task_due')}: {formatDateTime(task.due_at, language)}
                      </p>
                    )}
                  </div>
                  {task.status === 'OPEN' && can('crm') && (
                    <Button size="sm" variant="outline"
                      onClick={async () => { await completeTask(task.id); await load(); }}>
                      {t('dev_task_done')}
                    </Button>
                  )}
                </Panel>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Viewings ───────────────────────────────────────────────────────────────

function ViewingsTab({
  lead, language, onChanged,
}: { lead: LeadWithContact; language: string; onChanged: () => void }) {
  const { t } = useLanguage();
  const { workspace, can } = useDeveloperWorkspace();
  const [viewings, setViewings] = useState<DevViewing[]>([]);
  const [loading, setLoading] = useState(true);
  const [when, setWhen] = useState('');
  const [mode, setMode] = useState<'PHYSICAL' | 'VIRTUAL'>('PHYSICAL');

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      setViewings(await listViewings(workspace.id, { leadId: lead.id }));
    } catch (error) {
      toast.error(devErrorText(error, t));
    } finally {
      setLoading(false);
    }
  }, [workspace, lead.id, t]);

  useEffect(() => { void load(); }, [load]);

  const schedule = async () => {
    if (!workspace || !when) return;
    try {
      await scheduleViewing(workspace.id, {
        lead_id: lead.id,
        project_id: lead.project_id,
        scheduled_at: new Date(when).toISOString(),
        mode,
      });
      setWhen('');
      toast.success(t('dev_viewing_scheduled'));
      await load();
      onChanged();
    } catch (error) {
      toast.error(devErrorText(error, t));
    }
  };

  if (loading) return <LoadingRows rows={3} />;

  return (
    <div className="space-y-4">
      {can('crm') && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1 space-y-1.5">
            <Label htmlFor="dev-view-when">{t('dev_viewing_when')}</Label>
            <Input id="dev-view-when" type="datetime-local" value={when}
              onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dev-view-mode">{t('dev_viewing_mode')}</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as 'PHYSICAL' | 'VIRTUAL')}>
              <SelectTrigger id="dev-view-mode" className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PHYSICAL">{t('dev_viewing_physical')}</SelectItem>
                <SelectItem value="VIRTUAL">{t('dev_viewing_virtual')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" disabled={!when} onClick={schedule}>{t('dev_schedule')}</Button>
        </div>
      )}

      {viewings.length === 0 ? (
        <EmptyState icon={<CalendarClock className="h-7 w-7" />} title={t('dev_viewings_empty')} />
      ) : (
        <ul className="space-y-2">
          {viewings.map((v) => (
            <li key={v.id}>
              <Panel className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{formatDateTime(v.scheduled_at, language)}</p>
                    <p className="text-2xs text-muted-foreground">
                      {t(v.mode === 'VIRTUAL' ? 'dev_viewing_virtual' : 'dev_viewing_physical')}
                      {' · '}
                      {t(`dev_viewing_status_${v.status.toLowerCase()}`)}
                      {v.disposition && ` · ${v.disposition}`}
                    </p>
                  </div>
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

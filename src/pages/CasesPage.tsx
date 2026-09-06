// HOMATCH — "My Deals" (transaction_cases CRM UI).
//
// This is the first frontend surface for the transaction-case backend added
// in supabase/migrations/20260905222923_transaction_case_crm.sql — until
// this page, the DB schema, RLS policies, versioning triggers, and
// src/services/transactionCases.ts service layer existed with no way for a
// user to actually reach them. Deliberately scoped for a first pass:
// - Create / edit / delete a case; stage change; checklist; notes;
//   counterparty and offer fields; target closing date.
// - Version history is surfaced as a simple dated list (current_version +
//   timestamps from transaction_case_versions) — not a diff/"what changed"
//   view. That richer view, and any UI for transaction_case_events (an
//   activity/audit trail distinct from the version snapshots), are not
//   built yet.
// - No linking UI to an existing property/research_job row yet (the
//   columns exist and are nullable; a case created here always has
//   property_id/research_job_id = null). Wiring a "Track this deal" entry
//   point from PropertyDetailPage/VerifyPage is a natural next step, not
//   done in this pass.
// All data access goes through transactionCases.ts, which goes through
// ordinary RLS — no service-role bypass, consistent with the rest of the
// authenticated app.

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from '@/components/ui/sheet';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Briefcase, Plus, X, Trash2, History, Handshake } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  listTransactionCases, createTransactionCase, updateTransactionCase,
  deleteTransactionCase, listTransactionCaseVersions,
} from '@/services/transactionCases';
import type {
  TransactionCase, TransactionCaseStage, TransactionCaseChecklistItem,
  TransactionCaseVersion, TransactionCaseUpdatableFields,
} from '@/types/types';

const STAGES: TransactionCaseStage[] = [
  'DUE_DILIGENCE', 'OFFER_MADE', 'UNDER_CONTRACT', 'CLOSING', 'CLOSED', 'ABANDONED',
];

const STAGE_STYLE: Record<TransactionCaseStage, string> = {
  DUE_DILIGENCE: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  OFFER_MADE: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  UNDER_CONTRACT: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  CLOSING: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  CLOSED: 'bg-green-500/15 text-green-400 border-green-500/30',
  ABANDONED: 'bg-muted text-muted-foreground border-border',
};

function useStageLabel() {
  const { t } = useLanguage();
  const map: Record<TransactionCaseStage, string> = {
    DUE_DILIGENCE: t('cases_stage_due_diligence'),
    OFFER_MADE: t('cases_stage_offer_made'),
    UNDER_CONTRACT: t('cases_stage_under_contract'),
    CLOSING: t('cases_stage_closing'),
    CLOSED: t('cases_stage_closed'),
    ABANDONED: t('cases_stage_abandoned'),
  };
  return (s: TransactionCaseStage) => map[s];
}

function StageBadge({ stage }: { stage: TransactionCaseStage }) {
  const label = useStageLabel();
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap', STAGE_STYLE[stage])}>
      {label(stage)}
    </span>
  );
}

function NewCaseDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);

  const reset = () => setTitle('');

  const handleCreate = async () => {
    if (!homatchUser || !title.trim()) return;
    setLoading(true);
    try {
      await createTransactionCase({ user_id: homatchUser.id, title: title.trim() });
      toast.success(t('cases_toast_created'));
      reset();
      onCreated();
      onClose();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('cases_create_title')}</DialogTitle>
          <DialogDescription>{t('cases_page_subtitle')}</DialogDescription>
        </DialogHeader>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('cases_field_title_ph')}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cases_cancel')}</Button>
          <Button onClick={handleCreate} disabled={!title.trim() || loading}>
            {loading ? t('cases_creating') : t('cases_create_button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CaseDetailSheet({
  caseItem, onClose, onChanged,
}: {
  caseItem: TransactionCase | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<TransactionCase | null>(caseItem);
  const [newItem, setNewItem] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [versions, setVersions] = useState<TransactionCaseVersion[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const stageLabel = useStageLabel();

  useEffect(() => { setDraft(caseItem); setShowHistory(false); }, [caseItem]);

  useEffect(() => {
    if (!showHistory || !caseItem) return;
    listTransactionCaseVersions(caseItem.id).then(setVersions).catch(() => setVersions([]));
  }, [showHistory, caseItem]);

  if (!draft) return null;

  const patch = <K extends keyof TransactionCaseUpdatableFields>(field: K, value: TransactionCaseUpdatableFields[K]) => {
    setDraft((d) => (d ? { ...d, [field]: value } as TransactionCase : d));
  };

  const toggleChecklistItem = (idx: number) => {
    const next = draft.checklist.map((it, i) => (i === idx ? { ...it, done: !it.done } : it));
    patch('checklist', next);
  };
  const removeChecklistItem = (idx: number) => {
    patch('checklist', draft.checklist.filter((_, i) => i !== idx));
  };
  const addChecklistItem = () => {
    if (!newItem.trim()) return;
    const item: TransactionCaseChecklistItem = { label: newItem.trim(), done: false };
    patch('checklist', [...draft.checklist, item]);
    setNewItem('');
  };

  const handleSave = async () => {
    if (!caseItem) return;
    setSaving(true);
    try {
      await updateTransactionCase(caseItem.id, {
        title: draft.title,
        stage: draft.stage,
        counterparty_name: draft.counterparty_name,
        counterparty_contact: draft.counterparty_contact,
        offer_amount: draft.offer_amount,
        offer_currency: draft.offer_currency,
        target_closing_date: draft.target_closing_date,
        notes: draft.notes,
        checklist: draft.checklist,
      });
      toast.success(t('cases_toast_updated'));
      onChanged();
      onClose();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!caseItem) return;
    try {
      await deleteTransactionCase(caseItem.id);
      toast.success(t('cases_toast_deleted'));
      onChanged();
      onClose();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setConfirmDelete(false);
    }
  };

  return (
    <Sheet open={!!caseItem} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 break-words pe-6">
            <Handshake className="h-4 w-4 shrink-0 text-primary" />
            <span className="break-words">{draft.title}</span>
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">{t('cases_version_badge', { n: draft.current_version })}</span>
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setShowHistory((s) => !s)}>
              <History className="h-3 w-3 me-1" />{t('cases_history_title')}
            </Button>
          </div>
          {showHistory && (
            <div className="rounded-lg border border-border bg-secondary/30 p-2 space-y-1 max-h-40 overflow-y-auto">
              {versions.length === 0
                ? <p className="text-xs text-muted-foreground px-1">{t('cases_history_empty')}</p>
                : versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between text-xs px-1">
                    <span>{t('cases_history_entry', { n: v.version })}</span>
                    <span className="text-muted-foreground">{new Date(v.created_at).toLocaleString()}</span>
                  </div>
                ))}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('cases_field_title')}</label>
            <Input value={draft.title} onChange={(e) => patch('title', e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('cases_field_stage')}</label>
            <Select value={draft.stage} onValueChange={(v) => patch('stage', v as TransactionCaseStage)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => <SelectItem key={s} value={s}>{stageLabel(s)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t('cases_field_counterparty_name')}</label>
              <Input value={draft.counterparty_name ?? ''} onChange={(e) => patch('counterparty_name', e.target.value || null)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t('cases_field_counterparty_contact')}</label>
              <Input value={draft.counterparty_contact ?? ''} onChange={(e) => patch('counterparty_contact', e.target.value || null)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t('cases_field_offer_amount')}</label>
              <Input
                type="number"
                value={draft.offer_amount ?? ''}
                onChange={(e) => patch('offer_amount', e.target.value === '' ? null : Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t('cases_field_offer_currency')}</label>
              <Input
                value={draft.offer_currency ?? ''}
                onChange={(e) => patch('offer_currency', e.target.value.toUpperCase() || null)}
                maxLength={3}
                placeholder="USD"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('cases_field_target_closing_date')}</label>
            <Input
              type="date"
              value={draft.target_closing_date ?? ''}
              onChange={(e) => patch('target_closing_date', e.target.value || null)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('cases_field_checklist')}</label>
            <div className="space-y-1.5">
              {draft.checklist.length === 0 && (
                <p className="text-xs text-muted-foreground">{t('cases_checklist_empty')}</p>
              )}
              {draft.checklist.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Checkbox checked={item.done} onCheckedChange={() => toggleChecklistItem(idx)} />
                  <span className={cn('text-sm flex-1 break-words', item.done && 'line-through text-muted-foreground')}>
                    {item.label}
                  </span>
                  <button type="button" onClick={() => removeChecklistItem(idx)} className="text-muted-foreground hover:text-destructive shrink-0">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <Input
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                placeholder={t('cases_checklist_add_ph')}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(); } }}
              />
              <Button type="button" size="icon" variant="outline" onClick={addChecklistItem} disabled={!newItem.trim()}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t('cases_field_notes')}</label>
            <Textarea rows={3} value={draft.notes ?? ''} onChange={(e) => patch('notes', e.target.value || null)} />
          </div>
        </div>

        <SheetFooter className="mt-6 gap-2 sm:justify-between flex-row flex-wrap">
          <Button variant="outline" className="text-destructive hover:text-destructive border-destructive/30" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-3.5 w-3.5 me-1.5" />{t('cases_delete')}
          </Button>
          <Button onClick={handleSave} disabled={saving || !draft.title.trim()}>
            {saving ? t('cases_saving') : t('cases_save')}
          </Button>
        </SheetFooter>
      </SheetContent>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cases_delete_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('cases_delete_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cases_cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('cases_delete_confirm_go')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

function CaseCard({ item, onOpen }: { item: TransactionCase; onOpen: () => void }) {
  const { t } = useLanguage();
  const doneCount = item.checklist.filter((c) => c.done).length;
  return (
    <Card className="bg-card border-border cursor-pointer hover:border-primary/40 transition-colors" onClick={onOpen}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <StageBadge stage={item.stage} />
              {item.checklist.length > 0 && (
                <span className="text-[10px] text-muted-foreground">{doneCount}/{item.checklist.length}</span>
              )}
            </div>
            <p className="text-sm font-medium text-foreground break-words">{item.title}</p>
            {item.counterparty_name && (
              <p className="text-xs text-muted-foreground break-words">{item.counterparty_name}</p>
            )}
          </div>
          <div className="text-end shrink-0 space-y-0.5">
            {item.offer_amount != null && (
              <div className="text-sm font-medium">
                {item.offer_amount.toLocaleString()} {item.offer_currency ?? ''}
              </div>
            )}
            <div className="text-[10px] text-muted-foreground">
              {t('cases_updated_label')} {new Date(item.updated_at).toLocaleDateString()}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CasesPage() {
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const [cases, setCases] = useState<TransactionCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<TransactionCase | null>(null);

  const load = useCallback(async () => {
    if (!homatchUser) return;
    setLoading(true);
    try {
      setCases(await listTransactionCases(homatchUser.id));
    } finally {
      setLoading(false);
    }
  }, [homatchUser]);

  useEffect(() => { load(); }, [load]);

  return (
    <RouteGuard>
      <AppLayout>
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-foreground break-words flex items-center gap-2">
                <Briefcase className="h-5 w-5 text-primary shrink-0" />
                {t('cases_page_title')}
              </h1>
              <p className="text-sm text-muted-foreground break-words">{t('cases_page_subtitle')}</p>
            </div>
            <Button onClick={() => setNewOpen(true)} size="sm">
              <Plus className="h-4 w-4 me-1.5 shrink-0" />{t('cases_new_button')}
            </Button>
          </div>

          <div className="space-y-3">
            {loading
              ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
              : cases.length === 0
                ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Briefcase className="h-10 w-10 mx-auto opacity-30" />
                    <p className="mt-2 font-medium">{t('cases_empty_title')}</p>
                    <p className="text-sm">{t('cases_empty_desc')}</p>
                  </div>
                )
                : cases.map((c) => <CaseCard key={c.id} item={c} onOpen={() => setSelected(c)} />)}
          </div>
        </div>

        <NewCaseDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={load} />
        <CaseDetailSheet caseItem={selected} onClose={() => setSelected(null)} onChanged={load} />
      </AppLayout>
    </RouteGuard>
  );
}

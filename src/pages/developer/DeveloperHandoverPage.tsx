import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { KeySquare, Plus, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { DeveloperShell, SubNav } from '@/components/developer/DeveloperShell';
import { SalesContext } from '@/components/developer/SalesContext';
import {
  Panel, EmptyState, LoadingRows, ErrorState, TableScroll, Th, Td,
  formatDate, StatTile, formatNumber,
} from '@/components/developer/primitives';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { salesTabs } from './salesNav';
import {
  listHandovers, upsertHandover, listContracts,
  DEFAULT_HANDOVER_CHECKLIST, type HandoverRow, type ContractRow,
} from '@/services/developer/finance';
import { listTeam } from '@/services/developer/workspace';
import { devErrorText } from '@/services/developer/client';
import type { DevHandover, HandoverChecklistItem, DevMember } from '@/services/developer/types';

/**
 * HANDOVER — THE LAST THING THAT HAPPENS, AND THE EASIEST TO LOSE.
 *
 * Months after the money is finished, somebody has to meet a buyer at a door
 * with a set of keys. Nothing else in a sales system tracks that, which is
 * why it ends up in a spreadsheet nobody opens until a customer telephones.
 *
 * The checklist is per-handover jsonb rather than a table. A snagging list is
 * genuinely specific to how a company works — a relational model for it would
 * mean six joins to tick a box, and would still be wrong for the next
 * developer. The default list below is offered as a starting point a person
 * EDITS, never applied silently, because a tick-box nobody chose is a
 * tick-box nobody trusts.
 */
const STATUS_TONE: Record<DevHandover['status'], string> = {
  PENDING: 'border-border text-muted-foreground bg-muted/60',
  SCHEDULED: 'border-sky-600/40 text-sky-700 dark:text-sky-400 bg-sky-500/[0.07]',
  READY: 'border-gold-border text-gold-ink bg-gold/[0.08]',
  COMPLETED: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/[0.07]',
  CANCELLED: 'border-dashed border-border text-muted-foreground bg-transparent',
};

const STATUS_KEY: Record<DevHandover['status'], string> = {
  PENDING: 'dev_handover_status_pending',
  SCHEDULED: 'dev_handover_status_scheduled',
  READY: 'dev_handover_status_ready',
  COMPLETED: 'dev_handover_status_completed',
  CANCELLED: 'dev_handover_status_cancelled',
};

const STATUSES = Object.keys(STATUS_KEY) as DevHandover['status'][];

export default function DeveloperHandoverPage() {
  const { t, lang: language } = useLanguage();
  const { workspace, can } = useDeveloperWorkspace();

  const [rows, setRows] = useState<HandoverRow[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [team, setTeam] = useState<DevMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<HandoverRow | null>(null);
  const [adding, setAdding] = useState(false);

  const mayEdit = can('sale') || can('crm_all');

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      const [handovers, deals, members] = await Promise.all([
        listHandovers(workspace.id),
        listContracts(workspace.id),
        listTeam(workspace.id),
      ]);
      setRows(handovers);
      setContracts(deals);
      setTeam(members);
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => { void load(); }, [load]);

  const today = new Date().toISOString().slice(0, 10);

  const summary = useMemo(() => {
    const open = rows.filter((r) => ['PENDING', 'SCHEDULED', 'READY'].includes(r.status));
    return {
      open: open.length,
      overdue: open.filter((r) => r.target_date !== null && r.target_date < today).length,
      completed: rows.filter((r) => r.status === 'COMPLETED').length,
    };
  }, [rows, today]);

  /** Contracts that have no handover row yet — the only ones worth offering. */
  const available = useMemo(() => {
    const taken = new Set(rows.map((r) => r.deal_id));
    return contracts.filter((c) => !taken.has(c.id) && c.status !== 'CANCELLED');
  }, [rows, contracts]);

  return (
    <DeveloperShell
      title={t('dev_nav_sales')}
      description={t('dev_handover_subtitle')}
      tabs={<SubNav items={salesTabs(can)} />}
      actions={mayEdit && available.length > 0 ? (
        <Button type="button" size="sm" onClick={() => setAdding(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {t('dev_handover_add')}
        </Button>
      ) : undefined}
    >
      <SalesContext className="mb-6" />

      {loading && <LoadingRows rows={6} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && rows.length > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile label={t('dev_handover_open')} value={formatNumber(summary.open, language)} />
          <StatTile
            label={t('dev_handover_overdue')}
            value={formatNumber(summary.overdue, language)}
            tone={summary.overdue > 0 ? 'attention' : 'default'}
          />
          <StatTile
            label={t('dev_handover_status_completed')}
            value={formatNumber(summary.completed, language)}
            tone="good"
          />
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <Panel>
          <EmptyState
            icon={<KeySquare className="h-7 w-7" />}
            title={t('dev_handover_empty_title')}
            description={t(
              available.length > 0 ? 'dev_handover_empty_body' : 'dev_handover_empty_no_contracts',
            )}
            action={mayEdit && available.length > 0 ? (
              <Button type="button" size="sm" onClick={() => setAdding(true)}>
                {t('dev_handover_add')}
              </Button>
            ) : undefined}
          />
        </Panel>
      )}

      {!loading && !error && rows.length > 0 && (
        <Panel>
          <TableScroll>
            <table className="w-full text-sm" data-tabular>
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <Th>{t('dev_unit')}</Th>
                  <Th>{t('dev_project')}</Th>
                  <Th>{t('dev_contract_number')}</Th>
                  <Th>{t('dev_handover_target')}</Th>
                  <Th>{t('dev_handover_checklist')}</Th>
                  <Th>{t('dev_status')}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => {
                  const open = ['PENDING', 'SCHEDULED', 'READY'].includes(row.status);
                  const overdue = open && row.target_date !== null && row.target_date < today;
                  const done = row.checklist.filter((c) => c.done).length;
                  return (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <Td className="font-medium">{row.unit_number ?? '—'}</Td>
                      <Td className="text-muted-foreground">{row.project_name ?? '—'}</Td>
                      <Td className="text-muted-foreground">{row.contract_number ?? '—'}</Td>
                      <Td>
                        <span className={cn(overdue && 'font-medium text-amber-700 dark:text-amber-400')}>
                          {row.target_date ? formatDate(row.target_date, language) : '—'}
                        </span>
                        {overdue && (
                          <AlertTriangle className="ml-1 inline h-3 w-3 text-amber-600" aria-hidden="true" />
                        )}
                      </Td>
                      <Td className="text-muted-foreground">
                        {row.checklist.length > 0
                          ? `${formatNumber(done, language)} / ${formatNumber(row.checklist.length, language)}`
                          : '—'}
                      </Td>
                      <Td>
                        <span className={cn(
                          'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-2xs font-medium',
                          STATUS_TONE[row.status],
                        )}>
                          {t(STATUS_KEY[row.status])}
                        </span>
                        {row.actual_date && (
                          <span className="ml-2 text-2xs text-muted-foreground">
                            {formatDate(row.actual_date, language)}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <div className="flex justify-end">
                          <Button
                            type="button" variant="ghost" size="sm"
                            onClick={() => setEditing(row)}
                          >
                            {t(mayEdit ? 'dev_handover_manage' : 'dev_view')}
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}

      {(editing || adding) && workspace && (
        <HandoverDialog
          workspaceId={workspace.id}
          existing={editing}
          contracts={available}
          team={team}
          readOnly={!mayEdit}
          onClose={() => { setEditing(null); setAdding(false); }}
          onSaved={async () => { setEditing(null); setAdding(false); await load(); }}
        />
      )}
    </DeveloperShell>
  );
}

function HandoverDialog({
  workspaceId, existing, contracts, team, readOnly, onClose, onSaved,
}: {
  workspaceId: string;
  existing: HandoverRow | null;
  contracts: ContractRow[];
  team: DevMember[];
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [dealId, setDealId] = useState(existing?.deal_id ?? contracts[0]?.id ?? '');
  const [status, setStatus] = useState<DevHandover['status']>(existing?.status ?? 'PENDING');
  const [targetDate, setTargetDate] = useState(existing?.target_date ?? '');
  const [actualDate, setActualDate] = useState(existing?.actual_date ?? '');
  const [responsible, setResponsible] = useState(existing?.responsible ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [checklist, setChecklist] = useState<HandoverChecklistItem[]>(
    existing?.checklist?.length ? existing.checklist : DEFAULT_HANDOVER_CHECKLIST,
  );
  const [newItem, setNewItem] = useState('');
  const [saving, setSaving] = useState(false);

  const deal = existing
    ? null
    : contracts.find((c) => c.id === dealId) ?? null;

  /**
   * A default item's label is a translation KEY (they are our words); anything
   * a person typed is their own words and is shown verbatim. `t()` returns the
   * key back when it does not know it, which makes this safe either way.
   */
  function labelOf(item: HandoverChecklistItem): string {
    return item.label.startsWith('dev_handover_item_') ? t(item.label) : item.label;
  }

  function toggle(index: number) {
    if (readOnly) return;
    setChecklist((prev) => prev.map((c, i) => (i === index ? { ...c, done: !c.done } : c)));
  }

  function addItem() {
    const label = newItem.trim();
    if (!label) return;
    setChecklist((prev) => [...prev, { label, done: false }]);
    setNewItem('');
  }

  async function save() {
    const unitId = existing?.unit_id ?? deal?.unit_id;
    const targetDeal = existing?.deal_id ?? deal?.id;
    if (!unitId || !targetDeal) return;
    setSaving(true);
    try {
      await upsertHandover(workspaceId, {
        dealId: targetDeal,
        unitId,
        status,
        targetDate: targetDate || null,
        // Completing without a date would leave a record that says it happened
        // and cannot say when, so the day it was marked is the honest default.
        actualDate: status === 'COMPLETED'
          ? (actualDate || new Date().toISOString().slice(0, 10))
          : (actualDate || null),
        checklist,
        responsible: responsible || null,
        notes: notes.trim() || null,
      });
      toast.success(t('dev_handover_saved'));
      await onSaved();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setSaving(false);
    }
  }

  const done = checklist.filter((c) => c.done).length;
  const incomplete = done < checklist.length;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {existing?.unit_number
              ? t('dev_handover_dialog_title').replace('{unit}', existing.unit_number)
              : t('dev_handover_add')}
          </DialogTitle>
          <DialogDescription>{t('dev_handover_dialog_body')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!existing && (
            <div className="space-y-1.5">
              <Label htmlFor="ho-deal">{t('dev_handover_for_contract')}</Label>
              <Select value={dealId} onValueChange={setDealId}>
                <SelectTrigger id="ho-deal"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {contracts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {[c.unit_number, c.buyer_name, c.contract_number].filter(Boolean).join(' · ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ho-status">{t('dev_status')}</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as DevHandover['status'])}
                disabled={readOnly}
              >
                <SelectTrigger id="ho-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{t(STATUS_KEY[s])}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ho-responsible">{t('dev_handover_responsible')}</Label>
              <Select value={responsible} onValueChange={setResponsible} disabled={readOnly}>
                <SelectTrigger id="ho-responsible">
                  <SelectValue placeholder={t('dev_handover_unassigned')} />
                </SelectTrigger>
                <SelectContent>
                  {team.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.full_name || m.email || m.user_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ho-target">{t('dev_handover_target')}</Label>
              <Input
                id="ho-target" type="date" value={targetDate} disabled={readOnly}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ho-actual">{t('dev_handover_actual')}</Label>
              <Input
                id="ho-actual" type="date" value={actualDate} disabled={readOnly}
                onChange={(e) => setActualDate(e.target.value)}
              />
            </div>
          </div>

          <div className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">{t('dev_handover_checklist')}</Label>
              <span className="text-2xs text-muted-foreground">
                {done} / {checklist.length}
              </span>
            </div>
            <ul className="mt-2 space-y-2">
              {checklist.map((item, i) => (
                <li key={`${item.label}-${i}`} className="flex items-start gap-2">
                  <Checkbox
                    id={`ho-item-${i}`}
                    checked={item.done}
                    disabled={readOnly}
                    onCheckedChange={() => toggle(i)}
                    className="mt-0.5"
                  />
                  <label
                    htmlFor={`ho-item-${i}`}
                    className={cn(
                      'min-w-0 flex-1 text-sm',
                      item.done && 'text-muted-foreground line-through',
                    )}
                  >
                    {labelOf(item)}
                  </label>
                </li>
              ))}
            </ul>
            {!readOnly && (
              <div className="mt-3 flex gap-2">
                <Input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addItem(); }
                  }}
                  placeholder={t('dev_handover_add_item')}
                  aria-label={t('dev_handover_add_item')}
                />
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                  {t('dev_add')}
                </Button>
              </div>
            )}
          </div>

          {status === 'COMPLETED' && incomplete && (
            <p className="flex items-start gap-1.5 rounded-md border border-amber-600/40 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t('dev_handover_incomplete_warning')}
            </p>
          )}
          {status === 'COMPLETED' && !incomplete && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              {t('dev_handover_all_done')}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ho-notes">{t('dev_notes')}</Label>
            <Textarea
              id="ho-notes" rows={2} value={notes} disabled={readOnly}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t(readOnly ? 'dev_close' : 'dev_cancel')}
          </Button>
          {!readOnly && (
            <Button type="button" onClick={() => void save()} disabled={saving || !dealId}>
              {saving ? t('dev_saving') : t('dev_save')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, X } from 'lucide-react';
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
import { DeveloperShell, SubNav } from '@/components/developer/DeveloperShell';
import { SalesContext } from '@/components/developer/SalesContext';
import {
  Panel, PanelHeader, EmptyState, LoadingRows, ErrorState, formatDateTime,
} from '@/components/developer/primitives';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { salesTabs } from './salesNav';
import {
  listViewings, updateViewing, completeViewing, listLeads, type LeadWithContact,
} from '@/services/developer/crm';
import { devErrorText } from '@/services/developer/client';
import { DISPOSITIONS } from '@/services/developer/types';
import type { DevViewing } from '@/services/developer/types';

/**
 * VIEWINGS (§31).
 *
 * Grouped by day, with today first, because a sales manager opening this at
 * 9am is asking one question: what am I doing today.
 *
 * COMPLETING A VIEWING ASKS FOR ITS OUTCOME. That is the whole point of
 * recording viewings at all — a completed viewing with no disposition tells
 * nobody whether to call the buyer back, and it is the single most common
 * thing to lose between a showing and a CRM.
 */
export default function DeveloperViewingsPage() {
  const { t, lang: language } = useLanguage();
  const { workspace, can } = useDeveloperWorkspace();

  const [viewings, setViewings] = useState<DevViewing[]>([]);
  const [leads, setLeads] = useState<Map<string, LeadWithContact>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState<DevViewing | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      const from = new Date();
      from.setDate(from.getDate() - 30);
      const [rows, leadRows] = await Promise.all([
        listViewings(workspace.id, { from: from.toISOString() }),
        listLeads(workspace.id, { limit: 400 }),
      ]);
      setViewings(rows);
      setLeads(new Map(leadRows.map((l) => [l.id, l])));
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, DevViewing[]>();
    for (const v of viewings) {
      const day = v.scheduled_at.slice(0, 10);
      const list = map.get(day) ?? [];
      list.push(v);
      map.set(day, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [viewings]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <DeveloperShell
      title={t('dev_nav_sales')}
      description={t('dev_viewings_subtitle')}
      tabs={<SubNav items={salesTabs(can)} />}
      requires="crm"
    >
      <SalesContext className="mb-6" />

      {loading && <LoadingRows rows={5} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && viewings.length === 0 && (
        <Panel>
          <EmptyState
            icon={<CalendarClock className="h-7 w-7" />}
            title={t('dev_viewings_empty_title')}
            description={t('dev_viewings_empty_body')}
          />
        </Panel>
      )}

      {!loading && !error && grouped.length > 0 && (
        <div className="space-y-4">
          {grouped.map(([day, items]) => (
            <Panel key={day}>
              <PanelHeader
                title={
                  <span className={cn(day === today && 'text-gold-ink')}>
                    {day === today ? t('dev_today') : formatDateTime(`${day}T12:00:00`, language).split(',')[0]}
                  </span>
                }
                description={t('dev_n_viewings').replace('{n}', String(items.length))}
              />
              <ul className="divide-y divide-border">
                {items.map((v) => {
                  const lead = leads.get(v.lead_id);
                  const past = new Date(v.scheduled_at) < new Date();
                  return (
                    <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                      <time
                        dateTime={v.scheduled_at}
                        className="w-16 shrink-0 tabular text-sm font-semibold"
                      >
                        {new Date(v.scheduled_at).toLocaleTimeString(language, {
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </time>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {lead?.contact?.full_name || t('dev_unnamed_buyer')}
                        </p>
                        <p className="truncate text-2xs text-muted-foreground">
                          {t(v.mode === 'VIRTUAL' ? 'dev_viewing_virtual' : 'dev_viewing_physical')}
                          {' · '}
                          {t(`dev_viewing_status_${v.status.toLowerCase()}`)}
                          {v.disposition && ` · ${t(`dev_disp_${v.disposition.toLowerCase()}`)}`}
                        </p>
                      </div>
                      {can('crm') && v.status !== 'COMPLETED' && v.status !== 'CANCELLED' && (
                        <div className="flex shrink-0 gap-1.5">
                          <Button size="sm" onClick={() => setCompleting(v)}>
                            <Check className="mr-1.5 h-3.5 w-3.5" />
                            {t('dev_viewing_complete')}
                          </Button>
                          <Button
                            size="sm" variant="outline"
                            onClick={async () => {
                              try {
                                await updateViewing(v.id, { status: 'CANCELLED' });
                                await load();
                              } catch (error) {
                                toast.error(devErrorText(error, t));
                              }
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ))}
        </div>
      )}

      {completing && (
        <CompleteDialog
          viewing={completing}
          onClose={() => setCompleting(null)}
          onDone={() => { setCompleting(null); void load(); }}
        />
      )}
    </DeveloperShell>
  );
}

function CompleteDialog({
  viewing, onClose, onDone,
}: { viewing: DevViewing; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const { workspace } = useDeveloperWorkspace();
  const [disposition, setDisposition] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('dev_viewing_complete')}</DialogTitle>
          <DialogDescription>{t('dev_viewing_complete_hint')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dev-vw-disp">{t('dev_lead_disposition')}</Label>
            <Select value={disposition} onValueChange={setDisposition}>
              <SelectTrigger id="dev-vw-disp">
                <SelectValue placeholder={t('dev_lead_disposition_none')} />
              </SelectTrigger>
              <SelectContent>
                {DISPOSITIONS.map((d) => (
                  <SelectItem key={d} value={d}>{t(`dev_disp_${d.toLowerCase()}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dev-vw-notes">{t('dev_unit_notes')}</Label>
            <Textarea id="dev-vw-notes" rows={3} value={notes}
              onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('dev_cancel')}</Button>
          <Button
            disabled={!disposition || saving}
            onClick={async () => {
              if (!workspace) return;
              setSaving(true);
              try {
                await completeViewing(workspace.id, viewing, disposition, notes.trim() || null);
                toast.success(t('dev_viewing_completed'));
                onDone();
              } catch (error) {
                toast.error(devErrorText(error, t));
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? t('dev_saving') : t('dev_save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

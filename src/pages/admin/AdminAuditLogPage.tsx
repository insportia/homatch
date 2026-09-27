// HOMATCH Admin — Audit log.
//
// admin_audit_log had writers — settings changes, impersonation, contact
// reveals, announcements — and nothing that read it, which made it a record
// nobody could consult. This is the reader. Metadata is shown as the database
// returns it from admin_audit_log_list, which has already replaced any value
// whose key names a credential or a contact detail with "[redacted]", at any
// depth, so a writer that once stored a request body cannot leak it here.
import { ScrollText } from 'lucide-react';
import React from 'react';
import { humanize } from '@/admin/labels';
import {
  DateFilter, Empty, ErrorNote, FilterBar, IdChip, KV, PageHeader, Pager, SelectFilter,
  TextFilter, UserLine, When, dayAfter, dayStart, useQueryState,
} from '@/components/admin/control/AdminKit';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { listAudit, totalOf, type AuditRow } from '@/services/adminControl';

const LIMIT = 50;
const DEFAULTS = { admin: '', action: '', target: '', from: '', to: '' };

export default function AdminAuditLogPage() {
  const { t } = useLanguage();
  const [applied, setApplied] = useQueryState(DEFAULTS);
  const [draft, setDraft] = React.useState(applied);
  const [offset, setOffset] = React.useState(0);
  const [rows, setRows] = React.useState<AuditRow[]>([]);
  const [actions, setActions] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    listAudit({ ...applied, from: dayStart(applied.from), to: dayAfter(applied.to) }, LIMIT, offset)
      .then((r) => { if (live) { setRows(r.rows); setActions(r.actions ?? []); setError(null); } })
      .catch((e: unknown) => { if (live) { setRows([]); setError(e instanceof Error ? e.message : String(e)); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [applied, offset]);

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={t('admin_cc_audit_title')} subtitle={t('admin_cc_audit_subtitle')} />
      <FilterBar
        busy={loading}
        onApply={() => { setOffset(0); setApplied(draft); }}
        onReset={() => { setDraft(DEFAULTS); setOffset(0); setApplied(DEFAULTS); }}
        primary={<>
          <TextFilter label={t('admin_cc_admin')} value={draft.admin} placeholder={t('admin_cc_owner_placeholder')}
                      onChange={(v) => setDraft({ ...draft, admin: v })} />
          <SelectFilter label={t('admin_cc_action')} value={draft.action}
                        options={actions.map((a) => ({ value: a, label: humanize(a) }))}
                        onChange={(v) => setDraft({ ...draft, action: v })} />
          <TextFilter label={t('admin_cc_target')} value={draft.target} placeholder={t('admin_cc_target_placeholder')}
                      onChange={(v) => setDraft({ ...draft, target: v })} />
          <DateFilter label={t('admin_cc_created_from')} value={draft.from} onChange={(v) => setDraft({ ...draft, from: v })} />
        </>}
        more={<DateFilter label={t('admin_cc_created_to')} value={draft.to} onChange={(v) => setDraft({ ...draft, to: v })} />}
      />
      {error && <ErrorNote message={error} />}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <Empty>{t('admin_cc_no_audit')}</Empty>
          ) : (
            <ul>
              {rows.map((r) => (
                <li key={r.id} className="border-t border-border first:border-0">
                  <button type="button" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}
                          className="flex w-full flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-start hover:bg-accent/50">
                    <ScrollText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-[10rem] flex-1">
                      <span className="block truncate text-sm font-medium">{humanize(r.action)}</span>
                      <span className="block truncate text-2xs text-muted-foreground">
                        {r.admin?.email ?? t('admin_cc_system_actor')}{r.target?.email ? ` → ${r.target.email}` : ''}
                      </span>
                    </span>
                    <span className="text-2xs text-muted-foreground"><When at={r.created_at} /></span>
                  </button>
                  {open === r.id && (
                    <div className="space-y-2 border-t border-border bg-muted/30 px-4 py-3">
                      <KV rows={[
                        [t('admin_cc_admin'), r.admin ? <UserLine user={{ ...r.admin, full_name: null }} /> : <IdChip id={r.admin_ref} />],
                        [t('admin_cc_target'), r.target ? <UserLine user={r.target} /> : '—'],
                        [t('admin_cc_entity'), r.entity_type ? <span>{humanize(r.entity_type)} <IdChip id={r.entity_id} /></span> : '—'],
                        [t('admin_cc_created'), <When at={r.created_at} />],
                      ]} />
                      <pre dir="ltr" className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2 text-2xs">
                        {JSON.stringify(r.metadata ?? {}, null, 2)}
                      </pre>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Pager offset={offset} limit={LIMIT} total={totalOf(rows)} count={rows.length} onChange={setOffset} />
    </div>
  );
}

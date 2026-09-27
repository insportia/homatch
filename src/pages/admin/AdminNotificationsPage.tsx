// HOMATCH Admin — Notifications: what was sent, to whom, and what became of it.
//
// The questions an operator actually asks about a notification are all
// operational — was it created, was it pushed, did they read it, where does
// it lead, what is its dedupe key — and none of them needs its text. So the
// body is never fetched (admin_notifications_list does not select it), and a
// message notification does not even show its title: whatever a future writer
// puts there, a private conversation does not surface on this screen.
import { Bell, BellRing } from 'lucide-react';
import React from 'react';
import { humanize } from '@/admin/labels';
import {
  DateFilter, Empty, ErrorNote, FilterBar, IdChip, KV, PageHeader, Pager, SelectFilter,
  TextFilter, UserLine, When, dayAfter, dayStart, useQueryState,
} from '@/components/admin/control/AdminKit';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { listNotifications, totalOf, type NotificationRow } from '@/services/adminControl';

const LIMIT = 25;
const DEFAULTS = { type: '', recipient: '', read: '', pushed: '', from: '', to: '', id: '' };

export default function AdminNotificationsPage() {
  const { t } = useLanguage();
  const [applied, setApplied] = useQueryState(DEFAULTS);
  const [draft, setDraft] = React.useState(applied);
  const [offset, setOffset] = React.useState(0);
  const [rows, setRows] = React.useState<NotificationRow[]>([]);
  const [types, setTypes] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | null>(applied.id || null);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    listNotifications({
      type: applied.type, recipient: applied.recipient,
      read: applied.read as '' | 'read' | 'unread', pushed: applied.pushed as '' | 'yes' | 'no',
      from: dayStart(applied.from), to: dayAfter(applied.to), id: applied.id,
    }, LIMIT, offset)
      .then((r) => { if (live) { setRows(r.rows); setTypes(r.types ?? []); setError(null); } })
      .catch((e: unknown) => { if (live) { setRows([]); setError(e instanceof Error ? e.message : String(e)); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [applied, offset]);

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={t('admin_cc_notif_title')} subtitle={t('admin_cc_notif_subtitle')} />
      <FilterBar
        busy={loading}
        onApply={() => { setOffset(0); setApplied({ ...draft, id: '' }); }}
        onReset={() => { setDraft(DEFAULTS); setOffset(0); setApplied(DEFAULTS); }}
        primary={<>
          <TextFilter label={t('admin_cc_recipient')} value={draft.recipient} placeholder={t('admin_cc_owner_placeholder')}
                      onChange={(v) => setDraft({ ...draft, recipient: v })} />
          <SelectFilter label={t('admin_cc_type')} value={draft.type}
                        options={types.map((v) => ({ value: v, label: humanize(v) }))}
                        onChange={(v) => setDraft({ ...draft, type: v })} />
          <SelectFilter label={t('admin_cc_read_state')} value={draft.read}
                        options={[{ value: 'unread', label: t('admin_cc_unread') }, { value: 'read', label: t('admin_cc_read') }]}
                        onChange={(v) => setDraft({ ...draft, read: v })} />
          <SelectFilter label={t('admin_cc_push_state')} value={draft.pushed}
                        options={[{ value: 'yes', label: t('admin_cc_pushed') }, { value: 'no', label: t('admin_cc_not_pushed') }]}
                        onChange={(v) => setDraft({ ...draft, pushed: v })} />
        </>}
        more={<>
          <DateFilter label={t('admin_cc_created_from')} value={draft.from} onChange={(v) => setDraft({ ...draft, from: v })} />
          <DateFilter label={t('admin_cc_created_to')} value={draft.to} onChange={(v) => setDraft({ ...draft, to: v })} />
        </>}
      />
      <p className="text-xs text-muted-foreground">{t('admin_cc_notif_privacy')}</p>
      {error && <ErrorNote message={error} />}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <Empty>{t('admin_cc_no_notifications')}</Empty>
          ) : (
            <ul>
              {rows.map((n) => (
                <li key={n.id} className="border-t border-border first:border-0">
                  <button type="button" aria-expanded={open === n.id} onClick={() => setOpen(open === n.id ? null : n.id)}
                          className="flex w-full flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-start hover:bg-accent/50">
                    {n.pushed_at
                      ? <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label={t('admin_cc_pushed')} />
                      : <Bell className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" aria-label={t('admin_cc_not_pushed')} />}
                    <span className="min-w-[10rem] flex-1">
                      <span className="block truncate text-sm font-medium">{humanize(n.type)}</span>
                      <span className="block truncate text-2xs text-muted-foreground">{n.recipient?.email ?? '—'} · {new Date(n.created_at).toLocaleString()}</span>
                    </span>
                    <Badge variant={n.read ? 'outline' : 'default'} className="text-2xs">{n.read ? t('admin_cc_read') : t('admin_cc_unread')}</Badge>
                  </button>
                  {open === n.id && (
                    <div className="border-t border-border bg-muted/30 px-4 py-3">
                      <KV rows={[
                        [t('admin_cc_recipient'), <UserLine user={n.recipient} />],
                        [t('admin_cc_type'), `${humanize(n.type)}${n.kind && n.kind !== n.type ? ` · ${humanize(n.kind)}` : ''}`],
                        [t('admin_cc_title_field'), n.title ?? <span className="text-muted-foreground">{t('admin_cc_title_withheld')}</span>],
                        [t('admin_cc_priority'), humanize(n.priority)],
                        [t('admin_cc_created'), <When at={n.created_at} />],
                        [t('admin_cc_seen_at'), <When at={n.seen_at} />],
                        [t('admin_cc_read_at'), <When at={n.read_at} />],
                        [t('admin_cc_pushed_at'), <When at={n.pushed_at} />],
                        [t('admin_cc_entity'), n.entity_type ? <span>{humanize(n.entity_type)} <IdChip id={n.entity_id} /></span> : '—'],
                        [t('admin_cc_deep_link'), n.deep_link ? <code dir="ltr" className="text-2xs">{n.deep_link}</code> : '—'],
                        [t('admin_cc_dedupe_key'), n.dedupe_key ? <code dir="ltr" className="break-all text-2xs">{n.dedupe_key}</code> : '—'],
                        [t('admin_cc_internal_id'), <IdChip id={n.id} />],
                      ]} />
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

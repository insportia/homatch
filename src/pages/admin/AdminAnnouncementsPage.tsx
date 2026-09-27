// HOMATCH Admin — Announcements.
//
// Write one, read it back in every language it will be shown in, publish it,
// take it down. Each step is a SQL function that checks is_admin() and writes
// the audit log (migration 20260928220000), and publishing goes through the
// existing idempotent fan-out: pressing Publish twice, or again after an edit,
// tells nobody twice — and the confirmation says how many it actually added.
//
// Archiving hides the announcement from customers. It does not reach into
// anybody's inbox: notifications already delivered stay, with the text they
// were sent with.
import { Archive, ArchiveRestore, Eye, Megaphone, Pencil, Plus, Send } from 'lucide-react';
import React from 'react';
import { toast } from 'sonner';
import { Confirm, Empty, ErrorNote, Field, PageHeader, When, inputClass, useQueryState } from '@/components/admin/control/AdminKit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  listAnnouncements, publishAnnouncement, saveAnnouncement, setAnnouncementArchived,
  type AnnouncementRow, type LocaleText,
} from '@/services/adminControl';

const LOCALES = ['en', 'ka', 'ru', 'tr', 'ar', 'he'] as const;
type Locale = typeof LOCALES[number];
const RTL = new Set<Locale>(['ar', 'he']);

interface Draft { id: string | null; slug: string; title: LocaleText; body: LocaleText; deep_link: string; published: boolean }
const EMPTY: Draft = { id: null, slug: '', title: {}, body: {}, deep_link: '', published: false };

function stateOf(a: AnnouncementRow): 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' {
  if (a.archived_at) return 'ARCHIVED';
  return a.published_at ? 'PUBLISHED' : 'DRAFT';
}

export default function AdminAnnouncementsPage() {
  const { t } = useLanguage();
  const [query] = useQueryState({ slug: '' });
  const [rows, setRows] = React.useState<AnnouncementRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Draft | null>(null);
  const [previewing, setPreviewing] = React.useState<AnnouncementRow | null>(null);
  const [confirm, setConfirm] = React.useState<{ kind: 'publish' | 'archive' | 'restore'; a: AnnouncementRow } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    listAnnouncements()
      .then((r) => { setRows(r); setError(null); })
      .catch((e: unknown) => { setRows([]); setError(e instanceof Error ? e.message : String(e)); });
  }, []);
  React.useEffect(load, [load]);

  const label = (s: ReturnType<typeof stateOf>) =>
    s === 'DRAFT' ? t('admin_cc_ann_draft') : s === 'PUBLISHED' ? t('admin_cc_ann_published') : t('admin_cc_ann_archived');

  const act = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === 'publish') {
        const r = await publishAnnouncement(confirm.a.slug);
        toast.success(t('admin_cc_ann_published_toast', { added: r.newly_delivered, total: r.accounts }));
      } else {
        await setAnnouncementArchived(confirm.a.slug, confirm.kind === 'archive');
        toast.success(confirm.kind === 'archive' ? t('admin_cc_ann_archived_toast') : t('admin_cc_ann_restored_toast'));
      }
      setConfirm(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader
        title={t('admin_cc_ann_title')}
        subtitle={t('admin_cc_ann_subtitle')}
        actions={<Button size="sm" className="gap-1.5" onClick={() => setEditing(EMPTY)}><Plus className="h-4 w-4" aria-hidden="true" />{t('admin_cc_ann_new')}</Button>}
      />
      {error && <ErrorNote message={error} />}
      <Card>
        <CardContent className="p-0">
          {rows === null ? (
            <div className="space-y-2 p-3">{[0, 1].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <Empty>{t('admin_cc_ann_empty')}</Empty>
          ) : (
            <ul>
              {rows.map((a) => {
                const s = stateOf(a);
                return (
                  <li key={a.id} className={`flex flex-wrap items-start gap-3 border-t border-border px-4 py-3 first:border-0 ${query.slug === a.slug ? 'bg-accent/40' : ''}`}>
                    <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-[12rem] flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {a.title.en}
                        <Badge variant={s === 'PUBLISHED' ? 'default' : 'outline'} className="text-2xs">{label(s)}</Badge>
                      </p>
                      <p className="text-2xs text-muted-foreground">
                        <code dir="ltr">{a.slug}</code> · {t('admin_cc_ann_languages', { list: Object.keys(a.title).join(', ') })}
                        {a.published_at && <> · {t('admin_cc_ann_delivered', { delivered: a.delivered, read: a.read })}</>}
                      </p>
                      <p className="text-2xs text-muted-foreground">
                        {a.published_at ? <>{t('admin_cc_ann_published_at')} <When at={a.published_at} /></> : <>{t('admin_cc_created')} <When at={a.created_at} /></>}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => setPreviewing(a)}><Eye className="h-3.5 w-3.5" aria-hidden="true" />{t('admin_cc_ann_preview')}</Button>
                      {s !== 'ARCHIVED' && (
                        <Button size="sm" variant="ghost" className="h-8 gap-1"
                                onClick={() => setEditing({ id: a.id, slug: a.slug, title: a.title, body: a.body ?? {}, deep_link: a.deep_link ?? '', published: !!a.published_at })}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />{t('admin_cc_ann_edit')}
                        </Button>
                      )}
                      {s === 'DRAFT' && (
                        <Button size="sm" className="h-8 gap-1" onClick={() => setConfirm({ kind: 'publish', a })}><Send className="h-3.5 w-3.5" aria-hidden="true" />{t('admin_cc_ann_publish')}</Button>
                      )}
                      {s === 'PUBLISHED' && (
                        <>
                          <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setConfirm({ kind: 'publish', a })}><Send className="h-3.5 w-3.5" aria-hidden="true" />{t('admin_cc_ann_republish')}</Button>
                          <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setConfirm({ kind: 'archive', a })}><Archive className="h-3.5 w-3.5" aria-hidden="true" />{t('admin_cc_ann_archive')}</Button>
                        </>
                      )}
                      {s === 'DRAFT' && (
                        <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => setConfirm({ kind: 'archive', a })}><Archive className="h-3.5 w-3.5" aria-hidden="true" />{t('admin_cc_ann_archive')}</Button>
                      )}
                      {s === 'ARCHIVED' && (
                        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setConfirm({ kind: 'restore', a })}><ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />{t('admin_cc_ann_restore')}</Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {editing && <Editor draft={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {previewing && (
        <Dialog open onOpenChange={(v) => { if (!v) setPreviewing(null); }}>
          <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg">
            <DialogHeader><DialogTitle>{t('admin_cc_ann_preview')}</DialogTitle></DialogHeader>
            <Preview title={previewing.title} body={previewing.body ?? {}} deepLink={previewing.deep_link} />
          </DialogContent>
        </Dialog>
      )}

      <Confirm
        open={confirm !== null}
        onOpenChange={(v) => { if (!v) setConfirm(null); }}
        title={confirm?.kind === 'publish' ? t('admin_cc_ann_confirm_publish_title')
          : confirm?.kind === 'archive' ? t('admin_cc_ann_confirm_archive_title') : t('admin_cc_ann_confirm_restore_title')}
        description={confirm?.kind === 'publish' ? t('admin_cc_ann_confirm_publish_body')
          : confirm?.kind === 'archive' ? t('admin_cc_ann_confirm_archive_body') : t('admin_cc_ann_confirm_restore_body')}
        confirmLabel={confirm?.kind === 'publish' ? t('admin_cc_ann_publish')
          : confirm?.kind === 'archive' ? t('admin_cc_ann_archive') : t('admin_cc_ann_restore')}
        destructive={confirm?.kind === 'archive'}
        busy={busy}
        onConfirm={act}
      />
    </div>
  );
}

function Preview({ title, body, deepLink }: { title: LocaleText; body: LocaleText; deepLink: string | null }) {
  const { t } = useLanguage();
  const [loc, setLoc] = React.useState<Locale>('en');
  /* What a reader of this language will actually get: their own text, or the
     English when it was not written — which is the fallback the app applies. */
  const shownTitle = title[loc] || title.en || '';
  const shownBody = body[loc] || body.en || '';
  const fallback = !title[loc] && loc !== 'en';
  return (
    <div className="space-y-3">
      <Tabs value={loc} onValueChange={(v) => setLoc(v as Locale)}>
        <TabsList className="flex-wrap">{LOCALES.map((l) => <TabsTrigger key={l} value={l}>{l.toUpperCase()}</TabsTrigger>)}</TabsList>
      </Tabs>
      <div dir={RTL.has(loc) && !fallback ? 'rtl' : 'ltr'} className="rounded-lg border border-border bg-card p-3 shadow-sm">
        <p className="text-sm font-semibold">{shownTitle || '—'}</p>
        {shownBody && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{shownBody}</p>}
        {deepLink && <p className="mt-2 text-2xs text-primary" dir="ltr">{deepLink}</p>}
      </div>
      {fallback && <p className="text-2xs text-muted-foreground">{t('admin_cc_ann_fallback_note')}</p>}
    </div>
  );
}

function Editor({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage();
  const [d, setD] = React.useState<Draft>(draft);
  const [loc, setLoc] = React.useState<Locale>('en');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const slugOk = /^[a-z0-9][a-z0-9-]{2,63}$/.test(d.slug);
  const linkOk = d.deep_link === '' || /^\/[^/]/.test(d.deep_link);
  const titleOk = !!d.title.en?.trim();

  const save = async () => {
    setSaving(true);
    try {
      await saveAnnouncement({ id: d.id, slug: d.slug, title: d.title, body: d.body, deep_link: d.deep_link });
      toast.success(t('admin_cc_ann_saved'));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{d.id ? t('admin_cc_ann_edit') : t('admin_cc_ann_new')}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {error && <ErrorNote message={error} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('admin_cc_ann_slug')}>
              <input className={inputClass} dir="ltr" value={d.slug} disabled={d.published}
                     onChange={(e) => setD({ ...d, slug: e.target.value.toLowerCase() })} placeholder="mortgage-launch" />
              <span className="text-2xs text-muted-foreground">{d.published ? t('admin_cc_ann_slug_frozen') : t('admin_cc_ann_slug_hint')}</span>
            </Field>
            <Field label={t('admin_cc_ann_link')}>
              <input className={inputClass} dir="ltr" value={d.deep_link} placeholder="/mortgage"
                     onChange={(e) => setD({ ...d, deep_link: e.target.value })} />
              {!linkOk && <span className="text-2xs text-destructive">{t('admin_cc_ann_link_invalid')}</span>}
            </Field>
          </div>
          <Tabs value={loc} onValueChange={(v) => setLoc(v as Locale)}>
            <TabsList className="flex-wrap">
              {LOCALES.map((l) => <TabsTrigger key={l} value={l}>{l.toUpperCase()}{d.title[l]?.trim() ? ' ✓' : ''}</TabsTrigger>)}
            </TabsList>
          </Tabs>
          <div className="space-y-3" dir={RTL.has(loc) ? 'rtl' : 'ltr'}>
            <Field label={loc === 'en' ? t('admin_cc_ann_title_en') : t('admin_cc_ann_title_field')}>
              <input className={inputClass} value={d.title[loc] ?? ''} maxLength={200}
                     onChange={(e) => setD({ ...d, title: { ...d.title, [loc]: e.target.value } })} />
            </Field>
            <Field label={t('admin_cc_ann_body_field')}>
              <Textarea rows={4} value={d.body[loc] ?? ''} maxLength={2000}
                        onChange={(e) => setD({ ...d, body: { ...d.body, [loc]: e.target.value } })} />
            </Field>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('admin_cc_ann_preview')}</p>
            <Preview title={d.title} body={d.body} deepLink={d.deep_link || null} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>{t('admin_cc_cancel')}</Button>
            <Button onClick={save} disabled={saving || !slugOk || !linkOk || !titleOk}>{t('admin_cc_ann_save')}</Button>
          </div>
          {d.published && <p className="text-2xs text-muted-foreground">{t('admin_cc_ann_edit_published_note')}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

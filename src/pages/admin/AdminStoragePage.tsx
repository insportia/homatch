// HOMATCH — Admin: Storage Explorer.
//
// The question this page exists to answer is "what files does this account
// have?", and the reason it is a page rather than a Cloudflare tab is that
// Cloudflare cannot answer it. R2 can be browsed by key prefix and nothing
// else: no email, no registration date, no category, no size range. The
// index those questions are asked of is Postgres, and this is its face.
//
// TWO PANES, BECAUSE THERE ARE TWO QUESTIONS
//
//   Accounts  who is there, and how much do they have. Sourced from `users`
//             with objects LEFT JOINed, so an account that registered an
//             hour ago and uploaded nothing appears with 0 files — which
//             enumerating the bucket could never show, because no object and
//             no prefix exists until the first upload.
//   Files     the objects themselves, filtered every way an operator asks.
//
// ACCESS CONTROL IS NOT THIS FILE'S JOB
//
// Every query is a SECURITY DEFINER function that checks is_admin() inside
// itself, under the caller's own token. The admin route is a convenience;
// somebody calling the functions directly gets nothing back. And opening a
// private file goes through the same short-lived signed-read flow as every
// other reader, with the admin's read written to admin_audit_log — there is
// no permanent URL for a private object, for anyone.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { HardDrive, Search, RotateCcw, ExternalLink, FileText, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import {
  Kpi, KpiRow, LoadingBlock, EmptyState, ErrorState, ScrollTable,
} from '@/components/communications/primitives';
import {
  accountStorageSummary, formatBytes, openStorageObject,
  searchStorageAccounts, searchStorageObjects,
  type AccountStorageSummary, type StorageAccountRow, type StorageObjectRow,
} from '@/services/adminStorage';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

/** `ANY` rather than an empty string: a Select cannot hold an empty value. */
const ANY = 'ANY';
const nullIfAny = (v: string) => (v === ANY || v === '' ? null : v);

const CATEGORIES = [
  'property-photos', 'deal-room-documents', 'developer-documents',
  'developer-media', 'mortgage-documents', 'mortgage-offer-documents',
  'expat-attachments', 'generated-reports', 'voice-auditions', 'site-assets',
];

interface Filters {
  email: string;
  userId: string;
  registeredFrom: string;
  registeredTo: string;
  uploadedFrom: string;
  uploadedTo: string;
  category: string;
  entityType: string;
  entityId: string;
  contentType: string;
  visibility: string;
  lifecycle: string;
  provider: string;
  minKb: string;
  maxKb: string;
}

const EMPTY: Filters = {
  email: '', userId: '', registeredFrom: '', registeredTo: '',
  uploadedFrom: '', uploadedTo: '', category: ANY, entityType: '',
  entityId: '', contentType: '', visibility: ANY, lifecycle: ANY,
  provider: ANY, minKb: '', maxKb: '',
};

/** A date input gives a day; the filter wants the whole of that day. */
const startOf = (d: string) => (d ? new Date(`${d}T00:00:00.000Z`).toISOString() : null);
const endOf = (d: string) => (d ? new Date(`${d}T23:59:59.999Z`).toISOString() : null);
const kbToBytes = (v: string) => (v.trim() === '' ? null : Math.round(Number(v) * 1024));

export default function AdminStoragePage() {
  const { t } = useLanguage();

  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [accounts, setAccounts] = useState<StorageAccountRow[]>([]);
  const [objects, setObjects] = useState<StorageObjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<StorageObjectRow | null>(null);
  const [summary, setSummary] = useState<AccountStorageSummary | null>(null);
  const [opening, setOpening] = useState(false);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    setFilters((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [acc, objs] = await Promise.all([
        searchStorageAccounts({
          email: filters.email || null,
          userId: filters.userId || null,
          registeredFrom: startOf(filters.registeredFrom),
          registeredTo: endOf(filters.registeredTo),
          limit: 100,
        }),
        searchStorageObjects({
          email: filters.email || null,
          userId: filters.userId || null,
          category: nullIfAny(filters.category),
          entityType: filters.entityType || null,
          entityId: filters.entityId || null,
          contentType: filters.contentType || null,
          visibility: nullIfAny(filters.visibility),
          lifecycle: nullIfAny(filters.lifecycle),
          provider: nullIfAny(filters.provider),
          uploadedFrom: startOf(filters.uploadedFrom),
          uploadedTo: endOf(filters.uploadedTo),
          registeredFrom: startOf(filters.registeredFrom),
          registeredTo: endOf(filters.registeredTo),
          minBytes: kbToBytes(filters.minKb),
          maxBytes: kbToBytes(filters.maxKb),
          limit: 200,
        }),
      ]);
      setAccounts(acc);
      setObjects(objs);
    } catch {
      setError('storage_error');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // One load on arrival. Afterwards the operator drives it, because every
  // keystroke in an email box is not a query anybody wants to run.
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  const totals = useMemo(() => ({
    accounts: accounts.length,
    withFiles: accounts.filter((a) => a.object_count > 0).length,
    objects: objects.length,
    matched: objects[0]?.total_matched ?? 0,
    bytes: objects.reduce((sum, o) => sum + Number(o.byte_size ?? 0), 0),
  }), [accounts, objects]);

  const openAccount = async (row: StorageAccountRow) => {
    set('userId', row.user_id);
    try { setSummary(await accountStorageSummary(row.user_id)); }
    catch { setSummary(null); }
  };

  const open = async (row: StorageObjectRow) => {
    setOpening(true);
    try {
      const url = await openStorageObject(row.object_key);
      // A new tab, and the URL is never stored anywhere: it stops working in
      // two minutes and that is the point of it.
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error(t('storage_open_failed'));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-display text-xl font-bold tracking-tight">
            <HardDrive className="h-5 w-5 text-gold-ink" aria-hidden="true" />
            {t('storage_title')}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">{t('storage_subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" className="gap-1.5"
            onClick={() => { setFilters(EMPTY); setSummary(null); }}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />{t('storage_reset')}
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
            <Search className="h-3.5 w-3.5" aria-hidden="true" />{t('storage_search')}
          </Button>
        </div>
      </header>

      <KpiRow cols={4}>
        <Kpi labelKey="storage_accounts" value={totals.accounts} icon={Users} loading={loading} />
        <Kpi labelKey="storage_accounts_with_files" value={totals.withFiles} loading={loading} />
        <Kpi labelKey="storage_files" value={totals.matched || totals.objects}
          icon={FileText} loading={loading} />
        <Kpi labelKey="storage_total_bytes" value={formatBytes(totals.bytes)} loading={loading} />
      </KpiRow>

      {/* ── Filters ─────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="storage_search_email">
            <Input value={filters.email} onChange={(e) => set('email', e.target.value)}
              placeholder={t('storage_search_email')} />
          </Field>
          <Field label="storage_search_user_id">
            <Input value={filters.userId} onChange={(e) => set('userId', e.target.value)} />
          </Field>
          <Field label="storage_registered_from">
            <Input type="date" value={filters.registeredFrom}
              onChange={(e) => set('registeredFrom', e.target.value)} />
          </Field>
          <Field label="storage_registered_to">
            <Input type="date" value={filters.registeredTo}
              onChange={(e) => set('registeredTo', e.target.value)} />
          </Field>
          <Field label="storage_uploaded_from">
            <Input type="date" value={filters.uploadedFrom}
              onChange={(e) => set('uploadedFrom', e.target.value)} />
          </Field>
          <Field label="storage_uploaded_to">
            <Input type="date" value={filters.uploadedTo}
              onChange={(e) => set('uploadedTo', e.target.value)} />
          </Field>
          <Field label="storage_category">
            <Select value={filters.category} onValueChange={(v) => set('category', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t('storage_any')}</SelectItem>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="storage_file_type">
            <Input value={filters.contentType}
              onChange={(e) => set('contentType', e.target.value)} />
          </Field>
          <Field label="storage_entity_type">
            <Input value={filters.entityType} onChange={(e) => set('entityType', e.target.value)} />
          </Field>
          <Field label="storage_entity_id">
            <Input value={filters.entityId} onChange={(e) => set('entityId', e.target.value)} />
          </Field>
          <Field label="storage_visibility">
            <Select value={filters.visibility} onValueChange={(v) => set('visibility', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t('storage_any')}</SelectItem>
                {['PRIVATE', 'AUTHENTICATED', 'PUBLIC'].map((v) => (
                  <SelectItem key={v} value={v}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="storage_lifecycle">
            <Select value={filters.lifecycle} onValueChange={(v) => set('lifecycle', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t('storage_any')}</SelectItem>
                {['ACTIVE', 'PENDING', 'ORPHANED', 'DELETED'].map((v) => (
                  <SelectItem key={v} value={v}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="storage_provider">
            <Select value={filters.provider} onValueChange={(v) => set('provider', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t('storage_any')}</SelectItem>
                <SelectItem value="R2">R2</SelectItem>
                <SelectItem value="SUPABASE">SUPABASE</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="storage_min_size">
            <Input type="number" min={0} value={filters.minKb}
              onChange={(e) => set('minKb', e.target.value)} />
          </Field>
          <Field label="storage_max_size">
            <Input type="number" min={0} value={filters.maxKb}
              onChange={(e) => set('maxKb', e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      {error && <ErrorState messageKey={error} onRetry={() => void load()} />}

      {/* ── One account's summary ───────────────────────────────────── */}
      {summary?.account && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <span className="text-sm font-semibold">{summary.account.email}</span>
              <span className="text-2xs text-muted-foreground tabular-nums">
                {summary.account.user_id}
              </span>
              <span className="text-2xs text-muted-foreground">
                {t('storage_registered')}: {new Date(summary.account.registered_at)
                  .toISOString().slice(0, 10)}
              </span>
            </div>
            <div className="flex flex-wrap gap-4 text-xs">
              <span>{t('storage_total_objects')}: <b className="tabular-nums">
                {summary.totals.object_count}</b></span>
              <span>{t('storage_total_bytes')}: <b className="tabular-nums">
                {formatBytes(Number(summary.totals.total_bytes))}</b></span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {summary.by_category.length === 0
                ? <span className="text-2xs text-muted-foreground">{t('storage_none')}</span>
                : summary.by_category.map((c) => (
                  <Badge key={c.category ?? 'null'} variant="outline" className="text-2xs">
                    {c.category} · {c.object_count} · {formatBytes(Number(c.total_bytes))}
                  </Badge>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Accounts ────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('storage_accounts')}</h2>
        {loading ? <LoadingBlock rows={3} /> : accounts.length === 0 ? (
          <EmptyState icon={Users} titleKey="storage_no_accounts" />
        ) : (
          <ScrollTable minWidth={820}>
            <table className="w-full text-xs">
              <thead className="bg-secondary/60 text-muted-foreground">
                <tr>
                  <Th k="storage_account" />
                  <Th k="storage_registered" />
                  <Th k="storage_total_objects" right />
                  <Th k="storage_total_bytes" right />
                  <Th k="storage_categories_used" />
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.user_id}
                    className="cursor-pointer border-t border-border hover:bg-secondary/40"
                    onClick={() => void openAccount(a)}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{a.email}</div>
                      <div className="text-2xs text-muted-foreground tabular-nums">
                        {a.user_id}
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {a.registered_at.slice(0, 10)}
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">{a.object_count}</td>
                    <td className="px-3 py-2 text-end tabular-nums">
                      {formatBytes(Number(a.total_bytes))}
                    </td>
                    <td className="px-3 py-2">
                      {a.categories.length === 0
                        ? <span className="text-muted-foreground">{t('storage_none')}</span>
                        : a.categories.join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        )}
      </section>

      {/* ── Files ───────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('storage_files')}</h2>
        <p className="text-2xs text-muted-foreground">{t('storage_private_note')}</p>
        {loading ? <LoadingBlock rows={4} /> : objects.length === 0 ? (
          <EmptyState icon={FileText} titleKey="storage_no_files" />
        ) : (
          <ScrollTable minWidth={980}>
            <table className="w-full text-xs">
              <thead className="bg-secondary/60 text-muted-foreground">
                <tr>
                  <Th k="storage_account" />
                  <Th k="storage_category" />
                  <Th k="storage_filename" />
                  <Th k="storage_file_type" />
                  <Th k="storage_size" right />
                  <Th k="storage_uploaded" />
                  <Th k="storage_provider" />
                  <Th k="storage_lifecycle" />
                  <Th />
                </tr>
              </thead>
              <tbody>
                {objects.map((o) => (
                  <tr key={o.id} className="border-t border-border hover:bg-secondary/40">
                    <td className="px-3 py-2">
                      {o.owner_email ?? <span className="text-muted-foreground">
                        {t('storage_unresolved_owner')}</span>}
                    </td>
                    <td className="px-3 py-2">{o.category}</td>
                    <td className="max-w-[16rem] truncate px-3 py-2">
                      {o.original_filename ?? o.object_key.split('/').pop()}
                    </td>
                    <td className="px-3 py-2">{o.content_type ?? '—'}</td>
                    <td className="px-3 py-2 text-end tabular-nums">
                      {formatBytes(Number(o.byte_size))}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{o.created_at.slice(0, 10)}</td>
                    <td className="px-3 py-2">{o.provider}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-2xs">{o.lifecycle}</Badge>
                    </td>
                    <td className="px-3 py-2 text-end">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" className="h-7 text-2xs"
                          onClick={() => setSelected(o)}>
                          {t('storage_details')}
                        </Button>
                        <Button variant="secondary" size="sm" className="h-7 gap-1 text-2xs"
                          disabled={opening} onClick={() => void open(o)}>
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          {t('storage_open')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        )}
      </section>

      {/* ── One object's metadata ───────────────────────────────────── */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetTitle className="text-sm">{t('storage_details')}</SheetTitle>
          {selected && (
            <dl className="mt-4 space-y-3 text-xs">
              <Row k="storage_object_key" v={selected.object_key} mono />
              <Row k="storage_account" v={selected.owner_email ?? t('storage_unresolved_owner')} />
              <Row k="storage_filename" v={selected.original_filename ?? '—'} />
              <Row k="storage_category" v={selected.category ?? '—'} />
              <Row k="storage_entity_type" v={selected.entity_type ?? '—'} />
              <Row k="storage_entity_id" v={selected.entity_id ?? '—'} mono />
              <Row k="storage_file_type" v={selected.content_type ?? '—'} />
              <Row k="storage_size" v={formatBytes(Number(selected.byte_size))} />
              <Row k="storage_checksum" v={selected.checksum_sha256 ?? '—'} mono />
              <Row k="storage_visibility" v={selected.visibility} />
              <Row k="storage_lifecycle" v={selected.lifecycle} />
              <Row k="storage_provider" v={selected.provider} />
              <Row k="storage_uploaded" v={selected.created_at} />
              <Row
                k="storage_source"
                v={selected.source_bucket
                  ? `${selected.source_bucket}/${selected.source_path}`
                  : '—'}
                mono
              />
              <Row k="storage_verified" v={selected.verified_at ?? '—'} />
            </dl>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const { t } = useLanguage();
  return (
    <div className="space-y-1">
      <Label className="text-2xs text-muted-foreground">{t(label as TKey)}</Label>
      {children}
    </div>
  );
}

/** A column heading. The key is a PROP, not child text: a translation key
 *  sitting in JSX text is indistinguishable from a hardcoded English string,
 *  both to a reader and to the i18n audit. */
function Th({ k, right }: { k?: string; right?: boolean }) {
  const { t } = useLanguage();
  return (
    <th className={`px-3 py-2 font-medium ${right ? 'text-end' : 'text-start'}`}>
      {k ? t(k as TKey) : ''}
    </th>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  const { t } = useLanguage();
  return (
    <div>
      <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{t(k as TKey)}</dt>
      <dd className={`mt-0.5 break-all ${mono ? 'font-mono text-2xs' : ''}`}>{v}</dd>
    </div>
  );
}

// LEADS CRM — "Your Buyer Relationships".
//
// Every contact an owner unlocked, with its status, notes, follow-up and conversation,
// in one list (server-paginated, crm_list) and one drawer per entry (crm_entry_detail /
// crm_update). Route: /leads; /leads?entry=<uuid> opens that entry's drawer, which is
// where a CRM_FOLLOW_UP_DUE notification lands.
//
// WHAT IS NEVER HERE
//
//   - A phone number or an email address. The list and detail RPCs do not return them,
//     and the CSV export is an explicit allowlist (src/crm/model.ts buildCrmCsv).
//   - Inferred interest. Statuses move forward on facts (sent, delivered, replied) on
//     the server; INTERESTED and beyond are the owner's call.
//   - A model call. "Suggested Next Step" is a deterministic rule (src/crm/nextStep.ts).

import { CalendarClock, Download, Loader2, Mail, RefreshCw, Search, Users, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CrmEntryDrawer } from '@/components/crm/CrmEntryDrawer';
import { CrmEntryRow } from '@/components/crm/CrmEntryRow';
import {
  FIELD, GOLD_BUTTON, PANEL, SECONDARY_BUTTON, useCrmDateFormat,
} from '@/components/crm/ui';
import { CustomerSurface, EmptyState, PageHero } from '@/components/customer/surface';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  CRM_STATUSES, buildCrmCsv, emailStudioHref, parseEntryParam, statusLabelKey,
} from '@/crm/model';
import type { CrmStatus } from '@/crm/nextStep';
import { cn } from '@/lib/utils';
import { crmList, crmListAll, type CrmList, type CrmListItem } from '@/services/leadsCrm';

const PAGE_SIZE = 25;
type Filter = 'ALL' | CrmStatus;

export default function LeadsCrmPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const fmt = useCrmDateFormat();
  const [params, setParams] = useSearchParams();

  const [filter, setFilter] = useState<Filter>('ALL');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<CrmList | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Map<string, CrmListItem>>(new Map());
  const [exporting, setExporting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const requestSeq = useRef(0);

  const openEntryId = parseEntryParam(params.get('entry'));

  /* Debounced search: the server does the matching. */
  useEffect(() => {
    const id = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setFailed(false);
    try {
      const next = await crmList({
        status: filter === 'ALL' ? null : filter,
        search: search || null,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      if (seq !== requestSeq.current) return;
      setData(next);
      setNow(Date.now());
    } catch {
      if (seq === requestSeq.current) setFailed(true);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [filter, search, page]);

  useEffect(() => { void load(); }, [load]);

  const counts = data?.counts;
  const allCount = useMemo(
    () => (counts ? CRM_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0) : undefined),
    [counts],
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const openItem = openEntryId ? items.find((i) => i.entryId === openEntryId) ?? null : null;
  const hasAnyEntry = (allCount ?? 0) > 0;
  const filtered = filter !== 'ALL' || search.length > 0;

  const openEntry = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('entry', id);
    setParams(next, { replace: false });
  };
  const closeEntry = () => {
    const next = new URLSearchParams(params);
    next.delete('entry');
    setParams(next, { replace: true });
  };

  const toggle = (item: CrmListItem) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.entryId)) next.delete(item.entryId);
      else next.set(item.entryId, item);
      return next;
    });
  };

  const createEmailForSelected = () => {
    const href = emailStudioHref([...selected.values()].map((i) => ({ entryId: i.entryId, propertyId: i.propertyId })));
    if (href) navigate(href);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows = await crmListAll({ status: filter === 'ALL' ? null : filter, search: search || null });
      const csv = buildCrmCsv(rows, {
        headers: {
          name: t('crm_csv_name'),
          status: t('crm_csv_status'),
          property: t('crm_csv_property'),
          homatchId: t('crm_csv_homatch_id'),
          lastActivity: t('crm_csv_last_activity'),
          followUp: t('crm_csv_follow_up'),
        },
        statusLabel: (s) => t(statusLabelKey(s)),
        formatDate: fmt.dateTime,
        anonymous: t('crm_anonymous'),
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `homatch-buyer-relationships-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error(t('crm_export_failed'));
    } finally {
      setExporting(false);
    }
  };

  const chips: Array<{ value: Filter; label: string; count?: number }> = [
    { value: 'ALL', label: t('crm_filter_all'), count: allCount },
    ...CRM_STATUSES.map((s) => ({ value: s as Filter, label: t(statusLabelKey(s)), count: counts?.[s] })),
  ];

  return (
    <AppLayout noPadding surfaceClass="hm-customer hm-customer-canvas min-h-[calc(100dvh-4rem)]">
      <CustomerSurface className="max-w-6xl space-y-5 pt-5 sm:pt-8">
        <PageHero
          compact
          eyebrow={t('crm_eyebrow')}
          title={t('crm_headline')}
          subtitle={t('crm_description')}
          actions={hasAnyEntry ? (
            <button
              type="button"
              onClick={() => void exportCsv()}
              disabled={exporting || total === 0}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/25 bg-white/5 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
              {t('crm_export_csv')}
            </button>
          ) : null}
        />

        {/* ── Filters ─────────────────────────────────────────────────── */}
        <div className={cn(PANEL, 'space-y-3 p-3 sm:p-4')}>
          <label className="relative block">
            <span className="sr-only">{t('crm_search_label')}</span>
            <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(218_15%_46%)]" aria-hidden="true" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('crm_search_placeholder')}
              className={cn(FIELD, 'h-12 ps-10 pe-11')}
              dir="auto"
            />
            {searchInput ? (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="absolute end-1 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-[hsl(218_15%_40%)] hover:text-[hsl(218_45%_14%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]"
                aria-label={t('crm_search_clear')}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </label>
          <div
            role="group"
            aria-label={t('crm_filter_label')}
            className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [mask-image:linear-gradient(to_right,black_0,black_calc(100%_-_24px),transparent_100%)] rtl:[mask-image:linear-gradient(to_left,black_0,black_calc(100%_-_24px),transparent_100%)] sm:flex-wrap sm:overflow-visible sm:[mask-image:none]"
          >
            {chips.map((c) => {
              const on = c.value === filter;
              return (
                <button
                  key={c.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => { setFilter(c.value); setPage(0); }}
                  className={cn(
                    'inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors motion-reduce:transition-none',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)] focus-visible:ring-offset-1',
                    on
                      ? 'border-[hsl(218_45%_14%)] bg-[hsl(218_45%_14%)] text-white'
                      : 'border-[hsl(40_12%_84%)] bg-white text-[hsl(218_28%_30%)] hover:border-[hsl(38_60%_62%)]',
                  )}
                >
                  {c.label}
                  {c.count !== undefined ? (
                    <span className={cn('tabular-nums text-2xs font-semibold', on ? 'text-[hsl(40_94%_70%)]' : 'text-[hsl(218_15%_46%)]')}>{c.count}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Due follow-ups ──────────────────────────────────────────── */}
        {data && data.dueFollowUps > 0 ? (
          <p role="status" className="flex items-start gap-2 rounded-2xl border border-[hsl(38_60%_72%)] bg-[hsl(41_88%_94%)] px-4 py-3 text-sm font-medium text-[hsl(34_90%_24%)]">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0">{t('crm_due_banner', { n: data.dueFollowUps })}</span>
          </p>
        ) : null}

        {/* ── Selection ───────────────────────────────────────────────── */}
        {selected.size > 0 ? (
          <div className={cn(PANEL, 'flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4')} role="region" aria-label={t('crm_selection_label')}>
            <p className="text-sm font-medium text-[hsl(218_45%_14%)]">{t('crm_selected_count', { n: selected.size })}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" className={cn(SECONDARY_BUTTON, 'h-12')} onClick={() => setSelected(new Map())}>
                {t('crm_clear_selection')}
              </button>
              <button type="button" className={GOLD_BUTTON} onClick={createEmailForSelected}>
                <Mail className="h-4 w-4" aria-hidden="true" /> {t('crm_create_email')}
              </button>
            </div>
          </div>
        ) : null}

        {/* ── List ────────────────────────────────────────────────────── */}
        <section aria-labelledby="crm-list-h" aria-busy={loading || undefined}>
          <h2 id="crm-list-h" className="sr-only">{t('crm_headline')}</h2>
          {loading && !data ? (
            <ul className="space-y-2.5" aria-hidden="true">
              {Array.from({ length: 5 }, (_, i) => (
                <li key={i}><Skeleton className="h-[4.5rem] rounded-2xl bg-[hsl(40_20%_92%)] motion-reduce:animate-none" /></li>
              ))}
            </ul>
          ) : failed ? (
            <div role="alert" className={cn(PANEL, 'flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between')}>
              <p className="text-sm text-[hsl(218_45%_14%)]">{t('crm_load_failed')}</p>
              <button type="button" className={SECONDARY_BUTTON} onClick={() => void load()}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> {t('crm_retry')}
              </button>
            </div>
          ) : items.length === 0 ? (
            filtered && hasAnyEntry ? (
              <EmptyState icon={Search} title={t('crm_no_results_title')} body={t('crm_no_results_body')} className="bg-white" />
            ) : (
              <EmptyState
                icon={Users}
                body={t('crm_empty')}
                className="bg-white"
                actions={(
                  <Link to="/property" className={GOLD_BUTTON}>{t('crm_empty_cta')}</Link>
                )}
              />
            )
          ) : (
            <>
              <ul className={cn('space-y-2.5 transition-opacity motion-reduce:transition-none', loading && 'opacity-60')}>
                {items.map((item) => (
                  <CrmEntryRow
                    key={item.entryId}
                    item={item}
                    now={now}
                    selected={selected.has(item.entryId)}
                    onToggle={() => toggle(item)}
                    onOpen={() => openEntry(item.entryId)}
                  />
                ))}
              </ul>
              {total > PAGE_SIZE ? (
                <nav aria-label={t('crm_pagination')} className="mt-4 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-[hsl(218_28%_34%)]" aria-live="polite">
                    {t('crm_showing', { from: page * PAGE_SIZE + 1, to: Math.min(total, (page + 1) * PAGE_SIZE), total })}
                  </p>
                  <div className="flex gap-2">
                    <button type="button" className={cn(SECONDARY_BUTTON, 'flex-1 sm:flex-none')} disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                      {t('crm_page_prev')}
                    </button>
                    <button type="button" className={cn(SECONDARY_BUTTON, 'flex-1 sm:flex-none')} disabled={page + 1 >= pageCount || loading} onClick={() => setPage((p) => p + 1)}>
                      {t('crm_page_next')}
                    </button>
                  </div>
                </nav>
              ) : null}
            </>
          )}
        </section>

        <p className="text-2xs leading-relaxed text-[hsl(218_15%_40%)]">{t('crm_privacy_note')}</p>
      </CustomerSurface>

      <CrmEntryDrawer
        entryId={openEntryId}
        item={openItem}
        onClose={closeEntry}
        onChanged={() => void load()}
      />
    </AppLayout>
  );
}

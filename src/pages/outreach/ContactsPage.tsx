// HOMATCH Communications — Contacts.
//
// WHY THIS ROUTE HAD TO EXIST
//
// There was an import wizard at /outreach/contacts/import and a CRM profile at
// /outreach/contacts/:id, and nothing at /outreach/contacts. So the audience —
// the thing both channels are pointed at — had no home. You could import into
// it and you could open one person in it, but you could not look at it.
//
// This is that page: how many people you have, which lists they came from, how
// many are actually reachable, and a way to find one.
//
// WHAT IT WILL NOT DO
//
// It does not estimate. `reachable` counts rows the database says have a valid
// phone and no suppression; `invalid` counts the rest. Neither is a projection,
// and when the account is empty it says so rather than rendering zeros.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Upload, Search, UserPlus, PhoneOff, ShieldCheck, Globe } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import { CommsWorkspace, Section } from '@/components/communications/CommsWorkspace';
import {
  Kpi, KpiRow, LoadingBlock, EmptyState, ErrorState, ScrollTable,
  formatPhone, relativeTime,
} from '@/components/communications/primitives';
import { listContacts, listAudienceSegments } from '@/services/communications';
import {
  CHANNEL_TITLE_KEY, channelPath, useCommsChannel, useCommsProduct,
} from '@/components/communications/channel';
import { AddContactDialog } from '@/components/communications/AddContactDialog';
import type { CommContact } from '@/types/communications';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

export default function ContactsPage() {
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();

  const [rows, setRows] = useState<CommContact[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  /*
   * From the PATH, so a refresh of /outreach/calls/contacts is still AI Calls.
   * null means the neutral audience screen, reached from neither product.
   */
  const channel = useCommsChannel();
  const product = useCommsProduct();

  /*
   * SEGMENTS, IN THE WORKSPACE THEY DESCRIBE.
   *
   * Contacts and Contact Lists were two top-level pages answering one
   * question -- who am I sending to -- so a person had to know which of two
   * screens held the answer, and the answer was "both, differently". A list
   * is a way of LOOKING at contacts, so it is a filter here rather than a
   * destination of its own.
   *
   * Nothing was deleted: the lists, their import pipeline and the management
   * screen all still exist. Only the navigation stopped presenting one job as
   * two.
   */
  const [segments, setSegments] = useState<Array<{
    id: string; name: string; total_rows: number; valid_rows: number;
  }>>([]);
  const [segmentId, setSegmentId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      /* Scoped, so Email Campaigns never lists somebody with no address and
         the call products never list somebody with no number. */
      const res = await listContacts({
        search: search.trim() || undefined, pageSize: 100, channel: channel ?? undefined,
        listId: segmentId ?? undefined,
      });
      setRows(res.rows);
      setTotal(res.total);
    } catch {
      setError('comms_contacts_load_failed');
    } finally {
      setLoading(false);
    }
  }, [search, channel, segmentId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void listAudienceSegments().then(setSegments).catch(() => setSegments([])); }, []);

  /* Counted from the rows in hand. Never extrapolated to the full table. */
  const stats = useMemo(() => {
    const reachable = rows.filter((c) => c.phone_valid === true && !c.suppressed && !c.do_not_contact).length;
    const suppressed = rows.filter((c) => c.suppressed || c.do_not_contact || c.unsubscribed).length;
    const invalid = rows.filter((c) => c.phone_valid !== true).length;
    const countries = new Set(rows.map((c) => c.country).filter(Boolean));
    const languages = new Set(rows.map((c) => c.language).filter(Boolean));
    const lists = new Set(rows.map((c) => c.list_id).filter(Boolean));
    return { reachable, suppressed, invalid, countries: countries.size, languages: languages.size, lists: lists.size };
  }, [rows]);

  return (
    <CommsWorkspace product={product}
      header={
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            {/* "AI Calls > Contacts", not "Communications > Contacts". The
                category is what somebody already knows; the product is the
                thing they need to be sure of before they act on a row. */}
            <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-gold-ink">
              {t(channel ? CHANNEL_TITLE_KEY[channel] : 'comms_workspace')}
            </p>
            <h1 className="mt-0.5 text-xl font-semibold leading-tight sm:text-2xl">{t('comms_nav_contacts')}</h1>
            <p className="mt-1 max-w-[46rem] text-sm leading-snug text-muted-foreground [overflow-wrap:anywhere]">
              {t('comms_contacts_sub')}
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button size="sm" className="h-8 gap-1.5" onClick={() => setAdding(true)}>
              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('comms_contact_add')}
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => navigate(channelPath(channel, '/contacts/import'))}>
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              {t('comms_import_contacts')}
            </Button>
            {/* Back into THIS product's lists, not the shared page. An action
                that leaves the product is the same leak as a menu that does. */}
            <Button
              variant="outline" size="sm" className="h-8"
              onClick={() => navigate(channel === 'EMAIL' ? channelPath(channel, '/lists') : '/outreach/contact-lists')}
            >
              {t('comms_contacts_lists')}
            </Button>
          </div>
        </div>
      }
    >
      <AddContactDialog
        open={adding}
        onOpenChange={setAdding}
        onAdded={() => { setLoading(true); void load(); }}
      />

      {error ? <ErrorState messageKey={error} onRetry={() => { setLoading(true); void load(); }} /> : null}

      <KpiRow cols={6}>
        <Kpi labelKey="comms_contacts_total" icon={Users} value={total || null} accent loading={loading} />
        <Kpi labelKey="comms_contacts_reachable" icon={ShieldCheck} value={rows.length ? stats.reachable : null} loading={loading} />
        <Kpi labelKey="comms_contacts_suppressed" icon={PhoneOff} value={rows.length ? stats.suppressed : null} loading={loading} />
        <Kpi labelKey="comms_contacts_invalid" icon={PhoneOff} value={rows.length ? stats.invalid : null} loading={loading} />
        <Kpi labelKey="comms_contacts_lists" icon={Users} value={rows.length ? stats.lists : null} loading={loading} />
        <Kpi labelKey="comms_contacts_countries" icon={Globe} value={rows.length ? stats.countries : null} loading={loading} />
      </KpiRow>

      <Section titleKey="comms_contacts_people" sub={t('comms_contacts_people_sub')}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('comms_contacts_search')}
              aria-label={t('comms_contacts_search')}
              className="h-8 ps-8 text-xs"
            />
          </div>
        </div>

        {/*
         * Segments, as a filter over the people below rather than a separate
         * page. A thin gold underline marks the active one: the selection has
         * to be unmistakable because it silently changes what every row and
         * every bulk action applies to.
         */}
        {segments.length > 0 ? (
          <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-border/70 pb-px">
            <button
              type="button"
              onClick={() => setSegmentId(null)}
              aria-pressed={segmentId === null}
              className={`-mb-px border-b-2 px-2.5 py-1.5 text-xs font-medium transition-colors ${
                segmentId === null
                  ? 'border-gold text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('comm_filter_all')}
            </button>
            {segments.map((seg) => (
              <button
                key={seg.id}
                type="button"
                onClick={() => setSegmentId(seg.id)}
                aria-pressed={segmentId === seg.id}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  segmentId === seg.id
                    ? 'border-gold text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className="min-w-0 max-w-[12rem] truncate">{seg.name}</span>
                <span className="tabular-nums text-[13px] text-muted-foreground">{seg.valid_rows ?? 0}</span>
              </button>
            ))}
          </div>
        ) : null}

        {loading ? <LoadingBlock rows={5} /> : rows.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            titleKey="comms_contacts_empty"
            bodyKey="comms_contacts_empty_body"
            action={{ labelKey: 'comms_contact_add', onClick: () => setAdding(true) }}
          />
        ) : (
          <ScrollTable minWidth={820}>
            <table className="w-full text-xs">
              <thead className="border-b bg-muted/40">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium [&>th]:text-muted-foreground">
                  <th>{t('comm_col_contact')}</th>
                  <th>{t('comm_field_phone')}</th>
                  <th>{t('comm_field_language')}</th>
                  <th>{t('comms_contacts_country')}</th>
                  <th>{t('comm_lead_stage')}</th>
                  <th>{t('comms_contacts_last_contacted')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    className="cursor-pointer border-b last:border-0 hover:bg-muted/30 [&>td]:px-3 [&>td]:py-2"
                    onClick={() => navigate(`/outreach/contacts/${c.id}`)}
                  >
                    <td className="font-medium">
                      {c.full_name || <span className="text-muted-foreground">{t('comms_contacts_unnamed')}</span>}
                    </td>
                    <td className="font-mono">
                      <span className="flex items-center gap-1.5">
                        {formatPhone(c.phone)}
                        {c.suppressed || c.do_not_contact ? (
                          <Badge variant="outline" className="text-2xs text-muted-foreground">
                            {t('comms_contacts_suppressed')}
                          </Badge>
                        ) : null}
                      </span>
                    </td>
                    <td className="uppercase">{c.language ?? '·'}</td>
                    <td className="uppercase">{c.country ?? '·'}</td>
                    <td>{c.lead_stage ? t(`comm_stage_${c.lead_stage.toLowerCase()}` as TKey) : '·'}</td>
                    <td className="text-muted-foreground">
                      {c.last_contacted_at ? relativeTime(c.last_contacted_at, language) : '·'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        )}
      </Section>
    </CommsWorkspace>
  );
}

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
import { listContacts } from '@/services/communications';
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

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await listContacts({ search: search.trim() || undefined, pageSize: 100 });
      setRows(res.rows);
      setTotal(res.total);
    } catch {
      setError('comms_contacts_load_failed');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { void load(); }, [load]);

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
    <CommsWorkspace
      header={
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-gold-ink">
              {t('comms_workspace')}
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
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => navigate('/outreach/contacts/import')}>
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              {t('comms_import_contacts')}
            </Button>
            <Button variant="outline" size="sm" className="h-8" onClick={() => navigate('/outreach/contact-lists')}>
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

// HOMATCH Admin — Properties.
//
// WHAT THIS REPLACED
//
// The newest two hundred properties, filtered in the browser by title, email
// and city. A property older than the two-hundredth did not exist here, and
// the permanent six-digit reference a customer reads out over the phone could
// not be typed anywhere.
//
// NOW
//
// Every filter runs in the database (admin_properties_search): the reference
// is an exact lookup on its unique index and finds a property even after its
// owner deleted it; owner, status, SALE/RENT, city, district and created date
// narrow the rest; paging is server-side. Opening a row shows where it came
// from and where it stands. Contact readiness is YES or NO — the number is
// only shown after a stated reason, and that act is written to the audit log
// before the number is returned.
import { Building2, Eye, Phone, PhoneOff } from 'lucide-react';
import React from 'react';
import { labelFor } from '@/admin/labels';
import {
  Confirm, DateFilter, Empty, ErrorNote, FilterBar, IdChip, KV, PageHeader, Pager,
  SelectFilter, TextFilter, UserLine, When, dayAfter, dayStart, useQueryState,
} from '@/components/admin/control/AdminKit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  getPropertyDetail, revealPropertyContact, searchProperties, totalOf,
  type PropertyDetail, type PropertyRow,
} from '@/services/adminControl';

const LIMIT = 25;
const DEFAULTS = { ref: '', owner: '', status: '', transaction: '', city: '', district: '', from: '', to: '', id: '' };

function statusOf(p: { is_deleted: boolean; archived_at: string | null; matching_status: string | null }) {
  if (p.is_deleted) return 'DELETED';
  if (p.archived_at) return 'ARCHIVED';
  return p.matching_status ?? 'DRAFT';
}

export default function AdminPropertiesPage() {
  const { t } = useLanguage();
  const [applied, setApplied] = useQueryState(DEFAULTS);
  const [draft, setDraft] = React.useState(applied);
  const [offset, setOffset] = React.useState(0);
  const [rows, setRows] = React.useState<PropertyRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(applied.id || null);

  const refInvalid = draft.ref.trim() !== '' && !/^#?\d{6}$/.test(draft.ref.trim());

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    searchProperties({
      ref: applied.ref.trim(), owner: applied.owner, status: applied.status, transaction: applied.transaction,
      city: applied.city, district: applied.district, from: dayStart(applied.from), to: dayAfter(applied.to),
    }, LIMIT, offset)
      .then((r) => { if (!live) return; setRows(r.rows); setError(null);
        /* An exact reference with exactly one answer opens it. */
        if (applied.ref && r.rows.length === 1) setOpenId(r.rows[0].id); })
      .catch((e: unknown) => { if (live) { setRows([]); setError(e instanceof Error ? e.message : String(e)); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [applied, offset]);

  const statusOptions = ['ACTIVE', 'PAUSED', 'DRAFT', 'COMPLETED', 'ARCHIVED', 'DELETED']
    .map((v) => ({ value: v, label: labelFor(t, 'propertyStatus', v) }));
  const txOptions = ['SALE', 'RENT', 'INVESTMENT'].map((v) => ({ value: v, label: labelFor(t, 'deal', v) }));
  const total = totalOf(rows);

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={t('admin_properties_title')} subtitle={t('admin_cc_properties_subtitle')} />

      <FilterBar
        busy={loading}
        onApply={() => { if (!refInvalid) { setOffset(0); setApplied({ ...draft, id: '' }); } }}
        onReset={() => { setDraft(DEFAULTS); setOffset(0); setApplied(DEFAULTS); }}
        primary={<>
          <div>
            <TextFilter label={t('admin_cc_property_ref')} value={draft.ref} inputMode="numeric"
                        placeholder="482915" onChange={(v) => setDraft({ ...draft, ref: v })} />
            {refInvalid && <p className="mt-1 text-2xs text-destructive">{t('admin_cc_ref_invalid')}</p>}
          </div>
          <TextFilter label={t('admin_cc_owner_filter')} value={draft.owner}
                      placeholder={t('admin_cc_owner_placeholder')} onChange={(v) => setDraft({ ...draft, owner: v })} />
          <SelectFilter label={t('admin_cc_status')} value={draft.status} options={statusOptions}
                        onChange={(v) => setDraft({ ...draft, status: v })} />
          <SelectFilter label={t('admin_cc_transaction')} value={draft.transaction} options={txOptions}
                        onChange={(v) => setDraft({ ...draft, transaction: v })} />
        </>}
        more={<>
          <TextFilter label={t('admin_cc_city')} value={draft.city} onChange={(v) => setDraft({ ...draft, city: v })} />
          <TextFilter label={t('admin_cc_district')} value={draft.district} onChange={(v) => setDraft({ ...draft, district: v })} />
          <DateFilter label={t('admin_cc_created_from')} value={draft.from} onChange={(v) => setDraft({ ...draft, from: v })} />
          <DateFilter label={t('admin_cc_created_to')} value={draft.to} onChange={(v) => setDraft({ ...draft, to: v })} />
        </>}
      />

      {error && <ErrorNote message={error} />}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <Empty>{applied.ref ? t('admin_cc_no_property_with_ref', { ref: applied.ref.replace('#', '') }) : t('admin_properties_empty')}</Empty>
          ) : (
            <ul>
              {rows.map((p) => {
                const status = statusOf(p);
                return (
                  <li key={p.id} className="border-t border-border first:border-0">
                    <button type="button" onClick={() => setOpenId(p.id)}
                            className="flex w-full flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-start hover:bg-accent/50">
                      <span className="w-16 shrink-0 font-mono text-sm font-semibold tabular-nums" dir="ltr">
                        {p.homatch_id ?? '—'}
                      </span>
                      <span className="min-w-[10rem] flex-1">
                        <span className="block truncate text-sm font-medium">{p.title ?? '—'}</span>
                        <span className="block truncate text-2xs text-muted-foreground">
                          {[p.owner?.email, [p.city, p.district].filter(Boolean).join(' · ')].filter(Boolean).join(' — ')}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={status === 'ACTIVE' ? 'default' : 'outline'} className="text-2xs">
                          {labelFor(t, 'propertyStatus', status)}
                        </Badge>
                        {p.transaction_type && <Badge variant="secondary" className="text-2xs">{labelFor(t, 'deal', p.transaction_type)}</Badge>}
                        {p.contact_phone_present
                          ? <Phone className="h-3.5 w-3.5 text-muted-foreground" aria-label={t('admin_cc_phone_present')} />
                          : <PhoneOff className="h-3.5 w-3.5 text-muted-foreground/60" aria-label={t('admin_cc_phone_absent')} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Pager offset={offset} limit={LIMIT} total={total} count={rows.length} onChange={setOffset} />

      <PropertySheet id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function PropertySheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useLanguage();
  const [detail, setDetail] = React.useState<PropertyDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [revealOpen, setRevealOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [revealing, setRevealing] = React.useState(false);
  const [revealed, setRevealed] = React.useState<{ listing_phone: string | null; owner_phone: string | null } | null>(null);

  React.useEffect(() => {
    setDetail(null); setError(null); setRevealed(null); setReason('');
    if (!id) return;
    let live = true;
    getPropertyDetail(id)
      .then((d) => { if (live) setDetail(d); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [id]);

  const reveal = async () => {
    if (!id) return;
    setRevealing(true);
    try {
      setRevealed(await revealPropertyContact(id, reason.trim()));
      setRevealOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRevealOpen(false);
    } finally {
      setRevealing(false);
    }
  };

  const yesNo = (v: boolean | null | undefined) => (v ? t('admin_cc_yes') : t('admin_cc_no'));

  return (
    <Sheet open={id !== null} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" aria-hidden="true" />
            {detail?.homatch_id ? `#${detail.homatch_id}` : t('admin_cc_property')}
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-5">
          {error && <ErrorNote message={error} />}
          {!detail && !error && <Skeleton className="h-40 w-full" />}
          {detail && (
            <>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{detail.title ?? '—'}</h3>
                <KV rows={[
                  [t('admin_cc_property_ref'), <span dir="ltr" className="font-mono">{detail.homatch_id ?? '—'}</span>],
                  [t('admin_cc_owner'), <UserLine user={detail.owner} />],
                  [t('admin_cc_status'), labelFor(t, 'propertyStatus', statusOf(detail))],
                  [t('admin_cc_transaction'), labelFor(t, 'deal', detail.transaction_type)],
                  [t('admin_cc_location'), [detail.facts.city, detail.facts.district].filter(Boolean).join(' · ') || '—'],
                  [t('admin_cc_created'), <When at={detail.created_at} />],
                  [t('admin_cc_internal_id'), <IdChip id={detail.id} />],
                ]} />
              </section>

              <section className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('admin_cc_contact_readiness')}</h4>
                <KV rows={[
                  [t('admin_cc_listing_phone'), yesNo(detail.contact_phone_present)],
                  [t('admin_cc_owner_phone'), yesNo(detail.owner_has_phone)],
                ]} />
                {revealed ? (
                  <div className="rounded-md border border-border bg-muted/40 p-3 text-sm" dir="ltr">
                    <p>{t('admin_cc_listing_phone')}: {revealed.listing_phone ?? '—'}</p>
                    <p>{t('admin_cc_owner_phone')}: {revealed.owner_phone ?? '—'}</p>
                    <p className="mt-1 text-2xs text-muted-foreground" dir="auto">{t('admin_cc_reveal_logged')}</p>
                  </div>
                ) : (detail.contact_phone_present || detail.owner_has_phone) ? (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setRevealOpen(true)}>
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" /> {t('admin_cc_reveal_contact')}
                  </Button>
                ) : null}
              </section>

              <section className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('admin_cc_provenance')}</h4>
                <KV rows={[
                  [t('admin_cc_source'), detail.provenance.source_type === 'URL_IMPORT' ? t('admin_cc_source_import') : detail.provenance.source_type === 'PRIVATE_LISTING' ? t('admin_cc_source_private') : '—'],
                  [t('admin_cc_source_site'), detail.provenance.source_domain ?? '—'],
                  [t('admin_cc_last_import'), detail.provenance.last_import
                    ? <span>{detail.provenance.last_import.status}{detail.provenance.last_import.error_code ? ` · ${detail.provenance.last_import.error_code}` : ''} · <When at={detail.provenance.last_import.created_at} /></span>
                    : '—'],
                ]} />
              </section>

              <section className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('admin_cc_matching_state')}</h4>
                <KV rows={[
                  [t('admin_cc_campaign'), detail.matching.campaign ? labelFor(t, 'campaignState', detail.matching.campaign.status) : t('admin_cc_none')],
                  [t('admin_cc_last_run'), detail.matching.last_job
                    ? <span>{detail.matching.last_job.status} · <When at={detail.matching.last_job.completed_at} /></span> : '—'],
                  [t('admin_cc_internal_matches'), `${detail.matching.internal_compatible} / ${detail.matching.internal_matches}`],
                  [t('admin_cc_legacy_matches'), String(detail.matching.legacy_matches)],
                  [t('admin_cc_interest_signals'), String(detail.matching.interest_signals)],
                ]} />
                <div className="flex flex-wrap gap-2 pt-1">
                  {detail.homatch_id && (
                    <>
                      <Button asChild size="sm" variant="outline"><a href={`/admin/supply-matches?kind=INTERNAL&ref=${detail.homatch_id}`}>{t('admin_cc_open_matches')}</a></Button>
                      <Button asChild size="sm" variant="outline"><a href={`/admin/intelligence?ref=${detail.homatch_id}`}>{t('admin_cc_open_signals')}</a></Button>
                    </>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </SheetContent>

      <Confirm
        open={revealOpen}
        onOpenChange={setRevealOpen}
        title={t('admin_cc_reveal_title')}
        description={t('admin_cc_reveal_body')}
        confirmLabel={t('admin_cc_reveal_confirm')}
        onConfirm={reveal}
        busy={revealing}
        confirmDisabled={reason.trim().length < 5}
      >
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('admin_cc_reason_placeholder')} rows={3} />
      </Confirm>
    </Sheet>
  );
}

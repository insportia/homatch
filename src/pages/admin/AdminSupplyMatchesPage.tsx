// HOMATCH Admin — Matches, internal and external, never mixed.
//
// INTERNAL  two Homatch accounts: somebody's listing and somebody's current
//           demand. Both people are real and both are shown, with what we told
//           each of them (the native-match notifications) and whether they
//           have started talking.
// EXTERNAL  a demand and a listing found OUTSIDE Homatch. There is nobody on
//           the other side with an account, so no counterparty is shown —
//           only the reference ids the evidence lives under. Inventing a name
//           here would be inventing a customer.
//
// The older `matches` table (paid unlocks of external signals) keeps its own
// page, /admin/matches, labelled as the legacy list.
import { Handshake, MessageSquare, MessageSquareOff } from 'lucide-react';
import React from 'react';
import { labelFor } from '@/admin/labels';
import {
  DateFilter, Empty, ErrorNote, FilterBar, IdChip, KV, PageHeader, Pager, SelectFilter,
  TextFilter, UserLine, When, dayAfter, dayStart, useQueryState,
} from '@/components/admin/control/AdminKit';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/contexts/LanguageContext';
import { listSupplyMatches, totalOf, type SupplyMatchRow } from '@/services/adminControl';

const LIMIT = 25;
const DEFAULTS = { kind: 'INTERNAL', ref: '', user: '', deal: '', compatibility: '', from: '', to: '', id: '' };

export default function AdminSupplyMatchesPage() {
  const { t } = useLanguage();
  const [applied, setApplied] = useQueryState(DEFAULTS);
  const kind = applied.kind === 'EXTERNAL' ? 'EXTERNAL' : 'INTERNAL';
  const [draft, setDraft] = React.useState(applied);
  const [offset, setOffset] = React.useState(0);
  const [rows, setRows] = React.useState<SupplyMatchRow[]>([]);
  const [counts, setCounts] = React.useState<{ internal: number; external: number } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | null>(applied.id || null);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    listSupplyMatches({
      kind: applied.id ? undefined : kind, ref: applied.ref, user: applied.user, deal: applied.deal, compatibility: applied.compatibility,
      from: dayStart(applied.from), to: dayAfter(applied.to), id: applied.id,
    }, LIMIT, offset)
      .then((r) => { if (live) { setRows(r.rows); setCounts(r.counts); setError(null); } })
      .catch((e: unknown) => { if (live) { setRows([]); setError(e instanceof Error ? e.message : String(e)); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [applied, offset, kind]);

  /* A match id found through the lookup belongs to one tab or the other. */
  React.useEffect(() => {
    if (applied.id && rows.length === 1 && rows[0].kind !== kind) setApplied({ ...applied, kind: rows[0].kind });
  }, [applied, rows, kind, setApplied]);

  const deals = ['SALE', 'RENT', 'SHORT_STAY', 'COMMERCIAL', 'LAND', 'INVESTMENT'].map((v) => ({ value: v, label: labelFor(t, 'deal', v) }));
  const compat = ['COMPATIBLE', 'INSUFFICIENT_INFORMATION', 'INCOMPATIBLE'].map((v) => ({ value: v, label: labelFor(t, 'compatibility', v) }));

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={t('admin_cc_matches_title')} subtitle={t('admin_cc_matches_subtitle')} />

      <Tabs value={kind} onValueChange={(v) => { setOffset(0); setOpen(null); setApplied({ ...applied, kind: v, id: '' }); }}>
        <TabsList>
          <TabsTrigger value="INTERNAL">{t('admin_cc_internal')}{counts ? ` (${counts.internal})` : ''}</TabsTrigger>
          <TabsTrigger value="EXTERNAL">{t('admin_cc_external')}{counts ? ` (${counts.external})` : ''}</TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="text-xs text-muted-foreground">{kind === 'INTERNAL' ? t('admin_cc_internal_note') : t('admin_cc_external_note')}</p>

      <FilterBar
        busy={loading}
        onApply={() => { setOffset(0); setApplied({ ...draft, kind, id: '' }); }}
        onReset={() => { setDraft({ ...DEFAULTS, kind }); setOffset(0); setApplied({ ...DEFAULTS, kind }); }}
        primary={<>
          <TextFilter label={t('admin_cc_property_ref')} value={draft.ref} inputMode="numeric" placeholder="482915"
                      onChange={(v) => setDraft({ ...draft, ref: v })} />
          <TextFilter label={t('admin_cc_user_filter')} value={draft.user} placeholder={t('admin_cc_owner_placeholder')}
                      onChange={(v) => setDraft({ ...draft, user: v })} />
          <SelectFilter label={t('admin_cc_transaction')} value={draft.deal} options={deals} onChange={(v) => setDraft({ ...draft, deal: v })} />
          <SelectFilter label={t('admin_cc_match_status')} value={draft.compatibility} options={compat} onChange={(v) => setDraft({ ...draft, compatibility: v })} />
        </>}
        more={<>
          <DateFilter label={t('admin_cc_created_from')} value={draft.from} onChange={(v) => setDraft({ ...draft, from: v })} />
          <DateFilter label={t('admin_cc_created_to')} value={draft.to} onChange={(v) => setDraft({ ...draft, to: v })} />
        </>}
      />

      {error && <ErrorNote message={error} />}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <Empty>{t('admin_cc_no_matches')}</Empty>
          ) : (
            <ul>
              {rows.map((m) => (
                <li key={m.id} className="border-t border-border first:border-0">
                  <button type="button" aria-expanded={open === m.id} onClick={() => setOpen(open === m.id ? null : m.id)}
                          className="flex w-full flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-start hover:bg-accent/50">
                    <Handshake className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-[10rem] flex-1">
                      <span className="block truncate text-sm font-medium">
                        {m.kind === 'INTERNAL'
                          ? `${m.property?.homatch_id ? `#${m.property.homatch_id} ` : ''}${m.property?.title ?? ''}`
                          : t('admin_cc_external_pair')}
                      </span>
                      <span className="block truncate text-2xs text-muted-foreground">
                        {m.kind === 'INTERNAL'
                          ? `${m.supply_user?.email ?? '—'} ↔ ${m.demand_user?.email ?? '—'}`
                          : t('admin_cc_no_homatch_counterparty')}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={m.compatibility === 'COMPATIBLE' ? 'default' : 'outline'} className="text-2xs">{labelFor(t, 'compatibility', m.compatibility)}</Badge>
                      {m.deal_kind && <Badge variant="secondary" className="text-2xs">{labelFor(t, 'deal', m.deal_kind)}</Badge>}
                      <span className="text-2xs tabular-nums text-muted-foreground">{Math.round(Number(m.score) * 100)}%</span>
                      {m.kind === 'INTERNAL' && (m.conversation_exists
                        ? <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" aria-label={t('admin_cc_conversation_yes')} />
                        : <MessageSquareOff className="h-3.5 w-3.5 text-muted-foreground/60" aria-label={t('admin_cc_conversation_no')} />)}
                    </span>
                  </button>
                  {open === m.id && <MatchDetail m={m} />}
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

function MatchDetail({ m }: { m: SupplyMatchRow }) {
  const { t } = useLanguage();
  const dims = (list: string[]) => (list?.length ? list.map((d) => labelFor(t, 'dimension', d)).join(', ') : '—');
  const notified = (side: 'supply' | 'demand') => {
    const n = (m.notifications ?? []).find((x) => x.side === side);
    if (!n) return t('admin_cc_not_notified');
    return `${new Date(n.created_at).toLocaleString()} · ${n.read ? t('admin_cc_read') : t('admin_cc_unread')}${n.pushed_at ? ` · ${t('admin_cc_pushed')}` : ''}`;
  };
  const common: Array<[string, React.ReactNode]> = [
    [t('admin_cc_match_status'), labelFor(t, 'compatibility', m.compatibility)],
    [t('admin_cc_score'), `${Math.round(Number(m.score) * 100)}%`],
    [t('admin_cc_agreed'), dims(m.agreed)],
    [t('admin_cc_conflicted'), dims(m.conflicted)],
    [t('admin_cc_unknown_dims'), dims(m.unknown_dimensions)],
    [t('admin_cc_created'), <When at={m.created_at} />],
    [t('admin_cc_match_id'), <IdChip id={m.id} />],
  ];
  const rows: Array<[string, React.ReactNode]> = m.kind === 'INTERNAL'
    ? [
      [t('admin_cc_property'), m.property?.homatch_id
        ? <a className="font-mono hover:underline" href={`/admin/properties?ref=${m.property.homatch_id}`}>#{m.property.homatch_id}</a> : '—'],
      [t('admin_cc_supply_user'), <UserLine user={m.supply_user} />],
      [t('admin_cc_demand_user'), <UserLine user={m.demand_user} />],
      [t('admin_cc_demand_id'), <IdChip id={m.demand_id} />],
      [t('admin_cc_notified_supply'), notified('supply')],
      [t('admin_cc_notified_demand'), notified('demand')],
      [t('admin_cc_conversation'), m.conversation_exists ? t('admin_cc_conversation_yes') : t('admin_cc_conversation_no')],
      ...common,
    ]
    : [
      [t('admin_cc_counterparty'), t('admin_cc_no_homatch_counterparty')],
      [t('admin_cc_external_signal'), <IdChip id={m.external_refs?.signal_id} />],
      [t('admin_cc_external_listing'), <IdChip id={m.external_refs?.observation_id} />],
      [t('admin_cc_campaign'), m.campaign
        ? <span><UserLine user={m.campaign.owner} />{m.campaign.property_homatch_id ? ` #${m.campaign.property_homatch_id}` : ''}</span>
        : '—'],
      ...common,
    ];
  return (
    <div className="border-t border-border bg-muted/30 px-4 py-3">
      <KV rows={rows} />
    </div>
  );
}

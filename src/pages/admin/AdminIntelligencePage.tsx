// HOMATCH Admin — Native intelligence.
//
// Two different things, kept on two different tabs because confusing them is
// the exact mistake effective.ts exists to prevent:
//
//   SIGNALS         what somebody SAID, once, on some surface — evidence. It
//                   accumulates and contradicts itself, and it is never the
//                   thing the matcher reads.
//   CURRENT DEMAND  what they WANT NOW — the projection the matcher reads
//                   (active searches), with each dimension's firmness taken
//                   from the newest statement that still stands.
//
// Neither tab shows anybody's words. A signal is shown as its structure — act,
// side, dimension, firmness, attribution, confidence, surface and the id of
// the event it came from — and the database filters constraints to short
// values before they leave it (admin_intent_signals).
import { Brain, History, Target } from 'lucide-react';
import React from 'react';
import { labelFor } from '@/admin/labels';
import {
  DateFilter, Empty, ErrorNote, FilterBar, IdChip, KV, PageHeader, Pager, SelectFilter,
  TextFilter, UserLine, When, dayAfter, dayStart, useQueryState,
} from '@/components/admin/control/AdminKit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  getEffectiveDemand, listSignals, searchUsers, totalOf,
  type EffectiveDemand, type SignalRow, type UserSearchRow,
} from '@/services/adminControl';

const LIMIT = 25;
const DEFAULTS = { tab: 'signals', user: '', surface: '', act: '', side: '', status: '', from: '', to: '', ref: '', signal: '' };
const DIMENSIONS = ['TRANSACTION', 'CITY', 'DISTRICT', 'PROPERTY_TYPE', 'PRICE', 'AREA', 'BEDROOMS', 'PARTICIPANTS'];

export default function AdminIntelligencePage() {
  const { t } = useLanguage();
  const [applied, setApplied] = useQueryState(DEFAULTS);
  const tab = applied.tab === 'demand' ? 'demand' : 'signals';

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={t('admin_cc_intel_title')} subtitle={t('admin_cc_intel_subtitle')} />
      <Tabs value={tab} onValueChange={(v) => setApplied({ ...applied, tab: v })}>
        <TabsList>
          <TabsTrigger value="signals" className="gap-1.5"><History className="h-3.5 w-3.5" aria-hidden="true" />{t('admin_cc_tab_signals')}</TabsTrigger>
          <TabsTrigger value="demand" className="gap-1.5"><Target className="h-3.5 w-3.5" aria-hidden="true" />{t('admin_cc_tab_demand')}</TabsTrigger>
        </TabsList>
        <TabsContent value="signals" className="mt-4">
          <SignalsTab applied={applied} setApplied={setApplied} />
        </TabsContent>
        <TabsContent value="demand" className="mt-4">
          <DemandTab userId={applied.user} onPick={(id) => setApplied({ ...applied, tab: 'demand', user: id })} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SignalsTab({ applied, setApplied }: { applied: typeof DEFAULTS; setApplied: (v: typeof DEFAULTS) => void }) {
  const { t } = useLanguage();
  const [draft, setDraft] = React.useState(applied);
  const [offset, setOffset] = React.useState(0);
  const [rows, setRows] = React.useState<SignalRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    listSignals({
      user: applied.user, surface: applied.surface, act: applied.act, side: applied.side, status: applied.status,
      from: dayStart(applied.from), to: dayAfter(applied.to), ref: applied.ref, signal: applied.signal,
    }, LIMIT, offset)
      .then((r) => { if (live) { setRows(r.rows); setError(null); if (applied.signal && r.rows[0]) setOpen(r.rows[0].id); } })
      .catch((e: unknown) => { if (live) { setRows([]); setError(e instanceof Error ? e.message : String(e)); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [applied, offset]);

  const opts = (domain: 'surface' | 'act' | 'side' | 'signalStatus', codes: string[]) =>
    codes.map((c) => ({ value: c, label: labelFor(t, domain, c) }));

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t('admin_cc_signals_note')}</p>
      <FilterBar
        busy={loading}
        onApply={() => { setOffset(0); setApplied({ ...draft, tab: 'signals', signal: '' }); }}
        onReset={() => { setDraft(DEFAULTS); setOffset(0); setApplied(DEFAULTS); }}
        primary={<>
          <TextFilter label={t('admin_cc_user_filter')} value={draft.user} placeholder={t('admin_cc_owner_placeholder')}
                      onChange={(v) => setDraft({ ...draft, user: v })} />
          <SelectFilter label={t('admin_cc_surface')} value={draft.surface}
                        options={opts('surface', ['LIVE_CHAT', 'PRIVATE_MESSAGE', 'VIEWING_REQUEST', 'SEARCH_PLAN', 'AI_CHAT'])}
                        onChange={(v) => setDraft({ ...draft, surface: v })} />
          <SelectFilter label={t('admin_cc_act')} value={draft.act}
                        options={opts('act', ['REQUIREMENT', 'INTEREST', 'REJECTION', 'OBJECTION', 'INQUIRY', 'TRANSACTION_INTENT'])}
                        onChange={(v) => setDraft({ ...draft, act: v })} />
          <SelectFilter label={t('admin_cc_signal_state')} value={draft.status}
                        options={opts('signalStatus', ['ACTIVE', 'WITHDRAWN', 'SUPERSEDED'])}
                        onChange={(v) => setDraft({ ...draft, status: v })} />
        </>}
        more={<>
          <SelectFilter label={t('admin_cc_side')} value={draft.side}
                        options={opts('side', ['DEMAND', 'SUPPLY', 'PROPERTY_INTEREST'])}
                        onChange={(v) => setDraft({ ...draft, side: v })} />
          <TextFilter label={t('admin_cc_property_ref')} value={draft.ref} inputMode="numeric" placeholder="482915"
                      onChange={(v) => setDraft({ ...draft, ref: v })} />
          <DateFilter label={t('admin_cc_said_from')} value={draft.from} onChange={(v) => setDraft({ ...draft, from: v })} />
          <DateFilter label={t('admin_cc_said_to')} value={draft.to} onChange={(v) => setDraft({ ...draft, to: v })} />
        </>}
      />
      {error && <ErrorNote message={error} />}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <Empty>{t('admin_cc_no_signals')}</Empty>
          ) : (
            <ul>
              {rows.map((s) => (
                <li key={s.id} className="border-t border-border first:border-0">
                  <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}
                          className="flex w-full flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-start hover:bg-accent/50">
                    <span className="min-w-[10rem] flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium">{labelFor(t, 'act', s.act)}</span>
                        {s.dimension && <span className="text-sm text-muted-foreground">· {labelFor(t, 'dimension', s.dimension)}</span>}
                      </span>
                      <span className="block truncate text-2xs text-muted-foreground">
                        {s.actor?.email ?? '—'} · {labelFor(t, 'surface', s.source_surface)} · {new Date(s.source_at).toLocaleString()}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      <Badge variant="secondary" className="text-2xs">{labelFor(t, 'side', s.side)}</Badge>
                      <Badge variant={s.status === 'ACTIVE' ? 'default' : 'outline'} className="text-2xs">{labelFor(t, 'signalStatus', s.status)}</Badge>
                    </span>
                  </button>
                  {open === s.id && (
                    <div className="space-y-3 border-t border-border bg-muted/30 px-4 py-3">
                      <KV rows={[
                        [t('admin_cc_user'), <UserLine user={s.actor} />],
                        [t('admin_cc_side'), labelFor(t, 'side', s.side)],
                        [t('admin_cc_scope'), labelFor(t, 'scope', s.scope)],
                        [t('admin_cc_attribution'), labelFor(t, 'attribution', s.attribution)],
                        [t('admin_cc_confidence'), `${Math.round(Number(s.confidence) * 100)}%${s.explicit ? ` · ${t('admin_cc_explicit')}` : ''}`],
                        [t('admin_cc_firmness'), <FirmnessList strength={s.strength} />],
                        [t('admin_cc_constraints'), <Constraints value={s.constraints} />],
                        [t('admin_cc_surface'), <span>{labelFor(t, 'surface', s.source_surface)} <IdChip id={s.source_event_id} /></span>],
                        [t('admin_cc_property'), s.property_homatch_id ? <a className="font-mono hover:underline" href={`/admin/properties?ref=${s.property_homatch_id}`}>#{s.property_homatch_id}</a> : '—'],
                        [t('admin_cc_said_at'), <When at={s.source_at} />],
                        [t('admin_cc_recorded_at'), <When at={s.created_at} />],
                        [t('admin_cc_withdrawn_at'), s.withdrawn_at ? <span><When at={s.withdrawn_at} />{s.withdrawn_reason ? ` · ${s.withdrawn_reason}` : ''}</span> : '—'],
                        [t('admin_cc_internal_id'), <IdChip id={s.id} />],
                      ]} />
                      {s.actor && (
                        <Button size="sm" variant="outline" onClick={() => setApplied({ ...DEFAULTS, tab: 'demand', user: s.actor!.id })}>
                          {t('admin_cc_see_current_demand')}
                        </Button>
                      )}
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

function FirmnessList({ strength }: { strength: Record<string, string> }) {
  const { t } = useLanguage();
  const entries = Object.entries(strength ?? {});
  if (entries.length === 0) return <span className="text-muted-foreground">{t('admin_cc_firm_none_stated')}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {entries.map(([dim, f]) => (
        <Badge key={dim} variant="outline" className="text-2xs">{labelFor(t, 'dimension', dim)}: {labelFor(t, 'firmness', f)}</Badge>
      ))}
    </span>
  );
}

function Constraints({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value ?? {});
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-1" dir="ltr">
      {entries.map(([k, v]) => (
        <code key={k} className="rounded bg-muted px-1.5 py-0.5 text-2xs">{k}: {Array.isArray(v) ? v.join(', ') : String(v)}</code>
      ))}
    </span>
  );
}

function DemandTab({ userId, onPick }: { userId: string; onPick: (id: string) => void }) {
  const { t } = useLanguage();
  const [q, setQ] = React.useState('');
  const [hits, setHits] = React.useState<UserSearchRow[] | null>(null);
  const [demand, setDemand] = React.useState<EffectiveDemand | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setDemand(null);
    if (!userId) return;
    let live = true;
    setLoading(true);
    getEffectiveDemand(userId)
      .then((d) => { if (live) { setDemand(d); setError(null); } })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [userId]);

  const find = async () => {
    try { setHits(await searchUsers(q.trim(), 10)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t('admin_cc_demand_note')}</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void find(); }}>
        <input className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm"
               value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin_cc_find_user_placeholder')}
               aria-label={t('admin_cc_find_user_placeholder')} />
        <Button type="submit" size="sm" disabled={q.trim().length < 2}>{t('admin_cc_find')}</Button>
      </form>
      {hits && (
        <Card><CardContent className="p-0">
          {hits.length === 0 ? <Empty>{t('admin_users_empty')}</Empty> : (
            <ul>{hits.map((u) => (
              <li key={u.id} className="border-t border-border first:border-0">
                <button type="button" className="w-full px-4 py-2.5 text-start hover:bg-accent/50" onClick={() => { setHits(null); onPick(u.id); }}>
                  <UserLine user={u} link={false} />
                </button>
              </li>))}</ul>
          )}
        </CardContent></Card>
      )}
      {error && <ErrorNote message={error} />}
      {loading && <Skeleton className="h-40 w-full" />}
      {demand && !loading && <DemandView demand={demand} />}
    </div>
  );
}

function DemandView({ demand }: { demand: EffectiveDemand }) {
  const { t } = useLanguage();
  const money = (n: number | null, c: string | null) => (n == null ? null : `${Number(n).toLocaleString()} ${c ?? ''}`.trim());
  const range = (a: unknown, b: unknown, fmt: (v: number) => string = String) =>
    a == null && b == null ? '—' : `${a == null ? '…' : fmt(Number(a))} – ${b == null ? '…' : fmt(Number(b))}`;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <UserLine user={demand.user} />
          <span className="text-2xs text-muted-foreground">
            {t('admin_cc_signal_counts', { active: demand.signals.active, withdrawn: demand.signals.withdrawn, superseded: demand.signals.superseded })}
          </span>
        </CardContent>
      </Card>

      <section aria-labelledby="demand-now">
        <h2 id="demand-now" className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Brain className="h-3.5 w-3.5" aria-hidden="true" />{t('admin_cc_demand_now')}
        </h2>
        {demand.projections.length === 0 ? (
          <Card><CardContent className="p-0"><Empty>{t('admin_cc_no_projection')}</Empty></CardContent></Card>
        ) : demand.projections.map((p) => (
          <Card key={p.subscription_id} className="mb-3">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                {labelFor(t, 'deal', p.transaction_type)} · {[p.city, p.district].filter(Boolean).join(' · ') || '—'}
                <Badge variant={p.is_active ? 'default' : 'outline'} className="text-2xs">{p.is_active ? t('admin_cc_active_search') : t('admin_cc_inactive_search')}</Badge>
                <Badge variant="secondary" className="text-2xs">{labelFor(t, 'origin', p.origin)}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <KV rows={[
                [t('admin_cc_budget'), range(p.budget_min, p.budget_max, (v) => money(v, p.currency) ?? '—')],
                [t('admin_cc_bedrooms'), range(p.bedrooms_min, p.bedrooms_max)],
                [t('admin_cc_area'), range(p.area_min, p.area_max)],
                [t('admin_cc_property_types'), (p.property_types ?? []).join(', ') || '—'],
                [t('admin_cc_confidence'), p.confidence == null ? '—' : `${Math.round(Number(p.confidence) * 100)}%`],
                [t('admin_cc_created'), <When at={p.created_at} />],
                [t('admin_cc_demand_id'), <IdChip id={p.intent_profile_id} />],
              ]} />
            </CardContent>
          </Card>
        ))}
      </section>

      <section aria-labelledby="demand-firmness">
        <h2 id="demand-firmness" className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('admin_cc_firmness_by_dimension')}</h2>
        <Card><CardContent className="p-4">
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {DIMENSIONS.map((d) => {
              const f: string = demand.firmness[d] ?? 'UNKNOWN';
              return (
                <li key={d} className="flex items-center justify-between gap-2 text-sm">
                  <span>{labelFor(t, 'dimension', d)}</span>
                  <Badge variant={f === 'REQUIRED' ? 'default' : f === 'UNKNOWN' ? 'outline' : 'secondary'} className="text-2xs">{labelFor(t, 'firmness', f)}</Badge>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-2xs text-muted-foreground">{t('admin_cc_firmness_note')}</p>
        </CardContent></Card>
      </section>

      <Button asChild size="sm" variant="outline">
        <a href={`/admin/intelligence?tab=signals&user=${demand.user?.id ?? ''}`}>{t('admin_cc_see_history')}</a>
      </Button>
    </div>
  );
}

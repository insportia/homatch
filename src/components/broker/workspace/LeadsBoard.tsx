// LEADS & PIPELINE — the broker's current leads on their own properties,
// grouped by workflow state (NEW → REVIEWED → CONTACTED → IN PROGRESS →
// WON / CLOSED). Rows are the owner's matches, read under RLS; a lead moves
// only through set_match_lead_state, which enforces the transition table,
// ownership and the "contact states need an opened contact" rule.
//
// Only CURRENT demand is listed (the canonical active window); history stays on
// the property's own matches page. A locked lead shows its locked preview only;
// opening the contact happens on the property's matches page, through the
// canonical contact-opening flow.

import { ExternalLink, Eye, EyeOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import type { TranslationKey } from '@/i18n/translations';
import { cn } from '@/lib/utils';
import { isHistoryMatch } from '@/matching/currentDemand';
import { LeadStateControl } from '@/components/broker/LeadStateControl';
import { LEAD_STATES, type LeadState } from '@/services/brokerDesk';

interface LeadRow {
  id: string;
  property_id: string;
  status: string;
  lead_state: LeadState;
  signal_strength: string | null;
  preview_city: string | null;
  preview_budget_min: number | null;
  preview_budget_max: number | null;
  preview_currency: string | null;
  preview_bedrooms: number | null;
  created_at: string;
  demand_published_at?: string | null;
}

type Filter = 'ACTION' | LeadState | 'ALL';
const ACTION_STATES: LeadState[] = ['NEW', 'REVIEWED'];

export function LeadsBoard({ properties, compact = false }: {
  properties: Array<{ id: string; title: string | null; homatch_id: string | null }>;
  /** The overview shows the leads that need action, briefly. */
  compact?: boolean;
}) {
  const { t, isRTL } = useLanguage();
  const [rows, setRows] = useState<LeadRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('ACTION');
  const ids = useMemo(() => properties.map((p) => p.id), [properties]);
  const titleOf = useMemo(() => new Map(properties.map((p) => [p.id, p.title || (p.homatch_id ? `#${p.homatch_id}` : '—')])), [properties]);

  const load = useCallback(async () => {
    if (ids.length === 0) { setRows([]); return; }
    setFailed(false);
    const { data, error } = await supabase
      .from('matches')
      .select('id,property_id,status,lead_state,signal_strength,preview_city,preview_budget_min,preview_budget_max,preview_currency,preview_bedrooms,created_at,demand_published_at')
      .in('property_id', ids)
      .neq('status', 'REJECTED')
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) { setFailed(true); setRows([]); return; }
    setRows(((data ?? []) as LeadRow[]).filter((r) => !isHistoryMatch(r)));
  }, [ids]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows ?? []) c[r.lead_state] = (c[r.lead_state] ?? 0) + 1;
    return c;
  }, [rows]);
  const shown = (rows ?? []).filter((r) => filter === 'ALL' || (filter === 'ACTION' ? ACTION_STATES.includes(r.lead_state) : r.lead_state === filter));
  const list = compact ? shown.slice(0, 5) : shown;

  const budget = (r: LeadRow) => {
    if (r.preview_budget_min == null && r.preview_budget_max == null) return null;
    const cur = r.preview_currency ?? '';
    return r.preview_budget_min != null && r.preview_budget_max != null && r.preview_budget_min !== r.preview_budget_max
      ? `${r.preview_budget_min.toLocaleString()}–${r.preview_budget_max.toLocaleString()} ${cur}`
      : `${(r.preview_budget_max ?? r.preview_budget_min)!.toLocaleString()} ${cur}`;
  };

  if (rows === null) return <Skeleton className="h-40 rounded-xl" />;
  if (failed) return <p role="alert" className="text-sm text-destructive">{t('broker_desk_load_error')}</p>;

  return (
    <div className="space-y-3" data-leads-board>
      {!compact && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('broker_desk_leads_heading')}>
          {(['ACTION', ...LEAD_STATES, 'ALL'] as Filter[]).map((f) => {
            const n = f === 'ALL' ? rows.length : f === 'ACTION' ? ACTION_STATES.reduce((a, s) => a + (counts[s] ?? 0), 0) : counts[f] ?? 0;
            return (
              <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
                className={cn('inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-2xs font-semibold transition-colors',
                  filter === f ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]' : 'border-border bg-card text-muted-foreground hover:text-foreground')}>
                {f === 'ACTION' ? t('broker_ws_needs_action') : f === 'ALL' ? t('broker_ws_all') : t(`lead_state_${f}` as TranslationKey)}
                <span className="tabular-nums">{n}</span>
              </button>
            );
          })}
        </div>
      )}
      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? t('broker_desk_leads_empty') : t('broker_ws_no_leads_in_state')}
        </p>
      ) : (
        <ul className="grid gap-2.5 lg:grid-cols-2">
          {list.map((r) => {
            const opened = r.status === 'UNLOCKED';
            return (
              <li key={r.id} className="rounded-xl border border-border bg-card p-3.5" data-lead-row>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-foreground">{titleOf.get(r.property_id)}</p>
                    <p className="mt-0.5 text-2xs text-muted-foreground">
                      {[r.preview_city, budget(r), r.preview_bedrooms != null ? t('broker_ws_bedrooms', { n: String(r.preview_bedrooms) }) : null]
                        .filter(Boolean).join(' · ') || t('broker_ws_preview_limited')}
                    </p>
                  </div>
                  <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-semibold',
                    opened ? 'border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]' : 'border-border bg-secondary text-muted-foreground')}>
                    {opened ? <Eye className="h-3 w-3" aria-hidden="true" /> : <EyeOff className="h-3 w-3" aria-hidden="true" />}
                    {opened ? t('broker_ws_contact_opened') : t('broker_ws_contact_locked')}
                  </span>
                </div>
                {!compact && (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <div className="min-w-[12rem] flex-1">
                      <LeadStateControl matchId={r.id} initialState={r.lead_state}
                        onChanged={(next) => setRows((prev) => (prev ?? []).map((x) => (x.id === r.id ? { ...x, lead_state: next } : x)))} />
                    </div>
                    <Link to={`/property/${r.property_id}/matches`}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-2xs font-semibold text-foreground hover:border-[hsl(var(--gold-border))]">
                      {opened ? t('broker_ws_open_contact') : t('broker_ws_open_to_unlock')}
                      <ExternalLink className={cn('h-3.5 w-3.5', isRTL && '-scale-x-100')} aria-hidden="true" />
                    </Link>
                  </div>
                )}
                {compact && (
                  <p className="mt-2 text-2xs font-semibold text-[hsl(var(--gold-ink))]">{t(`lead_state_${r.lead_state}` as TranslationKey)}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

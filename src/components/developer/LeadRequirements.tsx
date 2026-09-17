import React, { useEffect, useState } from 'react';
import { Building2, MapPin, BedDouble, Ruler, ArrowRight, UserCog } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Panel, Fact, Money, formatArea, formatNumber, formatDate, UnitStatusPill,
} from './primitives';
import { SectionHead } from './visuals';
import { listLeadUnits, type LeadWithContact } from '@/services/developer/crm';
import { listUnits } from '@/services/developer/inventory';
import { getUnitReservation, getDealByUnit } from '@/services/developer/sales';
import type { DevUnit, DevReservation, DevDeal } from '@/services/developer/types';

/**
 * WHAT THIS BUYER IS LOOKING FOR, AND WHAT THEY ARE ON.
 *
 * dev_leads has carried `preferences` since the schema was written — the
 * districts somebody asked for, the number of bedrooms, a floor they will not
 * go below — and nothing in the product ever displayed it. A salesperson
 * opening a buyer saw a source, a budget range and a language, and had to
 * remember the rest or read the notes.
 *
 * `preferences` is free-shaped jsonb by design, because what a buyer wants is
 * not a fixed schema. So this renders the keys it UNDERSTANDS as proper facts
 * and everything else verbatim underneath — a requirement nobody anticipated
 * is still shown, rather than silently dropped because it had no column.
 */

/** The preference keys the product knows how to draw. Anything else is text. */
const KNOWN: Record<string, { labelKey: string; icon: React.ComponentType<{ className?: string }> }> = {
  districts: { labelKey: 'dev_req_districts', icon: MapPin },
  district: { labelKey: 'dev_req_districts', icon: MapPin },
  bedrooms: { labelKey: 'dev_unit_bedrooms', icon: BedDouble },
  rooms: { labelKey: 'dev_unit_rooms', icon: BedDouble },
  area_min: { labelKey: 'dev_req_area_min', icon: Ruler },
  floor_min: { labelKey: 'dev_req_floor_min', icon: Building2 },
};

function renderValue(value: unknown, language: string): string {
  if (value == null) return '—';
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
  if (typeof value === 'number') return formatNumber(value, language);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

interface LinkedUnit {
  unit: DevUnit;
  interest: string;
  reservation: DevReservation | null;
  deal: DevDeal | null;
}

export function LeadRequirements({
  lead, managerName,
}: { lead: LeadWithContact; managerName?: string | null }) {
  const { t, lang: language } = useLanguage();
  const [linked, setLinked] = useState<LinkedUnit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const links = await listLeadUnits(lead.id).catch(() => []);
      if (cancelled) return;
      if (links.length === 0) { setLinked([]); setLoading(false); return; }

      /* One inventory read rather than one per link: a buyer shortlisting six
         apartments should not cost six round trips to draw six rows. */
      const all = await listUnits(lead.workspace_id, { limit: 5000, orderBy: 'unit_number' })
        .catch(() => ({ rows: [] as DevUnit[], total: 0 }));
      if (cancelled) return;
      const byId = new Map(all.rows.map((u) => [u.id, u]));

      const rows = await Promise.all(links.map(async (link) => {
        const unit = byId.get(link.unit_id);
        if (!unit) return null;
        /* The commercial state of each apartment, so the drawer can say
           "shortlisted, and somebody else is holding it". */
        const [reservation, deal] = await Promise.all([
          getUnitReservation(unit.id).catch(() => null),
          getDealByUnit(unit.id).catch(() => null),
        ]);
        return { unit, interest: link.interest, reservation, deal } as LinkedUnit;
      }));
      if (cancelled) return;
      setLinked(rows.filter((r): r is LinkedUnit => r !== null));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [lead.id, lead.workspace_id]);

  const prefs = (lead.preferences ?? {}) as Record<string, unknown>;
  const entries = Object.entries(prefs).filter(([, v]) => v != null && v !== '');
  const known = entries.filter(([k]) => KNOWN[k]);
  const other = entries.filter(([k]) => !KNOWN[k]);
  const overdue = lead.next_follow_up_at
    && new Date(lead.next_follow_up_at).getTime() < Date.now();

  return (
    <div className="space-y-6">
      {/* ── What they asked for ────────────────────────────────────────── */}
      <section>
        <SectionHead title={t('dev_req_title')} />
        <Panel className="p-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact
              label={t('dev_lead_budget')}
              value={lead.budget_min || lead.budget_max ? (
                <>
                  <Money amount={lead.budget_min} currency={lead.currency} />
                  {' – '}
                  <Money amount={lead.budget_max} currency={lead.currency} />
                </>
              ) : '—'}
            />
            {known.map(([key, value]) => (
              <Fact
                key={key}
                label={t(KNOWN[key].labelKey)}
                value={key === 'area_min'
                  ? formatArea(Number(value), language)
                  : renderValue(value, language)}
              />
            ))}
            <Fact label={t('dev_lead_source')} value={lead.source ?? '—'} />
            <Fact
              label={t('dev_req_manager')}
              value={managerName ?? (lead.assigned_to ? t('dev_req_assigned') : '—')}
            />
            <Fact
              label={t('dev_req_next_action')}
              value={lead.next_follow_up_at
                ? (
                  <span className={overdue ? 'text-amber-700 dark:text-amber-400' : undefined}>
                    {formatDate(lead.next_follow_up_at, language)}
                  </span>
                )
                : '—'}
            />
          </dl>

          {/* Anything the buyer asked for that has no column of its own. */}
          {other.length > 0 && (
            <ul className="mt-4 space-y-1.5 border-t border-border pt-3">
              {other.map(([key, value]) => (
                <li key={key} className="flex items-baseline gap-2 text-xs">
                  <span className="shrink-0 text-muted-foreground">{key}</span>
                  <span className="min-w-0 flex-1 truncate">{renderValue(value, language)}</span>
                </li>
              ))}
            </ul>
          )}

          {entries.length === 0 && (
            <p className="mt-3 border-t border-border pt-3 text-2xs text-muted-foreground">
              {t('dev_req_none')}
            </p>
          )}
        </Panel>
      </section>

      {/* ── The apartments they are on ─────────────────────────────────── */}
      <section>
        <SectionHead title={t('dev_req_units')} sub={t('dev_req_units_sub')} />
        {loading ? (
          <Panel className="p-4">
            <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          </Panel>
        ) : linked.length === 0 ? (
          <Panel className="p-4">
            <p className="text-xs text-muted-foreground">{t('dev_req_units_none')}</p>
          </Panel>
        ) : (
          <Panel className="divide-y divide-border">
            {linked.map(({ unit, interest, reservation, deal }) => (
              <Link
                key={unit.id}
                to={`/developers/projects/${unit.project_id}?unit=${unit.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate tabular text-sm font-medium">{unit.unit_number}</span>
                  <span className="block truncate text-2xs text-muted-foreground">
                    {[
                      unit.area_total ? formatArea(unit.area_total, language) : null,
                      unit.floor_level != null
                        ? `${t('dev_unit_floor')} ${formatNumber(unit.floor_level, language)}` : null,
                      t(`dev_interest_${interest.toLowerCase()}`),
                    ].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {/* Somebody ELSE holding or buying it is the thing a
                    salesperson most needs to see before they promise it. */}
                {deal ? (
                  <span className="shrink-0 text-2xs font-medium text-muted-foreground">
                    {t('dev_sales_tab_contracts')}
                  </span>
                ) : reservation ? (
                  <span className="shrink-0 text-2xs font-medium text-amber-700 dark:text-amber-400">
                    {t('dev_sales_tab_reservations')}
                  </span>
                ) : null}
                <UnitStatusPill status={unit.status} />
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            ))}
          </Panel>
        )}
      </section>

      {lead.notes && (
        <section>
          <SectionHead title={t('dev_lead_notes')} />
          <Panel className="p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{lead.notes}</p>
          </Panel>
        </section>
      )}

      {lead.assigned_to && (
        <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          <UserCog className="h-3 w-3" aria-hidden="true" />
          {t('dev_req_assigned')}
        </p>
      )}
    </div>
  );
}

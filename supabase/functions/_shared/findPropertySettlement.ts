// PHASE 2 — what a FIND PROPERTY run charges: delivered listings, nothing else.
//
// OWNER RULE (2026-10-02). A run that delivers zero usable listings is never
// charged: the reservation is released and the customer pays 0. A run that
// delivers listings pays for exactly those -- never for failed, rejected,
// duplicate, unusable or undelivered results -- and never more than the
// reservation the customer authorised.
//
// WHY THIS DOES NOT CALL settleExecution. The shared settle prices the WORK
// (billing_price_quote over measured COGS, falling back to the product's
// reference COGS), so a portal run whose fetches cost $0 was charged the full
// reference price whether it delivered nothing or ten flats. billing.ts is
// shared with Verify and stays untouched; this module prices the RESULTS for
// Phase 2 only, with the same two wallet RPCs settleExecution ends in:
//
//   unit price  billing_price_quote(product, the plan the run STARTED under)
//               -- the plan's discount and margin floor still apply per unit
//   charge      unit price x billable deliveries, capped at the reservation
//               (wallet_settle caps again at authorized_max_credits)
//   0 delivered wallet_release through releaseExecution (charge 0)
//
// WHAT IS BILLABLE. Read from supply_matches on the server, never from a caller:
//   * the run's own plan (intent_profile_id), shape EXTERNAL_LISTING
//   * compatibility COMPATIBLE (what find-property shows)
//   * first matched during this run (created_at >= started_at); an upsert keeps
//     created_at, so a listing re-scored by a later run is not billed again
//   * the observation not INVALID or REMOVED
//   * one per PROPERTY: observations of one supply_entity count once, and so do
//     observations cross-source dedupe proves are one property (the same ad in
//     three Telegram channels, a portal listing and its repost: same post,
//     same text, a shared contact with matching area and rooms/price, the
//     same coordinates -- discovery/cross-source-dedupe.ts); a property
//     already delivered to this plan before the run is not billed again
//
// IDEMPOTENT. Only the caller whose conditional update moves the run from
// MATCHING with credits_charged still null settles; any repeat returns what
// was recorded. The wallet RPCs are themselves no-ops on a reservation that
// is no longer RESERVED.

import type { ExecutionGrant } from './billing.ts';
import { fromObservationRow } from '../../../src/research-core/discovery/discovery-entity.ts';
import { dedupe } from '../../../src/research-core/discovery/cross-source-dedupe.ts';

type Json = Record<string, unknown>;

export const NOT_BILLABLE_VALIDATION = ['INVALID', 'REMOVED'];

type DeliveredObservation = { entity_id?: string | null; validation_state?: string | null; content_fingerprint?: string | null } & Record<string, unknown>;

export interface DeliveryRow {
  observation_id: string;
  created_at: string;
  compatibility?: string | null;
  observation?: DeliveredObservation | DeliveredObservation[] | null;
}

/**
 * observation_id → the property it is (pure). Observations the entity resolver
 * already linked (one supply_entity) are ALWAYS one property -- dedupe can only
 * join more, never split them; the rest are joined on cross-source evidence.
 */
export function propertyKeys(rows: readonly DeliveryRow[]): Map<string, string> {
  const representative = new Map<string, string>();
  const items = [];
  const seen = new Set<string>();
  const itemIds = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.observation_id)) continue;
    seen.add(row.observation_id);
    const o = (Array.isArray(row.observation) ? row.observation[0] : row.observation) ?? {};
    const entityId = (o.entity_id as string | null) ?? null;
    const id = entityId ? `entity:${entityId}` : `obs:${row.observation_id}`;
    representative.set(row.observation_id, id);
    if (itemIds.has(id)) continue;
    itemIds.add(id);
    items.push({ id, entity: fromObservationRow(o as never), fingerprint: (o.content_fingerprint as string | null) ?? null });
  }
  const { keyOf } = dedupe(items);
  const out = new Map<string, string>();
  for (const [observationId, id] of representative) out.set(observationId, keyOf.get(id) ?? id);
  return out;
}

export interface Deliveries {
  /** Distinct properties delivered by this run: the billable count. */
  delivered: number;
  /** Matched rows this run that were not billable, by reason. */
  excluded: { incompatible: number; unusable: number; duplicate: number; previouslyDelivered: number };
}

/** Pure: the billable deliveries among a plan's EXTERNAL_LISTING matches. */
export function billableDeliveries(rows: readonly DeliveryRow[], runStartedAt: string): Deliveries {
  const started = Date.parse(runStartedAt);
  const excluded = { incompatible: 0, unusable: 0, duplicate: 0, previouslyDelivered: 0 };
  const property = propertyKeys(rows);
  const usable = (row: DeliveryRow) => {
    const o = Array.isArray(row.observation) ? row.observation[0] : row.observation;
    const state = String(o?.validation_state ?? '').toUpperCase();
    return { key: property.get(row.observation_id) ?? String(o?.entity_id ?? row.observation_id), ok: !NOT_BILLABLE_VALIDATION.includes(state) };
  };
  const compatible = (row: DeliveryRow) => (row.compatibility ?? 'COMPATIBLE') === 'COMPATIBLE';

  const before = new Set<string>();
  for (const row of rows) {
    if (Date.parse(row.created_at) >= started || !compatible(row)) continue;
    const { key, ok } = usable(row);
    if (ok) before.add(key);
  }
  const counted = new Set<string>();
  for (const row of rows) {
    if (!(Date.parse(row.created_at) >= started)) continue;
    if (!compatible(row)) { excluded.incompatible++; continue; }
    const { key, ok } = usable(row);
    if (!ok) { excluded.unusable++; continue; }
    if (before.has(key)) { excluded.previouslyDelivered++; continue; }
    if (counted.has(key)) { excluded.duplicate++; continue; }
    counted.add(key);
  }
  return { delivered: counted.size, excluded };
}

export type SettlementPlan =
  | { action: 'RELEASE'; credits: 0; reason: 'NO_DELIVERED_LISTINGS' | 'NO_RESERVATION' }
  | { action: 'SETTLE'; credits: number; unitCredits: number; capped: boolean };

/** Pure: release on zero, otherwise unit x delivered capped at the reservation. */
export function planSettlement(input: {
  delivered: number; unitCredits: number; authorizedMaxCredits: number; reservationId: string | null;
}): SettlementPlan {
  if (!input.reservationId) return { action: 'RELEASE', credits: 0, reason: 'NO_RESERVATION' };
  if (!(input.delivered > 0)) return { action: 'RELEASE', credits: 0, reason: 'NO_DELIVERED_LISTINGS' };
  if (!(Number.isFinite(input.unitCredits) && input.unitCredits > 0)) {
    throw new Error(`no unit price for a delivered listing (${input.unitCredits})`);
  }
  const raw = Math.round(input.unitCredits * input.delivered * 100) / 100;
  const cap = Number(input.authorizedMaxCredits);
  const capped = Number.isFinite(cap) && cap >= 0 && raw > cap;
  return { action: 'SETTLE', credits: capped ? cap : raw, unitCredits: input.unitCredits, capped };
}

/** The plan's EXTERNAL_LISTING matches, newest state, from the server. */
export async function loadDeliveries(db: any, intentProfileId: string | null, runStartedAt: string): Promise<Deliveries> {
  if (!intentProfileId) return billableDeliveries([], runStartedAt);
  const { data, error } = await db.from('supply_matches')
    .select('observation_id,created_at,compatibility,observation:supply_observations!observation_id('
      + 'entity_id,validation_state,content_fingerprint,adapter_id,external_id,canonical_url,transaction,property_type,'
      + 'country_code,city,district,sale_amount,sale_currency,rent_amount,rent_currency,area_sqm,rooms,bedrooms,'
      + 'published_at,description,field_origins)')
    .eq('intent_profile_id', intentProfileId)
    .eq('source_kind', 'EXTERNAL_LISTING')
    .limit(5000);
  if (error) throw error;
  return billableDeliveries((data ?? []) as DeliveryRow[], runStartedAt);
}

/** Exactly one finaliser per run gets true; a repeat (or a lost race) gets false. */
export async function claimSettlement(db: any, runId: string): Promise<boolean> {
  const { data, error } = await db.from('discovery_runs')
    .update({ stage: 'SETTLING', updated_at: new Date().toISOString() })
    .eq('id', runId).eq('status', 'MATCHING').neq('stage', 'SETTLING').is('credits_charged', null)
    .select('id');
  if (error) throw error;
  return Array.isArray(data) && data.length === 1;
}

export interface SettlementUsage {
  runId: string;
  searchCount: number;
  durationMs: number;
  providerCostUsd: number;
  providerCostUnknown: boolean;
  deliveries: Deliveries;
}

export interface SettlementOutcome {
  action: 'RELEASE' | 'SETTLE' | 'NONE';
  creditsCharged: number;
  unitCredits?: number;
  capped?: boolean;
}

/**
 * Charge (or release) a finished run. `release` is billing.ts releaseExecution,
 * passed in so this module never imports the shared billing at runtime.
 */
export async function settleFindPropertyRun(
  db: any,
  grant: ExecutionGrant | null,
  usage: SettlementUsage,
  release: (grant: ExecutionGrant, reason: string, usage?: any) => Promise<void>,
): Promise<SettlementOutcome> {
  if (!grant) return { action: 'NONE', creditsCharged: 0 };
  const metadata: Json = {
    delivered_listings: usage.deliveries.delivered,
    not_billed: usage.deliveries.excluded,
    provider_cost_unknown: usage.providerCostUnknown,
    pricing: 'per_delivered_listing',
  };
  const providerCostCents = usage.providerCostUnknown ? 0 : usage.providerCostUsd * 100;

  let unitCredits = Number.NaN;
  if (usage.deliveries.delivered > 0 && grant.reservationId) {
    const { data: quote, error } = await db.rpc('billing_price_quote', {
      p_product_code: grant.productCode, p_plan_code: grant.planCode, p_landed_cogs_cents: null,
    });
    if (error) throw new Error(`billing_price_quote failed: ${error.message}`);
    unitCredits = Number((Array.isArray(quote) ? quote[0] : quote)?.credits);
  }
  const plan = planSettlement({
    delivered: usage.deliveries.delivered,
    unitCredits,
    authorizedMaxCredits: grant.authorizedMaxCredits,
    reservationId: grant.reservationId,
  });

  if (plan.action === 'RELEASE') {
    await release(grant, plan.reason.toLowerCase(), {
      provider: 'homatch_discovery',
      providerOperation: 'find_property_run',
      providerRequestId: usage.runId,
      rawProviderCostCents: providerCostCents,
    });
    return { action: 'RELEASE', creditsCharged: 0 };
  }

  const { data, error } = await db.rpc('wallet_settle', {
    p_reservation_id: grant.reservationId,
    p_actual_credits: plan.credits,
    p_usage: {
      provider: 'homatch_discovery',
      provider_operation: 'find_property_run',
      provider_request_id: usage.runId,
      search_count: usage.searchCount,
      provider_units: usage.deliveries.delivered,
      duration_ms: usage.durationMs,
      raw_provider_cost_cents: providerCostCents,
      ai_cost_cents: 0,
      metadata: { ...metadata, unit_credits: plan.unitCredits, capped_by_run: plan.capped },
    },
    p_outcome: 'SUCCESS',
  });
  if (error) throw new Error(`wallet_settle failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) ?? {};
  return {
    action: 'SETTLE',
    creditsCharged: Number(row.settled_credits ?? plan.credits),
    unitCredits: plan.unitCredits,
    capped: plan.capped || row.clamped === true,
  };
}

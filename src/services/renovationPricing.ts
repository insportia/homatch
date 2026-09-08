// HOMATCH — renovation pricing: the gate between the survey and the customer.
//
// THE INVARIANT
// -------------
// A customer estimate may ONLY be produced from VERIFIED items in the single
// PUBLISHED price-book version. It is enforced in three places, deliberately:
//
//   * the `renovation_active_prices` view filters to exactly that set,
//   * RLS on renovation_price_items restates the same rule at the table, so a
//     query that bypasses the view still cannot see a provisional price,
//   * and `loadCustomerPriceBook()` below refuses to return a book at all
//     when the set is empty.
//
// Today that set IS empty: version 1 is a DRAFT of 13 provisional items. So
// the calculator does not price anything, and says so. That is the correct
// behaviour, not a bug to work around — the alternative is showing someone a
// five-figure renovation number derived from prices nobody has checked.

import { supabase } from '@/db/supabase';
import { validatePriceBook } from '@/renovation/calculations/priceBook';
import type { PriceBook, PriceItem } from '@/renovation/calculations/priceBook';

export type PricingAvailability =
  | { state: 'PRICED'; book: PriceBook; versionId: string; version: number }
  | { state: 'INSUFFICIENT_PRICE_DATA'; verifiedCount: number; reason: string };

/** Rows the customer-facing view returns. */
interface ActivePriceRow {
  id: string;
  version_id: string;
  market: string;
  version: number;
  item_key: string;
  category: string;
  label: string;
  unit: PriceItem['unit'];
  cost_kind: 'LABOR' | 'MATERIAL' | 'COMBINED';
  waste_factor: string | number;
  price_low: string | number | null;
  price_base: string | number;
  price_high: string | number | null;
  currency: string;
  source: string | null;
  source_date: string | null;
  verified_at: string | null;
}

// Postgres numerics arrive as strings through PostgREST. Coercing here rather
// than trusting the wire type avoids silent string concatenation later in the
// arithmetic.
const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Builds the engine's low/typical/high triple from one row, tolerating a row
 * that only carries a base price. The triple is forced into order because
 * validatePriceBook() rejects an unordered one. */
function tripleOf(r: ActivePriceRow): { low: number; typical: number; high: number } | null {
  const typical = num(r.price_base);
  if (typical === null || typical <= 0) return null;
  const low = num(r.price_low) ?? typical;
  const high = num(r.price_high) ?? typical;
  return { low: Math.min(low, typical), typical, high: Math.max(high, typical) };
}

/**
 * Loads the price book a customer estimate may use.
 *
 * Returns INSUFFICIENT_PRICE_DATA rather than an empty book, so a caller
 * cannot accidentally treat "no verified prices" as "everything costs zero".
 * The distinction matters: an empty PriceBook would still multiply cleanly
 * through the engine and produce a confident 0 GEL.
 */
export async function loadCustomerPriceBook(market = 'tbilisi'): Promise<PricingAvailability> {
  const { data, error } = await supabase
    .from('renovation_active_prices')
    .select('*')
    .eq('market', market);
  if (error) throw error;

  const rows = (data ?? []) as ActivePriceRow[];
  if (!rows.length) {
    return { state: 'INSUFFICIENT_PRICE_DATA', verifiedCount: 0, reason: 'no_published_verified_prices' };
  }

  // A logical item can be stored as one COMBINED row, or as a LABOR row plus a
  // MATERIAL row so the estimate can show the split. Group first, then build.
  const byKey = new Map<string, ActivePriceRow[]>();
  for (const r of rows) {
    const list = byKey.get(r.item_key) ?? [];
    list.push(r);
    byKey.set(r.item_key, list);
  }

  const items: PriceItem[] = [];
  for (const [key, group] of byKey) {
    const head = group[0];
    const labourRow = group.find((g) => g.cost_kind === 'LABOR');
    const materialRow = group.find((g) => g.cost_kind === 'MATERIAL');
    const combinedRow = group.find((g) => g.cost_kind === 'COMBINED');

    // A COMBINED rate already includes its own materials and their waste, so
    // it is carried as labour with no material line and no waste multiplier.
    // Applying waste to an all-in rate would inflate it twice.
    const labour = tripleOf(labourRow ?? combinedRow ?? head);
    if (!labour) continue;
    const material = materialRow ? tripleOf(materialRow) : null;

    const waste = combinedRow && !materialRow ? 0 : num((materialRow ?? head).waste_factor) ?? 0;

    const provenanceRow = materialRow ?? labourRow ?? combinedRow ?? head;
    items.push({
      key,
      category: head.category,
      label: head.label,
      unit: head.unit,
      material,
      labour,
      wasteFactor: Math.min(Math.max(waste, 0), 0.3),
      review: 'ADMIN_REVIEWED',
      provenance: provenanceRow.source
        ? [
            {
              source: provenanceRow.source,
              observedAt: provenanceRow.source_date ?? provenanceRow.verified_at ?? new Date(0).toISOString(),
              value: labour.typical + (material?.typical ?? 0),
            },
          ]
        : [],
    });
  }

  if (!items.length) {
    return { state: 'INSUFFICIENT_PRICE_DATA', verifiedCount: rows.length, reason: 'no_usable_items' };
  }

  const book: PriceBook = {
    market: market as PriceBook['market'],
    version: rows[0].version,
    effectiveFrom: rows[0].verified_at ?? new Date().toISOString(),
    currency: 'GEL',
    items,
  };

  // The same structural validation the in-code seed book is held to. A book
  // assembled from database rows must not be allowed to break a rule the
  // hard-coded one obeys — that would be a silent second standard.
  const problems = validatePriceBook(book);
  if (problems.length) {
    return {
      state: 'INSUFFICIENT_PRICE_DATA',
      verifiedCount: items.length,
      reason: `invalid_price_book:${problems[0]}`,
    };
  }

  return { state: 'PRICED', versionId: rows[0].version_id, version: rows[0].version, book };
}

/* ------------------------------------------------------------------ *
 * Scenario persistence                                                *
 * ------------------------------------------------------------------ */

export interface RenovationScenarioRecord {
  id: string;
  deal_room_id: string | null;
  name: string | null;
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
  price_book_version_id: string | null;
  estimate_state: 'NOT_PRICED' | 'PRICED' | 'INSUFFICIENT_PRICE_DATA';
  created_at: string;
  updated_at: string;
}

const SCENARIO_COLUMNS =
  'id,deal_room_id,name,inputs,result,price_book_version_id,estimate_state,created_at,updated_at';

export async function listScenarios(roomId: string | null): Promise<RenovationScenarioRecord[]> {
  let q = supabase.from('renovation_scenarios').select(SCENARIO_COLUMNS);
  q = roomId ? q.eq('deal_room_id', roomId) : q.is('deal_room_id', null);
  const { data, error } = await q.order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as RenovationScenarioRecord[];
}

/**
 * Saves a scenario, pinning the price version it was computed against.
 *
 * Pinning is what makes an old estimate explainable: reopening it months later
 * shows the numbers it was actually built from, rather than silently
 * recomputing against whatever the current book says.
 */
export async function saveScenario(args: {
  roomId: string | null;
  name: string;
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
  priceBookVersionId: string | null;
  estimateState: RenovationScenarioRecord['estimate_state'];
  scenarioId?: string;
}): Promise<RenovationScenarioRecord> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const userId = auth.user?.id;
  if (!userId) throw new Error('not_authenticated');

  const payload = {
    deal_room_id: args.roomId,
    user_id: userId,
    name: args.name.trim() || null,
    inputs: args.inputs,
    result: args.result,
    price_book_version_id: args.priceBookVersionId,
    estimate_state: args.estimateState,
  };

  const q = args.scenarioId
    ? supabase.from('renovation_scenarios').update(payload).eq('id', args.scenarioId)
    : supabase.from('renovation_scenarios').insert(payload);

  const { data, error } = await q.select(SCENARIO_COLUMNS).single();
  if (error) throw error;
  return data as unknown as RenovationScenarioRecord;
}

export async function deleteScenario(id: string): Promise<void> {
  const { error } = await supabase.from('renovation_scenarios').delete().eq('id', id);
  if (error) throw error;
}

/* ------------------------------------------------------------------ *
 * Admin: the survey and the review queue                              *
 * ------------------------------------------------------------------ */

export interface PriceObservationRecord {
  id: string;
  market: string;
  item_key: string;
  category: string | null;
  observed_value: number;
  observed_unit: string;
  normalized_value: number | null;
  normalized_unit: string | null;
  normalization_note: string | null;
  currency: string;
  source_type: string;
  source_name: string;
  source_url: string | null;
  source_date: string | null;
  collected_at: string;
  review_state: 'PENDING' | 'APPROVED' | 'REJECTED' | 'OUTLIER';
  review_note: string | null;
  reviewed_at: string | null;
}

export async function listObservations(
  reviewState?: PriceObservationRecord['review_state']
): Promise<PriceObservationRecord[]> {
  let q = supabase.from('renovation_price_observations').select('*');
  if (reviewState) q = q.eq('review_state', reviewState);
  const { data, error } = await q.order('collected_at', { ascending: false }).limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as PriceObservationRecord[];
}

export async function reviewObservation(
  id: string,
  state: PriceObservationRecord['review_state'],
  note?: string
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('renovation_price_observations')
    .update({
      review_state: state,
      review_note: note?.trim() || null,
      reviewed_by: auth.user?.id ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
}

export interface PriceItemRecord {
  id: string;
  version_id: string;
  item_key: string;
  category: string;
  label: string;
  unit: string;
  cost_kind: string;
  price_low: number | null;
  price_base: number;
  price_high: number | null;
  currency: string;
  status: 'PROVISIONAL' | 'VERIFIED' | 'STALE' | 'REJECTED';
  source: string | null;
  source_url: string | null;
  source_date: string | null;
  active: boolean;
  notes: string | null;
  verified_at: string | null;
}

export async function listPriceItems(versionId: string): Promise<PriceItemRecord[]> {
  const { data, error } = await supabase
    .from('renovation_price_items')
    .select('*')
    .eq('version_id', versionId)
    .order('category', { ascending: true })
    .order('item_key', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as PriceItemRecord[];
}

export interface PriceVersionRecord {
  id: string;
  market: string;
  version: number;
  currency: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  notes: string | null;
  published_at: string | null;
  created_at: string;
}

export async function listPriceVersions(): Promise<PriceVersionRecord[]> {
  const { data, error } = await supabase
    .from('renovation_price_book_versions')
    .select('*')
    .order('market', { ascending: true })
    .order('version', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PriceVersionRecord[];
}

/**
 * Marks one item VERIFIED.
 *
 * The database refuses this unless `source` is present, via the
 * `renovation_price_items_verified_needs_evidence_ck` constraint — so a
 * price cannot be promoted on somebody's say-so. This function supplies the
 * verifier and timestamp; the caller must supply the evidence.
 */
export async function verifyPriceItem(
  id: string,
  evidence: { source: string; sourceUrl?: string; sourceDate?: string; base?: number }
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('not_authenticated');
  if (!evidence.source?.trim()) throw new Error('verification_requires_a_source');

  const patch: Record<string, unknown> = {
    status: 'VERIFIED',
    source: evidence.source.trim(),
    source_url: evidence.sourceUrl?.trim() || null,
    source_date: evidence.sourceDate || null,
    verified_by: userId,
    verified_at: new Date().toISOString(),
  };
  if (typeof evidence.base === 'number' && evidence.base > 0) patch.price_base = evidence.base;

  const { error } = await supabase.from('renovation_price_items').update(patch).eq('id', id);
  if (error) throw error;
}

export async function setPriceItemStatus(
  id: string,
  status: PriceItemRecord['status']
): Promise<void> {
  const { error } = await supabase.from('renovation_price_items').update({ status }).eq('id', id);
  if (error) throw error;
}

/**
 * Publishes a draft version.
 *
 * Refuses when the version still contains provisional items, because
 * publishing is precisely the moment those would become customer-visible.
 * The check is here as well as in the UI so an API caller cannot skip it.
 */
export async function publishPriceVersion(versionId: string): Promise<void> {
  const items = await listPriceItems(versionId);
  const unverified = items.filter((i) => i.active && i.status !== 'VERIFIED');
  if (unverified.length) {
    throw new Error(`cannot_publish:${unverified.length}_items_not_verified`);
  }
  if (!items.some((i) => i.active && i.status === 'VERIFIED')) {
    throw new Error('cannot_publish:no_verified_items');
  }

  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('renovation_price_book_versions')
    .update({
      status: 'PUBLISHED',
      published_at: new Date().toISOString(),
      published_by: auth.user?.id ?? null,
    })
    .eq('id', versionId);
  if (error) throw error;
}

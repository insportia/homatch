/*
 * FIND PROPERTY → THE HOMATCH NETWORK.
 *
 * A Marketplace Search is a person telling HOMATCH what they are looking for. That same
 * statement is matched against properties HOMATCH members own — through the native
 * matcher (supply-matching, nativeOnly), never through a catalogue. This writes the
 * canonical demand exactly as a confirmed search plan does (find-property-plan, confirm):
 * one intent_profiles row, one SUPPLY subscription (a person watching for listings) and
 * the recorded requirement, then asks the matcher to run.
 *
 * Free by construction: nothing here touches the wallet, and discover_brokers is false —
 * external or broker discovery stays the separate, explicit action it always was.
 *
 * Find Buyers 2.0 (owner, 2026-10-18): the profile also carries what the brief states beyond
 * the plan vocabulary — rooms (the matcher compares them with a listing's own room count) and
 * the stated features (`requirements`) — and ONE demand per distinct search: the same person
 * repeating the same search refreshes `last_active_at` of the profile they already have
 * (same fingerprint) instead of adding another. A different search is a different demand.
 */
import {
  type PlanDraft,
  normalisePlan,
  planReadiness,
  planToIntentProfile,
} from '../../../src/research-core/discovery/search-plan.ts';
import { recordIntent } from './intent.ts';

// deno-lint-ignore no-explicit-any
type Db = any;

export interface SeekerExtras {
  /** demandFingerprint(brief), hashed here; equal fingerprints are the same demand. */
  fingerprint?: string | null;
  roomsMin?: number | null;
  roomsMax?: number | null;
  requirements?: Record<string, unknown>;
}

/** A column this code writes that the database does not have yet (migration not applied). */
const missingColumn = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42703' || e.code === 'PGRST204' || /column .* does not exist|Could not find the .* column/i.test(e.message ?? ''));

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Returns the intent id (new, or the refreshed existing one), or null when the brief cannot become a matchable demand. */
export async function recordSeekerIntent(db: Db, userId: string, draft: PlanDraft, source: { marketplaceSearchId: string }, extras: SeekerExtras = {}): Promise<string | null> {
  const { plan } = normalisePlan(draft);
  if (!plan || !planReadiness(plan).ready) return null;
  const now = new Date().toISOString();
  const fingerprint = extras.fingerprint ? await sha256(extras.fingerprint) : null;

  /* The same search again: refresh the demand the person already has. */
  if (fingerprint) {
    const { data: same, error: sameError } = await db.from('active_search_subscriptions')
      .select('id,intent_id,search_criteria').eq('user_id', userId).eq('side', 'SUPPLY').eq('is_active', true)
      .eq('demand_fingerprint', fingerprint).limit(1).maybeSingle();
    if (!sameError && same?.intent_id) {
      await db.from('active_search_subscriptions').update({
        last_active_at: now,
        search_criteria: { ...(same.search_criteria ?? {}), marketplaceSearchId: source.marketplaceSearchId },
      }).eq('id', same.id);
      await db.from('intent_profiles').update({ last_active_at: now }).eq('id', same.intent_id);
      return String(same.intent_id);
    }
  }

  const base = planToIntentProfile(plan, { language: plan.originalLanguage });
  const richer = {
    ...base,
    rooms_min: extras.roomsMin ?? null,
    rooms_max: extras.roomsMax ?? extras.roomsMin ?? null,
    requirements: extras.requirements ?? {},
    last_active_at: now,
  };
  let ins = await db.from('intent_profiles').insert(richer).select('id').single();
  if (missingColumn(ins.error)) ins = await db.from('intent_profiles').insert({ ...base, rooms_min: richer.rooms_min, rooms_max: richer.rooms_max }).select('id').single();
  const { data: intent, error: intentError } = ins;
  if (intentError || !intent) throw new Error(`intent insert failed: ${intentError?.message ?? 'no row'}`);

  const sub = {
    user_id: userId,
    intent_id: intent.id,
    side: 'SUPPLY',
    is_active: true,
    search_criteria: { ...plan, marketplaceSearchId: source.marketplaceSearchId },
    discover_brokers: false,
  };
  let subIns = await db.from('active_search_subscriptions').insert({ ...sub, demand_fingerprint: fingerprint, last_active_at: now, demand_source: 'MARKETPLACE_SEARCH' });
  if (missingColumn(subIns.error)) subIns = await db.from('active_search_subscriptions').insert(sub);
  if (subIns.error?.code === '23505' && fingerprint) {
    /* A concurrent identical search won the unique index: this profile is surplus. */
    await db.from('intent_profiles').delete().eq('id', intent.id);
    const { data: winner } = await db.from('active_search_subscriptions').select('intent_id')
      .eq('user_id', userId).eq('demand_fingerprint', fingerprint).eq('is_active', true).limit(1).maybeSingle();
    return winner?.intent_id ? String(winner.intent_id) : null;
  }
  const subError = subIns.error;
  if (subError) throw new Error(`subscription insert failed: ${subError.message}`);

  await recordIntent(db, {
    actorUserId: userId,
    sourceSurface: 'SEARCH_PLAN',
    sourceEventId: intent.id,
    sourceAt: new Date().toISOString(),
    side: 'DEMAND',
    act: 'REQUIREMENT',
    dimension: null,
    polarity: 'POSITIVE',
    attribution: 'SELF',
    explicit: true,
    confidence: 1,
    scope: 'SEARCH',
    intentProfileId: intent.id,
    constraints: {
      transactionType: plan.deal === 'INVESTMENT' ? 'SALE' : plan.deal,
      city: plan.city?.value ?? null,
      district: plan.districts?.value?.[0] ?? null,
      districts: plan.districts?.value ?? null,
      propertyTypes: plan.propertyTypes?.value ?? null,
      budgetMin: plan.budget?.value.min ?? null,
      budgetMax: plan.budget?.value.max ?? null,
      currency: plan.budget?.value.currency ?? null,
      bedroomsMin: plan.bedrooms?.value.min ?? null,
      bedroomsMax: plan.bedrooms?.value.max ?? null,
      areaMin: plan.areaSqm?.value.min ?? null,
      areaMax: plan.areaSqm?.value.max ?? null,
      roomsMin: extras.roomsMin ?? null,
      roomsMax: extras.roomsMax ?? extras.roomsMin ?? null,
      ...(extras.requirements && Object.keys(extras.requirements).length ? { features: extras.requirements } : {}),
    },
    strength: {
      ...(plan.city && plan.city.strength !== 'UNKNOWN' ? { CITY: plan.city.strength } : {}),
      ...(plan.districts && plan.districts.strength !== 'UNKNOWN' ? { DISTRICT: plan.districts.strength } : {}),
      ...(plan.propertyTypes && plan.propertyTypes.strength !== 'UNKNOWN' ? { PROPERTY_TYPE: plan.propertyTypes.strength } : {}),
      ...(plan.budget && plan.budget.strength !== 'UNKNOWN' ? { PRICE: plan.budget.strength } : {}),
      ...(plan.bedrooms && plan.bedrooms.strength !== 'UNKNOWN' ? { BEDROOMS: plan.bedrooms.strength } : {}),
      ...(plan.areaSqm && plan.areaSqm.strength !== 'UNKNOWN' ? { AREA: plan.areaSqm.strength } : {}),
    },
  });
  return String(intent.id);
}

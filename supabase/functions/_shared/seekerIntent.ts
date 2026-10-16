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

/** Returns the new intent id, or null when the brief cannot become a matchable demand. */
export async function recordSeekerIntent(db: Db, userId: string, draft: PlanDraft, source: { marketplaceSearchId: string }): Promise<string | null> {
  const { plan } = normalisePlan(draft);
  if (!plan || !planReadiness(plan).ready) return null;

  const { data: intent, error: intentError } = await db.from('intent_profiles')
    .insert(planToIntentProfile(plan, { language: plan.originalLanguage })).select('id').single();
  if (intentError || !intent) throw new Error(`intent insert failed: ${intentError?.message ?? 'no row'}`);

  const { error: subError } = await db.from('active_search_subscriptions').insert({
    user_id: userId,
    intent_id: intent.id,
    side: 'SUPPLY',
    is_active: true,
    search_criteria: { ...plan, marketplaceSearchId: source.marketplaceSearchId },
    discover_brokers: false,
  });
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

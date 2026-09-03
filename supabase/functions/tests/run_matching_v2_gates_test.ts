/**
 * run-matching-v2 — Hard Gate Unit Tests (Task #60)
 * Run with: deno test --allow-env --allow-read run_matching_v2_gates_test.ts
 *
 * Mirrors the pure decision logic in supabase/functions/run-matching-v2/index.ts
 * (norm/similar/typeGroupOf/typeCompatible/TYPE_GROUPS/INTENT_TRANSACTION_FALLBACK
 * and the hard-gate sequence itself), following the same self-contained-mirror
 * convention already used by tests/phase7_outreach_test.ts in this repo — there is
 * no test harness wired up in this project that imports directly from a deployed
 * edge function, so keeping this file in sync with index.ts by hand (as that file
 * already is) is the existing, established pattern here, not a shortcut invented
 * for this test.
 *
 * Before this fix, run-matching-v2 only capped a KNOWN transaction/type mismatch
 * at score 49 (still above its 20-point creation floor) and never penalized a
 * district mismatch at all — so a FOR_SALE property could "match" a RENT-seeking
 * signal, and a property in one district could match someone who explicitly wants
 * a different one, as long as the city matched. Confirmed against LIVE production
 * data before writing this fix (see the Task #60 migration
 * run_matching_v2_hard_gates_cleanup and its retroactive REJECTED cleanup of 19
 * matches that these exact hard gates now catch). These tests assert the fixed
 * behavior directly, independent of that one-time cleanup.
 */

import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// ─── Mirrors: supabase/functions/run-matching-v2/index.ts ─────────────────────

const INTENT_TRANSACTION_FALLBACK: Record<string, string[]> = {
  BUY: ['sale'],
  RELOCATE_BUY: ['sale'],
  RENT: ['rent'],
  RELOCATE_RENT: ['rent'],
  INVEST: ['sale', 'investment'],
};

function norm(value: any) {
  return String(value || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_');
}
function similar(left: any, right: any) {
  const a = norm(left), b = norm(right);
  if (!a || !b) return 0;
  return a === b || a.includes(b) || b.includes(a) ? 1 : 0;
}

const TYPE_GROUPS = [
  ['commercial', 'office', 'retail', 'warehouse', 'hotel'],
  ['house', 'villa', 'townhouse'],
  ['apartment', 'studio', 'penthouse'],
  ['land', 'plot'],
];
function typeGroupOf(value: string): number {
  if (!value) return -1;
  return TYPE_GROUPS.findIndex((group) => group.some((keyword) => value === keyword || value.includes(keyword) || keyword.includes(value)));
}
function typeCompatible(left: string, right: string) {
  if (left === right) return true;
  const lg = typeGroupOf(left);
  const rg = typeGroupOf(right);
  return lg !== -1 && lg === rg;
}

/** Mirrors the exact hard-gate sequence in the caller loop of index.ts. */
function hardGateDecision(
  property: { id: string; transaction_type: string; property_type?: string },
  facts: { district?: string | null; neighborhood?: string | null; city?: string | null } | null,
  profile: {
    intent_type: string;
    transaction_type?: string | null;
    property_types?: string[] | null;
    district?: string | null;
    neighborhoods?: string[] | null;
    city?: string | null;
  },
  signal: { property_id?: string | null } = {},
): { rejected: boolean; reason?: 'SELF_SOURCED' | 'TRANSACTION' | 'PROPERTY_TYPE' | 'DISTRICT' } {
  const profileIntent = String(profile.intent_type || '').toUpperCase();

  if (signal.property_id && String(signal.property_id) === String(property.id)) {
    return { rejected: true, reason: 'SELF_SOURCED' };
  }

  const propertyTransaction = norm(property.transaction_type);
  const explicitIntentTransaction = norm(profile.transaction_type);
  const compatTransactions = profileIntent === 'INVEST'
    ? INTENT_TRANSACTION_FALLBACK.INVEST
    : explicitIntentTransaction
    ? [explicitIntentTransaction]
    : INTENT_TRANSACTION_FALLBACK[profileIntent] || null;
  if (propertyTransaction && compatTransactions && !compatTransactions.includes(propertyTransaction)) {
    return { rejected: true, reason: 'TRANSACTION' };
  }

  const propertyTypeNorm = norm(property.property_type);
  const intentPropertyTypesKnown = (profile.property_types || []).map(norm).filter((v) => typeGroupOf(v) !== -1);
  if (
    propertyTypeNorm &&
    typeGroupOf(propertyTypeNorm) !== -1 &&
    intentPropertyTypesKnown.length &&
    !intentPropertyTypesKnown.some((value) => typeCompatible(propertyTypeNorm, value))
  ) {
    return { rejected: true, reason: 'PROPERTY_TYPE' };
  }

  const propertyDistrictNorm = norm(facts?.district || facts?.neighborhood);
  const intentDistricts = [profile.district, ...(profile.neighborhoods || [])].filter(Boolean) as string[];
  const cityKnownMismatch = !!facts?.city && !!profile.city && similar(facts.city, profile.city) === 0;
  if (
    propertyDistrictNorm &&
    intentDistricts.length &&
    !cityKnownMismatch &&
    !intentDistricts.some((value) => similar(propertyDistrictNorm, value) >= 0.5)
  ) {
    return { rejected: true, reason: 'DISTRICT' };
  }

  return { rejected: false };
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

const saleApartmentInKrtsanisi = {
  id: 'prop-1',
  transaction_type: 'SALE',
  property_type: 'APARTMENT',
};
const factsKrtsanisiTbilisi = { district: 'Krtsanisi', city: 'Tbilisi' };

// ─── 1. Real production bug: FOR_SALE property must reject a RENT seeker ──────

Deno.test('rejects a RENT-seeking signal against a SALE property (real prod case, id a34339d0-era)', () => {
  const profile = { intent_type: 'RELOCATE_RENT', transaction_type: 'RENT', city: 'Tbilisi' };
  const result = hardGateDecision(saleApartmentInKrtsanisi, factsKrtsanisiTbilisi, profile);
  assert(result.rejected);
  assertEquals(result.reason, 'TRANSACTION');
});

Deno.test('accepts a BUY signal against a SALE property', () => {
  const profile = { intent_type: 'BUY', transaction_type: 'SALE', city: 'Tbilisi' };
  const result = hardGateDecision(saleApartmentInKrtsanisi, factsKrtsanisiTbilisi, profile);
  assertFalse(result.rejected);
});

// ─── 2. INVEST is compatible with BOTH SALE and INVESTMENT properties ─────────

Deno.test('INVEST demand is compatible with a SALE property even when transaction_type says INVESTMENT', () => {
  const profile = { intent_type: 'INVEST', transaction_type: 'INVESTMENT', city: 'Tbilisi' };
  const result = hardGateDecision(saleApartmentInKrtsanisi, factsKrtsanisiTbilisi, profile);
  assertFalse(result.rejected, 'INVEST must never hard-reject a SALE property — live data shows both are the same demand');
});

Deno.test('INVEST demand rejects a RENT property', () => {
  const rentProperty = { ...saleApartmentInKrtsanisi, transaction_type: 'RENT' };
  const profile = { intent_type: 'INVEST', transaction_type: 'INVESTMENT', city: 'Tbilisi' };
  const result = hardGateDecision(rentProperty, factsKrtsanisiTbilisi, profile);
  assert(result.rejected);
  assertEquals(result.reason, 'TRANSACTION');
});

// ─── 3. District hard gate (real prod bug: Krtsanisi property matched Saburtalo/Samgori/Bagebi seekers) ──

for (const wantedDistrict of ['Saburtalo', 'Samgori', 'Bagebi']) {
  Deno.test(`rejects a same-city, different-district match: Krtsanisi property vs ${wantedDistrict} seeker`, () => {
    const profile = { intent_type: 'BUY', transaction_type: 'SALE', city: 'Tbilisi', district: wantedDistrict };
    const result = hardGateDecision(saleApartmentInKrtsanisi, factsKrtsanisiTbilisi, profile);
    assert(result.rejected);
    assertEquals(result.reason, 'DISTRICT');
  });
}

Deno.test('does not district-gate when the seeker names no district at all', () => {
  const profile = { intent_type: 'BUY', transaction_type: 'SALE', city: 'Tbilisi' };
  const result = hardGateDecision(saleApartmentInKrtsanisi, factsKrtsanisiTbilisi, profile);
  assertFalse(result.rejected);
});

Deno.test('does not district-gate when the city itself is already a mismatch (avoids double-penalizing)', () => {
  const profile = { intent_type: 'BUY', transaction_type: 'SALE', city: 'Batumi', district: 'Saburtalo' };
  const result = hardGateDecision(saleApartmentInKrtsanisi, factsKrtsanisiTbilisi, profile);
  assertFalse(result.rejected, 'a city-level mismatch is reported by score(), not double-gated here');
});

// ─── 4. Property-type gate tolerates free-text classifier phrasing ────────────

Deno.test('accepts "2-bedroom apartment" free text against an APARTMENT property', () => {
  const profile = { intent_type: 'BUY', transaction_type: 'SALE', city: 'Tbilisi', property_types: ['2-bedroom apartment'] };
  const result = hardGateDecision(saleApartmentInKrtsanisi, factsKrtsanisiTbilisi, profile);
  assertFalse(result.rejected, 'free-text type phrases must resolve into the apartment family, not hard-reject on literal mismatch');
});

Deno.test('does not type-gate on a generic, unrecognized type claim like "real estate"', () => {
  const profile = { intent_type: 'INVEST', transaction_type: 'INVESTMENT', city: 'Tbilisi', property_types: ['real estate'] };
  const result = hardGateDecision(saleApartmentInKrtsanisi, factsKrtsanisiTbilisi, profile);
  assertFalse(result.rejected, 'a generic claim with no recognized family is a data gap, not a stated incompatibility');
});

Deno.test('rejects a HOUSE-seeker against an APARTMENT property', () => {
  const profile = { intent_type: 'BUY', transaction_type: 'SALE', city: 'Tbilisi', property_types: ['house'] };
  const result = hardGateDecision(saleApartmentInKrtsanisi, factsKrtsanisiTbilisi, profile);
  assert(result.rejected);
  assertEquals(result.reason, 'PROPERTY_TYPE');
});

// ─── 5. Self-sourced guard ─────────────────────────────────────────────────────

Deno.test('rejects a signal that is the property\'s own origin signal', () => {
  const profile = { intent_type: 'BUY', transaction_type: 'SALE', city: 'Tbilisi' };
  const result = hardGateDecision(saleApartmentInKrtsanisi, factsKrtsanisiTbilisi, profile, { property_id: 'prop-1' });
  assert(result.rejected);
  assertEquals(result.reason, 'SELF_SOURCED');
});

// ─── 6. Unknown/missing data never hard-rejects (soft scoring handles it) ──────

Deno.test('does not transaction-gate when the property transaction_type is unknown', () => {
  const unknownTxnProperty = { ...saleApartmentInKrtsanisi, transaction_type: '' };
  const profile = { intent_type: 'RENT', transaction_type: 'RENT', city: 'Tbilisi' };
  const result = hardGateDecision(unknownTxnProperty, factsKrtsanisiTbilisi, profile);
  assertFalse(result.rejected);
});

Deno.test('does not district-gate when the property has no known district', () => {
  const noDistrictFacts = { district: null, city: 'Tbilisi' };
  const profile = { intent_type: 'BUY', transaction_type: 'SALE', city: 'Tbilisi', district: 'Saburtalo' };
  const result = hardGateDecision(saleApartmentInKrtsanisi, noDistrictFacts, profile);
  assertFalse(result.rejected);
});

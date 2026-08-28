// ============================================================
// HOMATCH — MatchingEngine (portable, no Supabase deps)
// Hard/strong factors then soft factors → match score
// ============================================================

import type { AIIntentResult } from './provider_types.ts';

export type SignalStrength =
  | 'POTENTIAL' | 'GOOD' | 'STRONG' | 'VERY_STRONG' | 'EXCEPTIONAL';

export interface PropertySnapshot {
  id: string;
  // Core
  country?: string;
  city?: string;
  district?: string;
  transaction_type?: string;
  property_type?: string;
  total_price?: number;
  currency?: string;
  area?: number;
  bedrooms?: number;
  // Soft
  condition?: string;
  new_build?: boolean;
  parking?: boolean;
  balcony?: boolean;
  elevator?: boolean;
  furnished?: boolean;
  // Campaign context
  campaign_id?: string;
}

export interface MatchEngineResult {
  propertyId: string;
  intentProfileId: string;
  matchScore: number;
  intentConfidence: number;
  signalStrength: SignalStrength;
  matchReasons: string[];
  mismatchReasons: string[];
  unlockPriceCredits: number;
  previewExcerpt: string;
}

// ── WEIGHT CONFIG ─────────────────────────────────────────────
// Hard factors (disqualifying if strong mismatch)
const W = {
  country: 30,
  transaction: 20,
  city: 15,
  district: 10,
  budget: 15,
  propertyType: 5,
  bedrooms: 5,
  // Soft
  area: 3,
  condition: 2,
  newBuild: 1,
  parking: 1,
  amenities: 1,
};
const HARD_MAX = W.country + W.transaction + W.city + W.district + W.budget + W.propertyType + W.bedrooms;
const TOTAL_MAX = Object.values(W).reduce((s, v) => s + v, 0);

// ── PRICING ENGINE ────────────────────────────────────────────

export function calculateUnlockPrice(params: {
  signalStrength: SignalStrength;
  matchScore: number;
  intentConfidence: number;
  specificity: number;
  actionability: number;
  recencyHours: number;
  sourceQuality: number;
}): number {
  const { signalStrength, matchScore, intentConfidence, specificity, actionability, recencyHours, sourceQuality } = params;

  // Base by strength tier
  const baseMap: Record<SignalStrength, number> = {
    POTENTIAL: 0.5,
    GOOD: 1.0,
    STRONG: 1.8,
    VERY_STRONG: 3.0,
    EXCEPTIONAL: 5.0,
  };
  let price = baseMap[signalStrength];

  // Multipliers
  price *= 0.7 + 0.3 * (matchScore / 100);
  price *= 0.7 + 0.3 * intentConfidence;
  price *= 0.8 + 0.2 * specificity;
  price *= 0.8 + 0.2 * actionability;
  price *= 0.9 + 0.1 * sourceQuality;

  // Recency boost: very fresh signal premium
  if (recencyHours < 1) price *= 1.3;
  else if (recencyHours < 6) price *= 1.15;
  else if (recencyHours < 24) price *= 1.05;
  else if (recencyHours > 168) price *= 0.8; // > 1 week

  // Floor: every qualified match must have non-zero price
  return Math.max(0.5, Math.round(price * 100) / 100);
}

// ── SIGNAL STRENGTH TIER ──────────────────────────────────────

export function computeSignalStrength(params: {
  matchScore: number;
  intentConfidence: number;
  specificity: number;
  actionability: number;
  recencyHours: number;
  sourceQuality: number;
}): SignalStrength {
  const composite =
    0.35 * params.matchScore / 100 +
    0.25 * params.intentConfidence +
    0.15 * params.specificity +
    0.15 * params.actionability +
    0.10 * Math.min(1, (168 - Math.min(168, params.recencyHours)) / 168) *
           params.sourceQuality;

  if (composite >= 0.85) return 'EXCEPTIONAL';
  if (composite >= 0.70) return 'VERY_STRONG';
  if (composite >= 0.55) return 'STRONG';
  if (composite >= 0.35) return 'GOOD';
  return 'POTENTIAL';
}

// ── CORE MATCHING ─────────────────────────────────────────────

export function matchPropertyToIntent(
  property: PropertySnapshot,
  intent: AIIntentResult,
  intentProfileId: string,
  recencyHours: number,
  sourceQuality: number
): MatchEngineResult | null {
  const reasons: string[] = [];
  const mismatches: string[] = [];
  let score = 0;

  // ── HARD FACTORS ─────────────────────────────────

  // Country (global-aware)
  const propCountry = (property.country ?? 'GE').toUpperCase();
  const intCountry = (intent.country ?? '').toUpperCase();
  if (!intCountry || intCountry === propCountry || intCountry === 'GE' && propCountry === 'GE') {
    score += W.country;
    reasons.push('Country match');
  } else {
    mismatches.push(`Country mismatch: property=${propCountry}, intent=${intCountry}`);
    // Hard disqualifier on country mismatch
    return null;
  }

  // Transaction
  const propTxn = property.transaction_type?.toUpperCase();
  const intTxn = intent.transactionType?.toUpperCase();
  if (!propTxn || !intTxn) {
    score += W.transaction * 0.5; // unknown — partial credit
  } else if (propTxn === intTxn) {
    score += W.transaction;
    reasons.push('Transaction type matches');
  } else {
    score += 0;
    mismatches.push(`Transaction mismatch: property=${propTxn}, want=${intTxn}`);
  }

  // City
  const propCity = property.city?.toLowerCase();
  const intCity = intent.city?.toLowerCase();
  if (!propCity || !intCity) {
    score += W.city * 0.4;
  } else if (propCity === intCity) {
    score += W.city;
    reasons.push(`City: ${property.city}`);
  } else {
    mismatches.push(`City mismatch: property=${property.city}, want=${intent.city}`);
  }

  // District
  const propDistrict = property.district?.toLowerCase();
  const intDistrict = intent.district?.toLowerCase();
  if (propDistrict && intDistrict) {
    if (propDistrict === intDistrict) {
      score += W.district;
      reasons.push(`District: ${property.district}`);
    } else {
      // Partial — neighborhoods check
      const inNeighborhood = (intent.neighborhoods ?? [])
        .map(n => n.toLowerCase())
        .includes(propDistrict);
      if (inNeighborhood) {
        score += W.district * 0.7;
        reasons.push('In requested neighborhood');
      } else {
        mismatches.push(`District mismatch`);
      }
    }
  } else {
    score += W.district * 0.5;
  }

  // Budget
  const price = property.total_price;
  const bMin = intent.budgetMin;
  const bMax = intent.budgetMax;
  if (!price || (!bMin && !bMax)) {
    score += W.budget * 0.5;
  } else {
    const inRange =
      (!bMin || price >= bMin * 0.9) &&
      (!bMax || price <= bMax * 1.1);
    if (inRange) {
      score += W.budget;
      reasons.push(`Price within budget range`);
    } else if (bMax && price <= bMax * 1.25) {
      score += W.budget * 0.5;
      reasons.push('Price slightly above budget');
    } else {
      mismatches.push(`Price ${price} outside budget ${bMin ?? '?'}–${bMax ?? '?'}`);
    }
  }

  // Property type
  const propType = property.property_type?.toUpperCase();
  const intTypes = (intent.propertyTypes ?? []).map(t => t.toUpperCase());
  if (!propType || !intTypes.length) {
    score += W.propertyType * 0.5;
  } else if (intTypes.includes(propType)) {
    score += W.propertyType;
    reasons.push(`Property type: ${propType}`);
  } else {
    mismatches.push(`Type mismatch: property=${propType}, want=${intTypes.join('/')}`);
  }

  // Bedrooms
  const beds = property.bedrooms;
  const bedsMin = intent.bedroomsMin;
  const bedsMax = intent.bedroomsMax;
  if (!beds || (!bedsMin && !bedsMax)) {
    score += W.bedrooms * 0.5;
  } else {
    const okBeds =
      (!bedsMin || beds >= bedsMin) &&
      (!bedsMax || beds <= bedsMax);
    if (okBeds) {
      score += W.bedrooms;
      reasons.push(`Bedrooms: ${beds}`);
    } else {
      mismatches.push(`Bedrooms ${beds} vs wanted ${bedsMin ?? '?'}–${bedsMax ?? '?'}`);
    }
  }

  // Hard disqualifier: must score >50% of hard max
  const hardScore = score;
  if (hardScore < HARD_MAX * 0.4) {
    return null;
  }

  // ── SOFT FACTORS ─────────────────────────────────

  // Area
  const area = property.area;
  const aMin = intent.areaMin;
  const aMax = intent.areaMax;
  if (area && (aMin || aMax)) {
    const okArea = (!aMin || area >= aMin * 0.85) && (!aMax || area <= aMax * 1.15);
    if (okArea) { score += W.area; reasons.push(`Area ${area}m²`); }
  } else {
    score += W.area * 0.5;
  }

  // New build
  if (intent.investmentIntent && property.new_build) {
    score += W.newBuild;
    reasons.push('New build suits investment');
  } else {
    score += W.newBuild * 0.3;
  }

  // Amenities
  if (property.parking) { score += W.parking * 0.5; reasons.push('Parking'); }
  if (property.balcony || property.elevator) { score += W.amenities * 0.5; }

  // Final score out of 100
  const matchScore = Math.round((score / TOTAL_MAX) * 100);

  const signalStrength = computeSignalStrength({
    matchScore,
    intentConfidence: intent.intentConfidence,
    specificity: intent.specificityScore,
    actionability: intent.actionabilityScore,
    recencyHours,
    sourceQuality,
  });

  const unlockPriceCredits = calculateUnlockPrice({
    signalStrength,
    matchScore,
    intentConfidence: intent.intentConfidence,
    specificity: intent.specificityScore,
    actionability: intent.actionabilityScore,
    recencyHours,
    sourceQuality,
  });

  // Build short excerpt (safe — never contains full contact/url)
  const budgetStr = bMin || bMax
    ? `${intent.currency ?? '$'}${(bMin ?? '?').toLocaleString()}–${(bMax ?? '?').toLocaleString()}`
    : null;
  const previewExcerpt = (intent.originalText ?? intent.translatedText ?? '')
    .substring(0, 80)
    .trim() + '…';

  return {
    propertyId: property.id,
    intentProfileId,
    matchScore,
    intentConfidence: intent.intentConfidence,
    signalStrength,
    matchReasons: reasons,
    mismatchReasons: mismatches,
    unlockPriceCredits,
    previewExcerpt,
  };
}

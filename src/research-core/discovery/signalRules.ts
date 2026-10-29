// SIGNAL CLASSIFICATION, BY RULES FIRST (classify-signals-v2, owner 2026-10-29).
//
// A post that says "ვეძებ 2 საძინებლიან ბინას ვაკეში $200,000-მდე" or "Сдаётся квартира" does
// not need a model to be read. The six-language demand reader (findBuyers/demandClassifier.ts)
// decides who is speaking and what they want; the constraint reader (intent/constraints.ts)
// reads the city, district, type, rooms, area and budget in the canonical spellings the
// matcher compares; interpret.ts says whose intent it is. What none of them can decide is
// AMBIGUOUS, and only that may go to a model — when an admin switch says so (aiPolicy.ts).
//
// The verdict is conservative in one direction only: a DEMAND verdict needs a first-person,
// real-estate, confident seeker reading with a known transaction. Anything less is AMBIGUOUS,
// never promoted to demand. A confident offer, agency, job, service or non-real-estate text is
// NOT_DEMAND — exactly the cases the model was already told to reject.
//
// Pure: no I/O, no model, no clock.

import { classifyDemand, type DemandReading } from '../findBuyers/demandClassifier.ts';
import { readConstraints } from '../intent/constraints.ts';
import { attributionOf } from '../intent/interpret.ts';

export const SIGNAL_RULES_VERSION = 'signal-rules-1';
/** The model name written on an intent profile the rules produced (intent_profiles.ai_model). */
export const RULES_MODEL = 'rules';

/** A rule-read demand profile, in the intent_profiles column vocabulary. */
export interface RuleProfile {
  intentType: 'BUY' | 'RENT';
  transactionType: 'SALE' | 'RENT';
  city: string | null;
  district: string | null;
  neighborhoods: string[] | null;
  propertyTypes: string[] | null;
  bedroomsMin: number | null;
  bedroomsMax: number | null;
  areaMin: number | null;
  areaMax: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
  currency: string | null;
  language: string | null;
  intentConfidence: number;
  specificityScore: number;
  actionabilityScore: number;
}

export type RuleSignalVerdict =
  | { decision: 'DEMAND'; profile: RuleProfile; evidence: string[]; version: string }
  | { decision: 'NOT_DEMAND'; intentType: 'PROPERTY_AD' | 'AGENT_AD' | 'NOISE'; transactionType: 'SALE' | 'RENT' | null; confidence: number; evidence: string[]; version: string }
  | { decision: 'AMBIGUOUS'; evidence: string[]; version: string };

/** A seeker reading this confident or better is decided by the rules. */
export const RULE_DEMAND_MIN_CONFIDENCE = 0.7;
/** A rejection (irrelevant, job, service) this confident or better is decided by the rules. */
export const RULE_REJECT_MIN_CONFIDENCE = 0.8;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : []);
const titleCase = (s: string) => s.replace(/(^|[\s-])(\p{Ll})/gu, (_m, p, c) => `${p}${c.toUpperCase()}`);

function profileOf(text: string, r: DemandReading): RuleProfile {
  const c = readConstraints(text);
  const districts = strs(c.districts);
  const ruleDistricts = r.districts.map(titleCase);
  const places = districts.length ? districts : ruleDistricts;
  const types = strs(c.propertyTypes);
  const bedrooms = num(c.bedroomsMin) ?? r.bedrooms ?? null;
  const ruleBudget = r.budget && r.budget.currencyStated !== false ? r.budget : null;
  const budgetMin = num(c.budgetMin) ?? ruleBudget?.min ?? null;
  const budgetMax = num(c.budgetMax) ?? ruleBudget?.max ?? null;
  const currency = typeof c.currency === 'string' && c.currency ? c.currency : (budgetMin != null || budgetMax != null) ? ruleBudget?.currency ?? null : null;
  const areaMin = num(c.areaMin) ?? r.area?.min ?? null;
  const areaMax = num(c.areaMax) ?? r.area?.max ?? null;
  const city = typeof c.city === 'string' && c.city ? c.city : r.cities[0] ? titleCase(r.cities[0]) : null;
  const stated = [city, places.length ? 1 : null, types.length || r.propertyType ? 1 : null, bedrooms ?? r.rooms, budgetMax ?? budgetMin, areaMin ?? areaMax]
    .filter((v) => v != null).length;
  return {
    intentType: r.transaction === 'RENT' ? 'RENT' : 'BUY',
    transactionType: r.transaction === 'RENT' ? 'RENT' : 'SALE',
    city,
    district: places[0] ?? null,
    neighborhoods: places.length > 1 ? places : null,
    propertyTypes: types.length ? types : r.propertyType ? [r.propertyType] : null,
    bedroomsMin: bedrooms,
    bedroomsMax: num(c.bedroomsMax) ?? bedrooms,
    areaMin, areaMax, budgetMin, budgetMax,
    currency: currency ? String(currency).toUpperCase() : null,
    language: typeof c.originalLanguage === 'string' ? c.originalLanguage : null,
    intentConfidence: Math.round(r.confidence * 100) / 100,
    /* Six stated facts make a fully specific request; a bare "looking for a flat" scores low. */
    specificityScore: Math.round((stated / 6) * 1000) / 1000,
    actionabilityScore: Math.round(Math.min(1, 0.3 + (stated / 6) * 0.7) * 1000) / 1000,
  };
}

/**
 * The rules' verdict on one signal's text. What the collector already stored about the row
 * (research_direction SUPPLY, author_is_agency) is applied by classify-signals-v2 before this.
 */
export function ruleSignalVerdict(text: string | null | undefined): RuleSignalVerdict {
  const body = String(text ?? '');
  const version = SIGNAL_RULES_VERSION;
  if (body.trim().length < 3) return { decision: 'NOT_DEMAND', intentType: 'NOISE', transactionType: null, confidence: 0.9, evidence: ['empty_text'], version };
  const r = classifyDemand(body, { kind: 'POST' });
  const evidence = [...r.evidence];
  if (r.needsModel || r.role === 'UNCLEAR') return { decision: 'AMBIGUOUS', evidence: [...evidence, 'rules_undecided'], version };
  switch (r.role) {
    case 'BUY_SEEKER':
    case 'RENT_SEEKER': {
      if (r.intermediary) return { decision: 'NOT_DEMAND', intentType: 'AGENT_AD', transactionType: r.transaction === 'RENT' ? 'RENT' : r.transaction === 'BUY' ? 'SALE' : null, confidence: 0.8, evidence: [...evidence, 'intermediary'], version };
      /* Whose intent: "my brother is looking …" is not the author's own request. */
      const who = attributionOf(body);
      if (who === 'THIRD_PARTY' || who === 'QUOTED') return { decision: 'AMBIGUOUS', evidence: [...evidence, `attribution_${who.toLowerCase()}`], version };
      if (!r.realEstate || !r.transaction || r.confidence < RULE_DEMAND_MIN_CONFIDENCE) return { decision: 'AMBIGUOUS', evidence: [...evidence, 'seeker_not_confident'], version };
      return { decision: 'DEMAND', profile: profileOf(body, r), evidence, version };
    }
    case 'SALE_OFFER':
    case 'RENT_OFFER':
      return { decision: 'NOT_DEMAND', intentType: 'PROPERTY_AD', transactionType: r.role === 'RENT_OFFER' ? 'RENT' : 'SALE', confidence: r.confidence, evidence, version };
    case 'AGENT':
      return { decision: 'NOT_DEMAND', intentType: 'AGENT_AD', transactionType: r.transaction === 'RENT' ? 'RENT' : r.transaction === 'BUY' ? 'SALE' : null, confidence: r.confidence, evidence, version };
    default:
      /* IRRELEVANT / JOB / SERVICE: decided only when the rules are sure. */
      if (r.confidence >= RULE_REJECT_MIN_CONFIDENCE) return { decision: 'NOT_DEMAND', intentType: 'NOISE', transactionType: null, confidence: r.confidence, evidence, version };
      return { decision: 'AMBIGUOUS', evidence: [...evidence, 'rejection_not_confident'], version };
  }
}

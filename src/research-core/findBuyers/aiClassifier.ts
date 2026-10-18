// AI-FIRST LEAD CLASSIFICATION (owner, 2026-10-18). Campaign 343cfc41 showed two brokers as
// buyers: the rules read "ჩამიყარეთ გასაყიდი ბინები მყავს ბათუმელი კლიენტები" (send me flats for
// sale, I have clients) and "إذا كنتم مهتمين بشراء شقة … أقدم لكم خدمة" (interested in buying? I
// offer a service) as purchase requests, confidently enough that the model was never asked.
//
// Now every unique candidate is judged by the model (OpenAI structured output) against the
// Property DNA before qualification: the model makes the SEMANTIC decision — who is speaking and
// what they want. Deterministic code keeps what must not depend on a model: extracted facts
// (budget, places, rooms, area), hard constraints in qualify.ts, deduplication, billing, safety.
//
//   AI says                     reading becomes                     shown as
//   DIRECT_BUYER / _TENANT      BUY_SEEKER / RENT_SEEKER            buyer / tenant (qualify decides fit)
//   BROKER_WITH_CLIENT          AGENT + seeking_for_client          "through a broker", never qualified
//   BROKER_COLLECTING_LISTINGS  AGENT + collects_listings           never shown
//   SELLER_OR_LANDLORD          SALE_OFFER / RENT_OFFER             never shown
//   SERVICE_PROVIDER            SERVICE                             never shown
//   IRRELEVANT                  IRRELEVANT                          never shown
//   UNCERTAIN / low confidence  UNCLEAR (ai_uncertain)              never shown, never Strong
//   no answer (AI failed)       UNCLEAR (ai_unverified) when the     never a confident rule buyer
//                               rules said seeker; a rule rejection
//                               stays a rejection
//
// Nothing is invented: the model may only quote the text as evidence; facts come from the text
// through the rule extractor; a model compatibility verdict can only LOWER a lead, never raise it.

import type { DemandReading } from './demandClassifier.ts';
import type { PropertyDna } from './propertyDna.ts';

export const AI_CLASSIFIER_VERSION = 'fb-ai-1';

export const AI_ROLES = [
  'DIRECT_BUYER', 'DIRECT_TENANT', 'BROKER_WITH_CLIENT', 'BROKER_COLLECTING_LISTINGS',
  'SELLER_OR_LANDLORD', 'SERVICE_PROVIDER', 'IRRELEVANT', 'UNCERTAIN',
] as const;
export type AiRole = typeof AI_ROLES[number];

export interface AiVerdict {
  role: AiRole;
  /** 0–1: how sure the model is of the role. */
  confidence: number;
  transaction: 'BUY' | 'RENT' | 'UNKNOWN';
  /** The request against THIS property: COMPATIBLE / INCOMPATIBLE / UNKNOWN (unstated). */
  compatibility: 'COMPATIBLE' | 'INCOMPATIBLE' | 'UNKNOWN';
  /** Constraints the text itself states (verbatim or near-verbatim), null when unstated. */
  budget: string | null;
  location: string | null;
  /** What in the text contradicts the property (other city, too small, rent vs sale …). */
  contradictions: string[];
  /** Short quotes from the text that decided the role. */
  evidence: string[];
  reason: string;
}

/** Below this the role is not trusted: UNCERTAIN. */
export const MIN_ROLE_CONFIDENCE = 0.6;
/** A buyer may be Strong only when the model is at least this sure of the role. */
export const STRONG_ROLE_CONFIDENCE = 0.8;
/** Items per model call and calls in flight per worker run (bounded). */
export const AI_BATCH_SIZE = 20;
export const AI_CONCURRENCY = 4;
/** Most items one pipeline run sends to the model; the rest stay unverified (never a lead). */
export const AI_MAX_ITEMS_PER_RUN = 240;

const nullableString = (maxLength: number) => ({ type: ['string', 'null'], maxLength });

export const AI_CLASSIFY_SCHEMA = {
  name: 'find_buyers_lead_role',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['id', 'role', 'confidence', 'transaction', 'compatibility', 'budget', 'location', 'contradictions', 'evidence', 'reason'],
          properties: {
            id: { type: 'string' },
            role: { type: 'string', enum: [...AI_ROLES] },
            confidence: { type: 'number' },
            transaction: { type: 'string', enum: ['BUY', 'RENT', 'UNKNOWN'] },
            compatibility: { type: 'string', enum: ['COMPATIBLE', 'INCOMPATIBLE', 'UNKNOWN'] },
            budget: nullableString(80),
            location: nullableString(80),
            contradictions: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 100 } },
            evidence: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 120 } },
            reason: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
  },
} as const;

export const AI_SYSTEM_PROMPT = [
  'You classify public social-media posts and comments about real estate in Georgia (Georgian — also written in Latin letters —, Russian, English, Arabic, Hebrew, Turkish) for a property owner looking for buyers or tenants of THE PROPERTY described in "property".',
  'For each item decide WHO is speaking and WHAT they want:',
  'DIRECT_BUYER: the author personally (or their family) wants to buy a property. DIRECT_TENANT: the author personally wants to rent one.',
  'BROKER_WITH_CLIENT: an agent/realtor/intermediary looking for a property for ONE specific client whose need they describe ("I have a client who wants a 2-room flat in Vake").',
  'BROKER_COLLECTING_LISTINGS: an agent asking owners or colleagues to send properties for sale/rent ("send me flats for sale", "ჩამიყარეთ ბინები", "скидывайте варианты", "I have many clients/buyers", "cooperation with agents") — they collect inventory, they are not a buyer.',
  'SELLER_OR_LANDLORD: offers a property for sale or rent (also a developer or agency advertising projects). SERVICE_PROVIDER: offers a service to buyers or sellers — including an agent advertising "if you want to buy an apartment, write to me, I offer full service", relocation, legal, renovation, mortgage brokers.',
  'IRRELEVANT: not about buying/renting real estate (jobs, news, group rules, chat). UNCERTAIN: you cannot tell from the text.',
  'Rules: a buyer speaks in the first person about their own need; addressing the reader ("if you are interested…", "write to me") is an advertiser, not a buyer. A broker word alone does not make a broker: "no agents please" is a buyer refusing brokers.',
  'Use the parent post (when given) only as context: a comment asking the price under a listing is a person interested in THAT listing.',
  'transaction: what the author wants (BUY or RENT), UNKNOWN if not stated. compatibility: compare only what the text states with the property (family, transaction, city/district, budget, size, rooms): INCOMPATIBLE when a stated requirement contradicts it, COMPATIBLE when stated requirements fit, UNKNOWN when nothing relevant is stated.',
  'budget/location: what the text states, else null. contradictions: each stated conflict in a few words. evidence: up to 3 short exact quotes from the text. confidence 0–1 for the role.',
  'Never invent facts, budgets, places, contacts or intent that the text does not state. When in doubt choose UNCERTAIN with a low confidence.',
].join(' ');

/** The property as the model needs it: only stored facts, no contact or address. */
export function propertyBrief(dna: PropertyDna) {
  return {
    transaction: dna.transaction, family: dna.family, subtype: dna.subtype ?? null, type: dna.propertyType,
    city: dna.city, district: dna.district, price: dna.price, currency: dna.currency,
    areaSqm: dna.areaSqm, rooms: dna.rooms, bedrooms: dna.bedrooms,
  };
}

const clamp01 = (n: unknown) => (Number.isFinite(Number(n)) ? Math.max(0, Math.min(1, Number(n))) : 0);
const strList = (v: unknown, max: number, len: number) => (Array.isArray(v) ? v.map((x) => String(x ?? '').slice(0, len)).filter(Boolean).slice(0, max) : []);

/** A model item made safe: unknown roles become UNCERTAIN, numbers clamped, strings bounded. */
export function parseAiVerdict(raw: any): AiVerdict | null {
  if (!raw || typeof raw !== 'object') return null;
  const role = (AI_ROLES as readonly string[]).includes(String(raw.role)) ? raw.role as AiRole : 'UNCERTAIN';
  const tx = String(raw.transaction ?? '').toUpperCase();
  const comp = String(raw.compatibility ?? '').toUpperCase();
  return {
    role,
    confidence: clamp01(raw.confidence),
    transaction: tx === 'BUY' || tx === 'RENT' ? tx : 'UNKNOWN',
    compatibility: comp === 'COMPATIBLE' || comp === 'INCOMPATIBLE' ? comp : 'UNKNOWN',
    budget: raw.budget == null ? null : String(raw.budget).slice(0, 80),
    location: raw.location == null ? null : String(raw.location).slice(0, 80),
    contradictions: strList(raw.contradictions, 4, 100),
    evidence: strList(raw.evidence, 3, 120),
    reason: String(raw.reason ?? '').slice(0, 200),
  };
}

/** Roles the rules can produce that would put a person in front of the owner. */
const RULE_POSITIVE = new Set(['BUY_SEEKER', 'RENT_SEEKER', 'AGENT', 'UNCLEAR']);

/**
 * The model's semantic decision applied to the rule reading. Facts (budget, places, rooms,
 * area, property type) stay the extractor's; only role, transaction and evidence change.
 * `ai === null` (the call failed or the item was over the per-run bound): a rule-positive
 * reading becomes UNCLEAR / ai_unverified — never a confident rule-based buyer; a rule
 * rejection (seller, job, irrelevant …) stays what it is.
 */
export function applyAiVerdict(rule: DemandReading, ai: AiVerdict | null): DemandReading {
  const base = { ...rule, needsModel: false };
  if (!ai) {
    if (!RULE_POSITIVE.has(rule.role)) return base;
    return { ...base, role: 'UNCLEAR', evidence: [...rule.evidence, 'ai_unverified'], confidence: Math.min(rule.confidence, 0.4) };
  }
  const tag = (role: DemandReading['role'], extra: string[] = [], over: Partial<DemandReading> = {}): DemandReading => ({
    ...base, role, ...over, aiVerdict: ai,
    evidence: [...rule.evidence.filter((e) => e !== 'seeking_for_client' && e !== 'collects_listings'), 'ai_classified', `ai:${ai.role}`, ...extra],
    confidence: ai.confidence,
  });
  if (ai.role === 'UNCERTAIN' || ai.confidence < MIN_ROLE_CONFIDENCE) return tag('UNCLEAR', ['ai_uncertain']);
  const tx = ai.transaction === 'UNKNOWN' ? null : ai.transaction;
  switch (ai.role) {
    case 'DIRECT_BUYER':
      return tag(tx === 'RENT' ? 'RENT_SEEKER' : 'BUY_SEEKER', [], { transaction: tx ?? 'BUY', realEstate: true, intermediary: false });
    case 'DIRECT_TENANT':
      return tag(tx === 'BUY' ? 'BUY_SEEKER' : 'RENT_SEEKER', [], { transaction: tx ?? 'RENT', realEstate: true, intermediary: false });
    case 'BROKER_WITH_CLIENT':
      return tag('AGENT', ['seeking_for_client'], { transaction: tx, realEstate: true, intermediary: true });
    case 'BROKER_COLLECTING_LISTINGS':
      return tag('AGENT', ['collects_listings'], { intermediary: true });
    case 'SELLER_OR_LANDLORD':
      return tag(tx === 'RENT' || rule.role === 'RENT_OFFER' ? 'RENT_OFFER' : 'SALE_OFFER', [], { transaction: tx });
    case 'SERVICE_PROVIDER':
      return tag('SERVICE');
    default:
      return tag('IRRELEVANT');
  }
}

/** Which candidates are worth a model call: unique texts with something to read. */
export function aiCandidateKey(text: string, kind: string, parentRole: string | null, dnaKey: string): string {
  return `${AI_CLASSIFIER_VERSION}:${kind}:${parentRole ?? 'x'}:${dnaKey}:${text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 400)}`;
}

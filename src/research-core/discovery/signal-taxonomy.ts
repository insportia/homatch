// HOMATCH RESEARCH CORE — what a collected message IS, in nine words.
//
// The classifier model answers with its own vocabulary (BUY, RENT, AGENT_AD,
// PROPERTY_AD, NOISE, ...) and the deterministic readers answer with theirs
// (research_direction SUPPLY/DEMAND, author_is_agency). Discovery needs one
// label every screen and counter agrees on, so it is derived here from both,
// deterministically, and stored next to the verdict with the classifier
// version that produced it.
//
//   BUYER_DEMAND        someone wants to buy or invest       -> may become a match
//   TENANT_DEMAND       someone wants to rent                -> may become a match
//   SELLER_SUPPLY       an owner or listing offering a sale  -> never a match
//   LANDLORD_SUPPLY     an owner or listing offering a rent  -> never a match
//   BROKER_AGENCY       an agent or agency speaking          -> broker review, never a match
//   DEVELOPER           a developer promoting a project      -> never a match
//   GENERAL_DISCUSSION  real-estate talk with no transaction
//   IRRELEVANT          spam, jobs, news, unrelated
//   AMBIGUOUS           cannot tell seeking from offering
//
// Only the two demand labels can ever reach matching. A potentially
// interested person is never inferred from supply, from an agency, or from a
// message the classifier could not read with confidence.

export const CLASSIFIER_VERSION = 'signals-v2.1';

/** Below this, a demand verdict is not trusted enough to act on. */
export const DEMAND_MIN_CONFIDENCE = 0.35;

export type DiscoveryLabel =
  | 'BUYER_DEMAND'
  | 'TENANT_DEMAND'
  | 'SELLER_SUPPLY'
  | 'LANDLORD_SUPPLY'
  | 'BROKER_AGENCY'
  | 'DEVELOPER'
  | 'GENERAL_DISCUSSION'
  | 'IRRELEVANT'
  | 'AMBIGUOUS';

export const DISCOVERY_LABELS: readonly DiscoveryLabel[] = [
  'BUYER_DEMAND', 'TENANT_DEMAND', 'SELLER_SUPPLY', 'LANDLORD_SUPPLY', 'BROKER_AGENCY',
  'DEVELOPER', 'GENERAL_DISCUSSION', 'IRRELEVANT', 'AMBIGUOUS',
];

export const DEMAND_LABELS: ReadonlySet<DiscoveryLabel> = new Set(['BUYER_DEMAND', 'TENANT_DEMAND']);

/** Where a label sends the signal. */
export type SignalRoute = 'MATCHING' | 'BROKER_REVIEW' | 'NONE';

export interface LabelInput {
  /** The model's intentType, or a deterministic stand-in. */
  intentType?: string | null;
  transactionType?: string | null;
  confidence?: number | null;
  /** The reader's verdict that an agency is speaking. */
  agencyVoice?: boolean | null;
  /** The reader's research_direction: SUPPLY / DEMAND / UNKNOWN / null. */
  direction?: string | null;
}

export function discoveryLabelFor(input: LabelInput): DiscoveryLabel {
  const intent = String(input.intentType ?? '').toUpperCase();
  const tx = String(input.transactionType ?? '').toUpperCase();
  const confident = Number(input.confidence ?? 0) >= DEMAND_MIN_CONFIDENCE;

  /* An agency speaking is a broker lead whatever it says it wants. */
  if (input.agencyVoice === true || intent === 'AGENT_AD') return 'BROKER_AGENCY';
  if (intent === 'DEVELOPER') return 'DEVELOPER';

  if (intent === 'BUY' || intent === 'INVEST' || intent === 'RELOCATE_BUY') {
    return confident ? 'BUYER_DEMAND' : 'AMBIGUOUS';
  }
  if (intent === 'RENT' || intent === 'RELOCATE_RENT') {
    return confident ? 'TENANT_DEMAND' : 'AMBIGUOUS';
  }
  if (intent === 'SELLER' || intent === 'PROPERTY_AD' || String(input.direction ?? '').toUpperCase() === 'SUPPLY') {
    return tx === 'RENT' ? 'LANDLORD_SUPPLY' : 'SELLER_SUPPLY';
  }
  if (intent === 'DISCUSSION') return 'GENERAL_DISCUSSION';
  if (intent === 'SPAM' || intent === 'NOISE') return 'IRRELEVANT';
  return 'AMBIGUOUS';
}

export function routeFor(label: DiscoveryLabel): SignalRoute {
  if (DEMAND_LABELS.has(label)) return 'MATCHING';
  if (label === 'BROKER_AGENCY') return 'BROKER_REVIEW';
  return 'NONE';
}

/**
 * May a cached verdict be reused for another message with the same content?
 * Only one produced by THIS classifier version: a prompt or taxonomy change
 * must re-read, never inherit, the older answer.
 */
export function reusableVerdict(json: unknown): boolean {
  return !!json && typeof json === 'object'
    && (json as Record<string, unknown>).classifierVersion === CLASSIFIER_VERSION
    && typeof (json as Record<string, unknown>).discoveryLabel === 'string';
}

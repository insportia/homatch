// WHO IS ON EACH SIDE, AND WHAT THEY WANT FROM EACH OTHER.
//
// Homatch has five kinds of supply-side participant and four kinds of demand-side
// one, and they do not pair off arbitrarily. A landlord and a buyer are both real
// participants with real intent and they have nothing to offer each other; an
// investor and a developer do. Until now that knowledge lived implicitly in
// whichever function happened to be matching, expressed as a transaction-type
// comparison, which is why INVESTMENT kept needing a special case.
//
// So the relationship is modelled once, here, and both directions read it.
//
// WHY ROLES ARE NOT THE SAME AS TRANSACTIONS
//
// A transaction says what is happening (SALE, RENT). A role says who is doing it
// (a developer sells, an agency sells on behalf of somebody, a broker introduces).
// Those are different facts and collapsing them loses information the product
// needs: a developer's SALE and a private seller's SALE are the same transaction
// and a different conversation, and an agency listing the same flat as its owner
// is a duplicate rather than two opportunities.
//
// The matcher does not care about most of that. It cares about exactly one thing:
// whether a demand role and a supply role can transact at all. Everything else
// about the role is presentation, and belongs to whatever renders the result.
//
// AND WHY "CAN THEY TRANSACT" IS NOT "IS THIS A MATCH"
//
// This module answers the coarsest question first and refuses to answer any other.
// A tenant and a landlord CAN transact; whether this particular tenant fits this
// particular flat is compatibility, and that is compatibility.ts's job. Keeping
// them apart is what stops "they are both rentals" from being mistaken for a
// reason to show somebody a flat.

/** Who is offering. */
export type SupplyRole =
  /** A private owner selling their own property. */
  | 'SELLER'
  /** An owner letting their own property. */
  | 'LANDLORD'
  /** A developer selling units in their own project. */
  | 'DEVELOPER'
  /** An agency listing on an owner's behalf. */
  | 'AGENCY'
  /** An intermediary who introduces rather than holds inventory. */
  | 'BROKER';

/** Who is looking. */
export type DemandRole =
  /** Buying to own or occupy. */
  | 'BUYER'
  /** Renting to live in, long term. */
  | 'TENANT'
  /** Renting for nights or weeks. */
  | 'GUEST'
  /** Buying for yield or appreciation rather than to occupy. */
  | 'INVESTOR';

export const SUPPLY_ROLES: readonly SupplyRole[] = [
  'SELLER', 'LANDLORD', 'DEVELOPER', 'AGENCY', 'BROKER',
];
export const DEMAND_ROLES: readonly DemandRole[] = ['BUYER', 'TENANT', 'GUEST', 'INVESTOR'];

/**
 * What kind of deal the two sides would be doing.
 *
 * The same vocabulary listing-age-policy.ts keys its ceilings by, deliberately: a
 * SHORT_STAY match and a SHORT_STAY freshness ceiling are about the same market, and
 * two vocabularies for one concept is how they drift.
 */
export type DealKind = 'SALE' | 'RENT' | 'SHORT_STAY' | 'COMMERCIAL' | 'LAND' | 'INVESTMENT';

export const DEAL_KINDS: readonly DealKind[] = [
  'SALE', 'RENT', 'SHORT_STAY', 'COMMERCIAL', 'LAND', 'INVESTMENT',
];

/**
 * Which supply roles can serve which demand role, and in what kind of deal.
 *
 * Read as: a BUYER can transact with a SELLER, DEVELOPER, AGENCY or BROKER, in a
 * SALE, or a LAND deal, or a COMMERCIAL one. A BUYER and a LANDLORD cannot transact
 * at all, and that is a HARD fact rather than a low score.
 *
 * INVESTOR is the row worth reading twice. An investor buys, so every supply role a
 * buyer can reach is reachable — but an investor also legitimately transacts in
 * RENT, because a tenanted flat sold with its income IS the product. The production
 * matcher already needed a special case for exactly this ("the classifier records
 * transaction_type as either SALE or INVESTMENT for the same buy-to-invest demand"),
 * and this table is where that knowledge now lives instead.
 */
const RELATIONSHIPS: Readonly<Record<DemandRole, {
  supply: readonly SupplyRole[];
  deals: readonly DealKind[];
}>> = {
  BUYER: {
    supply: ['SELLER', 'DEVELOPER', 'AGENCY', 'BROKER'],
    deals: ['SALE', 'LAND', 'COMMERCIAL'],
  },
  TENANT: {
    supply: ['LANDLORD', 'AGENCY', 'BROKER'],
    deals: ['RENT', 'COMMERCIAL'],
  },
  GUEST: {
    /* No DEVELOPER: a developer sells units, and nobody books a night from one. */
    supply: ['LANDLORD', 'AGENCY', 'BROKER'],
    deals: ['SHORT_STAY'],
  },
  INVESTOR: {
    supply: ['SELLER', 'DEVELOPER', 'AGENCY', 'BROKER'],
    /*
     * RENT is here on purpose and is not a mistake. An investor buying a tenanted
     * flat is transacting in a rental asset, and excluding RENT would hide the
     * yield-bearing half of the investment market.
     */
    deals: ['SALE', 'INVESTMENT', 'LAND', 'COMMERCIAL', 'RENT'],
  },
};

export type RelationshipVerdict =
  /** These two can do business, in at least one kind of deal. */
  | 'CAN_TRANSACT'
  /** They cannot, whatever else agrees. A landlord has nothing to sell a buyer. */
  | 'CANNOT_TRANSACT'
  /** One side's role was not stated, so nothing has been established. */
  | 'UNKNOWN';

export interface RelationshipResult {
  verdict: RelationshipVerdict;
  /** The deal kinds both sides could be doing. Empty unless CAN_TRANSACT. */
  deals: DealKind[];
  reason: string;
}

/** Normalise whatever a row calls a supply role. Null when it says nothing. */
export function supplyRoleFrom(value: string | null | undefined): SupplyRole | null {
  const text = String(value ?? '').trim().toUpperCase();
  if (!text) return null;
  if (/DEVELOP|ZASTROY|ЗАСТРОЙ|ДЕВЕЛОП|მშენებ/.test(text)) return 'DEVELOPER';
  if (/AGENC|AGENT|АГЕНТ|სააგენტ/.test(text)) return 'AGENCY';
  if (/BROKER|БРОКЕР|შუამავ/.test(text)) return 'BROKER';
  if (/LANDLORD|LESSOR|АРЕНДОДАТ|მეპატრონ/.test(text)) return 'LANDLORD';
  if (/SELLER|OWNER|VENDOR|ПРОДАВ|СОБСТВЕН|მესაკუთრ/.test(text)) return 'SELLER';
  return null;
}

/**
 * Normalise whatever a row calls a demand role.
 *
 * Reads the intent_type the classifier already writes where it can, because a
 * second vocabulary for the same fact is how the two disagree. RENT_SEEKING and
 * BUY_INTENT are the shapes production actually holds.
 */
export function demandRoleFrom(input: {
  intentType?: string | null;
  transactionType?: string | null;
}): DemandRole | null {
  const intent = String(input.intentType ?? '').trim().toUpperCase();
  const transaction = String(input.transactionType ?? '').trim().toUpperCase();
  const both = `${intent} ${transaction}`;

  /* INVEST first: it is more specific than the SALE it implies. */
  if (/INVEST|YIELD|ROI|ДОХОДН/.test(both)) return 'INVESTOR';
  if (/SHORT|NIGHT|DAILY|GUEST|HOLIDAY|VACATION|СУТОЧН/.test(both)) return 'GUEST';
  if (/RENT|LEASE|TENANT|LET\b|АРЕНД|СНЯ|ქირ/.test(both)) return 'TENANT';
  if (/BUY|PURCHAS|SALE|SELL|КУПИ|ПОКУП|ყიდ/.test(both)) return 'BUYER';
  return null;
}

/** Which deal kind a supply row represents, from its own transaction and type. */
export function dealKindFrom(input: {
  transaction?: string | null;
  propertyType?: string | null;
}): DealKind | null {
  const transaction = String(input.transaction ?? '').trim().toUpperCase();
  const type = String(input.propertyType ?? '').trim().toUpperCase();

  /*
   * PROPERTY TYPE FIRST, for the same reason listing-age-policy.ts reads it first:
   * land for sale is a LAND deal, not a SALE deal, and the verb is the less
   * specific of the two facts.
   */
  if (/\bLAND\b|PLOT|AGRICULT|УЧАСТ|მიწ/.test(type)) return 'LAND';
  if (/COMMERC|OFFICE|RETAIL|WAREHOUSE|ОФИС|КОММЕРЧ/.test(type)) return 'COMMERCIAL';

  if (/SHORT|NIGHT|DAILY|СУТОЧН/.test(transaction)) return 'SHORT_STAY';
  /* Aligned with transaction() in compatibility.ts, and the drift ran both ways: this
     had the Georgian script ქირავდ but not the Latin transliteration QIRAVDEBA that
     portals actually put in slugs, and it had АРЕНД but neither СДА nor СНЯ. Both
     functions read the same rows, and a verb one recognises while the other does not is
     exactly how the two end up disagreeing about one listing. */
  if (/RENT|LEASE|LET\b|QIRAVDEBA|АРЕНД|СДА|СНЯ|ქირავდ/.test(transaction)) return 'RENT';
  if (/INVEST/.test(transaction)) return 'INVESTMENT';
  if (/SALE|SELL|ПРОДА|КУПИ|IKIDEBA|იყიდ/.test(transaction)) return 'SALE';
  return null;
}

/**
 * Can these two sides do business at all?
 *
 * Deliberately the coarsest question, answered before any compatibility is
 * considered. UNKNOWN when either role is unstated — production rows frequently
 * name neither, and refusing to match them would discard most of the corpus while
 * assuming they pair would invent a relationship nobody claimed.
 */
export function canTransact(
  demand: DemandRole | null,
  supply: SupplyRole | null,
  deal: DealKind | null,
): RelationshipResult {
  if (!demand || !supply) {
    return {
      verdict: 'UNKNOWN',
      deals: [],
      reason: !demand
        ? 'the enquiry does not say what kind of participant this is'
        : 'the listing does not say who is offering it',
    };
  }

  const relationship = RELATIONSHIPS[demand];
  if (!relationship.supply.includes(supply)) {
    return {
      verdict: 'CANNOT_TRANSACT',
      deals: [],
      reason: `a ${supply.toLowerCase()} has nothing to offer a ${demand.toLowerCase()}`,
    };
  }

  /*
   * The deal kind narrows it further when the listing states one. A LANDLORD and a
   * TENANT can transact; a LANDLORD offering a SHORT_STAY to a long-term TENANT is
   * a different product and the roles alone would have missed it.
   */
  if (deal && !relationship.deals.includes(deal)) {
    return {
      verdict: 'CANNOT_TRANSACT',
      deals: [],
      reason: `a ${demand.toLowerCase()} is not looking for a ${deal.toLowerCase().replace(/_/g, ' ')} deal`,
    };
  }

  return {
    verdict: 'CAN_TRANSACT',
    deals: deal ? [deal] : [...relationship.deals],
    reason: deal
      ? `a ${supply.toLowerCase()} and a ${demand.toLowerCase()} in a ${deal.toLowerCase().replace(/_/g, ' ')} deal`
      : `a ${supply.toLowerCase()} and a ${demand.toLowerCase()} can transact`,
  };
}

/** Every deal kind a demand role is ever interested in. For planning a search. */
export function dealsFor(demand: DemandRole): DealKind[] {
  return [...RELATIONSHIPS[demand].deals];
}

/** Every supply role a demand role can be served by. */
export function supplyRolesFor(demand: DemandRole): SupplyRole[] {
  return [...RELATIONSHIPS[demand].supply];
}

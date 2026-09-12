// The last thing that runs before Homatch spends money on a customer's behalf.
//
// WHY THIS FILE EXISTS
//
// Until it did, a campaign whose product had no active price still ran.
// `beginExecution()` returned PRODUCT_PRICING_INACTIVE, and comm-campaign-launch
// treated that as "launch anyway, reserve nothing" — on the reasoning that
// charging for something with no configured price would be worse than not
// charging. That reasoning is right about the invoice and wrong about the
// action: the honest answer to "I cannot price this" is not to do it for free,
// it is not to do it.
//
// The consequence was concrete. Publish an agent, import contacts, press
// Launch, and the dispatcher placed real PSTN calls at Cartesia and Vapi's
// real rates, reserved nothing, charged nobody, and recorded a cost_usd of
// null. The only thing between that and an unbounded bill was a per-tier daily
// cap — $25/day for a new account, multiplied by however many accounts exist.
//
// And the check was in the wrong place besides. It ran once, at launch. A
// campaign launched while priced and dispatched an hour later after an admin
// deactivated pricing would keep spending, because nothing between the queue
// and the provider adapter ever asked again.
//
// WHAT THIS IS
//
// One pure function that every billable provider action must pass immediately
// before the adapter is called. It is deliberately not a helper the caller can
// forget: `comm-dispatch-worker` calls it per send, and
// `executionGateRegression.test.mjs` asserts with a spy that the provider is
// never reached when it returns a refusal.
//
// It is pure so it can be tested exhaustively without a database, a provider
// or a network, and so the edge copy in _shared/comm/generated stays identical
// (scripts/sync-comm-domain.mjs --check).
//
// FAIL CLOSED, EVERY TIME
//
// Every unknown is a refusal. A null price is a refusal, not a zero. A missing
// product row is a refusal, not a default. An unparseable number is a refusal,
// not a coerced NaN. The cost of a wrong refusal is a customer who has to ask
// why; the cost of a wrong approval is money that has already left.

/**
 * Machine-readable refusals.
 *
 * Every one of these already existed somewhere in the system — in
 * `beginExecution`'s reason union, in `LaunchDecision['code']`, or in
 * `evaluateKillSwitch`'s codes. They are gathered here rather than reinvented,
 * so a refusal means the same thing wherever it surfaces and the UI has one
 * set of strings to translate.
 */
export type ExecutionRefusal =
  // Pricing and money
  | 'PRODUCT_DISABLED'
  | 'PRODUCT_PRICING_INACTIVE'
  | 'PRODUCT_PRICE_MISSING'
  | 'PRODUCT_PRICE_INVALID'
  | 'INSUFFICIENT_CREDIT'
  | 'RESERVATION_FAILED'
  | 'SPEND_CAP_REACHED'
  // Policy
  | 'DOMAIN_REJECTED'
  | 'RISK_REJECTED'
  | 'COMPLIANCE_PAUSED'
  // Channel and provider
  | 'CHANNEL_DISABLED'
  | 'KILL_SWITCH_ACTIVE'
  | 'PROVIDER_UNAVAILABLE'
  // The request itself
  | 'INVALID_REQUEST'
  | 'CONTACT_SUPPRESSED';

export interface ExecutionGateInput {
  /** What is about to happen. Only billable actions come through here. */
  action: 'PLACE_CALL' | 'SEND_WHATSAPP' | 'SEND_SMS' | 'SEND_EMAIL';

  /** The request is well-formed: a destination that could actually be reached. */
  requestValid: boolean;
  /** The contact is still contactable, re-read at this moment and not at launch. */
  contactContactable: boolean;

  /** The real-estate domain gate's verdict for this campaign. */
  domainVerdict: 'ALLOW' | 'REVIEW' | 'BLOCK' | null;
  /** The compliance/risk engine's decision for this campaign. */
  riskDecision: 'ALLOW' | 'REVIEW' | 'BLOCK' | 'THROTTLE' | null;
  /** True when the kill-switch evaluation says this campaign must stop now. */
  killSwitchPaused: boolean;

  /** comm_provider_routes for the role this action needs. */
  channelEnabled: boolean;
  channelKillSwitch: boolean;
  providerHealthy: boolean;

  /** billable_products for the product this action bills to. */
  productFound: boolean;
  productEnabled: boolean;
  pricingActive: boolean;
  /**
   * The resolved per-unit NET price in cents, before tax.
   *
   * null means "could not be resolved", which is a refusal. It does NOT mean
   * free. A product that is genuinely free is expressed as pricingActive with
   * a price of 0 and `freeAllowed` true — a deliberate statement rather than
   * an absence.
   */
  unitNetCents: number | null;
  /** Set only for a product intentionally priced at zero (the AI Talk demo). */
  freeAllowed?: boolean;

  /** Wallet. Credits already available to this action. */
  availableCredits: number | null;
  /** What this unit could cost at its ceiling, in credits. */
  requiredCredits: number | null;
  /** Whether this product requires a held reservation before executing. */
  reservationRequired: boolean;
  /** Whether one is actually held. */
  reservationHeld: boolean;

  /** Spend caps, all in cents. A null cap is no cap. */
  spentCents: number;
  inFlightCents: number;
  nextUnitMaxCents: number;
  campaignCapCents: number | null;
  accountDailyRemainingCents: number | null;
}

export interface ExecutionGateResult {
  /** The ONLY value that permits an adapter call. */
  allow: boolean;
  refusal: ExecutionRefusal | null;
  /** Why, in words, for a log line and an admin screen. Never shown raw to a customer. */
  detail: string | null;
  /**
   * Whether the campaign should be paused rather than this unit simply
   * skipped. A suppressed contact is a skip; an inactive price is a pause,
   * because every remaining unit would fail the same way.
   */
  pauseCampaign: boolean;
}

const refuse = (
  refusal: ExecutionRefusal,
  detail: string,
  pauseCampaign = false,
): ExecutionGateResult => ({ allow: false, refusal, detail, pauseCampaign });

/** A finite, non-negative number. Anything else is not a price. */
function isMoney(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

/**
 * May this billable provider action proceed?
 *
 * The order is deliberate: cheapest and most certain refusals first, so a log
 * line names the most specific cause rather than whichever check happened to
 * run. Policy outranks money — a campaign the domain gate rejected should be
 * reported as rejected, not as unpriced.
 */
export function evaluateExecutionGate(input: ExecutionGateInput): ExecutionGateResult {
  // ── 1. Is the request even coherent? ──────────────────────────────────────
  if (!input.requestValid) {
    return refuse('INVALID_REQUEST', 'the request has no usable destination');
  }
  if (!input.contactContactable) {
    // A skip, not a pause: the next contact may be perfectly contactable.
    return refuse('CONTACT_SUPPRESSED', 'the contact is no longer contactable');
  }

  /* ── 2. Policy. These pause the campaign; every unit would fail the same. ──
   *
   * ONLY 'ALLOW' ALLOWS. Not "anything that is not BLOCK".
   *
   * The first version of this gate refused BLOCK and null and let everything
   * else through, which quietly meant REVIEW dialled. REVIEW is the verdict
   * the classifier returns for campaigns it is not sure about — and it is the
   * verdict four of the six prohibited categories in the release corpus
   * actually produce: political campaigning, unrelated e-commerce, a generic
   * marketing blast, and unrelated B2B lead generation all come back REVIEW
   * rather than BLOCK, because the word lists cannot be certain and a human is
   * meant to look.
   *
   * So "held for a human" meant "dialled immediately", and the gate reported
   * itself as working. A verdict that means "someone must decide" cannot be
   * the same as "go ahead".
   */
  if (input.domainVerdict !== 'ALLOW') {
    const detail = input.domainVerdict === 'BLOCK'
      ? 'this campaign is not real-estate work'
      : input.domainVerdict === 'REVIEW'
        ? 'this campaign is waiting for a human to review it'
        : 'this campaign has not been classified';
    return refuse('DOMAIN_REJECTED', detail, true);
  }
  if (input.riskDecision !== 'ALLOW') {
    // Same rule on the compliance side. THROTTLE and REVIEW are both "not
    // now", and a campaign under either must not keep dialling while it waits.
    const detail = input.riskDecision === 'BLOCK'
      ? 'compliance blocked this campaign'
      : input.riskDecision === 'THROTTLE'
        ? 'compliance is holding this campaign back'
        : input.riskDecision === 'REVIEW'
          ? 'compliance is waiting for a human to review this campaign'
          : 'this campaign has no compliance decision';
    return refuse('RISK_REJECTED', detail, true);
  }
  if (input.killSwitchPaused) {
    return refuse('COMPLIANCE_PAUSED', 'the campaign was paused automatically', true);
  }

  // ── 3. Channel and provider ──────────────────────────────────────────────
  if (input.channelKillSwitch) {
    return refuse('KILL_SWITCH_ACTIVE', 'the kill switch for this channel is on', true);
  }
  if (!input.channelEnabled) {
    return refuse('CHANNEL_DISABLED', 'this channel is switched off', true);
  }
  if (!input.providerHealthy) {
    return refuse('PROVIDER_UNAVAILABLE', 'the provider is unavailable', true);
  }

  // ── 4. Money. THE GATE THIS FILE EXISTS FOR. ─────────────────────────────
  //
  // Nothing below may be relaxed into a warning. If Homatch cannot say what
  // this unit costs the customer, Homatch does not buy it.
  if (!input.productFound) {
    return refuse('PRODUCT_PRICE_MISSING', 'no billable product is registered for this action', true);
  }
  if (!input.productEnabled) {
    return refuse('PRODUCT_DISABLED', 'this product is switched off', true);
  }
  if (!input.pricingActive) {
    return refuse('PRODUCT_PRICING_INACTIVE', 'no active price is configured for this product', true);
  }
  if (input.unitNetCents === null || input.unitNetCents === undefined) {
    return refuse('PRODUCT_PRICE_MISSING', 'the unit price could not be resolved', true);
  }
  if (!isMoney(input.unitNetCents)) {
    // NaN, Infinity, a negative, or a string that arrived as a number: all of
    // them would have produced a charge nobody could defend.
    return refuse('PRODUCT_PRICE_INVALID', 'the configured unit price is not a usable number', true);
  }
  if (input.unitNetCents === 0 && !input.freeAllowed) {
    // A zero price is almost always an unconfigured one. Free has to be said
    // out loud, per product, not inferred from an empty column.
    return refuse('PRODUCT_PRICE_INVALID', 'the unit price is zero and this product is not declared free', true);
  }

  // ── 5. Wallet ────────────────────────────────────────────────────────────
  if (input.requiredCredits !== null && !isMoney(input.requiredCredits)) {
    return refuse('PRODUCT_PRICE_INVALID', 'the required credit amount is not a usable number', true);
  }
  if (input.requiredCredits !== null) {
    if (input.availableCredits === null || !isMoney(input.availableCredits)) {
      return refuse('INSUFFICIENT_CREDIT', 'the available balance could not be read', true);
    }
    if (input.availableCredits < input.requiredCredits) {
      return refuse('INSUFFICIENT_CREDIT', 'the balance will not cover this unit', true);
    }
  }
  if (input.reservationRequired && !input.reservationHeld) {
    return refuse('RESERVATION_FAILED', 'no credit reservation is held for this work', true);
  }

  // ── 6. Spend caps ────────────────────────────────────────────────────────
  const projected = input.spentCents + input.inFlightCents + input.nextUnitMaxCents;
  if (input.campaignCapCents !== null && projected > input.campaignCapCents) {
    // Not a pause here: runCampaign puts the unit back and pauses the campaign
    // itself, so the customer can raise the cap and resume.
    return refuse('SPEND_CAP_REACHED', 'the campaign would exceed its spend limit');
  }
  if (input.accountDailyRemainingCents !== null
      && input.nextUnitMaxCents > input.accountDailyRemainingCents) {
    return refuse('SPEND_CAP_REACHED', 'the account has used its daily spend limit');
  }

  return { allow: true, refusal: null, detail: null, pauseCampaign: false };
}

/**
 * Which refusals a customer may be shown, and which are ours alone.
 *
 * "compliance blocked this campaign" is a sentence a customer can act on.
 * "the provider is unavailable" names our plumbing and tells them nothing they
 * can do — §106. The UI maps the customer-facing set to translated copy and
 * shows the rest as a neutral "paused, we are looking at it".
 */
export const CUSTOMER_VISIBLE_REFUSALS: ReadonlySet<ExecutionRefusal> = new Set([
  'INSUFFICIENT_CREDIT',
  'SPEND_CAP_REACHED',
  'DOMAIN_REJECTED',
  'CONTACT_SUPPRESSED',
  'PRODUCT_PRICING_INACTIVE',
]);

export function isCustomerVisible(refusal: ExecutionRefusal): boolean {
  return CUSTOMER_VISIBLE_REFUSALS.has(refusal);
}

// HOMATCH Communications — phone number procurement, behind an interface.
//
// WHY AN INTERFACE BEFORE THERE IS A PROVIDER
//
// Nothing configured here can sell a number. The telephony provider lists the
// numbers the account already owns and has no inventory-search endpoint at
// all; there is no Twilio or Telnyx credential. So procurement is not a
// feature that is switched off, it is a feature with no supplier.
//
// The interface exists anyway, and the customer-facing product talks only to
// it, because the alternative is what usually happens: the first vendor gets
// wired straight into the pages, and the second one requires rewriting the
// pages. §23 asks for provider neutrality, and neutrality is cheap now and
// expensive later.
//
// WHAT A NULL PROVIDER IS FOR
//
// `resolveNumberProvider()` returns null when no credential is present, and
// every caller must handle that by saying so. It deliberately does NOT return
// a fake provider with empty inventory: "no numbers matched your search" and
// "this product has no supplier" are different sentences, and only one of them
// is true.

import { hasSecret } from './contracts.ts';

/** A number offered for sale, as the provider describes it. */
export interface NumberListing {
  /** The provider's own identifier for this listing. */
  providerRef: string;
  e164: string;
  country: string;
  /** VOICE / SMS / MMS — only what the provider actually confirms. */
  capabilities: string[];
  /** Real provider cost per month, in whole cents. Never a guess. */
  monthlyCostCents: number | null;
  /** Real provider cost to acquire, in whole cents, where charged separately. */
  setupCostCents: number | null;
  currency: string;
}

/** A number the account already holds. */
export interface OwnedNumber {
  providerRef: string;
  e164: string | null;
  country: string | null;
  capabilities: string[];
  /** What it is currently wired to, when the provider knows. */
  assignedTo: string | null;
}

export interface NumberSearch {
  country: string;
  /** Digits the number should contain, where the provider supports it. */
  contains?: string;
  limit?: number;
}

export interface NumberProviderResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; retryable: boolean };
}

/**
 * Everything the customer-facing Numbers product is allowed to ask for.
 *
 * Deliberately small. Each method is one thing a page needs, and none of them
 * leaks a vendor's vocabulary — a page that switched on `provider === 'TWILIO'`
 * would undo the point of this file.
 */
export interface NumberProvider {
  readonly name: string;

  /** Purchasable inventory. Never invented: an empty list means none matched. */
  searchNumbers(params: NumberSearch): Promise<NumberProviderResult<NumberListing[]>>;

  /** The provider's real cost for one listing, re-read at purchase time. */
  getNumberPrice(providerRef: string): Promise<NumberProviderResult<{
    monthlyCostCents: number | null; setupCostCents: number | null; currency: string;
  }>>;

  /**
   * Buy one number.
   *
   * `idempotencyKey` is not optional. Double-clicking Buy must not buy two
   * numbers, and the only place that can be guaranteed is at the provider.
   */
  purchaseNumber(params: {
    providerRef: string; idempotencyKey: string;
  }): Promise<NumberProviderResult<OwnedNumber>>;

  /** Give a number back. */
  releaseNumber(providerRef: string): Promise<NumberProviderResult<null>>;

  listOwnedNumbers(): Promise<NumberProviderResult<OwnedNumber[]>>;

  /** What this number can actually do, per the provider — not per assumption. */
  getCapabilities(providerRef: string): Promise<NumberProviderResult<string[]>>;
}

/**
 * Credentials that would make a procurement provider available.
 *
 * Listed in one place so the Admin checklist, the Numbers page and this
 * resolver cannot disagree about what is missing.
 */
export const PROCUREMENT_CREDENTIALS = {
  TWILIO: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
  TELNYX: ['TELNYX_API_KEY'],
} as const;

export function procurementConfigured(): boolean {
  return Object.values(PROCUREMENT_CREDENTIALS)
    .some((names) => names.every((n) => hasSecret(n)));
}

/**
 * The configured procurement provider, or null.
 *
 * Null is a real answer and callers must render it as "this needs setting up",
 * naming the credentials above. Returning a stub that answers every search
 * with an empty list would turn a missing supplier into what looks like a
 * sold-out catalogue.
 */
export function resolveNumberProvider(): NumberProvider | null {
  // No adapter is implemented yet because no credential exists to implement
  // one against, and an adapter nobody can run is an adapter nobody can test.
  // When a credential is added, construct it here; nothing above this line
  // and nothing in the pages needs to change.
  return null;
}

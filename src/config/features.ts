// CUSTOMER-FACING FEATURES THAT ARE DEFERRED RATHER THAN DELETED.
//
// One module, read at the places that render, so turning a feature back on is a single
// edit rather than an archaeology exercise across a dozen files. The alternative — a
// scatter of `display: none` and commented-out routes — is how a deferred feature
// becomes an undeletable one, because nobody can tell what was hidden on purpose.
//
// WHAT A FLAG HERE MEANS, AND WHAT IT DOES NOT
//
// It hides a CUSTOMER-FACING PRESENTATION. It never removes a table, a migration, an
// edge function, a persisted row or any part of the matching engine. If a flag here
// were ever the reason a record stopped being written, it would be the wrong tool and
// the code would be wrong, because the point of deferring a UI is to be able to bring
// it back to data that kept accruing while it was away.

export interface FeatureFlags {
  /**
   * The standalone "Active Search" customer feature: its page, its navigation entry,
   * its activation modal, its enable/disable toggle and the AI TALK destination that
   * pointed at it.
   *
   * DEFERRED 2026-09-26. It asked the customer to understand and switch on an abstract
   * mode before anything would happen, which is a concept the product no longer needs
   * them to hold: buyer and tenant discovery is contextual to a property now — open the
   * property, then "find buyers" or "find tenants" depending on what it is.
   *
   * WHAT IS EMPHATICALLY STILL RUNNING. `active_search_subscriptions` is the table the
   * reverse direction is built on: find-property-plan writes a row to it when a
   * customer confirms a search plan, and find-property reads the caller's own matches
   * through it. supply-matching, the campaign infrastructure, persisted matches and the
   * ledger are all untouched. This flag hides one screen and the controls that only
   * existed to operate that screen.
   *
   * The page component is kept on disk rather than deleted, for the same reason.
   */
  activeSearchUi: boolean;

  /**
   * The outbound-publication block on the Matches workspace: the community-outreach
   * panel that drafts a post for Facebook groups and Telegram channels, and the card of
   * links out to Georgian portals.
   *
   * DEFERRED 2026-09-27. Both were on a screen whose subject is "who wants this
   * property", and both answered a different question -- "where else could I advertise
   * it" -- above the answer to the first one. A customer scrolling to their matches read
   * two publication CTAs before the first match. The work they do is real and the AI
   * drafting is good; it belongs somewhere it is the subject, not in front of results.
   *
   * WHAT IS STILL RUNNING. `community_outreach_*`, the drafting edge function, the
   * translated post copy and the portal registry are untouched, and the components stay
   * on disk. This hides two panels on one page.
   */
  matchesOutboundPublication: boolean;

  /**
   * The campaign OPERATOR controls on the Matches workspace: the wallet-balance chip in
   * its header, the pulsing "matching is active" banner, and the per-language coverage
   * table.
   *
   * DEFERRED 2026-09-27, and this one needs the distinction stated precisely, because
   * hiding the wrong half would break the product.
   *
   * HIDDEN: the wallet balance (a number about the ACCOUNT, in the header of a screen
   * about a PROPERTY -- and the unlock dialog already shows the balance at the moment it
   * is about to change, which is where a balance is load-bearing); the green pulsing
   * status banner, which reported a state the customer had not asked to think about and
   * was derived from "some match is not archived" rather than from the campaign; and the
   * language-coverage counts, which are how an operator audits reach.
   *
   * NOT HIDDEN, and must never be folded into this flag: starting a search, the budget
   * authorisation dialog, pausing a running search, live job progress, and Expand
   * Search. Those are how a customer gets matches at all and how they stay in control of
   * what is spent.
   */
  matchesCampaignOperatorControls: boolean;
}

export const FEATURES: FeatureFlags = {
  activeSearchUi: false,
  matchesOutboundPublication: false,
  matchesCampaignOperatorControls: false,
};

/** Read a flag by name. A helper so call sites read as a question. */
export function featureEnabled(name: keyof FeatureFlags): boolean {
  return FEATURES[name];
}

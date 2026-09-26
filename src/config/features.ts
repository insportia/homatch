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
}

export const FEATURES: FeatureFlags = {
  activeSearchUi: false,
};

/** Read a flag by name. A helper so call sites read as a question. */
export function featureEnabled(name: keyof FeatureFlags): boolean {
  return FEATURES[name];
}

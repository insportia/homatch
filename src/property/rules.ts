// THE TWO DECISIONS A PROPERTY MAKES ABOUT ITSELF.
//
// Both are pure, both are read by two screens and one service, and both are the kind of
// rule that goes wrong quietly. They live here rather than in propertyManagement.ts for
// a reason that turned out to matter immediately: that file imports the Supabase client,
// so a test wanting to check "does a RENT listing offer to find tenants" could not load
// it without resolving a database alias. A rule that cannot be tested without a database
// is a rule nobody tests.

/** What a property can ask Homatch to do next. */
export type PropertyIntelligenceAction = 'FIND_BUYERS' | 'FIND_TENANTS' | 'FIND_INVESTORS';

/**
 * The one matching action this property's transaction type actually supports.
 *
 * ONE ACTION, NOT A MENU. A SALE listing finds buyers; a RENT listing finds tenants; an
 * INVESTMENT listing finds investors. Offering "Find tenants" on a flat that is for sale
 * is offering something that cannot succeed, and the customer discovers that by running
 * a campaign against the wrong half of the market.
 *
 * NULL IS A REAL ANSWER. A half-finished import has no transaction type, and guessing
 * SALE would be the same mistake in the other direction — a rental advertised to buyers
 * because a column was empty.
 */
export function intelligenceActionFor(
  transactionType: string | null | undefined,
): PropertyIntelligenceAction | null {
  switch (String(transactionType ?? '').trim().toUpperCase()) {
    case 'SALE': return 'FIND_BUYERS';
    case 'RENT': return 'FIND_TENANTS';
    case 'INVESTMENT': return 'FIND_INVESTORS';
    default: return null;
  }
}

/**
 * Is this property a Homatch copy of somebody else's listing?
 *
 * `property_source_type` has exactly two values — URL_IMPORT and PRIVATE_LISTING — and
 * this reads the first. It matters to the edit screen: the source fields are evidence of
 * what an external page said, they are not ours to rewrite, and the owner should be told
 * that editing changes the Homatch copy rather than the original.
 *
 * Deliberately exact rather than fuzzy. 'IMPORTED' is not a value this enum has, and
 * matching it would mean matching a value that could only come from a bug.
 */
export function isImported(sourceType: string | null | undefined): boolean {
  return String(sourceType ?? '').trim().toUpperCase() === 'URL_IMPORT';
}

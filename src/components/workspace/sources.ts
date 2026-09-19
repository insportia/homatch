// HOMATCH WORKSPACE — the provenance vocabulary, with no React in it.
//
// Split out of controls.tsx so the domain layers can name a source
// without pulling a component tree into Node's test runner. Both
// products' preset tables import this; only the badge imports the
// component that renders it.

/**
 * Both products' provenance vocabularies in one union.
 *
 * MARKET / CONVENTION / EXAMPLE are Investment's; OFFICIAL / ESTIMATE /
 * AI are Mortgage's; CALCULATED and USER are shared. They live together
 * because one badge with eight tones is easier to keep honest than two
 * badges with five each — the whole point is that two different kinds of
 * claim never look the same, and that is only checkable if they are
 * declared in one place.
 */
export type ValueSource =
  | 'MARKET'
  | 'CALCULATED'
  | 'CONVENTION'
  | 'EXAMPLE'
  | 'USER'
  | 'OFFICIAL'
  | 'ESTIMATE'
  | 'AI';

/** The five inv_* keys predate the split and are already translated into
 *  all six languages; renaming them would be churn with no reader-visible
 *  benefit. The three new ones carry the shared wk_ prefix. */
export const SOURCE_LABEL_KEYS: Record<ValueSource, string> = {
  MARKET: 'inv_src_market',
  CALCULATED: 'inv_src_calculated',
  CONVENTION: 'inv_src_convention',
  EXAMPLE: 'inv_src_example',
  USER: 'inv_src_user',
  OFFICIAL: 'wk_src_official',
  ESTIMATE: 'wk_src_estimate',
  AI: 'wk_src_ai',
};

export const SOURCE_TONES: Record<ValueSource, string> = {
  MARKET: 'border-[hsl(var(--gold-border))] text-[hsl(var(--gold-ink))]',
  CALCULATED: 'border-[hsl(var(--info)/0.45)] text-[hsl(var(--info))]',
  CONVENTION: 'border-border text-muted-foreground',
  EXAMPLE: 'border-dashed border-border text-muted-foreground',
  USER: 'border-border text-foreground',
  /* An official published limit is the strongest claim on either
     surface, so it gets the one colour nothing else uses here. */
  OFFICIAL: 'border-[hsl(var(--success)/0.5)] text-[hsl(var(--success))]',
  ESTIMATE: 'border-dashed border-border text-muted-foreground',
  /* Dashed and quiet, deliberately: prose from a model must never read
     as heavily as a number the engine produced. */
  AI: 'border-dashed border-[hsl(var(--info)/0.4)] text-[hsl(var(--info))]',
};

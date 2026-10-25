// HOMATCH HOME FINANCING — one page per mortgage word.
//
// The (i) cards beside labels stay short on purpose; this is where each word
// gets room: what it really means, why it matters, how it is calculated, a
// worked example in round lari and the usual mistakes. Every term the
// calculator names (GLOSSARY_TERMS) has a page, plus the words the flow
// relies on without labelling them (loan term, annuity vs differentiated,
// grace period, monthly fee, state programmes, exchange rate, NBG limits).
//
// Copy keys: mortgage_term_<slug>_title / _body (the one-line summary) and
// mortgage_tp_<slug>_what|why|how|ex_1..4|mistake_1..3.

import { GLOSSARY_TERMS, type GlossaryTerm } from './glossary.ts';

export const EXTRA_TERMS = [
  'LOAN_TERM', 'ANNUITY', 'DIFFERENTIATED', 'GRACE_PERIOD', 'MONTHLY_FEE', 'SUBSIDY', 'EXCHANGE_RATE', 'NBG_LIMITS',
] as const;
export type ExtraTerm = (typeof EXTRA_TERMS)[number];
export type PageTerm = GlossaryTerm | ExtraTerm;

export type TermCategory = 'rates' | 'basics' | 'limits' | 'costs' | 'later';

export interface TermPage {
  term: PageTerm;
  /** URL segment: /mortgage/terms/<slug>. */
  slug: string;
  category: TermCategory;
  related: PageTerm[];
}

const def = (term: PageTerm, category: TermCategory, related: PageTerm[]): TermPage => ({
  term, slug: term.toLowerCase().replace(/_/g, '-'), category, related,
});

/** In reading order: the index lists categories in this order and terms within them. */
export const TERM_PAGES: readonly TermPage[] = [
  def('NOMINAL_RATE', 'rates', ['EFFECTIVE_RATE', 'MONTHLY_INSTALLMENT', 'FIXED_RATE']),
  def('EFFECTIVE_RATE', 'rates', ['NOMINAL_RATE', 'ORIGINATION_FEE', 'TOTAL_COST']),
  def('FIXED_RATE', 'rates', ['VARIABLE_RATE', 'EARLY_REPAYMENT', 'NOMINAL_RATE']),
  def('VARIABLE_RATE', 'rates', ['REFERENCE_INDEX', 'FIXED_RATE', 'MONTHLY_INSTALLMENT']),
  def('REFERENCE_INDEX', 'rates', ['VARIABLE_RATE', 'NOMINAL_RATE']),

  def('PRINCIPAL', 'basics', ['INTEREST_PAYMENT', 'AMORTIZATION', 'EARLY_REPAYMENT']),
  def('INTEREST_PAYMENT', 'basics', ['PRINCIPAL', 'NOMINAL_RATE', 'TOTAL_REPAYMENT']),
  def('MONTHLY_INSTALLMENT', 'basics', ['ANNUITY', 'PTI', 'LOAN_TERM']),
  def('LOAN_TERM', 'basics', ['MONTHLY_INSTALLMENT', 'TOTAL_REPAYMENT', 'EARLY_REPAYMENT']),
  def('ANNUITY', 'basics', ['DIFFERENTIATED', 'AMORTIZATION', 'MONTHLY_INSTALLMENT']),
  def('DIFFERENTIATED', 'basics', ['ANNUITY', 'INTEREST_PAYMENT', 'PTI']),
  def('AMORTIZATION', 'basics', ['PRINCIPAL', 'INTEREST_PAYMENT', 'ANNUITY']),
  def('GRACE_PERIOD', 'basics', ['INTEREST_PAYMENT', 'MONTHLY_INSTALLMENT', 'TOTAL_COST']),
  def('DOWN_PAYMENT', 'basics', ['LTV', 'APPRAISAL', 'PRINCIPAL']),
  def('TOTAL_REPAYMENT', 'basics', ['TOTAL_COST', 'LOAN_TERM', 'INTEREST_PAYMENT']),
  def('TOTAL_COST', 'basics', ['EFFECTIVE_RATE', 'TOTAL_REPAYMENT', 'INSURANCE']),

  def('NBG_LIMITS', 'limits', ['PTI', 'LTV', 'CURRENCY_RISK']),
  def('PTI', 'limits', ['NBG_LIMITS', 'CO_BORROWER', 'MONTHLY_INSTALLMENT']),
  def('LTV', 'limits', ['NBG_LIMITS', 'DOWN_PAYMENT', 'APPRAISAL']),
  def('CREDIT_HISTORY', 'limits', ['GUARANTOR', 'CO_BORROWER']),
  def('CO_BORROWER', 'limits', ['PTI', 'GUARANTOR']),
  def('GUARANTOR', 'limits', ['CO_BORROWER', 'CREDIT_HISTORY']),
  def('COLLATERAL', 'limits', ['ADDITIONAL_COLLATERAL', 'APPRAISAL', 'LTV']),
  def('ADDITIONAL_COLLATERAL', 'limits', ['COLLATERAL', 'LTV']),
  def('APPRAISAL', 'limits', ['LTV', 'COLLATERAL', 'DOWN_PAYMENT']),

  def('ORIGINATION_FEE', 'costs', ['EFFECTIVE_RATE', 'TOTAL_COST', 'MONTHLY_FEE']),
  def('MONTHLY_FEE', 'costs', ['ORIGINATION_FEE', 'EFFECTIVE_RATE', 'TOTAL_COST']),
  def('INSURANCE', 'costs', ['TOTAL_COST', 'EFFECTIVE_RATE']),
  def('EARLY_REPAYMENT', 'costs', ['PRINCIPAL', 'REFINANCING', 'LOAN_TERM']),

  def('REFINANCING', 'later', ['EARLY_REPAYMENT', 'EFFECTIVE_RATE', 'VARIABLE_RATE']),
  def('SUBSIDY', 'later', ['NOMINAL_RATE', 'MONTHLY_INSTALLMENT']),
  def('CURRENCY_RISK', 'later', ['EXCHANGE_RATE', 'NBG_LIMITS', 'LTV']),
  def('EXCHANGE_RATE', 'later', ['CURRENCY_RISK']),
];

export const TERM_CATEGORIES: readonly TermCategory[] = ['rates', 'basics', 'limits', 'costs', 'later'];

const BY_SLUG = new Map(TERM_PAGES.map((p) => [p.slug, p]));
const BY_TERM = new Map(TERM_PAGES.map((p) => [p.term, p]));

export const termPageBySlug = (slug: string | undefined): TermPage | null => (slug ? BY_SLUG.get(slug.toLowerCase()) ?? null : null);
export const termPageFor = (term: PageTerm): TermPage => BY_TERM.get(term)!;
export const termPath = (term: PageTerm): string => `/mortgage/terms/${termPageFor(term).slug}`;
export const TERMS_INDEX_PATH = '/mortgage/terms';

const key = (term: PageTerm) => term.toLowerCase();
export const pageTitleKey = (term: PageTerm) => `mortgage_term_${key(term)}_title`;
export const pageSummaryKey = (term: PageTerm) => `mortgage_term_${key(term)}_body`;
export const pageSectionKey = (term: PageTerm, section: 'what' | 'why' | 'how') => `mortgage_tp_${key(term)}_${section}`;
export const pageExampleKeys = (term: PageTerm) => [1, 2, 3, 4].map((n) => `mortgage_tp_${key(term)}_ex_${n}`);
export const pageMistakeKeys = (term: PageTerm) => [1, 2, 3].map((n) => `mortgage_tp_${key(term)}_mistake_${n}`);
export const categoryKey = (c: TermCategory) => `mortgage_tp_cat_${c}`;

/** Every key a term page renders, for the completeness test. */
export function termPageKeys(term: PageTerm): string[] {
  return [pageTitleKey(term), pageSummaryKey(term), pageSectionKey(term, 'what'), pageSectionKey(term, 'why'),
    pageSectionKey(term, 'how'), ...pageExampleKeys(term), ...pageMistakeKeys(term)];
}

/** Sanity: every glossary term (the ones the calculator labels) has a page. */
export const MISSING_PAGES: GlossaryTerm[] = GLOSSARY_TERMS.filter((t) => !BY_TERM.has(t));

// HOMATCH Admin — bank mortgage products (public.mortgage_bank_products,
// migration 20261201092000), the rules an admin edit has to obey.
//
// Pure and framework-free so src/admin/__tests__/mortgageBankProducts.test.mjs
// can hold them. The screen is src/components/admin/MortgageBankProductsAdmin.tsx.
//
// What the table promises the public: a product is shown only while it is
// VERIFIED, has a verified date inside its review window and has started
// (RLS mortgage_bank_products_public_read). So:
//   · a new product is a DRAFT;
//   · changing a VERIFIED product's conditions sends it back to DRAFT — numbers
//     nobody re-checked must not keep the "verified" badge;
//   · verifying needs an https source and a verified date that is not in the future;
//   · a product is RETIRED, never deleted (the table has no DELETE policy).

export type BankProductStatus = 'DRAFT' | 'VERIFIED' | 'RETIRED';
export const BANK_PRODUCT_CURRENCIES = ['GEL', 'USD', 'EUR'] as const;
export const BANK_PRODUCT_RATE_TYPES = ['FIXED', 'VARIABLE', 'INDEXED'] as const;

export interface BankProductRow {
  id: string;
  bank_name: string;
  product_name: string;
  currency: string;
  min_term_months: number | null;
  max_term_months: number | null;
  rate_from_percent: number | string | null;
  rate_to_percent: number | string | null;
  rate_type: string | null;
  effective_rate_from_percent: number | string | null;
  min_down_payment_percent: number | string | null;
  notes: string | null;
  source_url: string;
  verified_at: string | null;
  effective_from: string | null;
  review_due_days: number;
  review_status: BankProductStatus;
  updated_at?: string | null;
}

/** Everything the form edits, as the strings the inputs hold. */
export interface BankProductForm {
  bank_name: string;
  product_name: string;
  currency: string;
  rate_from_percent: string;
  rate_to_percent: string;
  rate_type: string;
  effective_rate_from_percent: string;
  min_down_payment_percent: string;
  min_term_months: string;
  max_term_months: string;
  source_url: string;
  effective_from: string;
  review_due_days: string;
  notes: string;
}

export type BankProductPayload = {
  bank_name: string;
  product_name: string;
  currency: string;
  rate_from_percent: number | null;
  rate_to_percent: number | null;
  rate_type: string | null;
  effective_rate_from_percent: number | null;
  min_down_payment_percent: number | null;
  min_term_months: number | null;
  max_term_months: number | null;
  source_url: string;
  effective_from: string | null;
  review_due_days: number;
  notes: string | null;
};

/** Field → i18n key of the problem. */
export type FormErrors = Partial<Record<keyof BankProductForm, string>>;

export function emptyBankProductForm(): BankProductForm {
  return {
    bank_name: '', product_name: '', currency: 'GEL', rate_from_percent: '', rate_to_percent: '', rate_type: '',
    effective_rate_from_percent: '', min_down_payment_percent: '', min_term_months: '', max_term_months: '',
    source_url: '', effective_from: '', review_due_days: '45', notes: '',
  };
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function formFromRow(row: BankProductRow): BankProductForm {
  return {
    bank_name: row.bank_name, product_name: row.product_name, currency: row.currency,
    rate_from_percent: s(row.rate_from_percent), rate_to_percent: s(row.rate_to_percent), rate_type: s(row.rate_type),
    effective_rate_from_percent: s(row.effective_rate_from_percent), min_down_payment_percent: s(row.min_down_payment_percent),
    min_term_months: s(row.min_term_months), max_term_months: s(row.max_term_months),
    source_url: row.source_url, effective_from: s(row.effective_from), review_due_days: s(row.review_due_days || 45), notes: s(row.notes),
  };
}

const HTTPS = /^https:\/\/[^\s/$.?#][^\s]*$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isHttpsUrl(v: string): boolean {
  return HTTPS.test(v.trim()) && v.trim().toLowerCase().startsWith('https://');
}

export function isIsoDate(v: string): boolean {
  if (!ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Parse an optional decimal ("4,5" accepted); undefined means "invalid". */
function optNumber(v: string): number | null | undefined {
  const t = v.trim().replace(',', '.');
  if (t === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return undefined;
  return Number(t);
}

export function validateBankProductForm(form: BankProductForm):
  { ok: true; payload: BankProductPayload } | { ok: false; errors: FormErrors } {
  const errors: FormErrors = {};
  const bank = form.bank_name.trim();
  const product = form.product_name.trim();
  if (!bank) errors.bank_name = 'admin_hs_bp_err_required';
  if (!product) errors.product_name = 'admin_hs_bp_err_required';
  const currency = form.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = 'admin_hs_bp_err_currency';
  const url = form.source_url.trim();
  if (!isHttpsUrl(url)) errors.source_url = 'admin_hs_bp_err_https';

  const pct = (k: 'rate_from_percent' | 'rate_to_percent' | 'effective_rate_from_percent' | 'min_down_payment_percent', max: number) => {
    const n = optNumber(form[k]);
    if (n === undefined || (n !== null && (n < 0 || n > max))) { errors[k] = 'admin_hs_bp_err_percent'; return null; }
    return n;
  };
  const rateFrom = pct('rate_from_percent', 100);
  const rateTo = pct('rate_to_percent', 100);
  const effRate = pct('effective_rate_from_percent', 100);
  const down = pct('min_down_payment_percent', 100);
  if (rateFrom !== null && rateTo !== null && rateTo < rateFrom) errors.rate_to_percent = 'admin_hs_bp_err_range';

  const months = (k: 'min_term_months' | 'max_term_months') => {
    const n = optNumber(form[k]);
    if (n === undefined || (n !== null && (!Number.isInteger(n) || n <= 0 || n > 600))) { errors[k] = 'admin_hs_bp_err_months'; return null; }
    return n;
  };
  const minTerm = months('min_term_months');
  const maxTerm = months('max_term_months');
  if (minTerm !== null && maxTerm !== null && maxTerm < minTerm) errors.max_term_months = 'admin_hs_bp_err_range';

  const rateType = form.rate_type.trim().toUpperCase();
  if (rateType && !(BANK_PRODUCT_RATE_TYPES as readonly string[]).includes(rateType)) errors.rate_type = 'admin_hs_bp_err_required';

  const eff = form.effective_from.trim();
  if (eff && !isIsoDate(eff)) errors.effective_from = 'admin_hs_bp_err_date';

  const due = optNumber(form.review_due_days);
  if (due === undefined || due === null || !Number.isInteger(due) || due < 1 || due > 365) errors.review_due_days = 'admin_hs_bp_err_review_days';

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    payload: {
      bank_name: bank, product_name: product, currency,
      rate_from_percent: rateFrom, rate_to_percent: rateTo, rate_type: rateType || null,
      effective_rate_from_percent: effRate, min_down_payment_percent: down,
      min_term_months: minTerm, max_term_months: maxTerm,
      source_url: url, effective_from: eff || null, review_due_days: due as number,
      notes: form.notes.trim() || null,
    },
  };
}

/**
 * The write for a saved edit. A VERIFIED product whose conditions were edited
 * goes back to DRAFT (and leaves public view) until someone verifies it again;
 * a DRAFT stays DRAFT; a RETIRED one stays RETIRED.
 */
export function editWrite(current: BankProductStatus | null, payload: BankProductPayload):
  BankProductPayload & { review_status?: BankProductStatus } {
  if (current === null) return { ...payload, review_status: 'DRAFT' };
  if (current === 'VERIFIED') return { ...payload, review_status: 'DRAFT' };
  return payload;
}

/** The write that marks a product verified. Null + an i18n key when it cannot. */
export function verifyWrite(sourceUrl: string, verifiedAt: string, today: string):
  { ok: true; payload: { review_status: 'VERIFIED'; verified_at: string; source_url: string } } | { ok: false; error: string } {
  const url = sourceUrl.trim();
  if (!isHttpsUrl(url)) return { ok: false, error: 'admin_hs_bp_err_https' };
  if (!isIsoDate(verifiedAt)) return { ok: false, error: 'admin_hs_bp_err_date' };
  if (verifiedAt > today) return { ok: false, error: 'admin_hs_bp_err_future' };
  return { ok: true, payload: { review_status: 'VERIFIED', verified_at: verifiedAt, source_url: url } };
}

/** Which status moves the screen offers from each status. */
export function allowedMoves(status: BankProductStatus): Array<'verify' | 'retire' | 'restore'> {
  if (status === 'DRAFT') return ['verify', 'retire'];
  if (status === 'VERIFIED') return ['verify', 'retire'];
  return ['restore'];
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * What a customer sees of this row today, mirroring the public RLS policy:
 * SHOWN, or why not (DRAFT, RETIRED, STALE past its review window, NOT_STARTED).
 */
export type PublicVisibility = 'SHOWN' | 'DRAFT' | 'RETIRED' | 'STALE' | 'NOT_STARTED';

export function publicVisibility(row: Pick<BankProductRow, 'review_status' | 'verified_at' | 'review_due_days' | 'effective_from'>, today: string): PublicVisibility {
  if (row.review_status === 'RETIRED') return 'RETIRED';
  if (row.review_status !== 'VERIFIED' || !row.verified_at) return 'DRAFT';
  if (addDays(row.verified_at.slice(0, 10), row.review_due_days || 45) < today) return 'STALE';
  if (row.effective_from && row.effective_from.slice(0, 10) > today) return 'NOT_STARTED';
  return 'SHOWN';
}

/** Today as YYYY-MM-DD in the admin's local calendar (dates in this table are plain dates). */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Mortgage rule status changes the admin may make (mortgage_rule_admin_set_status enforces the same). */
export type RuleStatus = 'CANDIDATE' | 'ACTIVE' | 'SUPERSEDED' | 'REJECTED';
export function ruleMoves(status: RuleStatus | string): Array<'ACTIVE' | 'REJECTED'> {
  return status === 'CANDIDATE' ? ['ACTIVE', 'REJECTED'] : [];
}

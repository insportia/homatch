// HOMATCH HOME FINANCING — typing an amount in any currency.
//
// The calculation itself still runs in ONE currency (the loan currency,
// lari unless the person picks another; see currencies.ts). What changed is
// the entry: a price seen in dollars, a salary paid in euros or a plot valued
// in pounds can be typed as it is, and it is turned into the loan currency
// here, with the National Bank of Georgia's official rate.
//
// THE RULES
//
//   1. Lari is the hub. NBG quotes every currency as GEL per unit, so a
//      USD → EUR conversion is USD → GEL → EUR.
//   2. No rate, no number. A currency the table does not hold converts to
//      null, never to the amount itself and never to zero. The screen says
//      which rate is missing.
//   3. The rate and its date travel with the result, so the screen can show
//      exactly what was used.

export interface FxRate {
  currency: string;
  /** Lari for ONE unit of `currency` (NBG per-10/per-100 quotes already divided). */
  gelPerUnit: number;
  /** ISO date the NBG published it. */
  rateDate: string;
}

export type FxTable = Readonly<Record<string, FxRate>>;

export interface Conversion {
  value: number;
  /** Units of `to` for one unit of `from`. */
  rate: number;
  /** The older of the two dates involved; null when no rate was needed. */
  rateDate: string | null;
}

/** The four the owner asked for first, then the ones people in Georgia most often hold. */
export const MAIN_ENTRY_CURRENCIES = ['GEL', 'USD', 'EUR', 'GBP'] as const;
export const OTHER_ENTRY_CURRENCIES = [
  'TRY', 'AED', 'ILS', 'RUB', 'UAH', 'AZN', 'AMD', 'KZT', 'CHF', 'CAD', 'AUD', 'JPY', 'CNY',
  'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'SAR', 'KWD', 'QAR', 'INR', 'BYN', 'UZS',
] as const;

export function toTable(rates: readonly FxRate[]): FxTable {
  const out: Record<string, FxRate> = {};
  for (const r of rates) {
    const code = String(r.currency ?? '').toUpperCase();
    const v = Number(r.gelPerUnit);
    if (/^[A-Z]{3}$/.test(code) && code !== 'GEL' && Number.isFinite(v) && v > 0) out[code] = { currency: code, gelPerUnit: v, rateDate: r.rateDate };
  }
  return out;
}

function gelPer(code: string, table: FxTable): { v: number; date: string | null } | null {
  if (code === 'GEL') return { v: 1, date: null };
  const r = table[code];
  return r ? { v: r.gelPerUnit, date: r.rateDate } : null;
}

const older = (a: string | null, b: string | null) => (a && b ? (a < b ? a : b) : a ?? b);

/** Convert, or null when either side has no rate. Rounded to cents. */
export function convertAmount(amount: number, from: string, to: string, table: FxTable): Conversion | null {
  if (!Number.isFinite(amount)) return null;
  const f = from.toUpperCase();
  const tCode = to.toUpperCase();
  if (f === tCode) return { value: amount, rate: 1, rateDate: null };
  const a = gelPer(f, table);
  const b = gelPer(tCode, table);
  if (!a || !b) return null;
  const rate = a.v / b.v;
  return { value: Math.round(amount * rate * 100) / 100, rate, rateDate: older(a.date, b.date) };
}

/** Whether a published rate is old enough to say so (weekends and holidays allowed). */
export function isRateOld(rateDate: string | null, now: number = Date.now()): boolean {
  if (!rateDate) return false;
  const t = Date.parse(`${rateDate}T00:00:00Z`);
  return Number.isFinite(t) && now - t > 4 * 24 * 60 * 60 * 1000;
}

/** An amount as the person typed it. */
export interface MoneyEntry {
  /** Null while the field is empty: the currency choice is kept on its own. */
  amount: number | null;
  currency: string;
}

/** An entry in the loan currency, or null when it cannot be converted (empty, or no rate). */
export function entryInLoanCurrency(entry: MoneyEntry, loanCurrency: string, table: FxTable): Conversion | null {
  if (entry.amount === null) return null;
  return convertAmount(entry.amount, entry.currency, loanCurrency, table);
}
export type MoneyEntries = Readonly<Record<string, MoneyEntry>>;

/** Re-validate stored entries: storage is writable by anything on this origin. */
export function cleanEntries(raw: unknown): Record<string, MoneyEntry> {
  const out: Record<string, MoneyEntry> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const e = v as { amount?: unknown; currency?: unknown } | null;
    const amountOk = e && (e.amount === null || (typeof e.amount === 'number' && Number.isFinite(e.amount)));
    if (e && amountOk && typeof e.currency === 'string' && /^[A-Z]{3}$/.test(e.currency)) {
      out[k] = { amount: e.amount as number | null, currency: e.currency };
    }
  }
  return out;
}

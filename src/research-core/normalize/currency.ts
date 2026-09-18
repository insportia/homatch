import { parseNumber, round } from './numbers.ts';

export type CurrencyCode = string;

export interface Money {
  amount: number;
  currency: CurrencyCode;
}

export interface ParsedMoney extends Money {
  raw: string;
  /** How the currency was determined, for auditability. */
  currencySource: 'SYMBOL' | 'CODE' | 'WORD' | 'DEFAULT';
}

const SYMBOL_TO_CODE: Record<string, CurrencyCode> = {
  $: 'USD',
  US$: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '₾': 'GEL',
  '₽': 'RUB',
  '₺': 'TRY',
  '¥': 'JPY',
  '₴': 'UAH',
  '₼': 'AZN',
  '֏': 'AMD',
};

/**
 * Word forms, split by script.
 *
 * `\b` in JavaScript is defined over ASCII word characters, so it never matches
 * a boundary next to Georgian or Cyrillic letters. Non-Latin forms therefore
 * get their own unanchored patterns rather than silently never matching.
 */
const WORD_TO_CODE: Array<[RegExp, CurrencyCode]> = [
  [/\b(?:usd|dollars?)\b/i, 'USD'],
  [/\b(?:eur|euros?)\b/i, 'EUR'],
  [/\b(?:gbp|pounds? sterling)\b/i, 'GBP'],
  [/\b(?:gel|lari)\b/i, 'GEL'],
  [/\b(?:rub|rubles?)\b/i, 'RUB'],
  [/\b(?:try|lira)\b/i, 'TRY'],
  [/ლარ/i, 'GEL'],
  [/лари/i, 'GEL'],
  [/долл/i, 'USD'],
  [/евро/i, 'EUR'],
  [/рубл/i, 'RUB'],
];

const KNOWN_CODES = new Set([
  'USD', 'EUR', 'GBP', 'GEL', 'RUB', 'TRY', 'JPY', 'UAH', 'AZN', 'AMD', 'CHF', 'PLN', 'AED',
]);

/** Detect a currency without needing an amount. */
export function detectCurrency(text: string): { code: CurrencyCode; source: ParsedMoney['currencySource'] } | null {
  for (const [symbol, code] of Object.entries(SYMBOL_TO_CODE)) {
    if (text.includes(symbol)) return { code, source: 'SYMBOL' };
  }
  const codeMatch = text.toUpperCase().match(/\b([A-Z]{3})\b/);
  if (codeMatch && KNOWN_CODES.has(codeMatch[1] as string)) {
    return { code: codeMatch[1] as string, source: 'CODE' };
  }
  for (const [re, code] of WORD_TO_CODE) {
    if (re.test(text)) return { code, source: 'WORD' };
  }
  return null;
}

export function parseMoney(
  text: string,
  options: { defaultCurrency?: CurrencyCode } = {},
): ParsedMoney | null {
  const amount = parseNumber(text);
  if (amount === null) return null;

  const detected = detectCurrency(text);
  if (!detected && !options.defaultCurrency) return null;

  return {
    amount,
    currency: detected?.code ?? (options.defaultCurrency as CurrencyCode),
    currencySource: detected?.source ?? 'DEFAULT',
    raw: text.trim(),
  };
}

/**
 * Find every money-looking token in a blob of text.
 *
 * By default a token only counts as money when a currency was actually
 * detected on it. Without that rule "completed in 2019" and "permit issued
 * 2016" both parse as prices, which is exactly how a year ends up competing
 * with an asking price in the fact clusters. `allowBareNumbers` opts back in
 * for sources where the currency is known from context.
 */
export function extractMoney(
  text: string,
  options: { defaultCurrency?: CurrencyCode; allowBareNumbers?: boolean } = {},
): ParsedMoney[] {
  const pattern =
    /(?:[$€£₾₽₺¥₴₼֏]|\b(?:USD|EUR|GBP|GEL|RUB|TRY)\b)?\s?[0-9][0-9\s.,'  ]{2,}\s?(?:[$€£₾₽₺¥₴₼֏]|\b(?:USD|EUR|GBP|GEL|RUB|TRY|lari|ლარი)\b)?/gi;
  const out: ParsedMoney[] = [];
  for (const match of text.match(pattern) ?? []) {
    const money = parseMoney(match, options);
    if (!money || money.amount <= 0) continue;
    if (money.currencySource === 'DEFAULT' && !options.allowBareNumbers) continue;
    out.push(money);
  }
  return out;
}

export function formatMoney(money: Money, decimals = 0): string {
  return `${round(money.amount, decimals).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} ${money.currency}`;
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

export interface ConversionResult {
  amount: number;
  currency: CurrencyCode;
  rate: number;
  rateSource: string;
  asOf: string | null;
}

/**
 * Conversion is an interface, not a hardcoded table. The engine never invents a
 * rate: an unconfigured pair returns null and the caller reports the value in
 * its original currency rather than silently guessing.
 */
export interface CurrencyConverter {
  readonly name: string;
  convert(amount: number, from: CurrencyCode, to: CurrencyCode): ConversionResult | null;
  supports(from: CurrencyCode, to: CurrencyCode): boolean;
}

export interface RateEntry {
  rate: number;
  asOf?: string;
}

/**
 * Converter backed by an explicitly supplied rate table. Rates are operator
 * input (config, a daily job, the NBG feed) - never a constant baked into the
 * engine. Inverse and one-hop triangulation via a base currency are derived.
 */
export class StaticRateConverter implements CurrencyConverter {
  readonly name: string;
  private readonly rates = new Map<string, RateEntry>();

  private readonly options: { baseCurrency?: CurrencyCode; name?: string };

  constructor(
    rates: Record<string, RateEntry | number> = {},
    options: { baseCurrency?: CurrencyCode; name?: string } = {}) {
    this.options = options;

    this.name = options.name ?? 'static-rate-table';
    for (const [pair, entry] of Object.entries(rates)) {
      const normalized = typeof entry === 'number' ? { rate: entry } : entry;
      this.rates.set(pair.toUpperCase(), normalized);
    }
  }

  supports(from: CurrencyCode, to: CurrencyCode): boolean {
    return this.lookup(from, to) !== null;
  }

  convert(amount: number, from: CurrencyCode, to: CurrencyCode): ConversionResult | null {
    const found = this.lookup(from, to);
    if (!found) return null;
    return {
      amount: round(amount * found.rate, 2),
      currency: to.toUpperCase(),
      rate: found.rate,
      rateSource: this.name,
      asOf: found.asOf ?? null,
    };
  }

  private lookup(from: CurrencyCode, to: CurrencyCode): { rate: number; asOf?: string } | null {
    const a = from.toUpperCase();
    const b = to.toUpperCase();
    if (a === b) return { rate: 1 };

    const direct = this.rates.get(`${a}_${b}`);
    if (direct) return direct;

    const inverse = this.rates.get(`${b}_${a}`);
    if (inverse && inverse.rate !== 0) {
      return { rate: 1 / inverse.rate, asOf: inverse.asOf };
    }

    // One hop through the base currency, e.g. EUR -> USD -> GEL.
    const base = this.options.baseCurrency?.toUpperCase();
    if (base && a !== base && b !== base) {
      const toBase = this.lookupDirect(a, base);
      const fromBase = this.lookupDirect(base, b);
      if (toBase && fromBase) {
        return { rate: toBase.rate * fromBase.rate, asOf: toBase.asOf ?? fromBase.asOf };
      }
    }
    return null;
  }

  private lookupDirect(a: string, b: string): { rate: number; asOf?: string } | null {
    const direct = this.rates.get(`${a}_${b}`);
    if (direct) return direct;
    const inverse = this.rates.get(`${b}_${a}`);
    if (inverse && inverse.rate !== 0) return { rate: 1 / inverse.rate, asOf: inverse.asOf };
    return null;
  }
}

/** Converter that refuses every cross-currency conversion. The safe default. */
export const nullConverter: CurrencyConverter = {
  name: 'null-converter',
  supports: (from, to) => from.toUpperCase() === to.toUpperCase(),
  convert: (amount, from, to) =>
    from.toUpperCase() === to.toUpperCase()
      ? { amount, currency: to.toUpperCase(), rate: 1, rateSource: 'identity', asOf: null }
      : null,
};

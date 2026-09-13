// HOMATCH Communications — every country, not eleven of them.
//
// WHY THIS EXISTS
//
// The phone parser has always been global: it delegates to libphonenumber-js,
// which carries Google's metadata for every dialling plan on earth, and an
// explicit + prefix is trusted over any default. But the two places a customer
// CHOOSES a country — the import wizard's default-country step and the manual
// Add Contact form — each carried a hand-typed list of eleven ISO codes.
//
// So a customer importing Spanish, Brazilian or Nigerian contacts had no way
// to say so. Numbers written in local form, without a + prefix, could not be
// resolved at all, and the rows arrived as "unusable" with nothing explaining
// why. The parser was never the limit; the dropdown was.
//
// The list is now derived from the same metadata the parser uses, so the two
// cannot disagree about which countries exist.
//
// WHY NAMES AND NOT CODES
//
// "AE" is not a country to most people. Intl.DisplayNames gives the country's
// name in the language the customer is already reading the product in, which
// also means the list sorts sensibly in Georgian, Arabic and Hebrew rather
// than in the English alphabetical order of ISO codes.

import { getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js';

export interface CountryOption {
  /** ISO 3166-1 alpha-2, which is what the parser wants. */
  code: CountryCode;
  /** Localised country name, or the bare code where the runtime has no name. */
  name: string;
  /** Dialling code without the plus, e.g. "995". */
  dialCode: string;
}

/**
 * Countries offered first.
 *
 * Not a restriction — every country is still in the list below these. This is
 * where Homatch's customers actually are, and making somebody scroll past two
 * hundred entries to reach Georgia would be its own kind of broken.
 */
const PRIORITY: CountryCode[] = ['GE', 'TR', 'RU', 'AM', 'AZ', 'UA', 'IL', 'AE', 'GB', 'US', 'DE'];

/**
 * Every country the phone metadata knows, named in `locale`.
 *
 * Memoised per locale: this builds ~245 entries and runs an Intl lookup for
 * each, and a select that rebuilds the world on every render is a select that
 * janks while somebody types.
 */
const cache = new Map<string, CountryOption[]>();

export function countryOptions(locale: string): CountryOption[] {
  const key = locale || 'en';
  const cached = cache.get(key);
  if (cached) return cached;

  let display: Intl.DisplayNames | null = null;
  try {
    // Not available in every runtime, and a missing name must not cost the
    // customer the whole list.
    display = new Intl.DisplayNames([key], { type: 'region' });
  } catch {
    display = null;
  }

  const named: CountryOption[] = [];
  for (const code of getCountries()) {
    let dialCode: string;
    try {
      dialCode = getCountryCallingCode(code);
    } catch {
      // A country the metadata lists but cannot price a call to is not a
      // country this product can offer.
      continue;
    }

    let name = code as string;
    try {
      name = display?.of(code) ?? code;
    } catch {
      name = code;
    }
    named.push({ code, name, dialCode });
  }

  const collator = new Intl.Collator(key);
  const priority = PRIORITY
    .map((code) => named.find((c) => c.code === code))
    .filter((c): c is CountryOption => Boolean(c));
  const rest = named
    .filter((c) => !PRIORITY.includes(c.code))
    .sort((a, b) => collator.compare(a.name, b.name));

  const options = [...priority, ...rest];
  cache.set(key, options);
  return options;
}

/** "Georgia (+995)" — what a picker shows for one option. */
export function countryLabel(option: CountryOption): string {
  return `${option.name} (+${option.dialCode})`;
}

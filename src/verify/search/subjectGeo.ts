/*
 * WHAT THE DISCOVERY ENGINE NEEDS TO KNOW ABOUT WHERE THE PROPERTY IS.
 *
 * The research seed carries the subject as evidence-tagged values; the
 * resolver needs a flat identity — names to match, an address to normalise,
 * a developer to corroborate with, coordinates where a source genuinely
 * published them, and the spellings of the street to look for inside a
 * foreign-language snippet.
 *
 * ── THE STREET HINTS ARE THE WHOLE GAME ──────────────────────────────
 *
 * A snippet from myhome.ge says „Крцаниси улица 6". One from korter.ge says
 * „კრწანისის ქუჩა 6". One from estatehub.ge says "Krtsanisi Street 6". If the
 * hint list holds only the Georgian spelling, the Russian and English results
 * are discovered, fetched, extracted — and then classified as city-wide,
 * because nothing recognised the street. That is precisely how the Villion run
 * reached SAME_STREET = 0 on a street full of inventory.
 *
 * So the hints are generated in all three scripts from whatever the seed has,
 * rather than assumed to arrive that way.
 */

import type { ResearchSeed } from '../../research-core/plan/seed.ts';
import type { DiscoverySubjectGeo } from '../../research-core/market/discoveryRun.ts';
import { romanise } from '../../research-core/market/geoResolve.ts';
import { nameVariants } from '../../research-core/market/discoveryPlan.ts';

/*
 * Words that mean "street" and belong to no particular street.
 *
 * NOT written with \b. In JavaScript a word boundary is defined on ASCII word
 * characters even under /u, so `\bქუჩა\b` never matches Georgian and `\bул\b`
 * never matches Cyrillic — a gate written that way reports a clean sweep while
 * removing nothing, and "კრწანისის ქუჩა" then goes looking for itself inside a
 * Russian snippet. Letter-class lookarounds work in every script.
 */
const STREET_WORDS =
  /(?<!\p{L})(?:ქუჩა|ქ|გამზირი|street|st|str|avenue|ave|улица|ул|проспект|пр)\.?(?!\p{L})/giu;

/**
 * The bare name of a street, without the word "street" or a number.
 *
 * „კრწანისის ქუჩა 6" and „ул. Крцаниси 6" both reduce to the name alone,
 * which is the only part worth looking for inside someone else's sentence.
 */
export function streetStem(address: string | null | undefined): string {
  return (address ?? '')
    .replace(STREET_WORDS, ' ')
    .replace(/[0-9]+[a-zA-Zა-ჰа-яА-Я]?/g, ' ')
    .replace(/[.,;:#№]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every spelling of the street worth searching a snippet for.
 *
 * Includes the romanised form, because that is what matches a Latin-script
 * source, and the raw forms, because a Cyrillic snippet is never romanised
 * before it reaches us. Short fragments are dropped: a two-letter "hint"
 * matches half the language and would put the whole city on this street.
 */
export function streetHintsFor(seed: ResearchSeed): string[] {
  const stem = streetStem(seed.location.address?.value ?? null);
  const district = seed.location.district?.value ?? '';
  const hints = new Set<string>();

  for (const base of [stem, district]) {
    if (!base) continue;
    for (const variant of nameVariants(base)) {
      const v = variant.trim();
      if (v.length >= 4) hints.add(v);
    }
    const roman = romanise(base).replace(/\s+/g, ' ').trim();
    if (roman.length >= 4) hints.add(roman);
  }
  return [...hints];
}

/**
 * The subject, as the resolver and the tiering need it.
 *
 * Returns null when there is not enough to place the property at all —
 * without a street or a project name, every discovered listing would tier as
 * city-wide, and a city-wide sweep sold as local evidence is the defect this
 * layer exists to remove. Declining to run is the honest outcome.
 */
export function subjectGeoFromSeed(seed: ResearchSeed): DiscoverySubjectGeo | null {
  const address = seed.location.address?.value ?? null;
  const project = seed.project.name?.value ?? null;
  if (!address && !project) return null;

  const names = new Set<string>();
  for (const n of [project, ...seed.project.aliases]) {
    if (!n) continue;
    for (const v of nameVariants(n)) names.add(v);
  }

  return {
    names: [...names],
    address,
    developer:
      seed.project.developerCompanyName?.value ?? seed.project.developerName?.value ?? null,
    // Coordinates only where a source actually published them. Never derived,
    // because a guessed point 200 m out silently promotes a neighbour into
    // the subject's own building.
    lat: seed.location.latitude?.value ?? null,
    lon: seed.location.longitude?.value ?? null,
    district: seed.location.district?.value ?? null,
    city: seed.location.city?.value ?? null,
    streetHints: streetHintsFor(seed),
  };
}

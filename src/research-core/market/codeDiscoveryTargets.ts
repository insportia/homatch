/*
 * WHERE A CODE-ONLY RUN STARTS LOOKING.
 *
 * Without a search engine, the first question is not "what shall I ask" but
 * "which public door does this source leave open". There are only a few kinds,
 * and every one of them is a URL that can be constructed from what we already
 * know about the property:
 *
 *   robots.txt      names the sitemaps, which is the site telling us what it
 *                   publishes. korter.ge's building_landing.xml is how the
 *                   subject's own page was found, with no search API involved.
 *   /sitemap.xml    the conventional location, tried when robots names none.
 *   category paths  a district or street listing page, where the source's URL
 *                   shape is publicly known.
 *   the home page   the honest fallback: fetch it, read its links, and let the
 *                   slug filter decide what is relevant.
 *
 * ── SEEDS, NEVER A CEILING ───────────────────────────────────────────
 *
 * Every registered domain gets doors built for it, and a domain nobody
 * registered gets exactly the same treatment the moment a link leads to it.
 * The registry saves a run from rediscovering the obvious; it has never been
 * permission to exist.
 */

import { SEED_DOMAINS } from './discoverySources.ts';
import type { CodeDiscoverySubject, DiscoveryTarget } from './codeDiscovery.ts';
import { romanise } from './geoResolve.ts';

/** A slug fragment as a site would write it: romanised, hyphenated, lowercase. */
export function slugify(value: string | null | undefined): string {
  return romanise(value ?? '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    /*
     * The Georgian genitive is dropped, because a slug is written from the
     * nominative. The address says „კრწანისის" and every korter.ge URL
     * says `krtsanisi`, so the first constructed attempt asked for
     * `house-on-krtsanisis-6-tbilisi` and got a 404 for a building whose real
     * page was sitting in that same site's sitemap.
     *
     * Only the single trailing `s`. Stripping the whole `is` turns
     * `krtsanisis` into `krtsanis`, which is a different word again — the
     * resolver tolerates that because it compares by prefix, and a URL does
     * not tolerate it at all.
     */
    .replace(/s$/, '');
}

/**
 * The forms a site might have written this name in.
 *
 * Both the nominative and what we were given, because the genitive rule holds
 * for Georgian place names and not for every name a developer invents. Two
 * candidate URLs cost two 404s at worst, and a 404 cannot invent evidence.
 */
export function slugCandidates(value: string | null | undefined): string[] {
  const raw = romanise(value ?? '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return [...new Set([slugify(value), raw].filter(Boolean))];
}

/**
 * The doors to try on one domain.
 *
 * robots.txt first, always — it is both the permission check and the sitemap
 * directory, so the request that tells us what we may read also tells us where
 * everything is. Fetching it is never wasted.
 */
export function targetsForDomain(
  domain: string,
  subject: CodeDiscoverySubject,
): DiscoveryTarget[] {
  const targets: DiscoveryTarget[] = [
    {
      url: `https://${domain}/robots.txt`,
      path: 'SEED_DOMAIN_SITEMAP',
      reason: 'robots.txt names the sitemaps and states what may be read',
      depth: 0,
    },
    {
      url: `https://${domain}/sitemap.xml`,
      path: 'SEED_DOMAIN_SITEMAP',
      reason: 'conventional sitemap location',
      depth: 0,
    },
    {
      url: `https://${domain}/`,
      path: 'SEED_DOMAIN_CATEGORY',
      reason: 'home page, read for links that name the subject',
      depth: 0,
    },
  ];

  /*
   * A constructed building URL, where a source's shape is publicly evident.
   *
   * korter.ge writes a building page as `house-on-<street>-<number>-<city>`
   * and `<number>-<street>-street-<city>`; both forms are visible in its own
   * public sitemap, so building them is reading a published convention rather
   * than guessing at a private endpoint. If the guess is wrong the page 404s
   * and is recorded as a fetch failure — it cannot invent evidence.
   */
  const number = (subject.streetNumber ?? '').trim();
  const city = slugify(subject.city ?? '');
  if (domain === 'korter.ge' && number && city) {
    for (const street of slugCandidates(subject.streetStem ?? '')) {
      for (const form of [
        `house-on-${street}-${number}-${city}`,
        `${number}-${street}-street-${city}`,
      ]) {
        targets.push({
          url: `https://korter.ge/en/${form}`,
          path: 'CONSTRUCTED_URL',
          reason: 'building-page form published in this source’s own sitemap',
          depth: 0,
        });
      }
    }
  }

  return targets;
}

/**
 * Every door worth trying for this property, most promising source first.
 *
 * Ordered by how local the source's inventory tends to be: a project index and
 * the portals that carry street-level adverts before the international
 * aggregators, which mostly restate a city.
 */
export function buildCodeDiscoverySeeds(
  subject: CodeDiscoverySubject,
  domains: readonly string[] = Object.keys(SEED_DOMAINS),
): DiscoveryTarget[] {
  const rank = (d: string): number => {
    const kind = SEED_DOMAINS[d];
    if (kind === 'PROJECT_INDEX') return 0;
    if (kind === 'DEVELOPER') return 1;
    if (kind === 'PORTAL') return 2;
    if (kind === 'AGENCY') return 3;
    return 4;
  };
  return [...domains]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .flatMap((d) => targetsForDomain(d, subject));
}

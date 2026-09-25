#!/usr/bin/env node
/*
 * CAPTURE ONE REAL LISTING PAGE PER SOURCE, ONCE.
 *
 * An adapter tested against HTML somebody wrote by hand is an adapter tested
 * against its author's assumptions. These fixtures are what the sites
 * actually served, on a date, so a test that passes is evidence about the
 * real markup and a test that starts failing is evidence the site changed.
 *
 * WHAT IT DOES
 *
 * For each source: fetch one COLLECTION page, take the first link that looks
 * like a detail page, fetch that, and write both to disk. Six requests per
 * source at the absolute most, spaced by seconds, with the identifying
 * User-Agent, following nothing else.
 *
 * It is not a crawler and must never become one. It has no queue, no
 * recursion and no scheduling, and it is run by a person when a fixture needs
 * refreshing -- which is also why the capture date is written into the file.
 *
 * WHAT IS STORED
 *
 * The markup, unmodified, under src/research-core/adapters/portal/__fixtures__.
 * Nothing is republished and nothing is served to a customer: a fixture is
 * read by a test to check a parser, the same way a saved HTTP response is.
 *
 * Usage: node scripts/capture-listing-fixtures.mjs [host ...]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USER_AGENT =
  'HomatchResearch/1.0 (+https://homatch.ge/research-bot; respects robots.txt and rate limits)';

// fileURLToPath, not pathname.replace: the second is right on Windows and
// wrong on Linux, and this runs on both.
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(here, '..', 'src', 'research-core', 'adapters', 'portal', '__fixtures__');

/*
 * The shortlist, chosen from the probe rather than from impressions:
 *
 *   home.ss.ge      12,021 sitemap URLs. The dominant Georgian classifieds.
 *   korter.ge        8,783. A modern portal with its own listing taxonomy.
 *   place.ge         7,003. A second portal, different stack, different URLs.
 *   myhomesale.ge    2,550. An agency site — different shape entirely.
 *   home24.ge        1,881. A portal whose collection URLs carry filters.
 *   zarayaproperties.com  16. A developer site, and the only probe that
 *                    landed directly on a detail page with a listing ID.
 *
 * Four families across six sites, which is the point: a framework validated
 * only against two portals that happen to share a CMS has not been validated.
 */
const SOURCES = {
  'home.ss.ge': {
    collection: 'https://home.ss.ge/ka/udzravi-qoneba/l/bina/iyideba',
    // Read off the captured collection markup rather than guessed: detail
    // URLs are /ka/udzravi-qoneba/<georgian-slug>-<listing id>, so the
    // numeric suffix IS the canonical id and no detail fetch is needed to
    // learn it.
    detailHint: /\/ka\/udzravi-qoneba\/[a-z0-9-]+-\d{6,}$/i,
  },
  'korter.ge': {
    collection: 'https://korter.ge/en/apartments-for-sale-tbilisi',
    detailHint: /korter\.ge\/en\/[a-z0-9-]+-\d+$/i,
  },
  'place.ge': {
    collection: 'https://place.ge/ge/sakartvelo/bina/iyideba',
    detailHint: /place\.ge\/ge\/[^/]+\/\d+/i,
  },
  'myhomesale.ge': {
    collection: 'https://myhomesale.ge/ka/properties',
    detailHint: /myhomesale\.ge\/[a-z]{2}\/(property|properties)\/[^/]+/i,
  },
  'home24.ge': {
    collection: 'https://www.home24.ge/ge/results/for_sale/flat',
    detailHint: /home24\.ge\/[a-z]{2}\/(property|statement|item)\//i,
  },
  'zarayaproperties.com': {
    collection: 'https://www.zarayaproperties.com/en/properties-1',
    detailHint: /properties-1\/\d+/i,
  },
  /*
   * realting.com -- and the first source here that is not Georgian.
   *
   * Its estate sitemaps carry listings in Montenegro, Cambodia, Poland, the
   * United States, Thailand, Cyprus, Latvia, Turkey, Lithuania and Israel as
   * well as Georgia. It is in this batch because of that, not despite it: a
   * discovery network validated only against Georgian portals is a Georgian
   * scraper with ambitions.
   *
   * The collection URL carries the COUNTRY, which is why the adapter had to
   * learn to pick a route by country as well as by transaction.
   *
   * NOT short-term-rental. The site publishes three shapes --
   * /<country>/property/<id>, /<country>/property-to-rent/<id> and
   * /<country>/short-term-rental/<id> -- and the third is a nightly rate.
   * There is no transaction in the model for it, and folding it into RENT
   * would pool a per-night price with a monthly one and produce a rental
   * market that does not exist.
   */
  'realting.com': {
    collection: 'https://realting.com/georgia/property',
    detailHint: /realting\.com\/[a-z-]+\/property\/\d+/i,
  },
  /*
   * WAVE 2, chosen from audit-source-shape.mjs rather than from impressions.
   *
   * makler.ge      CLASSIFIEDS, and the first source here that publishes its
   *                own sitemap in seven languages -- ka, en, ru, tr, ar, zh
   *                and he. Six of those are Homatch campaign languages. Its
   *                detail pages carry a RealEstateListing node, though only
   *                name/description/url/image are in it; price and area are
   *                in the visible text.
   * caucasusestate.ge  AGENCY_SITE, WordPress, /properties/<slug>/ with ka,
   *                ru and ar variants of every listing. OpenGraph only.
   * estatemarket.ge    DEVELOPER-side inventory: House, QuantitativeValue,
   *                PostalAddress and GeoCoordinates on a unit-type page
   *                inside a named complex.
   *
   * Three families, three extraction strategies, three different stacks --
   * which is the point of a batch. Sources that audited badly are NOT here
   * and the reason is recorded in market/runtime.ts: myhomesale.ge and
   * xeli.ge render client-side, topbroker.ge is an agency brochure with
   * eighteen pages and no listings.
   */
  'makler.ge': {
    collection: 'https://www.makler.ge/ka/iyideba/binebi/',
    detailHint: /makler\.ge\/[a-z]{2}\/ad\/[^/]*-\d{6,}$/i,
  },
  'caucasusestate.ge': {
    collection: 'https://caucasusestate.ge/properties/',
    detailHint: /caucasusestate\.ge\/(?:[a-z]{2}\/)?properties\/[^/]+\/$/i,
  },
  'estatemarket.ge': {
    collection: 'https://estatemarket.ge/catalog/',
    detailHint: /estatemarket\.ge\/(?:en\/)?zk\/[^/]+\/[^/]+\/$/i,
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' },
    });
    return { ok: response.ok, status: response.status, url: response.url, text: await response.text() };
  } catch (error) {
    return { ok: false, status: 0, url, text: '', error: String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Absolute URLs from href attributes, de-duplicated, in document order. */
function links(html, base) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const absolute = new URL(m[1], base).toString();
      if (!seen.has(absolute)) { seen.add(absolute); out.push(absolute); }
    } catch { /* a malformed href is not worth a stack trace */ }
  }
  return out;
}

async function capture(host, config) {
  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);

  const collection = await get(config.collection);
  if (!collection.ok) {
    process.stderr.write(`${host.padEnd(22)} collection HTTP ${collection.status}\n`);
    return { host, ok: false, reason: `collection HTTP ${collection.status}` };
  }
  writeFileSync(path.join(OUT_DIR, `${host}.collection.html`), collection.text, 'utf8');

  const candidates = links(collection.text, collection.url).filter((u) => config.detailHint.test(u));
  if (!candidates.length) {
    process.stderr.write(
      `${host.padEnd(22)} collection captured (${collection.text.length} bytes), no detail link matched\n`,
    );
    return { host, ok: true, collectionBytes: collection.text.length, detail: null, capturedAt: stamp };
  }

  await sleep(4000);
  const detail = await get(candidates[0]);
  if (!detail.ok) {
    process.stderr.write(`${host.padEnd(22)} detail HTTP ${detail.status}\n`);
    return { host, ok: true, collectionBytes: collection.text.length, detail: null, capturedAt: stamp };
  }
  writeFileSync(path.join(OUT_DIR, `${host}.detail.html`), detail.text, 'utf8');

  process.stderr.write(
    `${host.padEnd(22)} collection ${String(collection.text.length).padStart(7)}b`
    + `  detail ${String(detail.text.length).padStart(7)}b  ${detail.url.slice(0, 60)}\n`,
  );
  return {
    host, ok: true, capturedAt: stamp,
    collectionUrl: collection.url, collectionBytes: collection.text.length,
    detailUrl: detail.url, detailBytes: detail.text.length,
    candidatesFound: candidates.length,
  };
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const hosts = only.length ? only : Object.keys(SOURCES);
  const results = [];
  for (const host of hosts) {
    const config = SOURCES[host];
    if (!config) { process.stderr.write(`${host}: not in the shortlist\n`); continue; }
    results.push(await capture(host, config));
    await sleep(3000);
  }
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`capture failed: ${error?.message ?? error}\n`);
  process.exit(1);
});

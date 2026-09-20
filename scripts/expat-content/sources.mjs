// HOMATCH FOR EXPATS — every source the seeded content rests on.
//
// Each entry here was OPENED AND READ on the date in `observedAt`, and the
// `excerpt` is what it actually said. Nothing in this file is a source
// somebody remembered, inferred from a search snippet, or expected to say
// the right thing.
//
// That matters because of what the content is. A foreigner reads "the fee
// is 300 lari" and turns up at a Public Service Hall with 300 lari. If the
// number came from a blog quoting a 2019 price, they have wasted a morning
// in a country where they do not speak the language.
//
// WHY `official` IS NARROW
//
// True only when the publisher IS the authority on the thing being stated:
// the legislative gazette for a decree, the agency for its own fees, the
// municipal transport company for its own fares. A law firm summarising a
// decree accurately is still not official — accuracy and authority are
// different properties, and a summary can be accurate on the day it is
// written and wrong six months later while the decree stays right.
//
// WHY ONE SOURCE HERE IS MEDIA AND STAYS MEDIA
//
// The electricity tariff. GNERC publishes it, but gnerc.org served an
// incomplete certificate chain when this content was prepared, so the
// regulator's own page could not be read. Civil.ge's report of the same
// decision could, so that is what is cited, marked unofficial, and the
// topic says the figure comes from a news report of the regulator's
// decision rather than from the regulator. Citing the page we could not
// open would have been the easier lie.

export const SOURCES = {
  ordinance255: {
    key: 'ordinance255',
    publisher: 'Legislative Herald of Georgia (matsne.gov.ge)',
    url: 'https://matsne.gov.ge/en/document/view/2867361',
    official: true,
    publishedOn: '2015-06-08',
    // The consolidated text in force when this was read.
    effectiveFrom: '2026-02-24',
    observedAt: '2026-09-20T00:00:00Z',
    language: 'en',
    excerpt:
      'Government of Georgia Ordinance No 255, "On Approval of the List of Countries Whose Citizens May Enter Georgia without a Visa": citizens of the countries listed in the annex may enter and stay in Georgia without visa for one full year. Registration code 010120000.10.003.018640. Consolidated version of 24 February 2026.',
  },

  sdaResidence: {
    key: 'sdaResidence',
    publisher: 'Public Service Development Agency of Georgia',
    url: 'https://sda.gov.ge/en/products/migration-residence-permits/',
    official: true,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: '2026-09-20T00:00:00Z',
    language: 'en',
    excerpt:
      'Residence permit service fees: "30th calendar day — GEL 300", "20th calendar day — GEL 450", "10th calendar day — GEL 600". "An alien shall apply to the Agency for a Georgian residence permit 40 calendar days before his/her lawful stay in the territory of Georgia expires."',
  },

  ttcTariff: {
    key: 'ttcTariff',
    publisher: 'Tbilisi Transport Company',
    url: 'https://ttc.com.ge/en/tariff/10',
    // The municipal operator publishing its own regulated fare is the
    // authority on that fare.
    official: true,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: '2026-09-20T00:00:00Z',
    language: 'en',
    excerpt:
      '"1 GEL - 90 minutes unlimited free travel"; "3 GEL – 1-day unlimited travel"; "20 GEL - 1-week unlimited travel"; "40 GEL – 1-month unlimited travel"; "100 GEL – 3-months unlimited travel"; "150 GEL – 6-months unlimited travel"; "250 GEL – 1-year unlimited travel".',
  },

  electricityTariff: {
    key: 'electricityTariff',
    publisher: 'Civil Georgia, reporting a GNERC decision',
    url: 'https://civil.ge/archives/728040',
    // Reputable media reporting a regulator. Not the regulator.
    official: false,
    publishedOn: '2026-03-30',
    effectiveFrom: '2026-04-01',
    observedAt: '2026-09-20T00:00:00Z',
    language: 'en',
    excerpt:
      'Tbilisi household electricity tariffs decided by the Georgian National Energy and Water Supply Regulatory Commission, effective April 2026, in tetri per kWh: 0–101 kWh from 15.041 to 20.041; 101–301 kWh from 19.053 to 24.053; over 301 kWh from 23.537 to 28.537.',
  },

  magticomInternet: {
    key: 'magticomInternet',
    publisher: 'Magticom',
    url: 'https://www.magticom.ge/en/internet/internet-tariffs/internet-packages',
    // The operator's own published price list. Authoritative for its own
    // prices, and not a survey of the market.
    official: false,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: '2026-09-20T00:00:00Z',
    language: 'en',
    excerpt:
      'Optical internet packages, per 30 days: "70 Mbps" at "40" GEL standard and "33" GEL promotional; "80 Mbps" at "50" GEL; "100 Mbps" at "80" GEL.',
  },

  amlLaw: {
    key: 'amlLaw',
    publisher: 'Financial Monitoring Service of Georgia',
    url: 'https://www.fms.gov.ge/Uploads/files/AML_CFT_Law.pdf',
    official: true,
    publishedOn: null,
    effectiveFrom: null,
    observedAt: '2026-09-20T00:00:00Z',
    language: 'en',
    excerpt:
      'Law of Georgia on Facilitating the Suppression of Money Laundering and the Financing of Terrorism. Obliges banks to identify and verify customers and to apply customer due diligence; the specific documents a bank requires are set by that bank within this framework.',
  },
};

/** Every source, as rows for expat_citations. */
export function citationRows() {
  return Object.values(SOURCES).map((s) => ({
    key: s.key,
    publisher: s.publisher,
    url: s.url,
    official: s.official,
    published_on: s.publishedOn,
    effective_from: s.effectiveFrom,
    observed_at: s.observedAt,
    language: s.language,
    excerpt: s.excerpt,
  }));
}

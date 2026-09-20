// FOR EXPATS — the prices we can actually stand behind.
//
// Two of them. That is not a placeholder pending a bigger list; it is the
// honest size of what is publicly published and verifiable today.
//
// WHY SO FEW
//
// Georgia's National Statistics Office collects average retail prices for
// the consumer basket and sells the series rather than publishing it —
// geostat.ge/en/order/42 is an order form, not a dataset. Buying data is an
// owner's decision and a cost, so it was not done. What remains publicly
// published is the handful of regulated or operator-published tariffs
// below.
//
// The budget tool is built to make this state readable rather than
// embarrassing: the categories with no observation are listed as gaps,
// they contribute nothing to the total, and the reader is told how many
// there are. Fifteen invented prices would have made a better screenshot
// and a worse product.
//
// WHY THE TRANSPORT RANGE IS A SINGLE NUMBER
//
// Because the thing observed is a published tariff, not a market. The
// monthly unlimited pass costs exactly 40 lari. A range there would imply
// we had sampled something.

export const COST_OBSERVATIONS = [
  {
    city: 'Tbilisi',
    district: null,
    category: 'TRANSPORT',
    low: 40,
    high: 40,
    currency: 'GEL',
    unit: 'PER_MONTH',
    sampleSize: 1,
    sourceCount: 1,
    observedAt: '2026-09-20T00:00:00Z',
    source: 'ttcTariff',
    notes:
      'The operator\'s published price for a one-month unlimited travel pass. Somebody paying per journey at GEL 1 for 90 minutes may spend less; this figure is the published pass, not a measured average of what people spend.',
  },
  {
    city: 'Tbilisi',
    district: null,
    category: 'INTERNET',
    low: 33,
    high: 80,
    currency: 'GEL',
    unit: 'PER_MONTH',
    // Three published packages from one operator. Three observations, one
    // source — and the two counts are recorded separately precisely so the
    // reader can see it is one operator's price list rather than a survey.
    sampleSize: 3,
    sourceCount: 1,
    observedAt: '2026-09-20T00:00:00Z',
    source: 'magticomInternet',
    notes:
      'Magticom\'s published home fibre packages: 70 Mbps at GEL 33 promotional and GEL 40 standard, 80 Mbps at GEL 50, 100 Mbps at GEL 80. One operator\'s list price, not a market survey.',
  },
];

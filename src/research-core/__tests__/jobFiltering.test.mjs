// A buyer-demand comment is not a property result.
//
// This is the assertion the whole job-aware design exists for, and it is the
// one failure that INVERTS a result set rather than degrading it: the buyer
// search returns estate agents and the property search returns people with no
// property. Both look plausible in a screenshot.
//
// Every case below is a real sentence somebody would write, in a language
// somebody would write it in, offered to both jobs — and each is accepted by
// exactly one of them.

import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyDirection } from '../signals/direction.ts';
import { filterSignals } from '../signals/filter.ts';
import {
  BUYER_SEARCH,
  RENTER_SEARCH,
  PROPERTY_SEARCH,
  LAND_SEARCH,
  INVESTOR_SEARCH,
  resolveJob,
  JOB_ALIASES,
} from '../profiles/jobs.ts';

const NOW = Date.parse('2026-09-18T12:00:00.000Z');

let n = 0;
function signal(text, over = {}) {
  n += 1;
  // Exactly what the adapter does: a comment inherits its subject from the
  // post it sits under, and none of its direction.
  const verdict = classifyDirection(text, { parentContext: over.parentExcerpt ?? null });
  return {
    id: over.id ?? `s${n}`,
    platform: 'FACEBOOK',
    contentType: over.contentType ?? 'POST',
    sourceUrl: 'https://www.facebook.com/groups/tbilisi-housing/',
    contentUrl: over.contentUrl ?? `https://www.facebook.com/groups/tbilisi-housing/posts/${n}`,
    parentUrl: over.parentUrl ?? null,
    parentExcerpt: over.parentExcerpt ?? null,
    author: { publicName: over.authorName ?? 'A Person', publicUrl: null },
    originalText: text,
    translatedText: null,
    language: over.language ?? null,
    publishedAt: over.publishedAt ?? '2026-09-17T09:00:00.000Z',
    discoveredAt: '2026-09-18T11:00:00.000Z',
    lastSeenAt: '2026-09-18T11:00:00.000Z',
    contentFingerprint: `fp${n}`,
    direction: over.direction ?? verdict.direction,
    directionConfidence: over.directionConfidence ?? verdict.confidence,
    locationHints: over.locationHints ?? {
      countryCode: null, city: null, district: null, mentions: [],
    },
    requirementHints: over.requirementHints ?? {
      bedrooms: null, areaSqm: null, budgetAmount: null, budgetCurrency: null,
    },
    accessClass: 'PUBLIC',
    __verdict: verdict,
  };
}

function run(profile, signals, extra = {}) {
  return filterSignals(signals, {
    job: profile.job,
    propertyTermsOf: (s) => s.__verdict.propertyTerms,
    agencyVoiceOf: (s) => s.__verdict.agencyVoice,
    now: NOW,
    ...extra,
  });
}

const accepted = (outcome) => outcome.accepted.map((entry) => entry.signal.id);
const rejectionFor = (outcome, id) => outcome.rejected.find((r) => r.signalId === id)?.reason;

/* ── The headline case, in four languages ─────────────────────────────── */

const DEMAND_POSTS = [
  ['en', 'Looking to buy a 2BR apartment in Tbilisi, budget around $150,000'],
  ['ka', 'ვეძებ საყიდლად ბინა ვაკეში, ბიუჯეტი 150000 დოლარამდე'],
  ['ru', 'ищу купить квартиру в Тбилиси, бюджет до 150000'],
  ['tr', 'Tiflis\'te satın almak istiyorum daire, bütçe 150000'],
];

const SUPPLY_POSTS = [
  ['en', '2BR apartment for sale in Krtsanisi, $145,000, 72 sq.m, 5th floor, call +995 555 123456'],
  ['ka', 'იყიდება ბინა კრწანისში, 145000 USD, 72 კვ.მ, მე-5 სართული, ტელ 555123456'],
  ['ru', 'продается квартира в Крцаниси, 145000 USD, 72 кв.м, 5 этаж, +995555123456'],
  ['tr', 'Krtsanisi\'de satılık daire, 145000 USD, 72 m², 5. kat, 0555 123 45 67'],
];

for (const [language, text] of DEMAND_POSTS) {
  test(`a ${language} buyer post is a BUYER_SEARCH result and NOT a PROPERTY_SEARCH result`, () => {
    const s = signal(text);
    assert.equal(s.direction, 'DEMAND', `classified as ${s.direction}`);

    const buyers = run(BUYER_SEARCH, [s]);
    assert.deepEqual(accepted(buyers), [s.id]);

    const properties = run(PROPERTY_SEARCH, [s]);
    assert.deepEqual(accepted(properties), []);
    assert.equal(rejectionFor(properties, s.id), 'WRONG_DIRECTION');
  });
}

for (const [language, text] of SUPPLY_POSTS) {
  test(`a ${language} listing is a PROPERTY_SEARCH result and NOT a BUYER_SEARCH result`, () => {
    const s = signal(text);
    assert.equal(s.direction, 'SUPPLY', `classified as ${s.direction}`);

    const properties = run(PROPERTY_SEARCH, [s]);
    assert.deepEqual(accepted(properties), [s.id]);

    const buyers = run(BUYER_SEARCH, [s]);
    assert.deepEqual(accepted(buyers), []);
    assert.equal(rejectionFor(buyers, s.id), 'WRONG_DIRECTION');
  });
}

test('the two jobs never both accept the same signal', () => {
  const all = [...DEMAND_POSTS, ...SUPPLY_POSTS].map(([, text]) => signal(text));
  const buyers = new Set(accepted(run(BUYER_SEARCH, all)));
  const properties = new Set(accepted(run(PROPERTY_SEARCH, all)));
  for (const id of buyers) {
    assert.ok(!properties.has(id), `${id} was accepted by both jobs`);
  }
  assert.ok(buyers.size > 0 && properties.size > 0, 'one of the jobs accepted nothing');
});

/* ── Rental demand is not a sale listing ──────────────────────────────── */

test('rental demand goes to RENTER_SEARCH, not to PROPERTY_SEARCH', () => {
  const s = signal('ищу снять квартиру в Тбилиси надолго');
  assert.deepEqual(accepted(run(RENTER_SEARCH, [s])), [s.id]);
  assert.deepEqual(accepted(run(PROPERTY_SEARCH, [s])), []);
});

test('a rental LISTING goes to PROPERTY_SEARCH, not to RENTER_SEARCH', () => {
  const s = signal('сдается квартира, 800 USD в месяц, 60 кв.м, балкон, лифт, +995555111222');
  assert.equal(s.direction, 'SUPPLY');
  assert.deepEqual(accepted(run(PROPERTY_SEARCH, [s])), [s.id]);
  assert.deepEqual(accepted(run(RENTER_SEARCH, [s])), []);
});

test('a buyer is not a renter: the transaction side is part of the contract', () => {
  // Both are DEMAND. RENTER_SEARCH is a rent job and a purchase post is not
  // its result — which the transaction field on the contract expresses.
  assert.equal(BUYER_SEARCH.job.transaction, 'SALE');
  assert.equal(RENTER_SEARCH.job.transaction, 'RENT');
  assert.notEqual(BUYER_SEARCH.job.transaction, RENTER_SEARCH.job.transaction);
});

/* ── Land ─────────────────────────────────────────────────────────────── */

test('LAND_SEARCH accepts a plot and refuses a flat', () => {
  const plot = signal('იყიდება მიწის ნაკვეთი 600 კვ.მ, 45000 USD, ტელ 555999888');
  const flat = signal('იყიდება ბინა ვაკეში, 120000 USD, 75 კვ.მ, მე-4 სართული, 555111222');

  const outcome = run(LAND_SEARCH, [plot, flat]);
  assert.ok(accepted(outcome).includes(plot.id), 'the plot was refused');
  assert.ok(!accepted(outcome).includes(flat.id), 'a flat was accepted by a land search');
  assert.equal(rejectionFor(outcome, flat.id), 'WRONG_PROPERTY_TYPE');
});

test('LAND_SEARCH names exactly one property term, which is what makes it a land search', () => {
  assert.deepEqual(LAND_SEARCH.job.propertyTerms, ['land']);
});

test('land keeps a wider freshness window than rentals, on purpose', () => {
  assert.equal(LAND_SEARCH.job.defaultFreshness.window, 'ANY');
  assert.equal(RENTER_SEARCH.job.defaultFreshness.window, 'LAST_7_DAYS');
});

/* ── Not every commenter is a lead ────────────────────────────────────── */

test('an ambiguous post is UNKNOWN and satisfies no job at all', () => {
  const s = signal('Anyone know anything about property prices here?');
  assert.equal(s.direction, 'UNKNOWN');
  assert.equal(rejectionFor(run(BUYER_SEARCH, [s]), s.id), 'DIRECTION_UNKNOWN');
  assert.equal(rejectionFor(run(PROPERTY_SEARCH, [s]), s.id), 'DIRECTION_UNKNOWN');
});

test('a weakly-committed post is rejected as WEAK_INTENT, not accepted as a lead', () => {
  const s = signal('Looking to buy an apartment in Tbilisi', { directionConfidence: 0.4 });
  assert.equal(rejectionFor(run(BUYER_SEARCH, [s]), s.id), 'WEAK_INTENT');
});

test('an agency pitch is refused by a demand job and allowed by a supply job', () => {
  // "We have clients looking for 2BR flats" is a sales pitch, not a lead. The
  // same voice posting real inventory is exactly what PROPERTY_SEARCH wants.
  const pitch = signal('Our agency has buyers looking to buy apartments in Vake — contact us');
  assert.equal(pitch.__verdict.agencyVoice, true);
  assert.equal(rejectionFor(run(BUYER_SEARCH, [pitch]), pitch.id), 'AGENCY_VOICE');

  const inventory = signal('Agency listing: apartment for sale in Vake, 180000 USD, 80 sq.m, parking, contact us');
  assert.equal(inventory.direction, 'SUPPLY');
  assert.deepEqual(accepted(run(PROPERTY_SEARCH, [inventory])), [inventory.id]);
});

/* ── Comments ─────────────────────────────────────────────────────────── */

test('demand jobs read comments and supply jobs do not', () => {
  const comment = signal('Looking to buy something like this in Vake, is it still available?', {
    contentType: 'COMMENT',
    parentUrl: 'https://www.facebook.com/groups/tbilisi-housing/posts/99',
    parentExcerpt: '2BR apartment for sale in Vake, 160000 USD',
  });
  assert.deepEqual(accepted(run(BUYER_SEARCH, [comment])), [comment.id]);

  const supplySide = run(PROPERTY_SEARCH, [comment]);
  assert.ok(
    ['COMMENTS_NOT_WANTED', 'WRONG_DIRECTION'].includes(rejectionFor(supplySide, comment.id)),
  );
});

test('a comment that kept its parent scores above one that lost it', () => {
  const text = 'Looking to buy a 2BR in Vake, budget 150000 USD';
  const withParent = signal(text, {
    id: 'with', contentType: 'COMMENT',
    parentUrl: 'https://www.facebook.com/groups/x/posts/1',
    parentExcerpt: '2BR for sale in Vake',
  });
  const without = signal(text, { id: 'without', contentType: 'COMMENT' });

  const outcome = run(BUYER_SEARCH, [withParent, without]);
  const scores = Object.fromEntries(outcome.accepted.map((e) => [e.signal.id, e.score]));
  assert.ok(scores['with'] > scores['without'], `${scores['with']} vs ${scores['without']}`);
});

/* ── Location and budget only reject when they CONTRADICT ─────────────── */

test('a signal that named no location is kept, not discarded', () => {
  // A comment in a Tbilisi housing group rarely repeats the city name.
  const s = signal('Looking to buy a 2BR, budget 150000 USD');
  const outcome = run(BUYER_SEARCH, [s], { target: { city: 'Tbilisi', countryCode: 'GE' } });
  assert.deepEqual(accepted(outcome), [s.id]);
});

test('a signal naming the WRONG city is rejected', () => {
  const s = signal('Looking to buy a 2BR apartment', {
    locationHints: { countryCode: 'GE', city: 'Batumi', district: null, mentions: [] },
  });
  const outcome = run(BUYER_SEARCH, [s], { target: { city: 'Tbilisi', countryCode: 'GE' } });
  assert.equal(rejectionFor(outcome, s.id), 'OUTSIDE_LOCATION');
});

test('a budget well outside the band is rejected; one just above it is not', () => {
  const far = signal('Looking to buy an apartment', {
    id: 'far',
    requirementHints: { bedrooms: null, areaSqm: null, budgetAmount: 900_000, budgetCurrency: 'USD' },
  });
  const near = signal('Looking to buy an apartment', {
    id: 'near',
    requirementHints: { bedrooms: null, areaSqm: null, budgetAmount: 170_000, budgetCurrency: 'USD' },
  });
  const target = { budgetMin: 100_000, budgetMax: 160_000, currency: 'USD' };
  const outcome = run(BUYER_SEARCH, [far, near], { target });

  assert.equal(rejectionFor(outcome, 'far'), 'OUTSIDE_BUDGET');
  assert.ok(accepted(outcome).includes('near'), 'a buyer 6% over budget was discarded');
});

test('budgets in different currencies are not compared, and never converted', () => {
  const s = signal('Looking to buy an apartment', {
    requirementHints: { bedrooms: null, areaSqm: null, budgetAmount: 400_000, budgetCurrency: 'GEL' },
  });
  const outcome = run(BUYER_SEARCH, [s], {
    target: { budgetMin: 100_000, budgetMax: 160_000, currency: 'USD' },
  });
  assert.deepEqual(accepted(outcome), [s.id], 'a GEL budget was compared against a USD band');
});

/* ── Every rejection is recorded with a reason ────────────────────────── */

test('nothing is dropped silently — every input is accepted or has a reason', () => {
  const inputs = [
    signal('Looking to buy a 2BR in Vake'),
    signal('იყიდება ბინა, 120000 USD, 75 კვ.მ, 555111222'),
    signal('Anyone know anything about property here?'),
    signal('   '),
  ];
  const outcome = run(BUYER_SEARCH, inputs);
  const seen = new Set([
    ...outcome.accepted.map((e) => e.signal.id),
    ...outcome.rejected.map((r) => r.signalId),
  ]);
  assert.equal(seen.size, inputs.length, 'an input vanished');
  for (const rejection of outcome.rejected) assert.ok(rejection.reason, 'a rejection had no reason');
});

test('the ordering is deterministic', () => {
  const inputs = DEMAND_POSTS.map(([, text]) => signal(text));
  const a = accepted(run(BUYER_SEARCH, inputs));
  const b = accepted(run(BUYER_SEARCH, inputs));
  assert.deepEqual(a, b);
});

/* ── Reusing existing names rather than duplicating them ──────────────── */

test('MARKET_RESEARCH and INVESTMENT_RESEARCH resolve to what already exists', () => {
  assert.equal(resolveJob('MARKET_RESEARCH').id, 'MARKET_COMPARABLES');
  assert.equal(resolveJob('INVESTMENT_RESEARCH').id, 'INVESTMENT_DEEP_RESEARCH');
});

test('VERIFY_RESEARCH resolves to null, because Verify is not a Research Core job', () => {
  // research-agent's five-stage pipeline owns research_jobs and stays
  // authoritative. Returning null is what stops somebody reimplementing it.
  assert.equal('VERIFY_RESEARCH' in JOB_ALIASES, true);
  assert.equal(resolveJob('VERIFY_RESEARCH'), null);
});

test('discovery jobs reuse existing product codes and invent none', () => {
  const codes = new Set(
    [BUYER_SEARCH, RENTER_SEARCH, PROPERTY_SEARCH, LAND_SEARCH, INVESTOR_SEARCH]
      .map((p) => p.productCode)
      .filter(Boolean),
  );
  assert.deepEqual([...codes], ['FIND_CLIENTS']);
});

test('INVESTOR_SEARCH demands more confidence than an ordinary buyer search', () => {
  assert.ok(INVESTOR_SEARCH.job.minDirectionConfidence > BUYER_SEARCH.job.minDirectionConfidence);
});

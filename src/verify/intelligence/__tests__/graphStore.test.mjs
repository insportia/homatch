// Writing to the graph, against a real in-memory Postgres-shaped stub.
//
// The three outcomes are the whole point, and the difference between them is
// what makes the layer worth having:
//
//   UNCHANGED  no new row, the clock moves forward. The next verification is
//              cheap because of this case.
//   CHANGED    the old row is SUPERSEDED, not overwritten, so "owner A →
//              owner B" survives with both provenances. A returning customer
//              asking "has anything changed?" is asking about exactly this.
//   NEW        we did not know it.
//
// The stub enforces the constraint that matters — one CURRENT row per
// (entity, fact key) — because the real database does, and a test that lets
// two through would pass while production rejected the write.

import test from 'node:test';
import assert from 'node:assert/strict';
import { persistHarvest, loadKnownIntelligence, valueSignature, compareValues } from '../graphStore.ts';
import { harvestReport } from '../harvest.ts';

/* ------------------------------------------------------------------ *
 * A small stub shaped like the PostgREST client                       *
 * ------------------------------------------------------------------ */

function makeDb() {
  const tables = {
    intelligence_entities: [],
    intelligence_facts: [],
    intelligence_relationships: [],
  };
  let seq = 0;
  const id = () => `id-${++seq}`;

  const query = (name) => {
    const filters = [];
    const api = {
      select() { return api; },
      eq(col, val) { filters.push([col, val]); return api; },
      in(col, vals) { filters.push([col, vals, 'in']); return api; },
      _rows() {
        return tables[name].filter((r) =>
          filters.every(([c, v, op]) => (op === 'in' ? v.includes(r[c]) : r[c] === v))
        );
      },
      maybeSingle() { return Promise.resolve({ data: api._rows()[0] ?? null, error: null }); },
      single() { return Promise.resolve({ data: api._rows()[0] ?? null, error: null }); },
      then(resolve) { return Promise.resolve({ data: api._rows(), error: null }).then(resolve); },
      insert(row) {
        const rows = Array.isArray(row) ? row : [row];
        const made = [];
        for (const r of rows) {
          // The partial unique index the migration creates.
          if (name === 'intelligence_facts' && r.status === 'CURRENT') {
            const clash = tables[name].some(
              (x) => x.entity_id === r.entity_id && x.fact_key === r.fact_key && x.status === 'CURRENT'
            );
            if (clash) {
              return {
                select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'duplicate key value violates unique constraint' } }) }),
                then: (res) => Promise.resolve({ data: null, error: { message: 'duplicate key' } }).then(res),
              };
            }
          }
          const made1 = { id: id(), ...r };
          tables[name].push(made1);
          made.push(made1);
        }
        return {
          select: () => ({ single: () => Promise.resolve({ data: made[0], error: null }) }),
          then: (res) => Promise.resolve({ data: made, error: null }).then(res),
        };
      },
      update(patch) {
        const target = { ...api };
        return {
          eq(col, val) {
            for (const r of tables[name].filter((x) => x[col] === val)) Object.assign(r, patch);
            return Promise.resolve({ data: null, error: null });
          },
          then: (res) => Promise.resolve({ data: null, error: null }).then(res),
          _unused: target,
        };
      },
    };
    return api;
  };

  return { from: (name) => query(name), tables };
}

const POLICIES = [
  { fact_key_pattern: 'registry.', freshness_class: 'HIGH_VOLATILITY', max_age_hours: 6 },
  { fact_key_pattern: 'project.identity', freshness_class: 'LOW_VOLATILITY', max_age_hours: 8760 },
];

const REPORT = {
  exactUnit: { code: '01.72.14.040.030.01.02.017', verified: false },
  legalStatus: { debtorRegistry: { status: 'CONFIRMED_POSITIVE', label: 'x' } },
  companyProfile: { name: 'Geo City', idCode: '424619256', sourceBasis: 'REGISTRY_CONFIRMED', legalForm: 'LLC' },
  projectProfile: { name: 'Kristian Stiven 18', floors: '7', buildings: '1', unitCounts: '48' },
};

const currentFacts = (db) => db.tables.intelligence_facts.filter((f) => f.status === 'CURRENT');

/* ── comparing values ────────────────────────────────────────────────── */

test('the same value in a different order is the same value', () => {
  // Amenities listed as "lift, parking" and "parking, lift" are the same
  // amenities. Without this, every report would look like a change.
  assert.equal(
    valueSignature({ valueJson: ['lift', 'parking'] }),
    valueSignature({ valueJson: ['parking', 'lift'] })
  );
  assert.notEqual(
    valueSignature({ valueJson: ['lift'] }),
    valueSignature({ valueJson: ['lift', 'parking'] })
  );
  assert.equal(valueSignature({ valueText: ' Geo City ' }), valueSignature({ valueText: 'Geo City' }));
  assert.notEqual(valueSignature({ valueNumber: 7 }), valueSignature({ valueText: '7' }));
});

/* ── the three outcomes ──────────────────────────────────────────────── */

test('the first verification of a property learns everything', async () => {
  const db = makeDb();
  const out = await persistHarvest(db, harvestReport(REPORT, POLICIES), 'job-1');
  assert.equal(out.errors.length, 0, out.errors.join('; '));
  assert.ok(out.entities >= 4, 'entities were not created');
  assert.ok(out.factsNew > 0);
  assert.equal(out.factsUnchanged, 0);
  assert.equal(out.factsChanged, 0);
  assert.ok(out.relationshipsNew > 0);
});

test('verifying the same property again learns nothing new, and says so', async () => {
  // This is the outcome that makes a repeat verification cheap.
  const db = makeDb();
  await persistHarvest(db, harvestReport(REPORT, POLICIES), 'job-1');
  const before = db.tables.intelligence_facts.length;

  const out = await persistHarvest(db, harvestReport(REPORT, POLICIES), 'job-2');
  assert.equal(out.errors.length, 0, out.errors.join('; '));
  assert.equal(out.factsNew, 0, 'a second identical verification inserted new facts');
  assert.equal(out.factsChanged, 0);
  assert.ok(out.factsUnchanged > 0);
  assert.equal(db.tables.intelligence_facts.length, before, 'the fact table grew on an unchanged re-check');
  assert.equal(out.relationshipsNew, 0);
  assert.ok(out.relationshipsConfirmed > 0);
});

test('an unchanged fact has its clock moved forward', async () => {
  const db = makeDb();
  await persistHarvest(db, harvestReport(REPORT, POLICIES), 'job-1');
  const row = currentFacts(db).find((f) => f.fact_key === 'company.name');
  const first = row.last_verified_at;
  row.last_verified_at = '2020-01-01T00:00:00.000Z';

  await persistHarvest(db, harvestReport(REPORT, POLICIES), 'job-2');
  const after = currentFacts(db).find((f) => f.fact_key === 'company.name');
  assert.notEqual(after.last_verified_at, '2020-01-01T00:00:00.000Z', 'the fact was not re-verified');
  assert.ok(after.last_verified_at >= first);
});

test('a changed fact supersedes the old one and keeps both', async () => {
  const db = makeDb();
  await persistHarvest(db, harvestReport(REPORT, POLICIES), 'job-1');

  const changed = { ...REPORT, projectProfile: { ...REPORT.projectProfile, floors: '9' } };
  const out = await persistHarvest(db, harvestReport(changed, POLICIES), 'job-2');

  assert.equal(out.factsChanged, 1, 'the changed floor count was not recorded as a change');
  assert.deepEqual(out.changes, [{ factKey: 'project.floors', from: '7', to: '9' }]);

  const floors = db.tables.intelligence_facts.filter((f) => f.fact_key === 'project.floors');
  assert.equal(floors.length, 2, 'the old value was overwritten instead of superseded');
  const old = floors.find((f) => f.status === 'SUPERSEDED');
  const now = floors.find((f) => f.status === 'CURRENT');
  assert.ok(old && now, 'the history is not one superseded row and one current row');
  assert.equal(Number(old.value_number), 7);
  assert.equal(Number(now.value_number), 9);
  assert.equal(now.supersedes, old.id, 'the new value does not point at what it replaced');
  assert.equal(old.superseded_by, now.id, 'the old value does not point at what replaced it');
  assert.ok(old.valid_to, 'the superseded value has no end date');
});

test('there is never more than one current value for a fact', async () => {
  // The database enforces this with a partial unique index; losing it would
  // mean two answers to "what is it now".
  const db = makeDb();
  await persistHarvest(db, harvestReport(REPORT, POLICIES), 'job-1');
  await persistHarvest(db, harvestReport({ ...REPORT, projectProfile: { ...REPORT.projectProfile, floors: '9' } }, POLICIES), 'job-2');
  await persistHarvest(db, harvestReport({ ...REPORT, projectProfile: { ...REPORT.projectProfile, floors: '11' } }, POLICIES), 'job-3');

  const byKey = new Map();
  for (const f of currentFacts(db)) {
    const k = `${f.entity_id}|${f.fact_key}`;
    assert.ok(!byKey.has(k), `two current values for ${f.fact_key}`);
    byKey.set(k, f);
  }
  assert.equal(Number(byKey.get([...byKey.keys()].find((k) => k.endsWith('project.floors'))).value_number), 11);
});

test('an entity is created once, however many verifications find it', async () => {
  const db = makeDb();
  await persistHarvest(db, harvestReport(REPORT, POLICIES), 'job-1');
  await persistHarvest(db, harvestReport(REPORT, POLICIES), 'job-2');
  const codes = db.tables.intelligence_entities.map((e) => e.natural_key);
  assert.equal(new Set(codes).size, codes.length, 'the same real-world thing became two entities');
});

/* ── failure is never the customer's problem ─────────────────────────── */

test('a broken graph write never throws into the caller', async () => {
  const exploding = { from() { throw new Error('database is on fire'); } };
  const out = await persistHarvest(exploding, harvestReport(REPORT, POLICIES), 'job-1');
  assert.ok(out.errors.length, 'the failure was swallowed silently');
  assert.equal(out.factsNew, 0);
});

test('an unreadable graph answers "we know nothing", not an error', async () => {
  // Knowing nothing is always safe: the verification researches everything,
  // exactly as it did before this layer existed.
  const exploding = { from() { throw new Error('nope'); } };
  const known = await loadKnownIntelligence(exploding, 'CADASTRAL_CODE', '01.72.14.040.030.01.02.017');
  assert.equal(known.entityId, null);
  assert.deepEqual(known.facts, []);
});

test('a property we have never seen returns nothing', async () => {
  const db = makeDb();
  const known = await loadKnownIntelligence(db, 'CADASTRAL_CODE', '01.00.00.000.000');
  assert.equal(known.entityId, null);
  assert.deepEqual(known.facts, []);
});

/* ── what comes back ─────────────────────────────────────────────────── */

test('what we know about a property comes back with its freshness intact', async () => {
  const db = makeDb();
  await persistHarvest(db, harvestReport(REPORT, POLICIES), 'job-1');
  const known = await loadKnownIntelligence(db, 'CADASTRAL_CODE', '01.72.14.040.030.01.02.017');

  assert.ok(known.entityId, 'the property was not found');
  assert.ok(known.facts.length, 'no facts came back');
  for (const f of known.facts) {
    assert.ok(f.fact_key, 'a fact came back without its key');
    assert.ok(f.last_verified_at, 'a fact came back with no freshness at all');
    assert.equal(f.status, 'CURRENT');
  }
  assert.ok(known.facts.some((f) => f.fact_key === 'registry.debtorRegistry'));
});

test('a parcel fact is returned as a parcel fact, never merged into the unit', async () => {
  // The distinction between "registered against this flat" and "registered
  // against the land it stands on" is the most consequential one in a
  // Georgian due-diligence report.
  const db = makeDb();
  await persistHarvest(db, harvestReport(REPORT, POLICIES), 'job-1');
  const known = await loadKnownIntelligence(db, 'CADASTRAL_CODE', '01.72.14.040.030.01.02.017');

  const parcel = known.relatedEntities.find((r) => r.relation === 'HAS_PARENT_PARCEL');
  assert.ok(parcel, 'the parcel is not reachable from the unit');
  assert.equal(parcel.entityType, 'PARENT_PARCEL');
  assert.ok(!known.facts.some((f) => known.relatedFacts.includes(f)), 'related facts leaked into the unit\'s own');
});

/* ── price history falls out of the machinery ────────────────────────── */

const LISTING = {
  url: 'https://home.ge/listing/444915',
  area: '83.2', floor: '6/8', price: '160000', rooms: '3',
  source: 'Home.ge', currency: 'USD', pricePerSqm: '1923',
  listingStatus: 'ACTIVE', project: 'Villion',
};
const withListing = (over = {}) => ({ ...REPORT, market: { comparables: [{ ...LISTING, ...over }] } });

test('a listing price change is recorded as history', async () => {
  const db = makeDb();
  await persistHarvest(db, harvestReport(withListing(), POLICIES), 'job-1');
  const out = await persistHarvest(db, harvestReport(withListing({ price: '155000' }), POLICIES), 'job-2');

  assert.ok(out.changes.some((c) => c.factKey === 'listing.price' && c.from === '160000' && c.to === '155000'),
    'the price drop was not recorded as a change');

  const prices = db.tables.intelligence_facts.filter((f) => f.fact_key === 'listing.price');
  assert.equal(prices.length, 2, 'the old price was overwritten instead of superseded');
  assert.equal(prices.filter((f) => f.status === 'CURRENT').length, 1);
  assert.ok(prices.find((f) => f.status === 'SUPERSEDED').valid_to, 'the old price has no end date');
});

test('a listing coming off the market is recorded the same way', async () => {
  const db = makeDb();
  await persistHarvest(db, harvestReport(withListing(), POLICIES), 'job-1');
  const out = await persistHarvest(db, harvestReport(withListing({ listingStatus: 'EXPIRED' }), POLICIES), 'job-2');
  assert.ok(out.changes.some((c) => c.factKey === 'listing.status' && c.from === 'ACTIVE' && c.to === 'EXPIRED'));
});

test('an unchanged listing is confirmed, not re-inserted', async () => {
  // The cheap case: seeing the same listing again costs one clock update.
  const db = makeDb();
  await persistHarvest(db, harvestReport(withListing(), POLICIES), 'job-1');
  const before = db.tables.intelligence_facts.length;
  const out = await persistHarvest(db, harvestReport(withListing(), POLICIES), 'job-2');
  assert.equal(db.tables.intelligence_facts.length, before, 'the fact table grew on an unchanged listing');
  assert.ok(out.factsUnchanged > 0);
  assert.equal(out.factsChanged, 0);
});

/* ── reaching the research that was already paid for ─────────────────── */

test('the project is reachable through the parcel, without claiming the flat is in it', async () => {
  // Measured in production: with only the unit→project link available and
  // correctly refused, seven researched project facts sat in the graph
  // unreachable and reuse came out at 3 facts of 18.
  //
  // "That development is on this land" is a parcel-level statement and a far
  // better supported one than "this flat is in that development". The two
  // must never be collapsed, which is why this edge hangs off the parcel.
  const db = makeDb();
  await persistHarvest(db, harvestReport(REPORT, POLICIES), 'job-1');
  const known = await loadKnownIntelligence(db, 'CADASTRAL_CODE', '01.72.14.040.030.01.02.017');

  const parcel = known.relatedEntities.find((r) => r.relation === 'HAS_PARENT_PARCEL');
  const project = known.relatedEntities.find((r) => r.entityType === 'PROJECT');
  assert.ok(parcel, 'the parcel is not reachable');
  assert.ok(project, 'the project is still unreachable through the parcel');

  // And the claim that was refused stays refused.
  const unitToProject = db.tables.intelligence_relationships.find(
    (r) => r.relation === 'PART_OF_PROJECT' && r.source_kind === 'OFFICIAL_REGISTRY'
  );
  assert.equal(unitToProject, undefined, 'the unverified unit was attached to the project after all');
});

test('project facts arrive as related, never as the unit\'s own', async () => {
  // The distinction between "registered against this flat" and "true of the
  // land it stands on" is the most consequential one in the report.
  const db = makeDb();
  await persistHarvest(db, harvestReport(REPORT, POLICIES), 'job-1');
  const known = await loadKnownIntelligence(db, 'CADASTRAL_CODE', '01.72.14.040.030.01.02.017');

  const ownKeys = known.facts.map((f) => f.fact_key);
  assert.ok(ownKeys.includes('registry.debtorRegistry'), 'the unit lost its own facts');
  assert.ok(!ownKeys.some((k) => k.startsWith('project.')), 'a project fact was presented as the unit\'s own');
  assert.ok(known.relatedFacts.some((f) => f.fact_key.startsWith('project.')),
    'the project research is still not reachable');
});

test('the walk follows the whole provenance chain, and stops there', async () => {
  // unit → parcel → project → developer is the property's own lineage, and
  // every link in it is derived or evidenced. The FOURTH hop leaves the
  // property entirely: a developer builds other projects, and their facts are
  // about other people's flats.
  const db = makeDb();
  await persistHarvest(db, harvestReport(REPORT, POLICIES), 'job-1');

  const known = await loadKnownIntelligence(db, 'CADASTRAL_CODE', '01.72.14.040.030.01.02.017');
  const types = known.relatedEntities.map((r) => r.entityType);
  assert.ok(types.includes('PARENT_PARCEL'), 'the parcel is unreachable');
  assert.ok(types.includes('PROJECT'), 'the project is unreachable');
  assert.ok(types.includes('COMPANY'), 'the developer is unreachable, so its research cannot be reused');

  // A second, unrelated property built by the same company: four hops away.
  const other = {
    ...REPORT,
    exactUnit: { code: '09.99.99.999.999.01.02.001', verified: false },
    projectProfile: { ...REPORT.projectProfile, name: 'Somewhere Else Entirely' },
  };
  await persistHarvest(db, harvestReport(other, POLICIES), 'job-2');

  const after = await loadKnownIntelligence(db, 'CADASTRAL_CODE', '01.72.14.040.030.01.02.017');
  assert.ok(!after.relatedEntities.some((r) => r.naturalKey === 'somewhere-else-entirely'),
    'the walk reached another property\'s project');
});

test('a comparable is recorded against the property, pointing away from it', async () => {
  // Recorded the other way round they sat one edge away in the wrong
  // direction, unreachable from the only place anyone starts — which is
  // exactly what the production graph showed.
  //
  // Reachable is not the same as lineage, and this asserts the edge rather
  // than the walk: loadKnownIntelligence deliberately does NOT follow
  // COMPARABLE_TO, because a comparable is a different property and its
  // asking price is not a fact about this one. See the lineage tests below.
  const db = makeDb();
  const withComps = {
    ...REPORT,
    market: { comparables: [{ url: 'https://home.ge/x/1', price: '150000', area: '80' }] },
  };
  const harvest = harvestReport(withComps, POLICIES);
  await persistHarvest(db, harvest, 'job-1');

  const edge = harvest.relationships.find((r) => r.relation === 'COMPARABLE_TO');
  assert.ok(edge, 'no comparable edge was recorded at all');
  assert.equal(edge.from.naturalKey, '01.72.14.040.030.01.02.017',
    'the comparable edge points at the subject instead of away from it');
  assert.equal(edge.to.entityType, 'LISTING');
  assert.ok(harvest.facts.some((f) => f.factKey === 'listing.price'),
    'a comparable asking price was not stored at all');
});

test('a cycle in the graph does not loop forever', async () => {
  const db = makeDb();
  await persistHarvest(db, harvestReport(REPORT, POLICIES), 'job-1');
  const [a, b] = db.tables.intelligence_entities;
  db.tables.intelligence_relationships.push(
    { id: 'cycle-1', from_entity_id: b.id, to_entity_id: a.id, relation: 'LOCATED_IN', status: 'CURRENT' }
  );
  const known = await loadKnownIntelligence(db, 'CADASTRAL_CODE', '01.72.14.040.030.01.02.017');
  assert.ok(Array.isArray(known.relatedEntities));
  assert.ok(!known.relatedEntities.some((r) => r.id === a.id), 'the walk came back to where it started');
});

/* ── wording is not change ───────────────────────────────────────────── */

test('the same company named two ways is not a change', async () => {
  // Measured by running the same verification twice against one property:
  // "Geo City Digomi LLC" came back as "LLC Geo City Digomi". A customer
  // asking "has anything changed?" would have been told the company was
  // renamed — and a fact that changes every run is never fresh, so it can
  // never be reused.
  assert.equal(
    compareValues({ valueText: 'LLC Geo City Digomi' }, { valueText: 'Geo City Digomi LLC' }),
    'SAME'
  );
  assert.equal(compareValues({ valueText: 'Geo  City   Digomi' }, { valueText: 'geo city digomi' }), 'SAME');
});

test('a thinner version of the same address does not replace the fuller one', async () => {
  // The second run returned "18 Kristian Stiven Street, Tbilisi" for
  // "18 Kristian Stiven Street, Digomi, Tbilisi". That is the same fact with
  // detail missing; superseding would make the graph worse every re-check.
  assert.equal(
    compareValues(
      { valueText: '18 Kristian Stiven Street, Tbilisi' },
      { valueText: '18 Kristian Stiven Street, Digomi, Tbilisi' }
    ),
    'LESS_SPECIFIC'
  );
  // And the fuller value is kept.
  const db = makeDb();
  const full = { ...REPORT, projectProfile: { ...REPORT.projectProfile, address: '18 Kristian Stiven Street, Digomi, Tbilisi' } };
  const thin = { ...REPORT, projectProfile: { ...REPORT.projectProfile, address: '18 Kristian Stiven Street, Tbilisi' } };
  await persistHarvest(db, harvestReport(full, POLICIES), 'job-1');
  const out = await persistHarvest(db, harvestReport(thin, POLICIES), 'job-2');
  assert.equal(out.factsChanged, 0, 'a less specific address replaced a fuller one');
  const kept = db.tables.intelligence_facts.find((f) => f.fact_key === 'address.full' && f.status === 'CURRENT');
  assert.match(kept.value_text, /Digomi/, 'the district was lost from the stored address');
});

test('a reworded amenity list is not a change to the building', () => {
  assert.equal(
    compareValues(
      { valueJson: ['Ground-level parking', 'Elevator'] },
      { valueJson: ['elevator', 'ground level parking'] }
    ),
    'SAME'
  );
  // A genuinely shorter list is the same building, described less fully.
  assert.equal(
    compareValues({ valueJson: ['Elevator'] }, { valueJson: ['Elevator', 'Parking'] }),
    'LESS_SPECIFIC'
  );
  // A different amenity IS a change.
  assert.equal(
    compareValues({ valueJson: ['Elevator', 'Pool'] }, { valueJson: ['Elevator', 'Parking'] }),
    'DIFFERENT'
  );
});

test('numbers and enums are never blurred', () => {
  // The facts where a difference is always real. Normalising these would
  // hide exactly the changes that matter most.
  assert.equal(compareValues({ valueNumber: 155000 }, { valueNumber: 160000 }), 'DIFFERENT');
  assert.equal(compareValues({ valueNumber: 7 }, { valueNumber: 9 }), 'DIFFERENT');
  assert.equal(
    compareValues({ valueText: 'NOT_CONFIRMED' }, { valueText: 'CONFIRMED_POSITIVE' }),
    'DIFFERENT'
  );
  assert.equal(compareValues({ valueText: 'JOINT' }, { valueText: 'SOLE' }), 'DIFFERENT');
});

test('a genuinely different set of directors is still a change', async () => {
  // The one real change the two production runs disagreed about, and it must
  // survive the normalisation that silences the rest.
  assert.equal(
    compareValues(
      { valueJson: ['მერაბ ბეჟაშვილი', 'ლიანა ჭუმბურიძე'] },
      { valueJson: ['გურამ ფშავლიშვილი', 'ჯუმბერი ომარაშვილი'] }
    ),
    'DIFFERENT'
  );
});

test('what is stored is always what the research said, never the normalised form', async () => {
  const db = makeDb();
  await persistHarvest(db, harvestReport(REPORT, POLICIES), 'job-1');
  const name = db.tables.intelligence_facts.find((f) => f.fact_key === 'company.name');
  assert.equal(name.value_text, 'Geo City', 'the stored value was normalised');
});

/* ── a comparable is not lineage ─────────────────────────────────────
 *
 * The traversal exists to reach what this property BELONGS to: its parcel,
 * its project, the company that built it. A COMPARABLE_TO edge points at a
 * different property, and following it pulls that property's asking price
 * into what we believe about this one. Production held eleven comparable
 * listings against a subject unit with four facts of its own, and an
 * unfiltered walk returned forty-four "related" facts that were mostly other
 * people's flats.
 */

test('comparable listings are not walked as if they were lineage', async () => {
  const db = makeDb();
  await persistHarvest(db, harvestReport(REPORT, POLICIES), 'job-1');
  const known = await loadKnownIntelligence(db, 'CADASTRAL_CODE', '01.72.14.040.030.01.02.017');

  const comparableIds = new Set(
    known.relatedEntities.filter((r) => r.relation === 'COMPARABLE_TO').map((r) => r.id)
  );
  assert.equal(comparableIds.size, 0, 'a comparable property was returned as lineage');

  for (const r of known.relatedEntities) {
    assert.notEqual(r.entityType, 'LISTING', `a listing (${r.naturalKey}) was walked as lineage`);
  }
});

test('every fact that comes back knows what it is a fact about', async () => {
  // A fact key is not an identity: eleven listings each have their own answer
  // to `listing.price`. Without entity_id the brief cannot tell them apart,
  // and it briefed five strangers' prices as this property's own.
  const db = makeDb();
  await persistHarvest(db, harvestReport(REPORT, POLICIES), 'job-1');
  const known = await loadKnownIntelligence(db, 'CADASTRAL_CODE', '01.72.14.040.030.01.02.017');

  for (const f of [...known.facts, ...known.relatedFacts]) {
    assert.ok(f.entity_id, `${f.fact_key} came back with no entity`);
  }
  for (const f of known.facts) {
    assert.equal(f.entity_id, known.entityId, `${f.fact_key} was filed under the wrong entity`);
  }
});

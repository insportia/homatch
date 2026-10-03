// PHASE 2 cross-source dedupe and the unified scoring contract.
import test from 'node:test';
import assert from 'node:assert/strict';

import { dedupe, sameEntityEvidence, conflictBetween, textSimilarity, MAX_BLOCK } from '../discovery/cross-source-dedupe.ts';
import { fromObservationRow, fromDemandSignal } from '../discovery/discovery-entity.ts';
import {
  scorePair, candidateQuality, unifiedScore, QUALITY_FACTORS, QUALITY_FLOOR, demandSideOf, supplySideOf,
} from '../match/unified-score.ts';
import { assessMatch } from '../match/compatibility.ts';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const day = (d) => new Date(NOW - d * 86_400_000).toISOString();

const supply = (id, over = {}, signal = null) => ({
  id,
  entity: fromObservationRow({
    adapter_id: 'telegram-community', external_id: `ch/${id}`, canonical_url: `https://t.me/ch_${id}/1`,
    transaction: 'RENT', property_type: 'APARTMENT', city: 'Batumi', rent_amount: 700, rent_currency: 'USD',
    area_sqm: 65, rooms: 2, published_at: day(1), description: 'Сдается квартира +995 599 12 34 56', ...over,
  }, signal),
  fingerprint: over.fingerprint ?? null,
  entityId: over.entity_id ?? null,
});

test('same ad cross-posted (identical text fingerprint) is one property with every source kept', () => {
  const [a, b, c] = [supply('a', { fingerprint: 'cl1:x' }), supply('b', { fingerprint: 'cl1:x' }), supply('c', { fingerprint: 'cl1:x', area_sqm: 120 })];
  const r = dedupe([a, b, c]);
  assert.equal(r.keyOf.get('a'), r.keyOf.get('b'));
  assert.notEqual(r.keyOf.get('a'), r.keyOf.get('c'), 'identical text but a conflicting area is not merged');
  assert.equal(conflictBetween(a, c), 'area');
  assert.deepEqual(sameEntityEvidence(a, c), []);
  const cluster = r.clusters.find((c) => c.members.includes('a'));
  assert.deepEqual(cluster.members, ['a', 'b']);
  assert.ok(cluster.evidence.includes('same-text'));
});

test('a broker phone alone never merges two different flats', () => {
  const a = supply('a', { area_sqm: 65, rooms: 2, rent_amount: 700 });
  const b = supply('b', { area_sqm: 48, rooms: 1, rent_amount: 500 });
  assert.deepEqual(sameEntityEvidence(a, b), []);
  const c = supply('c', { area_sqm: 65.5, rooms: 2, rent_amount: 700, description: 'Rent flat, call 599-12-34-56' });
  assert.deepEqual(sameEntityEvidence(a, c), ['shared-contact', 'area', 'rooms'], 'phone + matching area + rooms is the same flat');
});

test('complete-linkage veto: a chain never drags conflicting items into one entity', () => {
  // a~b by text, b~c by contact+area+rooms, but a and c disagree on price by >10%.
  const a = supply('a', { fingerprint: 'cl1:p', rent_amount: 700 });
  const b = supply('b', { fingerprint: 'cl1:p', rent_amount: 690 });
  const c = supply('c', { rent_amount: 820, description: 'call +995 599 12 34 56' });
  assert.equal(conflictBetween(a, c), 'price');
  const r = dedupe([a, b, c]);
  assert.equal(r.keyOf.get('a'), r.keyOf.get('b'));
  assert.notEqual(r.keyOf.get('a'), r.keyOf.get('c'));
});

test('coordinates within 30 m + same area and rooms is one building unit; missing fields are never agreement', () => {
  const geo = (lat, lng) => ({ field_origins: { lat, lng }, description: null });
  const a = supply('a', geo(41.7151, 44.8271));
  const b = supply('b', geo(41.7152, 44.8272));
  assert.deepEqual(sameEntityEvidence(a, b), ['coordinates', 'area', 'rooms']);
  const bare1 = supply('x', { description: null, area_sqm: null, rooms: null, rent_amount: null });
  const bare2 = supply('y', { description: null, area_sqm: null, rooms: null, rent_amount: null });
  assert.deepEqual(sameEntityEvidence(bare1, bare2), []);
});

test('deterministic: input order never changes clusters or keys', () => {
  const items = [supply('c', { fingerprint: 'f' }), supply('a', { fingerprint: 'f' }), supply('b')];
  const one = dedupe(items);
  const two = dedupe([...items].reverse());
  assert.deepEqual(one.clusters, two.clusters);
  assert.equal(one.keyOf.get('c'), 'a');
});

test('a key shared by too many items (a portal-wide phone) is not used to compare them', () => {
  const many = Array.from({ length: MAX_BLOCK + 1 }, (_, i) => supply(`n${String(i).padStart(3, '0')}`, { area_sqm: 65, rooms: 2 }));
  const r = dedupe(many);
  assert.equal(r.clusters.length, many.length, 'nothing merged through an over-common key');
});

const demand = (id, signal, reading) => ({ id, entity: fromDemandSignal({ platform: 'TELEGRAM', ...signal }, { origin: 'MODEL', ...reading }) });

test('demand: the same person in two groups (same profile) with an agreeing request is one person', () => {
  const a = demand('s1', { author_public_url: 'https://t.me/nino_k', original_text: 'Ищу 2-комн. в Ваке до 900$', published_at: day(2) },
    { transaction: 'RENT', city: 'Tbilisi', budgetMax: 900, currency: 'USD', bedrooms: 1 });
  const b = demand('s2', { author_public_url: 'https://t.me/nino_k', original_text: 'Looking for 2 rooms in Vake, up to $950', published_at: day(1) },
    { transaction: 'RENT', city: 'Tbilisi', budgetMax: 950, currency: 'USD', bedrooms: 1 });
  const c = demand('s3', { author_public_url: 'https://t.me/nino_k', original_text: 'Хочу купить дом в Батуми', published_at: day(1) },
    { transaction: 'SALE', city: 'Batumi', budgetMax: 150000, currency: 'USD' });
  const r = dedupe([a, b, c]);
  assert.equal(r.keyOf.get('s1'), r.keyOf.get('s2'));
  assert.notEqual(r.keyOf.get('s1'), r.keyOf.get('s3'), 'the same author asking for something else is a different request');
});

test('demand: near-verbatim re-post merges; requests months apart or with disjoint budgets do not', () => {
  const text = 'Ищу квартиру в аренду в Тбилиси, Сабуртало, 2 спальни, бюджет до 800 долларов, на длительный срок';
  const a = demand('d1', { original_text: text, published_at: day(3) }, { transaction: 'RENT', city: 'Tbilisi', budgetMax: 800, currency: 'USD' });
  const b = demand('d2', { original_text: `${text}!`, published_at: day(1) }, { transaction: 'RENT', city: 'Tbilisi', budgetMax: 800, currency: 'USD' });
  const old = demand('d3', { original_text: text, published_at: day(90) }, { transaction: 'RENT', city: 'Tbilisi', budgetMax: 800, currency: 'USD' });
  const rich = demand('d4', { original_text: text, published_at: day(2) }, { transaction: 'RENT', city: 'Tbilisi', budgetMin: 3000, budgetMax: 4000, currency: 'USD' });
  assert.ok(textSimilarity(text, `${text}!`) > 0.9);
  const r = dedupe([a, b, old, rich]);
  assert.equal(r.keyOf.get('d1'), r.keyOf.get('d2'));
  assert.notEqual(r.keyOf.get('d1'), r.keyOf.get('d3'));
  assert.notEqual(r.keyOf.get('d1'), r.keyOf.get('d4'));
});

test('unified score: the same assessMatch in both directions; a conflict is 0 whatever the quality', () => {
  const want = fromDemandSignal({ platform: 'FORUM', original_text: 'ищу 2 комнаты, Батуми, до 750$', published_at: day(1) },
    { transaction: 'RENT', city: 'Batumi', budgetMax: 750, currency: 'USD', rooms: 2, propertyType: 'APARTMENT', origin: 'MODEL' });
  const flat = supply('f').entity;
  const fp = scorePair(want, flat, 'FIND_PROPERTY', { now: NOW });
  const fb = scorePair(want, flat, 'FIND_BUYERS', { now: NOW });
  assert.equal(fp.assessment.compatibility, 'COMPATIBLE');
  assert.equal(fp.relevance, fb.relevance, 'one comparison, two directions');
  assert.deepEqual(fp.assessment, assessMatch(demandSideOf(want), supplySideOf(flat), { minAgreements: 3 }));
  assert.ok(fp.score > 0 && fp.score <= fp.relevance);
  assert.ok(fp.score >= fp.relevance * QUALITY_FLOOR, 'quality can at most halve relevance');
  assert.ok(fp.explanation.length >= 5 && fp.explanation[0].startsWith('fit:'));
  const pricey = supply('g', { rent_amount: 2000 }).entity;
  const no = scorePair(want, pricey, 'FIND_PROPERTY', { now: NOW });
  assert.equal(no.score, 0);
  assert.notEqual(no.assessment.compatibility, 'COMPATIBLE');
});

test('quality: recent, complete, stated, contactable candidates rank higher; weights are documented and sum to 1', () => {
  const sum = Object.values(QUALITY_FACTORS).reduce((s, f) => s + f.weight, 0);
  assert.equal(Math.round(sum * 1000) / 1000, 1);
  for (const f of Object.values(QUALITY_FACTORS)) assert.ok(f.why.length > 10);
  const fresh = candidateQuality(supply('a').entity, NOW);
  const stale = candidateQuality(supply('b', { published_at: day(55) }).entity, NOW);
  const undated = candidateQuality(supply('c', { published_at: null }).entity, NOW);
  assert.equal(fresh.recency, 1);
  assert.ok(stale.recency < 0.2);
  assert.equal(undated.recency, 0.5);
  assert.ok(fresh.quality > stale.quality);
  assert.equal(unifiedScore(0, 1), 0);
  assert.equal(unifiedScore(0.8, 1), 0.8);
  assert.equal(unifiedScore(0.8, 0), 0.4);
});

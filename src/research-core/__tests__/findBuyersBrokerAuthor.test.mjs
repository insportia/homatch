// FIND BUYERS v8 — campaign 8f6b8544 (2026-10-18): the one "interested person" was a broker
// page ("ბინების ყიდვა-გაყიდვა გაქირავება", four sale ads in the same read) asking colleagues for
// ONE-bedroom flats, shown for a two-bedroom 97 m² Krtsanisi apartment. Owner: "from the name
// alone you must see that a broker posts"; a one-bedroom request is not this property's buyer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDemand, withAuthorEvidence, authorLooksLikeBusiness } from '../findBuyers/demandClassifier.ts';
import { qualify } from '../findBuyers/qualify.ts';
import { buildPropertyDna } from '../findBuyers/propertyDna.ts';
import { requalifyLeads } from '../findBuyers/requalify.ts';

const PROD = 'გამარჯობა, ვეძებ ერთ საძინებლიან ბინებს , ვისაც გაქვთ გასაყიდი და თანამშრომლობთ მომწერეთ პირადში !!! კომენტარებს ნუ ტოვებთ !!!';
const dna = buildPropertyDna({
  transaction_type: 'SALE', property_type: 'APARTMENT', city: 'Tbilisi', district: 'Krtsanisi',
  total_price: 213840, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2,
});

test('the production post is an intermediary by its own words (colleagues who "cooperate")', () => {
  const r = classifyDemand(PROD);
  assert.equal(r.role, 'AGENT', r.evidence.join(','));
  const q = qualify(r, dna, { ageDays: 0.1 });
  assert.equal(q.category, 'REJECTED');
  assert.ok(q.reasons.includes('AGENT_INTERMEDIARY'));
});

test('a business or channel name is never a buyer; a person\'s name is unchanged', () => {
  for (const n of ['ბინების ყიდვა-გაყიდვა გაქირავება', 'ყიდვა-გაყიდვა გაქირავება', 'უძრავი ქონების აგენტი თაკო', 'Sale Home', 'Lika Home', "Tika's Prime Home Georgia", 'ბინები თბილისში', 'Квартиры в Тбилиси', 'Tiflis Emlak'])
    assert.ok(authorLooksLikeBusiness(n), n);
  for (const n of ['Nini Unipro', 'Shoko Malkhasyan', 'Sandro Wereteli', 'ნი კა', 'Mariam Chachua', 'Giorgi Beridze', 'Homer Simpson', 'Georgia Brown', null, ''])
    assert.ok(!authorLooksLikeBusiness(n), String(n));
  const buyer = classifyDemand('ვეძებ 2 საძინებლიან ბინას კრწანისში, 220 000$-მდე, ვყიდულობ');
  assert.equal(buyer.role, 'BUY_SEEKER');
  assert.equal(withAuthorEvidence(buyer, { name: 'ბინების ყიდვა-გაყიდვა გაქირავება' }).role, 'AGENT');
  assert.ok(withAuthorEvidence(buyer, { name: 'Sale Home' }).evidence.includes('business_author'));
  assert.equal(withAuthorEvidence(buyer, { name: 'Nino Kapanadze' }).role, 'BUY_SEEKER');
});

test('an author who advertises homes in the same read is a broker when they "look for" one', () => {
  const buyer = classifyDemand('ვეძებ 2 საძინებლიან ბინას კრწანისში, ვყიდულობ');
  const r = withAuthorEvidence(buyer, { name: 'Nino', alsoAdvertises: true });
  assert.equal(r.role, 'AGENT');
  assert.ok(r.evidence.includes('author_also_advertises'));
  /* Listings themselves keep their role: the override only touches seekers. */
  const listing = classifyDemand('იყიდება 3 ოთახიანი ბინა კრწანისში 97 კვ 210 000$');
  assert.equal(withAuthorEvidence(listing, { name: 'Sale Home' }).role, listing.role);
});

test('bedroom counts written as words are read in every language and compared with the property', () => {
  const cases = [
    ['ვეძებ ერთ საძინებლიან ბინას ვყიდულობ', 1], ['ვყიდულობ ორსაძინებლიან ბინას', 2], ['ვყიდულობ სამ საძინებლიან ბინას', 3],
    ['Куплю квартиру, одна спальня', 1], ['Looking to buy a two-bedroom apartment', 2], ['Looking to buy a one bedroom flat', 1],
  ];
  for (const [text, n] of cases) assert.equal(classifyDemand(text).bedrooms, n, text);
  const one = qualify(classifyDemand('ვეძებ ერთ საძინებლიან ბინას კრწანისში, ვყიდულობ'), dna, { ageDays: 1 });
  assert.equal(one.category, 'REJECTED');
  assert.ok(one.reasons.includes('ROOMS_MISMATCH'), one.reasons.join(','));
});

test('re-checking stored leads applies the author rule too', () => {
  const [row] = requalifyLeads([{ id: 'x', text: 'ვეძებ 2 საძინებლიან ბინას კრწანისში, ვყიდულობ', author: 'ბინების ყიდვა-გაყიდვა გაქირავება', publishedAt: new Date().toISOString(), url: 'https://www.facebook.com/groups/1/permalink/2/' }], dna);
  assert.equal(row.reading.role, 'AGENT');
  assert.equal(row.qualification.category, 'REJECTED');
});

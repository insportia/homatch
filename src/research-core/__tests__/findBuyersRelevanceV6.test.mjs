// FIND BUYERS — property-specific relevance, v6 (owner, 2026-10-17).
//
// The paid campaigns of 2026-10-16 and 2026-10-17 for the Krtsanisi apartment
// (კრწანისის ქ. 6, $213,840, 3 rooms) showed 9 people; none fitted. These are
// their real texts (phones removed), each with what it actually is, plus the
// location, budget and intent rules the owner set: a micro-area is not a street,
// an unknown budget is never a compatible one, a seller looking for a buyer is
// not a buyer, an agent's or competitor's comment is not interest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDemand, classifyComment } from '../findBuyers/demandClassifier.ts';
import { qualify, locationLevel, budgetLevel, propertyPlace } from '../findBuyers/qualify.ts';
import { buildPropertyDna } from '../findBuyers/propertyDna.ts';
import { placesMentioned, streetOfAddress, districtsMentioned } from '../findBuyers/places.ts';

const DNA = buildPropertyDna({
  transactionType: 'SALE', propertyType: 'APARTMENT', countryCode: 'GE', city: 'Tbilisi', district: 'Krtsanisi',
  address: 'კრწანისის ქ. 6', totalPrice: 213840, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2, floor: 7, totalFloors: 8,
});
const Q = (text, dna = DNA) => qualify(classifyDemand(text, { kind: 'POST' }), dna, { ageDays: 2 });

/* lead id → [truth, text] — production, campaigns 46dcaf3f (2026-10-16) and 719a57ac (2026-10-17). */
const REAL = {
  '8646b961': ['SALE_LISTING', 'Премиум-дизайн ЖК - Твой дом на  Лиси | 3 спальни  | 100 м²\nИщете жилье «для себя», а не типовой ремонт под сдачу? Продается эксклюзивная угловая квартира в элитном комплексе «Your Home on Lisi».'],
  '7bfc19dd': ['AGENT', 'თუ გაქვთ ბინა, სახლი ან კომერციული ფართი გასაყიდი ან გასაქირავებელი, სიამოვნებით დაგეხმარებით. პირადად მოვალ, გადავიღებ ფოტოებს, გაგესაუბრებით, გავივლით დეტალებს და ჩემი რესურსით მაქსიმალურად შევეცდები, ვიპოვო რეალური მყიდველი ან დამქირავებელი.'],
  'd205058f': ['AGENT', 'თქვენ გაქვთ გასაყიდი უძრავი ქონება? ჩვენ გვყავს გუნდი, რომელიც მის გაყიდვაზე იმუშავებს!\nთუ ბინის, სახლის, მიწის ან კომერციული ფართის გაყიდვა გსურთ — ჩაგვაბარეთ ეს საქმე ჩვენ!\nვიღებთ უძრავ ქონებას ექსკლუზიურ გაყიდვაში!'],
  '1654fa18': ['AGENT', 'მეპატრონეებმა გამომიგზავნეთ გასაყიდი და გასაქირავებელი ბინები [phone] ვაცაფი'],
  '12b88ce0': ['AGENT', 'Здравствуйте, помогу приобрести недвижимость по всей территории Грузии, без комиссий, надбавок и %, подберем недвижимость по-вашему желанию, под любые цели, оперативно, быстро, полное сопровождение сделки.'],
  'cf934be7': ['BUYER_WRONG_BUDGET', 'ვეძებ დასრულებულ ბინას თბილისში ორ ოთახიანს, 60 ათასის ფარგლებში. განვიხილავ ყველა ვარიანტს. დატოვეთ კომენტარები და მე დაგიკავშირდებით დაინტერესების შემთხვევაში.'],
  '292b511c': ['BUYER_OTHER_AREA', 'КУПЛЮ КВАРТИРУ В САБУРТАЛО / БАГЕБИ\nРассмотрю квартиры площадью от 60 до 70 м².\nРайоны: Сабуртало, Багеби\nПокупка за наличный расчёт'],
  'ff1a6662': ['BUYER_TO_QUALIFY', 'სალამი, მეგობრებო! ვეძებ ბინას იპოთეკით, 2 საძინებლით, რომლის შეძენასაც შევძლებ საბანკო დაფინანსებით და რომელშიც შესვლისთანავე ცხოვრების შესაძლებლობა მექნება.'],
  '3841ad69': ['BUYER_TO_QUALIFY', 'ბენდუქიძეში თუ ყიდით ვინმე ბინას მომწერეთ პირადში ან დამირეკეთ [phone]'],
};

test('real paid-campaign leads: supply and agents are rejected, wrong budget/area rejected, the rest only "to qualify"', () => {
  for (const [id, [truth, text]] of Object.entries(REAL)) {
    const q = Q(text);
    if (truth === 'SALE_LISTING' || truth === 'AGENT' || truth === 'BUYER_WRONG_BUDGET' || truth === 'BUYER_OTHER_AREA') {
      assert.equal(q.category, 'REJECTED', `${id} ${truth}: ${q.category} ${q.reasons}`);
    } else {
      assert.equal(q.category, 'WEAK', `${id} ${truth}: ${q.category}`);
    }
    assert.notEqual(q.category, 'STRONG');
  }
  /* v7: two rooms for a three-room flat is a smaller home as well — both reasons stand. */
  assert.deepEqual(Q(REAL.cf934be7[1]).reasons, ['BUDGET_INCOMPATIBLE', 'ROOMS_MISMATCH']);
  assert.ok(Q(REAL['292b511c'][1]).reasons.includes('OTHER_AREA'));
});

test('the address gives the property\'s street; the district stays administrative', () => {
  assert.equal(streetOfAddress('კრწანისის ქ. 6'), 'krtsanisi');
  assert.deepEqual(propertyPlace(DNA), { street: 'krtsanisi', microArea: null, district: 'krtsanisi', city: 'tbilisi' });
});

test('Ponichala vs Krtsanisi Street: a micro-area of the district is never an exact place', () => {
  const ponichala = Q('ვიყიდი 3 ოთახიან ბინას ფონიჭალაში, ბიუჯეტი 215 000$');
  assert.equal(ponichala.locationLevel, 'MICRO_AREA_OF_DISTRICT');
  assert.equal(ponichala.locationFit, 'NEARBY');
  assert.equal(ponichala.category, 'POTENTIAL');
  assert.ok(ponichala.limitations.includes('LOCATION_MICRO_AREA_UNCONFIRMED'));
  /* the street itself, in three languages */
  for (const t of ['ვიყიდი 3 ოთახიან ბინას კრწანისის ქუჩაზე, ბიუჯეტი 215 000$', 'Куплю 3-комнатную квартиру на ул. Крцаниси, бюджет 215 000$', 'Looking to buy a 3 room flat on Krtsanisi street, budget $215,000']) {
    const q = Q(t);
    assert.equal(q.locationLevel, 'EXACT_STREET', t);
    assert.equal(q.category, 'STRONG', t);
  }
  /* "Krtsanisi street" in a request names the street, not (also) the district */
  assert.deepEqual(districtsMentioned('ბინა კრწანისის ქუჩაზე'), []);
  /* a property stored with a micro-area: the same micro-area is exact, a sibling is nearby */
  const inPonichala = buildPropertyDna({ transactionType: 'SALE', propertyType: 'APARTMENT', countryCode: 'GE', city: 'Tbilisi', district: 'Ponichala', totalPrice: 120000, currency: 'USD', rooms: 2 });
  assert.equal(locationLevel(classifyDemand('ვიყიდი ბინას ფონიჭალაში'), inPonichala), 'SAME_MICRO_AREA');
  assert.equal(locationLevel(classifyDemand('ვიყიდი ბინას ორთაჭალაში'), inPonichala), 'SIBLING_MICRO_AREA');
  assert.equal(locationLevel(classifyDemand('ვიყიდი ბინას კრწანისში'), inPonichala), 'SAME_DISTRICT');
});

test('location: other district rejected, excluded place rejected, stated flexibility is not a match', () => {
  assert.deepEqual(Q('Куплю квартиру в Ваке до 220 000$').reasons, ['OTHER_AREA']);
  assert.deepEqual(Q('ვიყიდი ბინას თბილისში, კრწანისის გარდა, 220 000$').reasons, ['LOCATION_EXCLUDED']);
  const flex = Q('Looking to buy an apartment in Tbilisi, any district, budget $220,000');
  assert.equal(flex.locationLevel, 'FLEXIBLE_STATED');
  assert.equal(flex.category, 'POTENTIAL');
  assert.ok(flex.limitations.includes('LOCATION_FLEXIBLE_STATED'));
  assert.deepEqual(Q('Куплю квартиру в Батуми до 220 000$').reasons, ['OTHER_CITY']);
  assert.ok(Q('Want to buy a flat in Old Batumi, $220,000').reasons.includes('OTHER_CITY'));
});

test('places: no "Vera" inside veranda / ვერაფერი / the name Вера; Hebrew and Arabic prefixes', () => {
  assert.deepEqual(placesMentioned('apartment with a big veranda in Tbilisi'), []);
  assert.deepEqual(placesMentioned('ვერაფერი ვიპოვე ჯერ'), []);
  assert.deepEqual(placesMentioned('Вера ищет квартиру'), []);
  assert.deepEqual(districtsMentioned('ბინა ვერაზე'), ['vera']);
  assert.deepEqual(districtsMentioned('מחפש דירה בסבורטלו'), ['saburtalo']);
  assert.deepEqual(districtsMentioned('أبحث عن شقة في فاكي'), ['vake']);
  assert.deepEqual(placesMentioned('ищу в Тбилиси, но не Ваке').map((p) => [p.key, p.negated]), [['vake', true]]);
});

test('budget: unknown is never compatible; unstated currency decided only when USD and GEL agree; far above is another segment', () => {
  assert.equal(budgetLevel(classifyDemand('ვიყიდი ბინას კრწანისში'), DNA), 'UNKNOWN');
  assert.equal(Q('ვიყიდი ბინას კრწანისში').category, 'POTENTIAL'); /* own place, budget to verify */
  assert.equal(Q('ვიყიდი ბინას თბილისში').category, 'WEAK');     /* city only + unknown budget */
  /* "60 ათასამდე" — below the price in USD and in GEL: incompatible either way */
  assert.equal(budgetLevel(classifyDemand('ვიყიდი ბინას კრწანისში 60 ათასამდე'), DNA), 'BELOW');
  /* "210 ათასამდე" — fits in USD, far below in GEL: the currency is unstated, so it stays unknown */
  const unstated = Q('ვიყიდი ბინას კრწანისში 210 ათასამდე');
  assert.equal(unstated.budgetLevel, 'UNSTATED_CURRENCY');
  assert.equal(unstated.budgetFit, 'UNKNOWN');
  assert.ok(unstated.limitations.includes('BUDGET_CURRENCY_UNSTATED'));
  assert.notEqual(unstated.category, 'STRONG');
  assert.equal(Q('Looking to buy an apartment in Krtsanisi, budget $190,000').budgetLevel, 'NEAR');
  assert.equal(Q('Looking to buy an apartment in Krtsanisi, budget $190,000').category, 'POTENTIAL');
  assert.equal(Q('Looking to buy a villa-size apartment in Krtsanisi, budget $600,000').budgetLevel, 'ABOVE_RANGE');
  assert.equal(Q('Looking to buy an apartment in Krtsanisi, budget $120,000').reasons[0], 'BUDGET_INCOMPATIBLE');
  /* a property priced in a currency outside the table is "unknown", never a rejection */
  const amd = buildPropertyDna({ transactionType: 'SALE', propertyType: 'APARTMENT', countryCode: 'GE', city: 'Tbilisi', district: 'Krtsanisi', totalPrice: 80000000, currency: 'AMD', rooms: 3 });
  assert.equal(budgetLevel(classifyDemand('Looking to buy an apartment in Krtsanisi, budget $200,000'), amd), 'UNKNOWN');
});

test('intent: a seller looking for a buyer, a broker for buyers, a listing collector are never buyers', () => {
  for (const t of ['Looking for a buyer for my 3 room apartment in Krtsanisi, $210000', 'ищу покупателя на 3 комнатную квартиру в Крцаниси 210000$', 'ვეძებ მყიდველს ჩემი ბინისთვის კრწანისში']) {
    assert.equal(classifyDemand(t).role, 'SALE_OFFER', t);
  }
  assert.equal(classifyDemand('Looking to buy an apartment in Krtsanisi, I am a serious buyer, $220,000').role, 'BUY_SEEKER');
  assert.equal(classifyDemand(REAL['1654fa18'][1]).evidence.at(-1), 'collects_listings');
  assert.equal(classifyDemand(REAL['12b88ce0'][1]).evidence.at(-1), 'service_to_buyers');
});

test('comments under a comparable listing: agents, competitors and farewells are not interest', () => {
  const parent = { role: 'SALE_OFFER', similarity: 82 };
  assert.equal(classifyComment('Is it still available? I am an agent with buyers', parent).role, 'AGENT');
  assert.equal(classifyComment('How much? I sell similar in Krtsanisi', parent).role, 'SALE_OFFER');
  assert.equal(classifyComment('მსგავსი მაქვს, მომწერეთ', parent).role, 'SALE_OFFER');
  assert.notEqual(classifyComment('ნახვამდის', parent).role, 'BUY_SEEKER');
  assert.equal(classifyComment('Interested — what is the price? Can I view it this week?', parent).role, 'BUY_SEEKER');
});

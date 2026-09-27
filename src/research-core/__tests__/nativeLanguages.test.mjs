// SIX LANGUAGES, ONE MEANING.
//
// Homatch is used in Georgian, English, Russian, Arabic, Hebrew and Turkish. Translating
// the interface is not the same as understanding the person: somebody writing in Hebrew
// that they are looking for a two-bedroom flat in Vake has stated exactly the same
// requirement as somebody writing it in Georgian, and the matcher must receive the same
// canonical demand from both — or one of them is silently a second-class customer.
//
// Every sentence here is written the way a person in that language would write it in a
// chat, not a mechanical translation of the English line. Where a market counts rooms
// differently — Hebrew and Georgian count the living room, Turkish writes 2+1 — the test
// asserts the market's own convention rather than forcing the English one on it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { attributionOf, readingsOf } from '../intent/interpret.ts';
import { readConstraints, foldDigits } from '../intent/constraints.ts';
import { normalisePlan } from '../discovery/search-plan.ts';
import { demandFromText } from '../../../supabase/functions/_shared/nativeDemand.ts';

const acts = (text) => readingsOf(text).map((r) => (r.dimension ? `${r.act}:${r.dimension}` : r.act)).sort();

const CASES = {
  ka: {
    self: 'ვეძებ 2 საძინებლიან ბინას ვაკეში, ბიუჯეტი $180,000-მდე',
    third: 'ჩემი ძმა ეძებს 2 საძინებლიან ბინას ვაკეში',
    interest: 'ეს ბინა ძალიან მომწონს',
    rejection: 'ეს ბინა აღარ მაინტერესებს',
    objection: 'ეს ძვირია',
    interestAndObjection: 'მომწონს, მაგრამ ძვირია',
    objectionAndRejection: 'ეს ძვირია, აღარ მაინტერესებს',
    inquiry: 'რა ღირს?',
    required: 'ვეძებ ბინას, აუცილებლად ვაკეში, $200,000-მდე',
    preferred: 'ვეძებ ბინას თბილისში $150,000-მდე, სასურველია საბურთალოზე',
    rooms: 'ვეძებ 3 ოთახიან ბინას თბილისში 120 ათას დოლარამდე',
    rent: 'ვიქირავებ ბინას ვაკეში თვეში 900 დოლარამდე',
  },
  en: {
    self: "I'm looking for a 2-bedroom apartment in Vake, budget up to $180,000",
    third: 'My sister is looking for a 2-bedroom flat in Vake',
    interest: "I'm interested in this apartment",
    rejection: "I'm no longer interested in this one",
    objection: "It's too expensive",
    interestAndObjection: 'I like it, but it is too expensive',
    objectionAndRejection: "It's expensive, I'm not interested anymore",
    inquiry: 'How much is it?',
    required: 'I need a flat, it must be in Vake, up to $200,000',
    preferred: "I'm looking for an apartment in Tbilisi up to $150k, ideally Saburtalo",
    rooms: "I'm looking for a 3-room apartment in Tbilisi up to 120k USD",
    rent: 'I want to rent a flat in Vake, up to $900 per month',
  },
  ru: {
    self: 'Ищу квартиру с двумя спальнями в Ваке, бюджет до 180 000 долларов',
    third: 'Мой брат ищет квартиру с двумя спальнями в Ваке',
    interest: 'Эта квартира мне очень нравится',
    rejection: 'Эта квартира меня больше не интересует',
    objection: 'Дороговато',
    interestAndObjection: 'Нравится, но дорого',
    objectionAndRejection: 'Дорого, больше не интересует',
    inquiry: 'Сколько стоит?',
    required: 'Ищу квартиру, обязательно в Ваке, до $200 000',
    preferred: 'Ищу квартиру в Тбилиси до $150k, желательно в Сабуртало',
    rooms: 'Ищу трёхкомнатную квартиру в Тбилиси до 120 тысяч долларов',
    rent: 'Сниму квартиру в Ваке до 900 долларов в месяц',
  },
  tr: {
    self: "Vake'de 2 yatak odalı daire arıyorum, bütçem 180.000 dolara kadar",
    third: "Kardeşim Vake'de 2 yatak odalı daire arıyor",
    interest: 'Bu daireyle ilgileniyorum',
    rejection: 'Bu daireyle artık ilgilenmiyorum',
    objection: 'Çok pahalı',
    interestAndObjection: 'Beğendim ama çok pahalı',
    objectionAndRejection: 'Çok pahalı, artık ilgilenmiyorum',
    inquiry: 'Fiyatı ne kadar?',
    required: "Daire arıyorum, mutlaka Vake'de olsun, 200 bin dolara kadar",
    preferred: "Tiflis'te 150 bin dolara kadar daire arıyorum, tercihen Saburtalo'da",
    rooms: "Tiflis'te 3 odalı daire arıyorum, 120 bin dolara kadar",
    rent: "Vake'de kiralık daire arıyorum, aylık 900 dolara kadar",
  },
  ar: {
    self: 'أبحث عن شقة بغرفتي نوم في فاكي، بميزانية حتى ١٨٠٬٠٠٠ دولار',
    third: 'أخي يبحث عن شقة بغرفتي نوم في فاكي',
    interest: 'أنا مهتم بهذه الشقة',
    rejection: 'لم أعد مهتما بهذه الشقة',
    objection: 'السعر مرتفع جدا',
    interestAndObjection: 'تعجبني الشقة لكن السعر مرتفع',
    objectionAndRejection: 'السعر مرتفع، لم أعد مهتما',
    inquiry: 'كم السعر؟',
    required: 'أبحث عن شقة، ضروري في فاكي، حتى 200 ألف دولار',
    preferred: 'أبحث عن شقة في تبليسي حتى 150 ألف دولار، ويفضل في سابورتالو',
    rooms: 'أبحث عن شقة من 3 غرف في تبليسي حتى 120 ألف دولار',
    rent: 'أريد استئجار شقة في فاكي حتى 900 دولار شهريا',
  },
  he: {
    self: 'אני מחפש דירה עם שני חדרי שינה בוואקה, תקציב עד 180,000 דולר',
    third: 'אחי מחפש דירה עם שני חדרי שינה בוואקה',
    interest: 'אני מעוניין בדירה הזאת',
    rejection: 'אני כבר לא מעוניין בדירה הזאת',
    objection: 'יקר מדי',
    interestAndObjection: 'הדירה מוצאת חן בעיניי, אבל היא יקרה',
    objectionAndRejection: 'יקר מדי, כבר לא מעוניין',
    inquiry: 'כמה זה עולה?',
    required: 'אני מחפשת דירה, חייבת להיות בוואקה, עד 200 אלף דולר',
    preferred: 'אני מחפש דירה בטביליסי עד 150 אלף דולר, עדיף בסבורטלו',
    rooms: 'אני מחפש דירת 3 חדרים בטביליסי עד 120 אלף דולר',
    rent: 'אני רוצה לשכור דירה בוואקה עד 900 דולר לחודש',
  },
};

for (const [lang, c] of Object.entries(CASES)) {
  test(`${lang}: the author's own search is SELF and reads to the canonical demand`, () => {
    assert.equal(attributionOf(c.self), 'SELF');
    const demand = demandFromText(c.self);
    assert.ok(demand, 'no demand was read');
    assert.equal(demand.constraints.transactionType, 'SALE');
    assert.equal(demand.constraints.city, 'Tbilisi');
    assert.deepEqual(demand.constraints.districts, ['Vake']);
    assert.deepEqual(demand.constraints.propertyTypes, ['APARTMENT']);
    assert.equal(demand.constraints.bedroomsMin, 2);
    assert.equal(demand.constraints.budgetMax, 180000);
    assert.equal(demand.constraints.currency, 'USD');
    assert.equal(demand.constraints.roomsMin, undefined, 'bedrooms were read as rooms');
  });

  test(`${lang}: somebody else's search is THIRD_PARTY, never the author's`, () => {
    assert.equal(attributionOf(c.third), 'THIRD_PARTY');
  });

  test(`${lang}: interest, rejection, objection and inquiry are four different things`, () => {
    assert.deepEqual(acts(c.interest), ['INTEREST']);
    assert.ok(acts(c.rejection).includes('REJECTION'));
    assert.ok(!acts(c.rejection).includes('INTEREST'), 'a withdrawal was read as interest');
    assert.deepEqual(acts(c.objection), ['OBJECTION:PRICE'], 'a price complaint is neither interest nor rejection');
    assert.deepEqual(acts(c.interestAndObjection), ['INTEREST', 'OBJECTION:PRICE']);
    const both = acts(c.objectionAndRejection);
    assert.ok(both.includes('OBJECTION:PRICE') && both.includes('REJECTION'));
    assert.ok(!both.includes('INTEREST'), 'a complaint followed by a withdrawal produced interest');
    assert.deepEqual(acts(c.inquiry), ['INQUIRY'], 'a question became a buyer');
  });

  test(`${lang}: "must" is REQUIRED and "ideally" is PREFERRED, clause by clause`, () => {
    const required = readConstraints(c.required);
    assert.deepEqual(required.districts, ['Vake']);
    assert.equal(required.districtsStrength, 'REQUIRED');
    assert.equal(required.budgetMax, 200000);
    const preferred = readConstraints(c.preferred);
    assert.equal(preferred.city, 'Tbilisi');
    assert.deepEqual(preferred.districts, ['Saburtalo']);
    assert.equal(preferred.districtsStrength, 'PREFERRED');
    assert.notEqual(preferred.cityStrength, 'PREFERRED', 'a district preference softened the city');
    assert.equal(preferred.budgetMax, 150000);
  });

  test(`${lang}: rooms are counted the way the market counts them`, () => {
    const reading = readConstraints(c.rooms);
    assert.equal(reading.city, 'Tbilisi');
    assert.equal(reading.budgetMax, 120000);
    assert.equal(reading.currency, 'USD');
    assert.equal(reading.roomsMin, 3, 'a room count was lost');
    assert.equal(reading.bedroomsMin, null, 'three rooms were stored as three bedrooms');
  });

  test(`${lang}: a monthly price is a rent`, () => {
    const demand = demandFromText(c.rent);
    assert.ok(demand);
    assert.equal(demand.constraints.transactionType, 'RENT');
    assert.equal(demand.constraints.budgetMax, 900);
    assert.deepEqual(demand.constraints.districts, ['Vake']);
  });
}

test('the same requirement in six languages is one canonical demand', () => {
  const canonical = Object.values(CASES).map(({ self }) => {
    const { constraints } = demandFromText(self);
    return JSON.stringify(constraints);
  });
  assert.equal(new Set(canonical).size, 1, `the languages disagree:\n${canonical.join('\n')}`);
});

test('Turkish 2+1 states two bedrooms, not three rooms', () => {
  const reading = readConstraints("Vake'de 2+1 daire arıyorum, 180 bin dolara kadar");
  assert.equal(reading.bedroomsMin, 2);
  assert.equal(reading.roomsMin, null);
  assert.equal(reading.budgetMax, 180000, 'the 2+1 was read as money');
});

test('mixed-language sentences read the same as single-language ones', () => {
  const mixed = [
    'ვეძებ apartment-ს ვაკეში max $180k',
    'Ищу apartment в Vake до $180k',
    'أبحث عن apartment في Vake حتى $180k',
    'אני מחפש apartment ב-Vake עד $180k',
    "Vake'de apartment arıyorum, max $180k",
    "I'm looking for ბინა in ვაკე up to $180k",
  ];
  for (const sentence of mixed) {
    assert.equal(attributionOf(sentence), 'SELF', sentence);
    const reading = readConstraints(sentence);
    assert.equal(reading.city, 'Tbilisi', sentence);
    assert.deepEqual(reading.districts, ['Vake'], sentence);
    assert.deepEqual(reading.propertyTypes, ['APARTMENT'], sentence);
    assert.equal(reading.budgetMax, 180000, sentence);
    assert.equal(reading.currency, 'USD', sentence);
  }
});

test('every way of writing one hundred and eighty thousand dollars is the same number', () => {
  const forms = [
    'ვეძებ ბინას ვაკეში $180,000',
    'ვეძებ ბინას ვაკეში 180000 USD',
    'ვეძებ ბინას ვაკეში 180k$',
    'ვეძებ ბინას ვაკეში $180K',
    'ვეძებ ბინას ვაკეში 180 ათასი დოლარი',
    'أبحث عن شقة في فاكي ١٨٠٬٠٠٠ دولار',
    'أبحث عن شقة في فاكي ۱۸۰۰۰۰ دولار',
    'Ищу квартиру в Ваке 180 000 долларов',
    "Vake'de daire arıyorum 180.000 dolar",
    'אני מחפש דירה בוואקה 180 אלף דולר',
  ];
  for (const sentence of forms) {
    const reading = readConstraints(sentence);
    assert.equal(reading.budgetMax, 180000, sentence);
    assert.equal(reading.currency, 'USD', sentence);
  }
  assert.equal(readConstraints('ვეძებ სახლს ბათუმში 1.2M USD').budgetMax, 1200000);
  assert.equal(foldDigits('٢٠٠'), '200');
});

test('a price in a currency this market does not quote is not silently dollars', () => {
  const reading = readConstraints('אני מחפש דירה בוואקה עד 600,000 ₪');
  assert.equal(reading.budgetMax, null);
  assert.equal(reading.currency, null);
});

test('a bare number with no currency is not a budget', () => {
  const reading = readConstraints('ვეძებ ბინას ვაკეში 200000');
  assert.equal(reading.budgetMax, null, 'a currency was invented');
});

test('a normalised reading passes the same gate a confirmed plan passes', () => {
  for (const { self } of Object.values(CASES)) {
    const { plan, rejected } = normalisePlan(readConstraints(self));
    assert.ok(plan, self);
    assert.deepEqual(rejected, [], `${self}: ${rejected.join('; ')}`);
  }
});

test('generic discussion states no requirement', () => {
  for (const sentence of [
    'გამარჯობა ყველას', 'Good morning everyone', 'Всем привет', 'Herkese merhaba',
    'مرحبا بالجميع', 'בוקר טוב לכולם', 'ფასები ვაკეში ძალიან გაიზარდა',
    'Prices in Vake went up a lot this year',
  ]) {
    assert.equal(demandFromText(sentence)?.found >= 2 && attributionOf(sentence) === 'SELF', false, sentence);
  }
});

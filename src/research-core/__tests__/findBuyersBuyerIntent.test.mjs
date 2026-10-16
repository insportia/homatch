// FIND BUYERS 3.0 — the buyer intent gate. Regression for production campaign
// d8b69c51 (2026-10-13): a developer's ad ("want to buy an apartment? we offer…")
// scored 55 as a buyer, and a bare "price?" under another listing became a buyer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBuyerIntent, detectSignals } from '../findBuyers/buyerIntent.ts';

const LISTING = { role: 'SALE_OFFER', similarity: 80 };
const post = (text) => classifyBuyerIntent({ text, kind: 'POST' });
const comment = (text, parent = LISTING) => classifyBuyerIntent({ text, kind: 'COMMENT', parent });

test('production false positive: a developer ad addressing buyers is a SELLER, never a buyer', () => {
  const r = post('ბინის შეძენა გსურთ და ვერ გადაგიწყვეტიათ რომელ\nკომპანიას მიმართოთ?🖼️\n\nგთავაზობთ ბინებს მწვანე კარკასის კონდიციით 💚\n\nგადახდის მოქნილი პირობებით🫶\n\nდეტალებზე დაკავშირება ამ ნომერზე შეგიძლიათ: \n591 099 171');
  assert.equal(r.resultType, 'EXCLUDED');
  assert.equal(r.intent, 'SELLER');
  for (const t of ['Want to buy an apartment in Tbilisi? We offer new apartments with a flexible payment plan, call us',
    'Хотите купить квартиру? Предлагаем квартиры от застройщика, рассрочка',
    'Tiflis\'te daire almak istiyor musunuz? Projemiz ile sunuyoruz']) {
    assert.equal(post(t).resultType, 'EXCLUDED', t);
  }
});

test('production: a bare price question under someone else\'s listing is a PRICE interest signal, not a buyer', () => {
  const r = comment('საძინებელი რამდენი?\nფასი?');
  assert.equal(r.resultType, 'INTEREST');
  assert.equal(r.intent, 'PRICE_INQUIRY');
});

test('renovation and service requests are never buyers, in several languages', () => {
  for (const t of ['Looking for a renovation company for my apartment in Vake, any recommendations?',
    'Ищу бригаду для ремонта квартиры, посоветуйте мастера',
    'ვეძებ კომპანიას ბინის რემონტისთვის, მირჩიეთ',
    'Daire tadilatı için usta arıyorum, tavsiye?',
    'أبحث عن شركة لترميم شقتي',
    'מחפש קבלן לשיפוץ דירה, ממליצים?']) {
    const r = post(t);
    assert.equal(r.resultType, 'EXCLUDED', t);
    assert.equal(r.intent, 'RENOVATION_REQUEST', t);
  }
});

test('a buyer who wants a renovated apartment is still a buyer', () => {
  for (const t of ['I want to buy a 2-bedroom apartment in Krtsanisi with new renovation, budget $170,000',
    'Куплю квартиру с ремонтом в Крцаниси, бюджет до 180 000$',
    'ვიყიდი ბინას ახალი რემონტით კრწანისში']) {
    const r = post(t);
    assert.equal(r.resultType, 'DIRECT', t);
    assert.equal(r.intent, 'ACTIVE_BUYER', t);
  }
});

test('explicit buyer and tenant intent are DIRECT', () => {
  assert.equal(post('I want to buy a two-bedroom apartment in Krtsanisi').intent, 'ACTIVE_BUYER');
  assert.equal(post('ვიყიდი 2 საძინებლიან ბინას კრწანისში, ბიუჯეტი 160 000$').intent, 'ACTIVE_BUYER');
  assert.equal(post('Сниму квартиру в Ваке на длительный срок до 700$').intent, 'ACTIVE_TENANT');
});

test('price and viewing questions are INTEREST; one comment with two signals keeps both', () => {
  assert.equal(comment('How much is this apartment?').intent, 'PRICE_INQUIRY');
  assert.equal(comment('Can I view this apartment tomorrow?').intent, 'VIEWING_INQUIRY');
  const both = comment('How much is it, and can I visit tomorrow?');
  assert.equal(both.resultType, 'INTEREST');
  assert.deepEqual(both.signals.filter((s) => s === 'PRICE' || s === 'VIEWING').sort(), ['PRICE', 'VIEWING']);
  assert.equal(comment('Сколько стоит? Можно посмотреть?').resultType, 'INTEREST');
  assert.equal(comment('ფასი რა არის? ნახვა შეიძლება ხვალ?').resultType, 'INTEREST');
  assert.equal(comment('كم السعر؟ هل متاحة؟').resultType, 'INTEREST');
  assert.equal(comment('כמה עולה? אפשר לראות?').resultType, 'INTEREST');
  assert.equal(comment('Fiyat ne kadar? Görebilir miyim?').resultType, 'INTEREST');
});

test('general praise, already purchased, not looking and spam are excluded', () => {
  assert.equal(comment('Beautiful apartment!').intent, 'GENERAL_ENGAGEMENT');
  assert.equal(comment('ლამაზი ბინაა 😍').resultType, 'EXCLUDED');
  assert.equal(post('Already bought an apartment, thanks everyone').intent, 'ALREADY_PURCHASED');
  assert.equal(post('Уже купили квартиру, спасибо').intent, 'ALREADY_PURCHASED');
  assert.equal(post('უკვე ვიყიდე ბინა, მადლობა').intent, 'ALREADY_PURCHASED');
  assert.equal(post('I am not looking for an apartment anymore').intent, 'NOT_LOOKING');
  assert.equal(post('Не ищу квартиру больше, не актуально').intent, 'NOT_LOOKING');
  assert.equal(comment('Earn money from home with crypto, click the link').intent, 'SPAM');
});

test('a question under a buyer\'s request is not interest (it is a seller replying)', () => {
  const r = comment('I have one, how much is your budget?', { role: 'BUY_SEEKER', similarity: 70 });
  assert.notEqual(r.resultType, 'INTEREST');
  assert.notEqual(r.resultType, 'DIRECT');
});

test('signals are a set and irrelevant text says so', () => {
  assert.deepEqual(detectSignals('Is parking included? Price negotiable?').filter((s) => s !== 'PRICE').sort(), ['NEGOTIATION', 'PARKING_AMENITIES']);
  assert.deepEqual(detectSignals('see you at the match tonight'), ['IRRELEVANT']);
  assert.deepEqual(detectSignals(''), []);
});

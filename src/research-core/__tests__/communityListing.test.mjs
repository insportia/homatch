// PHASE 2 — community posts that offer property become supply observations.
// Fixtures follow real Telegram post shapes from production (2026-10-02),
// with addresses and contacts removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCommunityListing } from '../discovery/community-listing.ts';

test('a Batumi rental card: 1+1, floor/total, кв/м, USD per month, city from the community', () => {
  const l = extractCommunityListing('1+1, 11/15 этаж , 45 кв/м\n\n700 USD/месяц\n\nОплата: за первый и последний месяц\nСрок аренды: 12 месяцев\nБалкон', { sourceCity: 'Batumi' });
  assert.equal(l.transaction, 'RENT');
  assert.deepEqual(l.price, { amount: 700, currency: 'USD', period: 'MONTH' });
  assert.equal(l.areaSqm, 45);
  assert.equal(l.rooms, 2);
  assert.equal(l.bedrooms, 1);
  assert.equal(l.floor, 11);
  assert.equal(l.totalFloors, 15);
  assert.equal(l.city, 'batumi');
  assert.equal(l.origins.city, 'SOURCE_CONTEXT', 'the post never named the city');
});

test('a Georgian sale post names its own city and district', () => {
  const l = extractCommunityListing('იყიდება ბინა— ისანი, თბილისი\n\n💰 ფასი: $70,000\n📐 ფართობი: 55 მ²\n🏢 სართული: მე-13\n🏠 2 ოთახი | 1 საძინებელი');
  assert.equal(l.transaction, 'SALE');
  assert.equal(l.propertyType, 'APARTMENT');
  assert.equal(l.city, 'tbilisi');
  assert.equal(l.district, 'isani');
  assert.equal(l.origins.city, 'TEXT');
  assert.deepEqual(l.price, { amount: 70000, currency: 'USD', period: null });
  assert.equal(l.areaSqm, 55);
  assert.equal(l.rooms, 2);
  assert.equal(l.bedrooms, 1);
});

test('a studio with $ after the number and spelled-out area', () => {
  const l = extractCommunityListing('🌊 Сдаётся студия у моря\n💰 Аренда — 400$ / месяц\nплощадью 30 квадратных метров', { sourceCity: 'Batumi' });
  assert.equal(l.rooms, 1);
  assert.equal(l.bedrooms, 0);
  assert.equal(l.price.amount, 400);
  assert.equal(l.areaSqm, 30);
  assert.equal(l.propertyType, 'APARTMENT');
});

test('a prose rental with word-numbers and no price still stores when it has an area', () => {
  const l = extractCommunityListing('Сдаётся светлая трёхкомнатная квартира площадью 100 квадратных метров. Аренда рассчитана на 12 месяцев.', { sourceCity: 'Tbilisi' });
  assert.equal(l.rooms, 3);
  assert.equal(l.areaSqm, 100);
  assert.equal(l.price, null);
});

test('not a listing, or not enough to compare on: nothing is invented', () => {
  assert.equal(extractCommunityListing('Ищу квартиру в Ваке до 500$'), null, 'a request has no offer verb');
  assert.equal(extractCommunityListing('Сдаётся квартира, пишите в личку'), null, 'no place, no price, no area');
  assert.equal(extractCommunityListing('Сдаётся квартира 600$ в месяц'), null, 'no place from text or community');
  assert.equal(extractCommunityListing('hi'), null);
});

test('a year or a phone number is never read as a sale price', () => {
  const l = extractCommunityListing('Продаётся квартира в Батуми, дом сдан в 2019 году, 52 м²');
  assert.equal(l.price, null);
  assert.equal(l.areaSqm, 52);
});

test('a price written in words and a Georgian place in the locative case', () => {
  const ru = extractCommunityListing('Сдаётся уютная однокомнатная квартира в Батуми. Метраж — 51 квадратный метр. Стоимость аренды — 800 долларов в месяц.');
  assert.deepEqual(ru.price, { amount: 800, currency: 'USD', period: 'MONTH' });
  const ka = extractCommunityListing('🏡 იყიდება | ბინა ვაკეში, თბილისში\n💰 ფასი: $100,000\n📐 35 მ²\n🛏 1 საძინებელი\n🏢 მე-3 სართული (3/6)');
  assert.equal(ka.city, 'tbilisi');
  assert.equal(ka.district, 'vake');
  assert.equal(ka.bedrooms, 1);
});

test('a card with no offer verb, city only in hashtags', () => {
  const l = extractCommunityListing('2+1, 25/35 этаж , 76 кв/м\n\n1000 USD/месяц\n\n#domiko #АрендаБатуми #Batumi');
  assert.equal(l.transaction, 'RENT');
  assert.equal(l.city, 'batumi');
  assert.equal(l.bedrooms, 2);
  assert.equal(l.floor, 25);
});

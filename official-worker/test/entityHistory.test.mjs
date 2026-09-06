// entityHistory.test.mjs — entities/EntityHistory.ts, the pure text parsing
// behind the company name-history fix (2026-09 "report intelligence v2"
// mandate, Section 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPrimaryIdCode, extractPreviousCompanyNames } from '../.tstest-build/entities/EntityHistory.js';

test('extractPrimaryIdCode: finds the entity page\'s own identification code', () => {
  assert.equal(extractPrimaryIdCode('დასახელება: შპს მილენიო გრუპი\nსაიდენტიფიკაციო კოდი: 404670272\nსტატუსი: აქტიური'), '404670272');
});
test('extractPrimaryIdCode: null when not printed', () => {
  assert.equal(extractPrimaryIdCode('არაფერი აქ'), null);
});

test('extractPreviousCompanyNames: recognizes "ყოფილი დასახელება"', () => {
  const out = extractPreviousCompanyNames('მიმდინარე დასახელება: შპს მილენიო გრუპი\nყოფილი დასახელება: შპს ქეი-ელ გრუპი\nსაიდენტიფიკაციო კოდი: 404670272');
  assert.deepEqual(out, ['შპს ქეი-ელ გრუპი']);
});
test('extractPreviousCompanyNames: recognizes "წინანდელი სახელწოდება" and dedups repeats', () => {
  const out = extractPreviousCompanyNames('წინანდელი სახელწოდება: შპს ქეი-ელ გრუპი. მოგვიანებით კვლავ მოხსენიებულია წინანდელი სახელწოდება: შპს ქეი-ელ გრუპი.');
  assert.deepEqual(out, ['შპს ქეი-ელ გრუპი']);
});
test('extractPreviousCompanyNames: empty when nothing printed', () => {
  assert.deepEqual(extractPreviousCompanyNames('დასახელება: შპს მილენიო გრუპი, სტატუსი: აქტიური'), []);
});

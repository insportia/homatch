import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/* The pure visibility rule mirrors RLS mortgage_bank_products_public_read; read it from source so the test needs no client. */
const src = fs.readFileSync('src/services/mortgageBankProductsPublic.ts', 'utf8');
const body = src.slice(src.indexOf('export function isPubliclyCurrent'), src.indexOf('export async function listPublicBankProducts'));
const js = body.replace(/export function isPubliclyCurrent\([\s\S]*?\): boolean \{/, 'return function isPubliclyCurrent(row, today = new Date()) {');
const isPubliclyCurrent = new Function(js + '\n')();

const base = { review_status: 'VERIFIED', verified_at: '2026-10-01', review_due_days: 45, effective_from: null };
const day = new Date('2026-10-24T12:00:00Z');

test('only verified, current and started products reach the public', () => {
  assert.equal(isPubliclyCurrent(base, day), true);
  assert.equal(isPubliclyCurrent({ ...base, review_status: 'DRAFT' }, day), false, 'a draft never shows, even to an admin on the consumer page');
  assert.equal(isPubliclyCurrent({ ...base, review_status: 'RETIRED' }, day), false);
  assert.equal(isPubliclyCurrent({ ...base, verified_at: null }, day), false);
  assert.equal(isPubliclyCurrent({ ...base, verified_at: '2026-08-01' }, day), false, 'past its review window');
  assert.equal(isPubliclyCurrent({ ...base, effective_from: '2026-11-01' }, day), false, 'not yet in force');
});

test('the panel never ranks banks and says so when nothing is verified', () => {
  const ui = fs.readFileSync('src/components/mortgage/BankProductsPanel.tsx', 'utf8');
  assert.ok(ui.includes("'mortgage_bp_empty'"), 'an honest empty state');
  assert.ok(!/best|sort\(/i.test(ui.replace(/\/\/.*$/gm, '')), 'no ranking');
  assert.ok(ui.includes("source: 'BANK_PUBLISHED'"), 'an added product is marked as the bank published figure');
});

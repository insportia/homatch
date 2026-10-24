// Admin bank mortgage products: what an edit may write, when a product is public,
// and that every control on the screen reaches the table or an RPC.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  emptyBankProductForm, formFromRow, validateBankProductForm, editWrite, verifyWrite, allowedMoves,
  publicVisibility, isHttpsUrl, isIsoDate, ruleMoves,
} from '../mortgageBankProducts.ts';

const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');

const good = () => ({
  ...emptyBankProductForm(),
  bank_name: ' TBC Bank ', product_name: 'Home loan', currency: 'gel', rate_from_percent: '10,5', rate_to_percent: '13',
  rate_type: 'fixed', min_down_payment_percent: '15', min_term_months: '12', max_term_months: '240',
  source_url: 'https://www.tbcbank.ge/mortgage', review_due_days: '45',
});

test('a valid form becomes a typed payload', () => {
  const v = validateBankProductForm(good());
  assert.equal(v.ok, true);
  assert.deepEqual(v.payload, {
    bank_name: 'TBC Bank', product_name: 'Home loan', currency: 'GEL', rate_from_percent: 10.5, rate_to_percent: 13,
    rate_type: 'FIXED', effective_rate_from_percent: null, min_down_payment_percent: 15, min_term_months: 12, max_term_months: 240,
    source_url: 'https://www.tbcbank.ge/mortgage', effective_from: null, review_due_days: 45, notes: null,
  });
});

test('invalid fields are reported by i18n key', () => {
  const v = validateBankProductForm({
    ...good(), bank_name: '', source_url: 'http://bank.ge', rate_from_percent: '12', rate_to_percent: '8',
    min_term_months: '1.5', min_down_payment_percent: '120', effective_from: '2026-02-30', review_due_days: '0', currency: 'GE',
  });
  assert.equal(v.ok, false);
  assert.deepEqual(v.errors, {
    bank_name: 'admin_hs_bp_err_required', source_url: 'admin_hs_bp_err_https', rate_to_percent: 'admin_hs_bp_err_range',
    min_term_months: 'admin_hs_bp_err_months', min_down_payment_percent: 'admin_hs_bp_err_percent', effective_from: 'admin_hs_bp_err_date',
    review_due_days: 'admin_hs_bp_err_review_days', currency: 'admin_hs_bp_err_currency',
  });
});

test('editing a verified product sends it back to draft; new products are drafts', () => {
  const { payload } = validateBankProductForm(good());
  assert.equal(editWrite(null, payload).review_status, 'DRAFT');
  assert.equal(editWrite('VERIFIED', payload).review_status, 'DRAFT');
  assert.equal('review_status' in editWrite('DRAFT', payload), false);
});

test('verifying needs https and a date not in the future', () => {
  assert.deepEqual(verifyWrite('https://bog.ge/x ', '2026-10-20', '2026-10-24'),
    { ok: true, payload: { review_status: 'VERIFIED', verified_at: '2026-10-20', source_url: 'https://bog.ge/x' } });
  assert.deepEqual(verifyWrite('ftp://bog.ge', '2026-10-20', '2026-10-24'), { ok: false, error: 'admin_hs_bp_err_https' });
  assert.deepEqual(verifyWrite('https://bog.ge', '2026-10-25', '2026-10-24'), { ok: false, error: 'admin_hs_bp_err_future' });
  assert.deepEqual(verifyWrite('https://bog.ge', 'yesterday', '2026-10-24'), { ok: false, error: 'admin_hs_bp_err_date' });
});

test('public visibility mirrors the RLS policy', () => {
  const base = { review_status: 'VERIFIED', verified_at: '2026-10-01', review_due_days: 45, effective_from: null };
  assert.equal(publicVisibility(base, '2026-10-24'), 'SHOWN');
  assert.equal(publicVisibility(base, '2026-11-15'), 'SHOWN'); // verified_at + 45 = 2026-11-15 (>= today)
  assert.equal(publicVisibility(base, '2026-11-16'), 'STALE');
  assert.equal(publicVisibility({ ...base, effective_from: '2026-12-01' }, '2026-10-24'), 'NOT_STARTED');
  assert.equal(publicVisibility({ ...base, review_status: 'DRAFT' }, '2026-10-24'), 'DRAFT');
  assert.equal(publicVisibility({ ...base, review_status: 'RETIRED' }, '2026-10-24'), 'RETIRED');
});

test('status moves', () => {
  assert.deepEqual(allowedMoves('DRAFT'), ['verify', 'retire']);
  assert.deepEqual(allowedMoves('VERIFIED'), ['verify', 'retire']);
  assert.deepEqual(allowedMoves('RETIRED'), ['restore']);
  assert.deepEqual(ruleMoves('CANDIDATE'), ['ACTIVE', 'REJECTED']);
  assert.deepEqual(ruleMoves('ACTIVE'), []);
});

test('helpers', () => {
  assert.equal(isHttpsUrl('https://nbg.gov.ge/en'), true);
  assert.equal(isHttpsUrl('https://'), false);
  assert.equal(isIsoDate('2027-02-29'), false);
  assert.equal(isIsoDate('2028-02-29'), true);
  const f = formFromRow({ id: 'x', bank_name: 'B', product_name: 'P', currency: 'USD', rate_from_percent: 7, rate_to_percent: null,
    rate_type: null, effective_rate_from_percent: null, min_down_payment_percent: '20.00', min_term_months: null, max_term_months: 360,
    notes: null, source_url: 'https://b.ge', verified_at: null, effective_from: null, review_due_days: 30, review_status: 'DRAFT' });
  assert.equal(f.rate_from_percent, '7');
  assert.equal(f.rate_to_percent, '');
  assert.equal(f.review_due_days, '30');
  assert.equal(validateBankProductForm(f).ok, true);
});

test('every control is wired to the table or an audited RPC and reports failure', () => {
  const ui = read('src/components/admin/MortgageBankProductsAdmin.tsx');
  assert.match(ui, /from\('mortgage_bank_products'\)\.insert\(patch\)\.select\('id'\)/);
  assert.match(ui, /from\('mortgage_bank_products'\)\.update\(patch\)\.eq\('id', id\)\.select\('id'\)/);
  assert.match(ui, /if \(error \|\| !data\) \{ fail\(error\); return false; \}/, 'a write that matched nothing is a failure');
  assert.ok(!/\.delete\(/.test(ui), 'products are retired, never deleted');
  const page = read('src/pages/admin/AdminHomiServicesPage.tsx');
  assert.match(page, /supabase\.rpc\('mortgage_rule_admin_set_status'/);
  assert.ok(!/from\('mortgage_rules'\)\.update/.test(page), 'rule status changes go through the audited RPC');
  assert.match(page, /<MortgageBankProductsAdmin \/>/);
});

test('migration 092: admin-only writes, audited rule moves', () => {
  const sql = read('supabase/migrations/20261201092000_mortgage_readiness_and_bank_products.sql');
  assert.match(sql, /revoke all on public\.mortgage_bank_products from anon, authenticated;/);
  assert.match(sql, /grant insert, update on public\.mortgage_bank_products to authenticated;/);
  assert.ok(!/grant[^;]*delete[^;]*mortgage_bank_products/i.test(sql));
  assert.match(sql, /for insert with check \(public\.is_admin\(\)\)/);
  const fn = sql.slice(sql.indexOf('create or replace function public.mortgage_rule_admin_set_status'));
  assert.match(fn, /if not public\.is_admin\(\) then/);
  assert.match(fn, /if v_old\.status <> 'CANDIDATE' then/);
  assert.match(fn, /insert into public\.admin_audit_log/);
  assert.match(fn, /revoke all on function public\.mortgage_rule_admin_set_status\(uuid, text, text, text\) from public, anon;/);
});

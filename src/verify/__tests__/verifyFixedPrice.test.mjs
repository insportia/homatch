// verifyFixedPrice.test.mjs — one admin-editable Verify price, charged on delivery; 30-day validity
// (20261127090000_verify_fixed_price_validity.sql; owner decisions 2026-10-23).
// The money and expiry rules are proven in SQL (tests/sql/verify_fixed_price.sql); this file
// proves the code around them sends, shows and enforces the same thing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { creditsForCents, parseUsdToCents } from '../verifyPrice.ts';
import { publicBilling } from '../pauseResume.ts';

const code = (p) => readFileSync(fileURLToPath(new URL(`../../../${p}`, import.meta.url)), 'utf8');
const migration = code('supabase/migrations/20261127090000_verify_fixed_price_validity.sql');
const agent = code('supabase/functions/research-agent/index.ts');
const page = code('src/pages/VerifyPage.tsx');
const budget = code('src/components/verify/VerifyBudget.tsx');

test('USD → credits at 10 per dollar: whole credits accepted, anything else refused (never rounded)', () => {
  for (const [usd, credits] of [['0.90', 9], ['1.90', 19], ['2.50', 25], ['3.00', 30], ['5', 50], ['5.00', 50]]) {
    assert.equal(creditsForCents(parseUsdToCents(usd)), credits, usd);
  }
  assert.equal(creditsForCents(parseUsdToCents('1.95')), null, '19.5 credits is refused');
  for (const bad of ['', '0', '-1', 'abc', '1.999', '10000.01', '1,9.0']) assert.equal(creditsForCents(parseUsdToCents(bad)), null, bad);
  assert.equal(parseUsdToCents('1,90'), 190, 'a decimal comma is read');
});

test('the server is the authority: one price source, admin-only, audited, refused when not whole credits', () => {
  assert.match(migration, /set billing_mode = 'FIXED', standard_retail_cents = 190, pricing_version = pricing_version \+ 1/);
  assert.match(migration, /create or replace function public\.admin_set_verify_price\(p_cents numeric, p_reason text\)/);
  assert.match(migration, /where u\.auth_id = auth\.uid\(\) and u\.is_admin = true;\n\s+if v_admin is null and auth\.role\(\) <> 'service_role' then raise exception 'FORBIDDEN'/);
  assert.match(migration, /if v_credits <> trunc\(v_credits\) then raise exception 'PRICE_NOT_WHOLE_CREDITS'/);
  assert.match(migration, /'VERIFY_PRICE_UPDATED', 'billable_products', 'VERIFY'/);
  assert.match(migration, /select \* into v_old from public\.billable_products where code = 'VERIFY' for update;/);
  // No second price table: the price is billable_products.VERIFY.
  assert.doesNotMatch(migration, /create table[^;]*price/i);
});

test('each job keeps its own price; the start refuses a price the customer was not shown', () => {
  assert.match(migration, /insert into public\.verify_billing \(job_id, user_id, authorized_total_credits, price_mode, price_credits, price_cents, pricing_version\)/);
  assert.match(migration, /if v_is_fixed and v_count = 0 and p_expected_credits is not null and p_expected_credits <> v_b\.price_credits then/);
  assert.match(migration, /'reason', 'PRICE_CHANGED'/);
  assert.match(agent, /\.\.\.\(Number\.isFinite\(expected\) && expected > 0 \? \{ p_expected_credits: expected \} : \{\}\)/);
  assert.match(agent, /reason === 'PRICE_CHANGED' \? 409 : 503/);
  assert.match(page, /expectedCredits:launchQuote\?\.priceMode==='FIXED'\?launchQuote\.priceCredits\?\?undefined:undefined/);
  assert.match(page, /if\(body\?\.code==='PRICE_CHANGED'\)\{const q=await loadLaunchQuote\(\);if\(q\)\{setLaunchQuote\(\{\.\.\.q,priceChanged:true\}\);setLaunchOpen\(true\);return\}\}/);
});

test('charged only on delivery; never paused for budget; jobs opened before keep their own rules', () => {
  assert.match(migration, /if v_b\.price_mode = 'FIXED' then\n\s+return jsonb_build_object\('decision', 'GO'/);
  assert.match(migration, /-- Not delivered \(stopped, partial, failed\): the customer pays nothing\.\n\s+if p_outcome <> 'COMPLETE' then/);
  assert.match(migration, /v_charge := round\(least\(greatest\(v_b\.price_credits - v_s\.charged_before, 0\), v_s\.reserved_credits\), 4\);/);
  assert.match(migration, /\/\* ---- cost-based \(jobs opened before the fixed price\) ---- \*\//);
});

test('V1 and V2 share the price: nothing in the billing open depends on the engine', () => {
  const start = agent.slice(agent.indexOf('RESERVE BEFORE ANY BILLABLE WORK'), agent.indexOf("const first = advanceExclusive(sb, key, model, j, lang)"));
  assert.ok(start.length > 200);
  assert.doesNotMatch(start, /engine|_engine|V2/);
  assert.doesNotMatch(migration, /_engine|engine/);
});

test('the frontend never decides the price: it shows the server quote and the job billing', () => {
  // A price would sit next to a currency or credits word; dates and ids do not.
  for (const src of [page, budget]) assert.doesNotMatch(src, /\$\s?1\.90|\b(19|190)\s*(credits?|კრედიტ|cents)|(credits?|priceCredits|maxCredits)\s*[:=]\s*(19|190)\b/i, 'a hard-coded price in the customer UI');
  assert.match(budget, /t\(fixed \? 'verify_price_label' : 'verify_budget_required'\)/);
  assert.match(budget, /fixed \? t\('verify_price_note', \{ days: String\(quote\?\.validityDays \?\? 30\) \}\) : t\('verify_budget_note'\)/);
  assert.match(budget, /return billing\?\.priceMode === 'FIXED' \? <FixedPriceLine billing=\{billing\} \/> : <LiveBudgetLine billing=\{billing\} \/>;/);
  const b = publicBilling({ state: 'ACTIVE', priceMode: 'FIXED', priceCredits: 19, priceCents: 190, validityDays: 30, chargedTotal: 0, authorizedTotal: 19 });
  assert.deepEqual([b.priceMode, b.priceCredits, b.priceCents, b.validityDays, b.canExtend], ['FIXED', 19, 190, 30, false]);
  assert.equal(publicBilling({ state: 'ACTIVE' }).priceMode, 'VARIABLE');
});

test('30-day validity: registered on delivery from completed_at, only after the cutover, never for contracts', () => {
  assert.match(migration, /if new\.synthesis_state = 'READY' and new\.status = 'COMPLETE' and new\.completed_at is not null/);
  assert.match(migration, /values \('VERIFY_REPORT', new\.id, new\.user_id, new\.completed_at, public\.retention_expiry\(new\.completed_at\), 'STANDARD_30D'/);
  assert.match(migration, /if v_effective is not null and new\.completed_at >= v_effective then/);
  assert.match(migration, /on conflict \(product, source_id\) do nothing;/);
  // The global retention switch also governs contract documents: it is not touched.
  assert.doesNotMatch(migration, /key\s*=\s*'storage_retention'|values \('storage_retention'/);
  assert.doesNotMatch(migration, /delete from public\.research_jobs|purge/i);
});

test('an expired report shows no content and offers a fresh run; a valid one shows its date', () => {
  assert.match(page, /if\(body\?\.code==='REPORT_EXPIRED'\)\{again=false;stop\(\);setLoading\(false\);setPollNotice\(null\);setReport\(null\);setSynthesis\(null\);setCaptcha\(null\);forgetCachedReport\(sessionStore\(\),id\);setExpired\(true\);/);
  assert.match(page, /\{expired&&!loading&&<VerifyReportExpired /);
  assert.match(page, /params\.delete\('job'\)/, 'the new run starts fresh, not on the expired job');
  assert.match(page, /<VerifyBudgetSummary billing=\{billing\}\/><VerifyReportValidity jobId=\{jobId\}\/>/);
  const validity = code('src/components/verify/VerifyReportValidity.tsx');
  assert.match(validity, /supabase\.rpc\('retention_my_records', \{ p_product: 'VERIFY_REPORT', p_source_ids: \[jobId\] \}\)/);
  // The server enforces it: the status read refuses an expired report before anything is returned.
  assert.match(code('supabase/functions/_shared/retentionGuard.ts'), /respond\(\{ error: 'report_expired', code: 'REPORT_EXPIRED' \}, 410\)/);
});

test('admin: the price card sits on Pricing Configuration; the V1/V2 routing card is untouched', () => {
  const pricing = code('src/pages/admin/AdminPricingPage.tsx');
  assert.match(pricing, /<SectionBoundary name="admin-verify-price">\n\s+<VerifyPriceCard \/>/);
  const card = code('src/components/admin/VerifyPriceCard.tsx');
  assert.match(card, /setVerifyPrice\(cents, reason\.trim\(\)\)/);
  assert.match(card, /confirmDisabled=\{reason\.trim\(\)\.length < 3\}/);
  assert.doesNotMatch(code('src/components/admin/VerifyEngineCard.tsx'), /price/i);
});

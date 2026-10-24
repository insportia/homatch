// Home Financing buyer intent lives in HOMATCH Matching, not in a marketplace of its own.
//
// Source-level guards for the architecture and value-based pricing the owner set on 2026-10-25:
// an opt-in becomes one ordinary member search the Matching engine scores; Matching shows the
// person beside the other leads, priced for this listing by the evidence (mortgage interest only
// 3; with their own matching search 5; existing prices otherwise), with the reasons; the existing
// unlock charges once per account and person; nothing is sold or unlocked from Home Financing. The
// behaviour itself is proven on PostgreSQL 17 against the production schema (see PROJECT_STATE).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const MIG = read('supabase/migrations/20261201093000_mortgage_workspace_and_buyer_leads.sql');
const body = (name) => {
  const a = MIG.indexOf(`function public.${name}(`);
  assert.ok(a >= 0, `${name} is defined`);
  return MIG.slice(a, MIG.indexOf('$$;', a));
};

test('two products, 30 and 50 cents, and no other product or price is touched', () => {
  const inserts = [...MIG.matchAll(/insert into public\.billable_products[\s\S]*?on conflict \(code\) do nothing;/g)];
  assert.equal(inserts.length, 1);
  assert.match(inserts[0][0], /'INTERNAL_LEAD_MORTGAGE'[\s\S]*?true,\s*30,\s*0,/);
  assert.match(inserts[0][0], /'INTERNAL_LEAD_MORTGAGE_MATCH'[\s\S]*?true,\s*50,\s*0,/);
  assert.doesNotMatch(MIG, /update public\.billable_products/i, 'no existing product is changed');
  const prices = body('internal_lead_prices');
  for (const code of ['INTERNAL_LEAD_STANDARD', 'INTERNAL_LEAD_EXACT', 'INTERNAL_LEAD_PREMIUM', 'INTERNAL_LEAD_MORTGAGE', 'INTERNAL_LEAD_MORTGAGE_MATCH']) assert.ok(prices.includes(`'${code}'`), code);
  assert.ok(!/function public\.internal_lead_segment\(|function public\.internal_lead_price_key\(/.test(MIG), 'the production segment and price-key functions are not redefined');
  assert.match(prices, /'mortgageActive'/, 'turning the mortgage segment off never stops the other three');
});

test('price by evidence: mortgage only 3, with a matching search 5, a signal never lowers a price', () => {
  const p = body('internal_lead_member_price');
  assert.match(p, /when m\.yes and s\.key = 'PREMIUM' then 'PREMIUM'/);
  assert.match(p, /when m\.yes and s\.key is not null then 'MORTGAGE_MATCH'/);
  assert.match(p, /when m\.yes then 'MORTGAGE'/);
  assert.match(p, /else coalesce\(s\.key, 'STANDARD'\)/, 'everyone else keeps the existing key');
  for (const r of ['HIGH_BUDGET', 'MORTGAGE_INTEREST', 'EXACT_SEARCH_MATCH', 'SEARCH_MATCH']) assert.ok(p.includes(`'${r}'`), r);
  assert.match(body('internal_lead_pick'), /internal_lead_member_price\(p_user_id, x\.property_id, x\.demand_user_id\)/, 'the quote and the unlock use the same price');
});

test('the unlock is the existing one, with the mortgage segments and a price guard', () => {
  const unlock = body('internal_leads_unlock');
  assert.match(unlock, /array\['STANDARD', 'EXACT', 'PREMIUM', 'MORTGAGE', 'MORTGAGE_MATCH'\]/);
  assert.match(unlock, /if p_expected_credits is not null and v_due > p_expected_credits then raise exception 'PRICE_CHANGED'/);
  assert.match(MIG, /drop function if exists public\.internal_leads_unlock\(uuid, uuid\[\], text\);/, 'one signature, so callers are never ambiguous');
  assert.match(unlock, /wallet_reserve\(p_user_id, 'INTERNAL_LEAD_' \|\| v_seg/);
  assert.match(unlock, /pg_advisory_xact_lock\(hashtextextended\('internal_lead_unlock:'/, 'same per-account lock');
  assert.match(unlock, /internal_lead_unlock_batches b\s+where b\.account_user_id = p_user_id and b\.idempotency_key = p_idempotency_key/, 'same idempotency');
  assert.match(MIG, /check \(segment in \('STANDARD', 'EXACT', 'PREMIUM', 'MORTGAGE', 'MORTGAGE_MATCH'\)\)/);
  assert.match(unlock, /exists \(select 1 from public\.internal_lead_unlocks u where u\.account_user_id = p_user_id and u\.lead_user_id = p\.lead_user_id\)/, 'one person, one payment per account, read under the lock');
  assert.ok(read('supabase/functions/atomic-unlock/index.ts').includes('p_expected_credits: parsed.expectedCredits'), 'the edge passes the confirmed total');
});

test('no marketplace of its own: no mortgage feed, unlock or contact functions, no mortgage unlock kind', () => {
  for (const gone of ['mortgage_buyer_leads_feed', 'mortgage_leads_unlock', 'mortgage_lead_contact', 'mortgage_lead_rows', 'mortgage_lead_unlock_batches', 'public_ref']) {
    assert.ok(!MIG.includes(gone), gone);
  }
  assert.ok(!read('supabase/functions/atomic-unlock/index.ts').includes('mortgage_leads'));
  assert.ok(!fs.existsSync('src/components/matching/workspace/MortgageBuyersSection.tsx'));
  for (const f of ['src/pages/MortgagePage.tsx', 'src/components/mortgage/MortgageLeadOptIn.tsx', 'src/services/mortgageLeads.ts']) {
    const src = read(f);
    assert.ok(!/atomic-unlock|internal_leads_unlock|unlockLeads|unlockInternal/.test(src), `${f} never unlocks or charges`);
  }
});

test('an opt-in is one ordinary member search the engine scores, and withdrawal deletes it', () => {
  const sync = body('mortgage_intent_sync_matching');
  assert.match(sync, /insert into public\.intent_profiles/);
  assert.match(sync, /'BUY', 'GE', v_city, v_district, 'SALE'/);
  assert.match(sync, /'mortgage-optin-1'/);
  assert.match(sync, /\(p_user_id, v_profile, 'SUPPLY', true, 'MORTGAGE'/, 'side SUPPLY like Find Property, demand_source MORTGAGE');
  assert.match(sync, /delete from public\.intent_profiles where id = v_i\.intent_profile_id/, 'withdrawal removes the search and, by cascade, its matches');
  assert.match(body('withdraw_my_mortgage_buyer_intent'), /perform public\.mortgage_intent_sync_matching\(v_me\)/);
  assert.match(body('set_my_mortgage_buyer_intent'), /perform public\.mortgage_intent_sync_matching\(v_me\)/);
  assert.ok(read('supabase/functions/supply-matching/index.ts').includes("'mortgage-optin-1'"), 'the worker names the origin to the buyer');
});

test('the Matching feeds price, label and describe it, and never read the mortgage calculation', () => {
  for (const fn of ['internal_leads_feed', 'internal_leads_feed_v2']) {
    const f = body(fn);
    assert.match(f, /'origin', case when p?g?\.has_mortgage and p?g?\.has_search then 'MORTGAGE_AND_SEARCH' when p?g?\.has_mortgage then 'MORTGAGE' else 'SEARCH' end/);
    assert.match(f, /'priceReasons', to_jsonb\(p?g?\.price_reasons\)/);
    assert.match(f, /internal_lead_member_price\(v_me, p_property_id, r\.lead_user_id\)/);
    assert.match(f, /'thisListing'/); assert.match(f, /'calculatorUse'/);
    assert.ok(!/mortgage_scenarios|income|debt|salary|guarantor|residen/i.test(f), `${fn} reads nothing financial`);
    assert.match(f, /'MORTGAGE', count\(\*\) filter \(where has_mortgage\)/);
  }
});

test('the opt-in tells the person where they now are, and the consent version changed with the wording', () => {
  const ui = read('src/components/mortgage/MortgageLeadOptIn.tsx');
  assert.ok(ui.includes('/privacy#matching'), 'the consent links to how the data is used');
  assert.ok(ui.includes('needsArea'), 'the area is asked only when nothing gives it');
  assert.ok(ui.includes("t('mortgage_lead_in_matching')") && ui.includes("t('mortgage_lead_need_area')") && ui.includes("t('mortgage_lead_offers_off')"));
  assert.match(read('src/services/mortgageLeads.ts'), /MORTGAGE_LEAD_CONSENT_VERSION = 'mbl-2026-10-25-matching'/);
});

// Home Financing buyer intent lives in HOMATCH Matching, not in a marketplace of its own.
//
// Source-level guards for the architecture the owner set on 2026-10-25: an opt-in becomes one
// ordinary member search the Matching engine scores; Matching shows it beside the other buyer
// leads and unlocks it at the MORTGAGE price (3 credits) through the existing unlock; nothing is
// sold or unlocked from Home Financing; the other HOMATCH Leads prices are untouched. The
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

test('one product, 30 cents = 3 credits, and no other product or price is touched', () => {
  const inserts = [...MIG.matchAll(/insert into public\.billable_products[\s\S]*?on conflict \(code\) do nothing;/g)];
  assert.equal(inserts.length, 1);
  assert.match(inserts[0][0], /'INTERNAL_LEAD_MORTGAGE'[\s\S]*?true,\s*30,\s*0,/);
  assert.doesNotMatch(MIG, /update public\.billable_products/i, 'no existing product is changed');
  const prices = body('internal_lead_prices');
  for (const code of ['INTERNAL_LEAD_STANDARD', 'INTERNAL_LEAD_EXACT', 'INTERNAL_LEAD_PREMIUM', 'INTERNAL_LEAD_MORTGAGE']) assert.ok(prices.includes(`'${code}'`), code);
  assert.match(prices, /'mortgageActive'/, 'turning the mortgage segment off never stops the other three');
});

test('the unlock is the existing one, with the MORTGAGE segment added', () => {
  const unlock = body('internal_leads_unlock');
  assert.match(unlock, /array\['STANDARD', 'EXACT', 'PREMIUM', 'MORTGAGE'\]/);
  assert.match(unlock, /wallet_reserve\(p_user_id, 'INTERNAL_LEAD_' \|\| v_seg/);
  assert.match(unlock, /pg_advisory_xact_lock\(hashtextextended\('internal_lead_unlock:'/, 'same per-account lock');
  assert.match(unlock, /internal_lead_unlock_batches b\s+where b\.account_user_id = p_user_id and b\.idempotency_key = p_idempotency_key/, 'same idempotency');
  assert.match(MIG, /check \(segment in \('STANDARD', 'EXACT', 'PREMIUM', 'MORTGAGE'\)\)/);
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
    assert.match(f, /'origin', case when p?g?\.segment = 'MORTGAGE' then 'MORTGAGE' else 'SEARCH' end/);
    assert.match(f, /'thisListing'/); assert.match(f, /'calculatorUse'/);
    assert.ok(!/mortgage_scenarios|income|debt|salary|guarantor|residen/i.test(f), `${fn} reads nothing financial`);
    assert.match(f, /'MORTGAGE', count\(\*\) filter \(where segment = 'MORTGAGE'\)/);
  }
  assert.match(body('internal_leads_feed_v2'), /when seg\.segment = 'MORTGAGE' then 'MORTGAGE'/);
  assert.match(body('internal_lead_segment'), /return query select 'MORTGAGE'::text/);
  assert.match(body('internal_lead_price_key'), /when 'MORTGAGE' then 'MORTGAGE'/);
});

test('the opt-in tells the person where they now are, and the consent version changed with the wording', () => {
  const ui = read('src/components/mortgage/MortgageLeadOptIn.tsx');
  assert.ok(ui.includes("t('mortgage_lead_in_matching')") && ui.includes("t('mortgage_lead_need_area')") && ui.includes("t('mortgage_lead_offers_off')"));
  assert.match(read('src/services/mortgageLeads.ts'), /MORTGAGE_LEAD_CONSENT_VERSION = 'mbl-2026-10-25-matching'/);
});

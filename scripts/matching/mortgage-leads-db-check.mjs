// PGlite behaviour test for 20261201093000_mortgage_workspace_and_buyer_leads.sql on production-shaped stubs:
// no consent means no lead, one buyer per person however often they recalculate, a preview without
// identity or finances, exactly-once unlock (retry, new key, other listing, mixed selection, an earlier
// internal unlock), price refusal, cross-account isolation, rollback on insufficient credits, contact
// limited to the channels the buyer chose, and withdrawal ending exposure and contact.
//
//   npm i --no-save @electric-sql/pglite@0.2      (or point the 2nd argument at a folder that has it)
//   node scripts/matching/mortgage-leads-db-check.mjs . [<folder with node_modules>]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PGlite } = process.argv[3]
  ? require(process.argv[3] + '/node_modules/@electric-sql/pglite/dist/index.cjs')
  : require('@electric-sql/pglite');
import assert from 'node:assert/strict';
const root = process.argv[2];
const sql = readFileSync(`${root}/supabase/migrations/20261201093000_mortgage_workspace_and_buyer_leads.sql`, 'utf8');
const db = new PGlite();
const one = async (s, p) => (await db.query(s, p)).rows[0];

await db.exec(`
  create schema auth;
  create role anon; create role authenticated; create role service_role;
  create table auth_ctx(uid uuid, role text);
  create function auth.uid() returns uuid language sql stable as $$ select uid from auth_ctx limit 1 $$;
  create function auth.role() returns text language sql stable as $$ select coalesce((select role from auth_ctx limit 1),'anon') $$;
  create table public.users (id uuid primary key default gen_random_uuid(), auth_id uuid, is_admin boolean default false,
    nickname text, full_name text, phone text, email text, preferred_language text default 'ka', suspended_at timestamptz);
  create function public.current_homatch_user_id() returns uuid language sql stable as $$ select id from public.users where auth_id = auth.uid() $$;
  create function public.is_admin() returns boolean language sql stable as $$ select coalesce((select is_admin from public.users where auth_id = auth.uid()), false) $$;
  create table public.mortgage_scenarios (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id), input jsonb, result jsonb);
  create table public.properties (id uuid primary key default gen_random_uuid(), user_id uuid references public.users(id), property_type text, is_deleted boolean default false);
  create table public.property_facts (property_id uuid references public.properties(id), city text, district text, total_price numeric, currency text);
  create table public.billable_products (code text primary key, name text, billing_mode text, requires_reservation boolean, standard_retail_cents integer,
    reference_landed_cogs_cents integer, min_gross_margin_bps integer, estimate_strategy text, enabled boolean, pricing_active boolean, kill_switch boolean default false,
    sort_order integer, config jsonb, min_viable_budget_credits integer, updated_at timestamptz);
  insert into public.billable_products (code, standard_retail_cents, enabled, pricing_active) values ('INTERNAL_LEAD_STANDARD', 30, true, true);
  create function public.billing_setting_num(k text, d numeric) returns numeric language sql stable as $$ select d $$;
  create table public.usage_reservations (id uuid primary key default gen_random_uuid(), idempotency_key text unique);
  create table public.credit_accounts (user_id uuid primary key, balance numeric not null);
  create table public.ledger (user_id uuid, product text, credits numeric, key text);
  create function public.wallet_reserve(p_user uuid, p_product text, p_est numeric, p_key text, a numeric, b numeric, c text, d jsonb)
  returns table(reservation_id uuid) language plpgsql as $$
  declare v uuid; bal numeric;
  begin
    select id into v from public.usage_reservations where idempotency_key = p_key;
    if found then return query select v; return; end if;
    select balance into bal from public.credit_accounts where user_id = p_user for update;
    if bal is null or bal < p_est then raise exception 'INSUFFICIENT_CREDITS'; end if;
    update public.credit_accounts set balance = balance - p_est where user_id = p_user;
    insert into public.usage_reservations(idempotency_key) values (p_key) returning id into v;
    insert into public.ledger values (p_user, p_product, p_est, p_key);
    return query select v;
  end $$;
  create function public.wallet_settle(r uuid, n numeric, m jsonb, s text) returns void language sql as $$ select $$;
  create table public.internal_lead_unlocks (
    id uuid primary key default gen_random_uuid(), account_user_id uuid not null references public.users(id), lead_user_id uuid not null references public.users(id),
    first_match_id uuid, first_property_id uuid, segment text not null, unit_price_credits numeric(12,4) not null, credits_charged numeric(12,4) not null,
    reservation_id uuid, batch_id uuid, created_at timestamptz not null default now());
  create unique index internal_lead_unlocks_account_lead on public.internal_lead_unlocks (account_user_id, lead_user_id);
  alter table public.internal_lead_unlocks add constraint internal_lead_unlocks_segment_check check (segment in ('STANDARD','EXACT','PREMIUM'));
  create function public.matching_maintenance_on() returns boolean language sql stable as $$ select false $$;
  create function public.matching_service_on(s text) returns boolean language sql stable as $$ select true $$;
  create table public.lead_contact_preferences (user_id uuid primary key, accept_property_offers boolean default true);
  create function public.lead_contact_prefs_of(u uuid) returns table(accept_property_offers boolean) language sql stable as $$
    select coalesce((select accept_property_offers from public.lead_contact_preferences where user_id = u), true) $$;
  create table public.conversation_blocks (blocker_id uuid, blocked_id uuid);
  create table public.contact_disclosures (viewer_user_id uuid, subject_user_id uuid, property_id uuid, relationship_kind text, relationship_id uuid);
`);
await db.exec(sql);
await db.exec(sql); // idempotent
console.log('migration applied twice');

const as = async (uid, role = 'authenticated') => { await db.query('delete from auth_ctx'); await db.query('insert into auth_ctx values ($1,$2)', [uid, role]); };
const mk = async (name, auth) => (await one(`insert into public.users (auth_id, nickname, full_name, phone, email) values ($1,$2,$2||' Surname','+995555000111',$2||'@x.ge') returning id`, [auth, name])).id;
const A_AUTH = '00000000-0000-0000-0000-00000000000a', B_AUTH = '00000000-0000-0000-0000-00000000000b', S_AUTH = '00000000-0000-0000-0000-00000000000c', S2_AUTH = '00000000-0000-0000-0000-00000000000d';
const buyer = await mk('Nino', A_AUTH);
const buyer2 = await mk('Giorgi', B_AUTH);
const seller = await mk('Seller', S_AUTH);
const seller2 = await mk('Seller2', S2_AUTH);
await db.query('insert into public.credit_accounts values ($1, 100), ($2, 100)', [seller, seller2]);
const prop = (await one(`insert into public.properties (user_id, property_type) values ($1,'APARTMENT') returning id`, [seller])).id;
await db.query(`insert into public.property_facts values ($1,'Tbilisi','Vake',120000,'GEL')`, [prop]);
const prop2 = (await one(`insert into public.properties (user_id, property_type) values ($1,'APARTMENT') returning id`, [seller])).id;
await db.query(`insert into public.property_facts values ($1,'Tbilisi','Saburtalo',110000,'GEL')`, [prop2]);
const propB = (await one(`insert into public.properties (user_id, property_type) values ($1,'APARTMENT') returning id`, [seller2])).id;
await db.query(`insert into public.property_facts values ($1,'Tbilisi','Vake',125000,'GEL')`, [propB]);

// A person who calculated a mortgage but did not opt in is invisible.
await db.query(`insert into public.mortgage_scenarios (user_id, input, result) values ($1, '{"income":5000}', '{}')`, [buyer]);
await as(S_AUTH);
let feed = (await one('select public.mortgage_buyer_leads_feed($1) f', [prop])).f;
assert.equal(feed.items.length, 0, 'no consent, no lead');
assert.equal(Number(feed.price.credits), 3, '$0.30 = 3 credits at 10 credits per USD');
assert.equal(feed.price.cents, 30);

// Opt-in needs at least one channel.
await as(A_AUTH);
await assert.rejects(db.query(`select public.set_my_mortgage_buyer_intent('{"city":"Tbilisi"}', 'mbl-1')`), /CHANNEL_REQUIRED/);
await db.query(`select public.set_my_mortgage_buyer_intent($1, 'mbl-1')`, [JSON.stringify({ city: 'Tbilisi', propertyTypes: ['apartment'], budgetMax: 130400, currency: 'GEL', sharePhone: true, salary: 9999, debts: 5 })]);
// Recalculating many times keeps ONE buyer.
for (let i = 0; i < 5; i++) await db.query(`select public.set_my_mortgage_buyer_intent($1, 'mbl-1')`, [JSON.stringify({ city: 'Tbilisi', budgetMax: 130000 + i, currency: 'GEL', sharePhone: true })]);
assert.equal(Number((await one('select count(*) n from public.mortgage_buyer_intents')).n), 1, 'one identity per person');
assert.equal((await one('select signal_count from public.mortgage_buyer_intents')).signal_count, 6);
assert.equal(Number((await one('select budget_max from public.mortgage_buyer_intents')).budget_max), 130000, 'budget rounded to 1000');
await as(B_AUTH);
await db.query(`select public.set_my_mortgage_buyer_intent($1, 'mbl-1')`, [JSON.stringify({ city: 'Tbilisi', budgetMax: 200000, currency: 'GEL', shareEmail: true })]);

await as(S_AUTH);
feed = (await one('select public.mortgage_buyer_leads_feed($1) f', [prop])).f;
assert.equal(feed.items.length, 2);
const text = JSON.stringify(feed);
for (const banned of ['Nino', 'Giorgi', '+995', '@x.ge', 'salary', 'income', '9999', 'debt', buyer, buyer2]) assert.ok(!text.includes(banned), `preview leaks ${banned}`);
const refNino = feed.items.find((i) => Number(i.budgetMax) === 130000).ref;
const refGio = feed.items.find((i) => Number(i.budgetMax) === 200000).ref;

// Another seller cannot read this listing's feed.
await as(S2_AUTH);
await assert.rejects(db.query('select public.mortgage_buyer_leads_feed($1)', [prop]), /not found/);

// Only the service role may unlock.
await as(S_AUTH);
await assert.rejects(db.query(`select public.mortgage_leads_unlock($1,$2,$3,'k-00000001',3)`, [seller, prop, [refNino]]), /FORBIDDEN/);

await as(null, 'service_role');
const unlock = async (acct, p, refs, key, expected) => (await one('select public.mortgage_leads_unlock($1,$2,$3,$4,$5) r', [acct, p, refs, key, expected])).r;
const bal = async (u) => Number((await one('select balance from public.credit_accounts where user_id=$1', [u])).balance);

await assert.rejects(unlock(seller, prop, [refNino, refGio], 'k-price-01', 3), /PRICE_CHANGED/, 'charge above confirmed total refused');
let r = await unlock(seller, prop, [refNino, refNino], 'k-first-001', 3);
assert.equal(Number(r.chargedCredits), 3); assert.equal(await bal(seller), 97);
r = await unlock(seller, prop, [refNino], 'k-first-001', 3);
assert.equal(r.duplicate, true); assert.equal(await bal(seller), 97, 'retry with same key charges nothing');
r = await unlock(seller, prop, [refNino], 'k-second-01', 3);
assert.equal(Number(r.chargedCredits), 0); assert.equal(r.alreadyUnlocked.length, 1); assert.equal(await bal(seller), 97, 'new key, same buyer: no charge');
r = await unlock(seller, prop2, [refNino], 'k-other-prop', 3);
assert.equal(Number(r.chargedCredits), 0); assert.equal(await bal(seller), 97, 'same buyer on another listing: no charge');
r = await unlock(seller, prop, [refNino, refGio], 'k-mixed-001', 3);
assert.equal(Number(r.chargedCredits), 3); assert.equal(await bal(seller), 94, 'only the new buyer is charged');
assert.equal(Number((await one(`select count(*) n from public.internal_lead_unlocks where account_user_id=$1`, [seller])).n), 2);
// A second account pays independently and gets no access through the first.
await assert.rejects(unlock(seller2, prop, [refNino], 'k-s2-00001', 3), /NOT_FOUND/, 'cannot unlock through a listing it does not own');
r = await unlock(seller2, propB, [refNino], 'k-s2-00002', 3);
assert.equal(Number(r.chargedCredits), 3); assert.equal(await bal(seller2), 97);
// Insufficient credits rolls back everything.
await db.query('update public.credit_accounts set balance = 1 where user_id = $1', [seller2]);
await assert.rejects(unlock(seller2, propB, [refGio], 'k-s2-00003', 3), /INSUFFICIENT_CREDITS/);
assert.equal(Number((await one(`select count(*) n from public.internal_lead_unlocks where account_user_id=$1`, [seller2])).n), 1);
// An existing internal STANDARD unlock already covers the buyer.
await db.query('update public.credit_accounts set balance = 50 where user_id = $1', [seller2]);
await db.query(`insert into public.internal_lead_unlocks (account_user_id, lead_user_id, segment, unit_price_credits, credits_charged) values ($1,$2,'STANDARD',3,3)`, [seller2, buyer2]);
r = await unlock(seller2, propB, [refGio], 'k-s2-00004', 3);
assert.equal(Number(r.chargedCredits), 0, 'unlocked earlier as an internal lead: not charged again');

// Contact: entitled account sees only what the buyer chose to share; others are refused.
await as(S_AUTH);
let c = (await one('select public.mortgage_lead_contact($1) c', [refNino])).c;
assert.equal(c.restricted, false); assert.equal(c.phone, '+995555000111'); assert.equal(c.email, null, 'email not shared');
assert.ok(!JSON.stringify(c).includes('income'));
const unlocked = (await one('select public.mortgage_buyer_leads_feed($1) f', [prop])).f.items.find((i) => i.ref === refNino);
assert.equal(unlocked.unlocked, true);
await db.query(`delete from auth_ctx`); await db.query(`insert into public.users (auth_id) values ('00000000-0000-0000-0000-0000000000ee')`); await as('00000000-0000-0000-0000-0000000000ee');
await assert.rejects(db.query('select public.mortgage_lead_contact($1)', [refNino]), /not unlocked/);

// Withdrawal ends exposure and contact; the old ref is dead.
await as(A_AUTH);
await db.query('select public.withdraw_my_mortgage_buyer_intent()');
await as(S_AUTH);
c = (await one('select public.mortgage_lead_contact($1) c', [refNino])).c;
assert.equal(c.restricted, true); assert.equal(c.reason, 'WITHDRAWN');
feed = (await one('select public.mortgage_buyer_leads_feed($1) f', [prop])).f;
assert.ok(!feed.items.some((i) => i.ref === refNino), 'withdrawn buyer is not exposed');
assert.equal(Number((await one(`select count(*) n from public.mortgage_buyer_consent_events where action='WITHDRAWN'`)).n), 1);

// Clients cannot write the intent table directly.
await db.query('set role authenticated');
await assert.rejects(db.query(`insert into public.mortgage_buyer_intents (user_id,status,consent_version,consented_at) values ($1,'ACTIVE','x',now())`, [seller]), /permission denied/);
await assert.rejects(db.query('select * from public.mortgage_lead_unlock_batches'), /permission denied/);
await db.query('reset role');
console.log('ALL MORTGAGE LEAD CHECKS PASSED');

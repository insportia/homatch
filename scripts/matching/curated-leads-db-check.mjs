// PGlite behaviour test for 20261128090000_curated_leads_marketplace.sql on production-shaped stubs:
// import (stage → fix → commit), publication rules, masked catalog, filters, quote, idempotent
// all-or-nothing unlock, the shared-catalog rule (A's purchase never removes a lead for B), the
// CRM handoff and its consent rule, the four independent switches, internal feed filters.
//
//   npm i --no-save @electric-sql/pglite@0.2      (or point the 2nd argument at a folder that has it)
//   node scripts/matching/curated-leads-db-check.mjs . [<folder with node_modules>]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const ROOT = process.argv[2];
const require = createRequire(import.meta.url);
const { PGlite } = process.argv[3]
  ? require(process.argv[3] + '/node_modules/@electric-sql/pglite/dist/index.cjs')
  : require('@electric-sql/pglite');
const PREV = readFileSync(ROOT + '/supabase/migrations/20261126090000_find_buyers_leads_crm.sql', 'utf8');
const MIGRATION = readFileSync(ROOT + '/supabase/migrations/20261128090000_curated_leads_marketplace.sql', 'utf8');
const db = new PGlite();
const A = '00000000-0000-0000-0000-0000000000a1', B = '00000000-0000-0000-0000-0000000000b1', ADM = '00000000-0000-0000-0000-0000000000ad';
const UA = '10000000-0000-0000-0000-0000000000a1', UB = '10000000-0000-0000-0000-0000000000b1', UADM = '10000000-0000-0000-0000-0000000000ad';
const UM = '10000000-0000-0000-0000-0000000000cc', P = '20000000-0000-0000-0000-000000000001';

await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;
grant usage on schema auth, public to authenticated, anon, service_role;
create table public.users (id uuid primary key, auth_id uuid, email text, phone text, nickname text, full_name text,
  preferred_language text, is_admin boolean default false, suspended_at timestamptz, account_type text default 'PERSONAL');
insert into public.users (id, auth_id, email, is_admin) values ('${UA}','${A}','a@x.test',false),('${UB}','${B}','b@x.test',false),('${UADM}','${ADM}','adm@x.test',true);
insert into public.users (id, auth_id, email, phone, nickname, preferred_language) values ('${UM}', gen_random_uuid(), 'Member@X.test', '+995555000111', 'Lika', 'ka');
create function public.current_homatch_user_id() returns uuid language sql stable security definer set search_path = public as $$ select id from public.users where auth_id = auth.uid() $$;
create function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$ select coalesce((select is_admin from public.users where auth_id = auth.uid()), false) $$;
create table public.admin_settings (key text primary key, value jsonb, updated_at timestamptz default now());
create function public.billing_setting_num(p_key text, p_default numeric) returns numeric language sql stable as $$ select p_default $$;
create table public.admin_audit_log (id bigserial primary key, admin_id uuid, target_id uuid, action text, entity_type text, entity_id text, metadata jsonb, created_at timestamptz default now());
create table public.service_controls (service_key text primary key, frontend_enabled boolean not null default true, backend_enabled boolean not null default true,
  version integer not null default 1, reason text, updated_by uuid, updated_at timestamptz default now(), service_group text not null default 'other');
alter table public.service_controls add constraint service_controls_service_key_check check (service_key in ('find_buyers'));
insert into public.service_controls (service_key, service_group) values ('find_buyers', 'discovery');
create table public.billable_products (code text primary key, name text, billing_mode text, requires_reservation boolean, standard_retail_cents integer,
  reference_landed_cogs_cents integer, min_gross_margin_bps integer, estimate_strategy text, pricing_version integer default 1, enabled boolean,
  pricing_active boolean, kill_switch boolean default false, sort_order integer, config jsonb, min_viable_budget_credits integer, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.finance_services (service_key text primary key, name text, product_codes text[], policy_id text, pricing_kind text, price_note text, service_control_key text, sort_order int);
create table public.credit_accounts (user_id uuid primary key, balance numeric not null default 0);
insert into public.credit_accounts values ('${UA}', 100), ('${UB}', 3);
create table public.ledger (id bigserial, user_id uuid, product text, credits numeric, key text unique);
create function public.wallet_reserve(p_user_id uuid, p_product_code text, p_authorized_max_credits numeric, p_idempotency_key text,
  p_estimate_min_credits numeric default 0, p_estimate_max_credits numeric default 0, p_job_ref text default null, p_metadata jsonb default '{}')
returns table (reservation_id uuid, reserved_credits numeric, balance_after numeric, was_duplicate boolean) language plpgsql as $$
declare v_bal numeric;
begin
  select balance into v_bal from public.credit_accounts where user_id = p_user_id for update;
  if coalesce(v_bal, 0) < p_authorized_max_credits then raise exception 'INSUFFICIENT_CREDITS'; end if;
  update public.credit_accounts set balance = balance - p_authorized_max_credits where user_id = p_user_id;
  insert into public.ledger (user_id, product, credits, key) values (p_user_id, p_product_code, p_authorized_max_credits, p_idempotency_key);
  return query select gen_random_uuid(), p_authorized_max_credits, v_bal - p_authorized_max_credits, false;
end $$;
create function public.wallet_settle(p_reservation_id uuid, p_actual_credits numeric, p_usage jsonb default '{}', p_outcome text default 'SUCCESS')
returns table (reservation_id uuid, settled_credits numeric, released_credits numeric, balance_after numeric, was_duplicate boolean, clamped boolean)
language sql as $$ select p_reservation_id, p_actual_credits, 0::numeric, 0::numeric, false, false $$;
create table public.properties (id uuid primary key, title text, homatch_id integer, user_id uuid, is_deleted boolean default false);
insert into public.properties values ('${P}', 'Krtsanisi', 244486, '${UA}', false);
create table public.find_buyers_leads (id uuid primary key);
create table public.outreach_contact_lists (id uuid primary key default gen_random_uuid(), owner_id uuid, name text, description text, import_status text,
  source_format text, source_filename text, total_rows int default 0, valid_rows int default 0, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.outreach_contacts (id uuid primary key default gen_random_uuid(), list_id uuid references public.outreach_contact_lists(id) on delete cascade, owner_id uuid,
  full_name text, email text, phone text, language text, country text, city text, tags text[], consent_status text default 'UNKNOWN', consent_source text,
  consent_lawful_basis text, consent_recorded_at timestamptz, lead_type text, lead_stage text, notes text, email_valid boolean, budget_min numeric, budget_max numeric,
  currency text, property_type text, unsubscribed boolean default false, suppressed boolean default false, suppressed_reason text,
  do_not_contact boolean default false, is_duplicate boolean default false, created_at timestamptz default now(), updated_at timestamptz default now());
create unique index outreach_contacts_list_email_uidx on public.outreach_contacts (list_id, lower(email)) where email is not null;
create unique index outreach_contacts_list_phone_uidx on public.outreach_contacts (list_id, phone) where phone is not null;
create table public.lead_contact_preferences (user_id uuid primary key, accept_property_offers boolean default true, share_phone_on_unlock boolean default true,
  share_email_on_unlock boolean default true, accept_marketing_email boolean default false, updated_at timestamptz default now());
create function public.lead_contact_prefs_of(p uuid) returns table (accept_property_offers boolean, share_phone_on_unlock boolean, share_email_on_unlock boolean, accept_marketing_email boolean)
  language sql stable as $$ select coalesce(c.accept_property_offers, true), coalesce(c.share_phone_on_unlock, true), coalesce(c.share_email_on_unlock, true), coalesce(c.accept_marketing_email, false)
    from (select 1) x left join public.lead_contact_preferences c on c.user_id = p $$;
create table public.conversation_blocks (id uuid primary key default gen_random_uuid(), blocker_id uuid, blocked_id uuid, reason text, created_at timestamptz default now());
create table public.contact_disclosures (id uuid primary key default gen_random_uuid(), viewer_user_id uuid, subject_user_id uuid, property_id uuid, relationship_kind text, relationship_id uuid, created_at timestamptz default now());
create table public.internal_lead_unlocks (id uuid primary key default gen_random_uuid(), account_user_id uuid, lead_user_id uuid);
create function public.internal_lead_entitled(p_me uuid, p_match_id uuid) returns table (lead_user_id uuid, property_id uuid, unlock_id uuid)
  language sql stable as $$ select u.lead_user_id, '${P}'::uuid, u.id from public.internal_lead_unlocks u where u.account_user_id = p_me and p_match_id = '40000000-0000-0000-0000-000000000001' $$;
-- feed stubs
create table public.internal_match_candidates (id uuid primary key, category text, kind text, confidence text);
create table public.intent_profiles (id uuid primary key, transaction_type text, intent_type text, property_types text[], country text, city text, district text,
  neighborhoods text[], budget_min numeric, budget_max numeric, currency text, bedrooms_min int, bedrooms_max int, rooms_min int, rooms_max int,
  area_min numeric, area_max numeric, requirements jsonb, created_at timestamptz default now(), last_active_at timestamptz);
create table public.active_search_subscriptions (user_id uuid, intent_id uuid, is_active boolean, on_behalf boolean, last_active_at timestamptz, created_at timestamptz default now());
create table public.internal_lead_seen (account_user_id uuid, property_id uuid, seen_at timestamptz);
create table public.internal_lead_saved (account_user_id uuid, match_id uuid);
create table public.lead_crm_entries (id uuid primary key default gen_random_uuid(), owner_user_id uuid, lead_user_id uuid, status text);
create function public.internal_lead_prices() returns jsonb language sql as $$ select '{"STANDARD":3,"EXACT":5,"PREMIUM":10,"active":true}'::jsonb $$;
create function public.internal_lead_rows(p_owner uuid, p_property_id uuid) returns table (match_id uuid, lead_user_id uuid, intent_profile_id uuid, match_score numeric,
  agreed text[], conflicted text[], unknown_dimensions text[], preference_misses text[], matched_at timestamptz, updated_at timestamptz)
  language sql stable as $$ select '40000000-0000-0000-0000-000000000001'::uuid, '${UM}'::uuid, '50000000-0000-0000-0000-000000000001'::uuid, 0.9,
    '{}'::text[], '{}'::text[], '{}'::text[], '{}'::text[], now(), now()
    union all select '40000000-0000-0000-0000-000000000002'::uuid, '${UB}'::uuid, '50000000-0000-0000-0000-000000000002'::uuid, 0.6,
    '{}'::text[], '{}'::text[], '{}'::text[], '{}'::text[], now(), now() $$;
insert into public.internal_match_candidates values ('40000000-0000-0000-0000-000000000001','EXACT','A','HIGH'),('40000000-0000-0000-0000-000000000002','NEARBY_SIMILAR','A','MEDIUM');
insert into public.intent_profiles (id, transaction_type, intent_type, country, city, district) values
  ('50000000-0000-0000-0000-000000000001','SALE','BUY','GE','Tbilisi','Krtsanisi'), ('50000000-0000-0000-0000-000000000002','RENT','RELOCATE_RENT','DE','Tbilisi','Vake');
create function public.internal_lead_features(r jsonb) returns jsonb language sql as $$ select '[]'::jsonb $$;
create function public.internal_lead_segment(p uuid) returns table (segment text, budget_usd numeric) language sql as $$ select 'STANDARD', null::numeric $$;
create type public.internal_match_candidates_t as (x int);
create function public.internal_lead_explanation(c public.internal_match_candidates) returns jsonb language sql as $$ select '{"why":"district"}'::jsonb $$;
create function public.internal_lead_round_budget(v numeric, tx text) returns numeric language sql as $$ select v $$;
create function public.internal_match_preferences_of(p uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
grant all on all tables in schema public to authenticated, service_role;
`);
await db.exec(PREV);
await db.exec(MIGRATION);
await db.exec(MIGRATION);
console.log('migration applied twice');

const as = async (authId, sql, params = [], role = 'authenticated') => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${authId ?? ''}', false), set_config('request.jwt.claim.role', '${role}', false);`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);`); }
};
const one = async (...a) => (await as(...a))[0].r;

/* controls */
const state = await one(A, 'select public.matching_workspace_state() r');
assert.deepEqual([state.maintenance, state.internal, state.curated, state.externalDiscovery, state.curatedPrice.credits], [false, true, true, false, 1],
  'maintenance OFF, internal + curated ON, legacy external OFF, $0.10 = 1 credit');

/* admin import: stage → validate → fix → commit → publish */
await assert.rejects(as(A, `select public.admin_curated_batch_save('{"name":"x"}'::jsonb)`), /FORBIDDEN/, 'not an admin');
const batch = await one(ADM, `select public.admin_curated_batch_save($1::jsonb) r`, [JSON.stringify({ name: 'Expo Dubai 2026', sourceClass: 'EVENT', legalBasis: 'CONSENT_PARTNER_OFFERS', acquiredAt: '2026-09-30' })]);
const rows = [
  { row_no: 2, data: { first_name: 'Anna', last_name: 'Schmidt', email: ' Anna.Schmidt@Example.de ', interests: 'invest', country: 'DE', languages: 'de, en' } },
  { row_no: 3, data: { first_name: 'Omar', last_name: 'Haddad', email: 'omar@example.ae', interests: 'Rent', country: 'AE' } },
  { row_no: 4, data: { first_name: 'Giorgi', last_name: 'K', email: 'bad-email', interests: 'buy', country: 'GE' } },
  { row_no: 5, data: { first_name: 'Anna', last_name: 'Other', email: 'anna.schmidt@example.de', interests: 'buy', country: 'DE' } },
  { row_no: 6, data: { first_name: 'Ivan', last_name: 'Petrov', email: 'ivan@example.ru', interests: 'покупка; аренда', country: 'RU', languages: 'ru' } },
  { row_no: 7, data: { first_name: 'Ayşe', last_name: 'Yılmaz', email: 'ayse@example.tr', interests: 'yatırım', country: 'Türkiye' } },
];
const staged = await one(ADM, 'select public.admin_curated_stage_rows($1, $2::jsonb) r', [batch.id, JSON.stringify(rows)]);
assert.deepEqual([staged.total, staged.valid, staged.invalid, staged.duplicate], [6, 3, 2, 1], 'bad email + bad country invalid, same email duplicate');
const invalid = await one(ADM, `select public.admin_curated_batch_rows($1, '{"status":"INVALID"}'::jsonb) r`, [batch.id]);
assert.deepEqual(invalid.errorSummary, { EMAIL_INVALID: 1, COUNTRY_INVALID: 1 });
const fixRow = invalid.items.find((r) => r.rowNo === 4);
const fixed = await one(ADM, 'select public.admin_curated_row_fix($1, $2::jsonb) r', [fixRow.id, JSON.stringify({ ...rows[2].data, email: 'giorgi@example.ge' })]);
assert.equal(fixed.status, 'VALID', 'a row is corrected in place');
const committed = await one(ADM, 'select public.admin_curated_batch_commit($1) r', [batch.id]);
assert.deepEqual([committed.created, committed.updated], [4, 0], 'valid rows imported; the duplicate skipped');
let leads = (await db.query('select * from public.curated_leads order by email_norm')).rows;
assert.ok(leads.every((l) => l.status === 'HIDDEN'), 'never auto-published');
const anna = leads.find((l) => l.email_norm === 'anna.schmidt@example.de');
assert.deepEqual([anna.interests, anna.languages, anna.first_name], [['INVEST'], ['de', 'en'], 'Anna'], 'first row wins; normalised');
assert.deepEqual(leads.find((l) => l.email_norm === 'ivan@example.ru').interests, ['BUY', 'RENT'], 'Russian synonyms, explicit both');
assert.deepEqual(leads.find((l) => l.email_norm === 'omar@example.ae').languages, [], 'language never guessed from country');

const blocked = await one(ADM, `select public.admin_curated_publish(jsonb_build_object('batchId', $1::text), true) r`, [batch.id]);
assert.deepEqual([blocked.changed, blocked.blockedUnverified], [0, 4], 'no publishing before rights are verified');
await one(ADM, 'select public.admin_curated_batch_save($1::jsonb) r', [JSON.stringify({ id: batch.id, rightsVerified: true })]);
const pub = await one(ADM, `select public.admin_curated_publish(jsonb_build_object('batchId', $1::text), true) r`, [batch.id]);
assert.equal(pub.changed, 4);

/* a shared phone (office / family) never blocks a purchase (audit H1) */
const b3 = await one(ADM, `select public.admin_curated_batch_save('{"name":"Family","legalBasis":"CONSENT_PARTNER_OFFERS","rightsVerified":true}'::jsonb) r`);
await one(ADM, 'select public.admin_curated_stage_rows($1, $2::jsonb) r', [b3.id, JSON.stringify([
  { row_no: 2, data: { first_name: 'Nana', last_name: 'Beridze', email: 'nana@example.ge', interests: 'buy', country: 'GE', phone: '+995599000000' } },
  { row_no: 3, data: { first_name: 'Dato', last_name: 'Beridze', email: 'dato@example.ge', interests: 'buy', country: 'GE', phone: '+995599000000' } },
  { row_no: 4, data: { first_name: 'Text', last_name: 'Leak', email: 'leak@example.ge', interests: 'buy', country: 'GE', description: 'call me +995 599 12 34 56' } },
  { row_no: 5, data: { first_name: 'Area', last_name: 'Spaces', email: 'area@example.ge', interests: 'buy', country: 'GE', area_min: '1 200', rooms_min: '3' } },
])]);
const b3rows = await one(ADM, `select public.admin_curated_batch_rows($1, '{"status":"INVALID"}'::jsonb) r`, [b3.id]);
assert.deepEqual(b3rows.items.map((r) => r.errors[0]), ['CONTACT_IN_TEXT:description'], 'no contact details in pre-purchase text');
assert.equal((await one(ADM, 'select public.admin_curated_batch_commit($1) r', [b3.id])).created, 3, 'area "1 200" commits');
/* customer catalog */
const cat = (p) => one(A, 'select public.curated_leads_catalog($1::jsonb) r', [JSON.stringify(p)]);
let page = await cat({});
const fam = (await one(ADM, `select public.admin_curated_leads('{"q":"beridze"}'::jsonb) r`)).items.map((l) => l.id);
await one(ADM, `select public.admin_curated_publish(jsonb_build_object('ids', $1::jsonb), true) r`, [JSON.stringify(fam)]);
const famU = await one(null, 'select public.curated_leads_unlock($1, $2::jsonb, $3) r', [UA, JSON.stringify({ ids: fam, expectedCredits: 2 }), 'key-fam-0001'], 'service_role');
assert.equal(famU.unlockedCount, 2, 'two people sharing one phone are both bought');
const famC = (await db.query(`select phone from public.outreach_contacts where owner_id = '${A}' and email in ('nana@example.ge','dato@example.ge') order by email`)).rows;
assert.equal(famC.filter((c) => c.phone).length, 1, 'the shared phone sits on one contact; the other keeps its e-mail');
await db.exec(`delete from public.outreach_contacts where owner_id = '${A}'; delete from public.outreach_contact_lists where owner_id = '${A}';
  delete from public.curated_lead_unlocks where account_user_id = '${UA}'; delete from public.curated_lead_unlock_batches where account_user_id = '${UA}';
  update public.credit_accounts set balance = 100 where user_id = '${UA}';
  update public.curated_leads set status = 'HIDDEN' where id = any(array[${fam.map((x) => `'${x}'`).join(',')}]::uuid[]);`);
page = await cat({});
assert.deepEqual([page.total, page.pageSize, page.counts.available, page.counts.unlocked], [4, 100, 4, 0]);
assert.ok(page.items.every((i) => !('email' in i) && !('phone' in i)), 'contacts masked before unlock');
assert.equal(page.items.find((i) => i.country === 'DE').displayName, 'Anna S.');
assert.equal((await cat({ filters: { interests: ['BUY'] } })).total, 2, 'BUY: Giorgi + Ivan (explicitly both), never Omar');
assert.equal((await cat({ filters: { interests: ['RENT'] } })).total, 2);
assert.equal((await cat({ filters: { languages: ['unknown'] } })).total, 2, 'unknown language is its own filter');
assert.equal((await cat({ filters: { countries: ['DE', 'AE'] } })).total, 2);
assert.equal((await cat({ filters: { languages: ['ru'], countries: ['RU'] } })).total, 1);
assert.deepEqual(page.facets.countries, { DE: 1, AE: 1, GE: 1, RU: 1 });

/* quote + unlock (service role, as atomic-unlock calls it) */
const ids = page.items.map((i) => i.id);
const q = await one(A, `select public.curated_leads_quote(jsonb_build_object('allMatching', true, 'filters', '{"interests":["BUY"]}'::jsonb)) r`);
assert.deepEqual([q.selected, q.newCount, q.totalCredits, q.unitCredits], [2, 2, 2, 1]);
const unlock = (user, p, key) => one(null, 'select public.curated_leads_unlock($1, $2::jsonb, $3) r', [user, JSON.stringify(p), key], 'service_role');
await assert.rejects(as(A, `select public.curated_leads_unlock('${UA}', '{}'::jsonb, 'k-12345678')`), /FORBIDDEN/, 'customers cannot call the unlock directly');
const u1 = await unlock(UA, { allMatching: true, filters: { interests: ['BUY'] }, expectedCredits: 2 }, 'key-aaaa-0001');
assert.deepEqual([u1.unlockedCount, u1.chargedCredits, u1.alreadyUnlocked], [2, 2, 0]);
const replay = await unlock(UA, { allMatching: true, filters: { interests: ['BUY'] } , expectedCredits: 10 }, 'key-aaaa-0001');
assert.equal(replay.duplicate, true, 'same key replays, no second charge');
const u2 = await unlock(UA, { ids , expectedCredits: 10 }, 'key-aaaa-0002');
assert.deepEqual([u2.unlockedCount, u2.alreadyUnlocked, u2.chargedCredits], [2, 2, 2], 'already unlocked leads are never charged again');
assert.equal((await db.query(`select balance from public.credit_accounts where user_id = '${UA}'`)).rows[0].balance * 1, 96);

await assert.rejects(unlock(UA, { ids: [ids[0]] }, 'key-aaaa-noprice'), /PRICE_CHANGED/, 'the database requires a confirmed price');
const u3 = await unlock(UA, { ids, expectedCredits: 0 }, 'key-aaaa-0003');
assert.deepEqual([u3.unlockedCount, u3.chargedCredits], [0, 0], 'a selection of owned leads charges nothing');

page = await cat({});
assert.deepEqual([page.total, page.counts.available, page.counts.unlocked], [0, 0, 4], 'unlocked leads leave A\'s available list');
const mine = await cat({ view: 'UNLOCKED' });
assert.equal(mine.total, 4);
assert.ok(mine.items.every((i) => i.email && i.unlockedAt && Number(i.creditsCharged) === 1), 'contacts revealed after unlock');
const pageB = await one(B, `select public.curated_leads_catalog('{}'::jsonb) r`);
assert.equal(pageB.total, 4, 'B still sees all four: a purchase never removes a lead from the shared catalog');
await assert.rejects(unlock(UB, { ids , expectedCredits: 10 }, 'key-bbbb-0001'), /INSUFFICIENT_CREDITS/, 'B has 3 credits for 4 leads: nothing charged, nothing granted');
assert.equal((await db.query(`select count(*)::int n from public.curated_lead_unlocks where account_user_id = '${UB}'`)).rows[0].n, 0, 'all-or-nothing');
const ub = await unlock(UB, { ids: [ids[0]], expectedCredits: 1 }, 'key-bbbb-0002');
assert.equal(ub.unlockedCount, 1);
await assert.rejects(unlock(UB, { allMatching: true, filters: {}, expectedCredits: 1 }, 'key-bbbb-0003'), /PRICE_CHANGED/, 'a bigger selection than quoted is refused');

/* CRM: the standing list, consent from the batch, no duplicates */
const contacts = (await db.query(`select * from public.outreach_contacts where owner_id = '${A}' order by email`)).rows;
assert.equal(contacts.length, 4, 'each unlocked lead saved once to the standing list');
assert.ok(contacts.every((c) => c.source_kind === 'CURATED_LEAD' && c.consent_status === 'CONSENTED' && c.consent_lawful_basis === 'CONSENT'),
  'partner-offers consent + verified rights → CONSENTED');
const lists = (await db.query(`select name, total_rows, source_kind from public.outreach_contact_lists where owner_id = '${A}'`)).rows;
assert.deepEqual(lists.map((l) => [l.name, l.total_rows, l.source_kind]), [['HOMATCH Curated Leads', 4, 'CURATED_LEAD']]);
const s1 = await one(A, 'select public.curated_leads_save_to_list($1::uuid[]) r', [ids.slice(0, 2)]);
const s2 = await one(A, 'select public.curated_leads_save_to_list($1::uuid[]) r', [ids.slice(0, 2).reverse()]);
assert.equal(s1.listId, s2.listId, 'the same selection returns the same list');
assert.equal(s2.added, 0, 'no duplicate contacts on a second send');
await assert.rejects(as(B, 'select public.curated_leads_save_to_list($1::uuid[])', [[ids[3]]]), /NOTHING_SELECTED/, 'only your own unlocked leads');

/* consent stays UNKNOWN without partner-offers consent */
const b2 = await one(ADM, `select public.admin_curated_batch_save('{"name":"Directory","legalBasis":"LEGITIMATE_INTEREST","rightsVerified":true}'::jsonb) r`);
await one(ADM, 'select public.admin_curated_stage_rows($1, $2::jsonb) r', [b2.id, JSON.stringify([{ row_no: 2, data: { first_name: 'Lea', last_name: 'Cohen', email: 'lea@example.il', interests: 'buy', country: 'IL', languages: 'he' } }])]);
await one(ADM, 'select public.admin_curated_batch_commit($1) r', [b2.id]);
await one(ADM, `select public.admin_curated_publish(jsonb_build_object('batchId', $1::text), true) r`, [b2.id]);
const lea = (await cat({})).items[0];
await unlock(UA, { ids: [lea.id] , expectedCredits: 10 }, 'key-aaaa-0004');
assert.equal((await db.query(`select consent_status from public.outreach_contacts where owner_id = '${A}' and email = 'lea@example.il'`)).rows[0].consent_status, 'UNKNOWN');

/* rights withdrawn → hidden; unlocked access survives */
await one(ADM, 'select public.admin_curated_batch_save($1::jsonb) r', [JSON.stringify({ id: batch.id, rightsVerified: false })]);
assert.equal((await one(B, `select public.curated_leads_catalog('{}'::jsonb) r`)).total, 1, 'only Lea remains on sale');
assert.equal((await cat({ view: 'UNLOCKED' })).total, 5, 'purchased access is permanent');

/* maintenance + switches are server-side */
await db.exec(`update public.admin_settings set value = 'true' where key = 'matching_maintenance_mode'`);
await assert.rejects(cat({}), /SERVICE_DISABLED/);
await db.exec(`update public.admin_settings set value = 'false' where key = 'matching_maintenance_mode'`);
await db.exec(`update public.service_controls set backend_enabled = false, frontend_enabled = false where service_key = 'curated_leads'`);
await assert.rejects(cat({}), /SERVICE_DISABLED/);
assert.equal((await cat({ view: 'UNLOCKED' })).total, 5, 'sales off never removes what the account bought');
await assert.rejects(one(A, `select public.curated_leads_quote('{"ids":[]}'::jsonb) r`), /SERVICE_DISABLED/, 'no quote while sales are off');
await assert.rejects(unlock(UB, { ids: [ids[1]] , expectedCredits: 10 }, 'key-bbbb-0009'), /SERVICE_DISABLED/, 'direct purchase refused while sales are off');
assert.ok((await one(A, 'select public.curated_leads_save_to_list($1::uuid[]) r', [ids.slice(0, 1)])).listId, 'own purchases still go to campaigns');
const st2 = await one(A, 'select public.matching_workspace_state() r');
assert.deepEqual([st2.curated, st2.internal, st2.externalDiscovery], [false, true, false], 'switches are independent');
await db.exec(`update public.service_controls set backend_enabled = true, frontend_enabled = true where service_key = 'curated_leads'`);

/* internal feed v2: filters + view, and save-to-list */
const feed = (p) => one(A, `select public.internal_leads_feed_v2('${P}', $1::jsonb) r`, [JSON.stringify(p)]);
let f = await feed({});
assert.equal(f.total, 2);
assert.deepEqual(f.facets.countries, { GE: 1, DE: 1 });
assert.equal((await feed({ interests: ['BUY'] })).total, 1);
assert.equal((await feed({ interests: ['RENT'] })).items[0].interest, 'RENT', 'RELOCATE_RENT is a tenant');
assert.equal((await feed({ countries: ['DE'] })).total, 1);
assert.equal((await feed({ languages: ['ka'] })).total, 1);
assert.equal((await feed({ q: 'vake' })).total, 1);
assert.deepEqual((await feed({ filters: ['LOCKED'] })).facets.languages, {}, 'no language is listed for members not yet unlocked');
assert.deepEqual((await feed({ withIds: true })).ids.length, 2);
await db.exec(`insert into public.internal_lead_unlocks (account_user_id, lead_user_id) values ('${UA}', '${UM}')`);
assert.deepEqual([(await feed({ filters: ['LOCKED'] })).total, (await feed({ filters: ['UNLOCKED'] })).total], [1, 1], 'available and unlocked are server-side views');
const si = await one(A, `select public.internal_leads_save_to_list(array['40000000-0000-0000-0000-000000000001']::uuid[]) r`);
const ic = (await db.query('select * from public.outreach_contacts where list_id = $1', [si.listId])).rows[0];
assert.deepEqual([ic.source_kind, ic.email, ic.consent_status, ic.language, ic.phone], ['INTERNAL_MATCH', 'member@x.test', 'UNKNOWN', 'ka', '+995555000111'],
  'no marketing consent recorded → UNKNOWN (internal_lead_contact.marketingEmail)');
assert.equal((await db.query(`select count(*)::int n from public.contact_disclosures where subject_user_id = '${UM}'`)).rows[0].n, 1, 'phone hand-over logged');
await db.exec(`insert into public.lead_contact_preferences (user_id, accept_marketing_email) values ('${UM}', true)`);
const si2 = await one(A, `select public.internal_leads_save_to_list(array['40000000-0000-0000-0000-000000000001']::uuid[], 'second') r`);
assert.equal((await db.query('select consent_status from public.outreach_contacts where list_id = $1', [si2.listId])).rows[0].consent_status, 'CONSENTED', 'with the member\'s marketing consent');
await db.exec(`update public.lead_contact_preferences set share_phone_on_unlock = false, accept_marketing_email = false where user_id = '${UM}'`);
const resynced = (await db.query(`select phone, consent_status from public.outreach_contacts where source_internal_lead_user_id = '${UM}'`)).rows;
assert.ok(resynced.every((r) => r.phone === null && r.consent_status === 'UNKNOWN'), 'a withdrawn choice reaches every copy');
await db.exec(`insert into public.conversation_blocks (blocker_id, blocked_id) values ('${UM}', '${UA}')`);
assert.ok((await db.query(`select do_not_contact from public.outreach_contacts where source_internal_lead_user_id = '${UM}'`)).rows.every((r) => r.do_not_contact), 'a block stops campaigns');
await assert.rejects(as(A, `select public.internal_leads_save_to_list(array['40000000-0000-0000-0000-000000000001']::uuid[], 'third')`), /NOTHING_SELECTED/, 'blocked members are not saved again');
await db.exec(`delete from public.conversation_blocks`);
await assert.rejects(as(A, `select public.internal_leads_save_to_list(array['40000000-0000-0000-0000-000000000002']::uuid[])`), /NOTHING_SELECTED/, 'not unlocked → nothing');
await db.exec(`update public.service_controls set backend_enabled = false where service_key = 'internal_matching'`);
const off = await feed({});
assert.deepEqual([off.disabled, off.total, off.counts.ALL, off.counts.LOCKED, off.ids ?? null], [true, 1, 1, 0, null],
  'internal off: only the members already unlocked, nothing about anyone else');
assert.equal(off.items[0].unlocked, true);
await db.exec(`update public.service_controls set backend_enabled = true where service_key = 'internal_matching'`);

/* admin reads, export, price, user lists */
const ov = await one(ADM, 'select public.admin_curated_overview() r');
assert.deepEqual([ov.total, ov.unlocks, Number(ov.revenueCredits), ov.controls.find_buyers_external.backend], [8, 6, 6, false]);
await assert.rejects(as(ADM, `select public.admin_curated_export('{}'::jsonb, 'short')`), /REASON_REQUIRED/);
const ex = await one(ADM, `select public.admin_curated_export('{}'::jsonb, 'Partner reconciliation for October') r`);
assert.equal(ex.count, 4, 'only records with verified rights are exportable (Lea + the 3 family-batch leads)');
const price = await one(ADM, `select public.admin_curated_set_price(20, 'test') r`);
assert.equal(Number(price.credits), 2);
await one(ADM, `select public.admin_curated_set_price(10, 'restore') r`);
const ul = await one(ADM, `select public.admin_outreach_lists('{}'::jsonb) r`);
assert.ok(ul.total >= 3 && ul.items[0].ownerEmail);
await assert.rejects(as(A, `select public.admin_outreach_lists('{}'::jsonb)`), /FORBIDDEN/);
await assert.rejects(as(A, `select public.admin_outreach_list_export($1, 'Customer support ticket 123')`, [ul.items[0].id]), /FORBIDDEN/, 'customers cannot export lists through the API');
await assert.rejects(as(ADM, `select public.admin_outreach_list_export($1, 'short')`, [ul.items[0].id]), /REASON_REQUIRED/);
const lx = await one(ADM, `select public.admin_outreach_list_export($1, 'Customer support ticket 123') r`, [ul.items[0].id]);
assert.ok(lx.count >= 1);
const lxAudit = (await db.query(`select target_id, metadata from public.admin_audit_log where action = 'OUTREACH_LIST_EXPORT' order by id desc limit 1`)).rows[0];
assert.equal(lxAudit.metadata.reason, 'Customer support ticket 123');
assert.ok(lxAudit.target_id, 'the list owner is recorded');
for (let i = 0; i < 8; i++) await one(ADM, `select public.admin_outreach_list_export($1, 'Customer support ticket 123') r`, [ul.items[0].id]);
await assert.rejects(as(ADM, `select public.admin_outreach_list_export($1, 'Customer support ticket 123')`, [ul.items[0].id]), /EXPORT_RATE_LIMITED/, 'at most 10 exports per hour');
const audit = (await db.query(`select action from public.admin_audit_log order by id`)).rows.map((r) => r.action);
for (const a of ['CURATED_BATCH_CREATE', 'CURATED_BATCH_COMMIT', 'CURATED_PUBLISH', 'CURATED_EXPORT', 'CURATED_PRICE_SET']) assert.ok(audit.includes(a), a);
await assert.rejects(as(A, `insert into public.outreach_contacts (list_id, owner_id, source_kind) values (gen_random_uuid(), '${A}', 'SCRAPED')`), /check constraint|violates/);
/* the admin panel: four independent switches, audited */
await assert.rejects(as(A, `select public.admin_matching_control_set('CURATED', false)`), /FORBIDDEN/);
let s4 = await one(ADM, `select public.admin_matching_control_set('UNLOCKED_LIBRARY', false, 'test') r`);
assert.deepEqual([s4.unlockedLibrary, s4.internal, s4.curated, s4.maintenance], [false, true, true, false]);
s4 = await one(ADM, `select public.admin_matching_control_set('CURATED', false) r`);
assert.deepEqual([s4.unlockedLibrary, s4.internal, s4.curated], [false, true, false]);
s4 = await one(ADM, `select public.admin_matching_control_set('INTERNAL', false) r`);
assert.deepEqual([s4.internal, s4.curated, s4.externalDiscovery], [false, false, false], 'no switch enables legacy discovery');
s4 = await one(ADM, `select public.admin_matching_control_set('MAINTENANCE', true) r`);
assert.equal(s4.maintenance, true);
assert.equal((await cat({ view: 'UNLOCKED' })).total, 5, 'all off + maintenance: purchases still recoverable');
for (const c of ['MAINTENANCE', 'INTERNAL', 'CURATED', 'UNLOCKED_LIBRARY']) await one(ADM, `select public.admin_matching_control_set('${c}', ${c !== 'MAINTENANCE'}) r`);
{ const w = await one(A, 'select public.matching_workspace_state() r'); assert.deepEqual([w.maintenance, w.internal, w.curated, w.unlockedLibrary], [false, true, true, true]); }
assert.equal((await db.query(`select count(*)::int n from public.admin_audit_log where action = 'MATCHING_CONTROL_SET'`)).rows[0].n, 8, 'every change audited');
await assert.rejects(as(ADM, `select public.admin_matching_control_set('FIND_BUYERS_EXTERNAL', true)`), /INVALID_ARGUMENT/, 'the legacy discovery is not a panel switch');
/* multilingual preparation on the existing lists */
const std = (await db.query(`select id from public.outreach_contact_lists where owner_id = '${A}' and name = 'HOMATCH Curated Leads'`)).rows[0].id;
const aud = await one(A, 'select public.outreach_list_audience($1) r', [std]);
assert.deepEqual([aud.total, aud.eligible, aud.bySource.CURATED_LEAD], [5, 4, 5], 'Lea has no consent: 4 of 5 reachable');
assert.deepEqual(Object.keys(aud.byLanguage).sort(), ['de', 'he', 'ru', 'unknown']);
await assert.rejects(as(B, 'select public.outreach_list_audience($1)', [std]), /NOT_FOUND/, "another owner's list");
let split = await one(A, 'select public.outreach_list_split_by_language($1) r', [std]);
assert.deepEqual(split.map((x) => x.language), ['de', 'he', 'ru', 'unknown'], 'no fallback: unknown stays unknown');
split = await one(A, `select public.outreach_list_split_by_language($1, 'en') r`, [std]);
const en = split.find((x) => x.language === 'en');
assert.equal(en.audience.total, 2, 'unknown-language contacts go to the fallback the owner chose');
const again2 = await one(A, `select public.outreach_list_split_by_language($1, 'en') r`, [std]);
assert.equal(again2.find((x) => x.language === 'en').audience.total, 2, 'splitting twice adds nobody twice');
assert.equal(again2.find((x) => x.language === 'en').listId, en.listId, 'and returns the same lists');
const fbList = (await db.query(`insert into public.outreach_contact_lists (owner_id, name) values ('${A}', 'mixed') returning id`)).rows[0].id;
await db.exec(`insert into public.find_buyers_leads (id) values ('60000000-0000-0000-0000-000000000001');
  insert into public.outreach_contacts (list_id, owner_id, full_name, source_kind, source_lead_id, language) values ('${fbList}', '${A}', 'FB person', 'FIND_BUYERS', '60000000-0000-0000-0000-000000000001', 'ka');
  insert into public.outreach_contacts (list_id, owner_id, full_name, source_kind, source_internal_lead_user_id, language) values ('${fbList}', '${A}', 'Member', 'INTERNAL_MATCH', '${UB}', 'ka');
  insert into public.outreach_contacts (list_id, owner_id, full_name, email, phone, language) values ('${fbList}', '${A}', 'P1', 'p1@x.test', '+995500', 'ka'), ('${fbList}', '${A}', 'P2', 'p2@x.test', '+995500x', 'ka');
  update public.outreach_contacts set phone = '+995500' where email = 'p2@x.test' and list_id = '${fbList}' and false;`);
const sp1 = await one(A, 'select public.outreach_list_split_by_language($1) r', [fbList]);
const sp2 = await one(A, 'select public.outreach_list_split_by_language($1) r', [fbList]);
assert.equal(sp1[0].listId, sp2[0].listId);
assert.equal(sp2[0].audience.total, 4, 'a Find Buyers contact and a member without address split, twice, without error or duplicates');
console.log('ALL CURATED LEADS CHECKS PASSED');

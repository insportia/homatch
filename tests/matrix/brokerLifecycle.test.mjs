// THE BROKER LIFECYCLE — the rules a professional's journey rests on, read
// from the sources that enforce them. The database is the authority; these
// tests stop a later edit from quietly moving a rule into the browser.
//
//   * one profile per owner; the owner can never set a status, a paid period
//     or a verification state
//   * the account type and suspension are server-set only
//   * verification documents are private and reviewed by an audited admin RPC
//   * the directory period is bought once per idempotency key, server-priced
//   * lead states that mean "we spoke" need an opened contact
//   * a suspended account cannot buy, unlock or launch — and keeps what it paid for
//   * broker posts go to a review queue, never into demand
//   * a native broker/agency listing is matched as that role, and rentals as landlord
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const M = read('supabase/migrations/20260930140000_broker_lifecycle.sql');
const fnBody = (name) => {
  const at = M.indexOf(`create or replace function public.${name}(`);
  assert.ok(at >= 0, `${name} is defined`);
  return M.slice(at, M.indexOf('end $$;', at));
};

test('one professional profile per owner, created as a DRAFT', () => {
  assert.match(M, /create unique index if not exists broker_directory_listings_one_per_owner\s+on public\.broker_directory_listings\(owner_user_id\)/);
  const save = fnBody('broker_profile_save');
  assert.match(save, /'DRAFT'\)/);
  const signature = save.slice(0, save.indexOf('returns uuid'));
  for (const forbidden of [/p_status/, /p_paid_until/, /p_verification/, /p_broker_id/, /p_owner/]) {
    assert.doesNotMatch(signature, forbidden, `broker_profile_save accepts ${forbidden}`);
  }
  assert.match(save, /where l\.owner_user_id = v_auth for update/);
  assert.match(save, /broker_logo_url_ok\(v_logo, v_auth\)/, 'a logo is an upload in the owner\'s own folder');
});

test('account type and suspension are reset unless the server set them', () => {
  const trigger = fnBody('protect_privileged_user_columns');
  for (const col of ['account_type', 'suspended_at', 'suspension_reason']) {
    assert.match(trigger, new RegExp(`new\\.${col} := old\\.${col}`));
  }
  assert.match(trigger, /current_setting\('homatch\.account_rpc', true\)/);
  const susp = fnBody('admin_set_user_suspension');
  assert.match(susp, /if not public\.is_admin\(\) then raise exception 'FORBIDDEN'/);
  assert.match(susp, /REASON_REQUIRED/);
  assert.match(susp, /CANNOT_SUSPEND_SELF/);
  assert.match(susp, /insert into public\.admin_audit_log/);
  assert.match(susp, /get diagnostics v_rows = row_count;\s+perform set_config/, 'the row count is read before PERFORM resets FOUND');
});

test('verification documents are private and decided by an audited admin', () => {
  assert.match(M, /values \('broker-verification', 'broker-verification', false/);
  assert.match(M, /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
  const add = fnBody('broker_verification_add_document');
  assert.match(add, /split_part\(p_storage_path, '\/', 1\) <> auth\.uid\(\)::text/, 'a path outside the owner folder is refused');
  const decide = fnBody('admin_set_broker_verification');
  assert.match(decide, /is_admin\(\)/);
  assert.match(decide, /NOTE_REQUIRED/);
  assert.match(decide, /NO_DOCUMENTS/);
  assert.match(decide, /admin_audit_log/);
  const panels = read('src/components/admin/BrokerAdminPanels.tsx');
  assert.match(read('src/services/brokerDesk.ts'), /createSignedUrl\(path, 300\)/, 'admins open documents through a short signed link');
  assert.doesNotMatch(panels, /getPublicUrl/);
});

test('the directory period is server-priced, approved-only and idempotent', () => {
  const buy = fnBody('broker_directory_purchase');
  assert.match(buy, /IDEMPOTENCY_KEY_REQUIRED/);
  assert.match(buy, /from public\.broker_listing_purchases where idempotency_key = p_idempotency_key/);
  assert.match(buy, /'duplicate', true/);
  assert.match(buy, /status not in \('APPROVED', 'ACTIVE', 'EXPIRED'\)/);
  assert.match(buy, /standard_retail_cents \/ 10\.0/, 'priced from the catalogue, 10 Credits = $1');
  assert.match(buy, /for update;\s+if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'/);
  assert.match(buy, /INSUFFICIENT_CREDITS/);
  assert.match(M, /idempotency_key text not null unique/);
  const desk = read('src/pages/BrokerCrmPage.tsx');
  assert.match(desk, /purchaseKey\.current = purchaseKey\.current \?\? newIdempotencyKey/, 'the key survives a retry');
});

test('contact lead states need an opened contact, and only the owner moves a lead', () => {
  const lead = fnBody('set_match_lead_state');
  assert.match(lead, /NOT_YOUR_PROPERTY/);
  assert.match(lead, /p_state in \('CONTACTED', 'IN_PROGRESS', 'WON'\)[\s\S]*match_unlocks[\s\S]*UNLOCK_REQUIRED/);
  assert.match(lead, /ACCOUNT_SUSPENDED/);
});

test('a suspended account cannot buy, unlock or launch, and keeps what it already paid for', () => {
  const unlock = read('supabase/functions/atomic-unlock/index.ts');
  assert.match(unlock, /ACCOUNT_SUSPENDED/);
  const guard = unlock.indexOf('ACCOUNT_SUSPENDED');
  assert.ok(unlock.slice(Math.max(0, guard - 400), guard).includes('priorUnlock'), 're-opening a paid contact stays allowed');
  assert.match(read('supabase/functions/match-campaign/index.ts'), /ACCOUNT_SUSPENDED/);
  assert.match(read('supabase/functions/meta-ads-api/index.ts'), /ACCOUNT_SUSPENDED/);
  assert.match(fnBody('broker_directory_purchase'), /ACCOUNT_SUSPENDED/);
});

test('broker posts go to Broker Review, never into demand', () => {
  const classify = read('supabase/functions/classify-signals-v2/index.ts');
  assert.match(classify, /from\('broker_review_items'\)/);
  assert.match(classify, /onConflict: ?'signal_id'/);
  const resolve = fnBody('admin_resolve_broker_review');
  assert.match(resolve, /is_admin\(\)/);
  assert.match(resolve, /NO_PUBLIC_IDENTITY/, 'a firm without a public identity is never invented');
  assert.match(resolve, /admin_audit_log/);
  assert.doesNotMatch(resolve, /insert into public\.(users|intent_profiles|matches)/, 'review never fabricates a user or demand');
});

test('a native professional listing is matched as that role, and rentals as landlord', () => {
  const participants = read('src/research-core/match/participants.ts');
  assert.match(participants, /export function nativeSupplyRole/);
  /* The property→supply mapping moved verbatim into the shared pure helper (native-pair.ts),
     which the worker now calls for every native candidate. */
  assert.match(read('src/research-core/match/native-pair.ts'), /nativeSupplyRole\(transaction, \(?property\.listed_by_role/);
  assert.match(read('supabase/functions/supply-matching/index.ts'), /supplySideFromProperty\(\s*propertyRow as PropertyShape/);
  assert.match(fnBody('properties_set_listed_by'), /new\.listed_by_role := v_type/);
});

test('desk counts use the canonical active window and never every match ever made', () => {
  const desk = fnBody('broker_desk_summary');
  assert.match(desk, /discovery_freshness_policy/);
  assert.match(desk, /m\.demand_published_at >= v_since/);
  assert.match(desk, /where p\.user_id = v_user/, 'owner-scoped');
});

test('the client label on a broker search stays private to its owner', () => {
  assert.match(M, /add column if not exists client_label text/);
  assert.match(M, /length\(client_label\) <= 80/);
  const desk = read('src/pages/BrokerCrmPage.tsx');
  assert.match(desk, /\.from\('active_search_subscriptions'\)\s*\.update\(\{ client_label/);
  assert.doesNotMatch(M, /client_label[\s\S]{0,200}broker_directory_public/, 'the label never reaches a public view');
});

test('every new broker RPC is closed to anon', () => {
  const names = [...M.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1])
    /* Triggers and a pure helper are not callable RPCs; record_broker_profile_event
       is the public profile's own counter and is meant for anonymous visitors. */
    .filter((n) => !['protect_privileged_user_columns', 'broker_logo_url_ok', 'properties_set_listed_by',
      'record_broker_profile_event'].includes(n));
  for (const n of names) {
    assert.match(M, new RegExp(`revoke all on function public\\.${n}\\([^)]*\\) from public, anon`), `${n} is not revoked from anon`);
  }
});

test('agency teams are reported as a limitation, not faked', () => {
  const onb = read('src/pages/BrokerOnboardingPage.tsx');
  assert.match(onb, /broker_onb_member_limit/);
  assert.match(onb, /role === 'AGENCY' \? 'AGENCY' : 'BROKER'/, 'an agent at an agency is saved as an individual broker');
});

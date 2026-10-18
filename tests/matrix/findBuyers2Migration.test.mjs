// FIND BUYERS 2.0 migration (20261118090000) — the money and privacy invariants, read from
// the SQL itself (a matrix gate: the functions were also executed against Postgres with
// fixtures before review, see the PR):
//   * prices change only for the two internal-lead products: Standard 30¢ = 3 credits,
//     VIP (PREMIUM) 100¢ = 10 credits; the credit rate itself is untouched;
//   * the v2 feed is owner-only, free, and returns contact CHANNELS as booleans — never a
//     phone, an email or a name before the unlock;
//   * the CRM profile is owner-only; a logged contact is the owner's statement;
//   * a schedule needs the reviewed version, and the due-claim is service-role only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261118090000_find_buyers_2_internal.sql'), 'utf8');
const fn = (name) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `guard: ${name} missing`);
  return sql.slice(start, sql.indexOf('end $$;', start) > 0 ? sql.indexOf('$$;', sql.indexOf('$$', start) + 2) + 3 : undefined);
};

test('only the two internal-lead prices change: 3 and 10 credits at 10 credits = $1', () => {
  const updates = [...sql.matchAll(/update public\.billable_products set standard_retail_cents = (\d+)[^;]*where code = '([A-Z_]+)'/g)].map((m) => [m[2], Number(m[1])]);
  assert.deepEqual(updates, [['INTERNAL_LEAD_STANDARD', 30], ['INTERNAL_LEAD_PREMIUM', 100]]);
  assert.doesNotMatch(sql, /credits_per_usd'\s*,\s*'?\d/, 'the credit rate is not touched');
  assert.doesNotMatch(sql, /wallet_(reserve|settle|debit)|credit_ledger/, 'nothing in this migration moves money');
});

test('the v2 feed is owner-only and never returns a contact or a name before the unlock', () => {
  const f = fn('internal_leads_feed_v2');
  assert.match(f, /pr\.user_id = v_me and not pr\.is_deleted/, 'owner check');
  assert.match(f, /from public\.internal_lead_rows\(v_me, p_property_id\)/, 'eligibility (consent, blocks, suspension) is the existing helper');
  assert.match(f, /'phone', pg\.share_phone_on_unlock and pg\.has_phone/, 'a channel flag, not a number');
  assert.match(f, /'email', pg\.share_email_on_unlock and pg\.has_email/);
  assert.match(f, /'displayName', case when pg\.unlocked then/, 'a name only after the unlock');
  /* Output fields only: usr.phone / usr.email are read solely as "is there one" booleans. */
  for (const leak of [/'phone',\s*(pg|usr|p)\.phone/, /'email',\s*(pg|usr|p)\.email/, /'fullName'/, /'nickname'/, /'phone',\s*usr/, /'email',\s*usr/]) assert.doesNotMatch(f, leak);
  assert.doesNotMatch(f, /select[^;]*\busr\.(phone|email)\s*(,|as\b)/i, 'the raw phone/email is never selected into a column');
  assert.match(sql, /grant execute on function public\.internal_leads_feed_v2\(uuid, jsonb\) to authenticated;/);
  assert.match(sql, /revoke all on function public\.internal_leads_feed_v2\(uuid, jsonb\) from public, anon;/);
  assert.match(fn('internal_lead_features'), /where k in \(/, 'only structured feature keys pass');
});

test('the CRM profile and contact log are the owner\'s own; stages extend the pipeline', () => {
  assert.match(fn('crm_entry_profile'), /where id = p_entry_id and owner_user_id = v_me/);
  const u = fn('crm_update');
  assert.match(u, /where id = p_entry_id and owner_user_id = v_me for update/);
  assert.match(u, /'CONTACT_LOGGED', jsonb_build_object\('channel', v_channel, 'by', 'OWNER'/);
  assert.match(u, /if v_e\.status in \('UNLOCKED', 'CONTACT_PLANNED'\) then/, 'a logged contact only moves an un-contacted lead forward');
  for (const s of ['CONTACT_PLANNED', 'NEGOTIATING', 'CONVERTED']) assert.match(sql, new RegExp(`'${s}'`));
});

test('a schedule sends only the reviewed version; claiming due campaigns is service-role only', () => {
  const s = fn('email_studio_schedule');
  assert.match(s, /owner_user_id = v_me for update/);
  assert.match(s, /if v_c\.status <> 'REVIEWED' or v_c\.reviewed_hash is null then raise exception 'NOT_REVIEWED'/);
  assert.match(s, /scheduled_hash = v_c\.reviewed_hash/);
  assert.match(s, /interval '5 minutes'.*interval '90 days'/s);
  assert.match(sql, /revoke all on function public\.email_studio_claim_due_scheduled\(integer\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.email_studio_claim_due_scheduled\(integer\) to service_role;/);
  assert.match(fn('email_studio_claim_due_scheduled'), /for update skip locked/);
});

test('one active demand per person per distinct search, old rows untouched', () => {
  assert.match(sql, /create unique index if not exists active_search_subscriptions_demand_fingerprint\s+on public\.active_search_subscriptions \(user_id, demand_fingerprint\)\s+where is_active and demand_fingerprint is not null;/);
  assert.doesNotMatch(sql, /update public\.active_search_subscriptions/, 'existing searches are not rewritten');
});

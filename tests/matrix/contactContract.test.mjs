// CONTACT US — the truthfulness contract, read off the sources.
//
// The page may only claim "sent" when something was actually persisted and
// somebody will actually see it. These guards pin the three facts that make
// that true: the RPC is the only door in, it validates and rate-limits, and
// it notifies the admins in the same transaction.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const migration = read('supabase/migrations/20260928700000_contact_messages.sql');
const page = read('src/pages/ContactPage.tsx');
const nav = read('src/site/publicNav.ts');

test('contact_messages has no INSERT policy — the validated RPC is the only door', () => {
  assert.ok(!/create policy \S+\s+on public\.contact_messages for insert/i.test(migration));
  assert.match(migration, /grant execute on function public\.contact_submit[^;]+to anon, authenticated/);
});

test('the RPC validates, rate-limits per sender, and rings the admins in one transaction', () => {
  assert.match(migration, /INVALID_EMAIL/);
  assert.match(migration, /INVALID_MESSAGE/);
  assert.match(migration, /RATE_LIMITED/);
  assert.match(migration, /notify_emit/);
  assert.match(migration, /'CONTACT_MESSAGE'::public\.notification_type/);
});

test('the form claims success only after the RPC succeeded, and drops honeypot hits', () => {
  // sent flips only after the rpc error check returned.
  const submit = page.slice(page.indexOf('const submit'), page.indexOf('const label'));
  assert.ok(submit.indexOf('rpcError') < submit.indexOf('setSent(true)'),
    'success must be gated on the server result');
  assert.match(submit, /if \(company\.trim\(\)\) return/);
  // No invented channels: the page renders no mailto:, tel: or address.
  assert.ok(!/mailto:|tel:/.test(page), 'the page must not invent contact channels');
});

test('Contact sits immediately after About in the company group', () => {
  const company = nav.slice(nav.indexOf("key: 'company'"));
  const about = company.indexOf("key: 'about'");
  const contact = company.indexOf("key: 'contact'");
  const pricing = company.indexOf("key: 'pricing'");
  assert.ok(about > -1 && contact > about && pricing > contact,
    'required order: About, Contact, Pricing');
});

test('reading the inbox stays admin-only', () => {
  assert.match(migration, /contact_messages_admin_reads[\s\S]*?using \(public\.is_admin\(\)\)/);
});

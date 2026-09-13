// One spelling of "who owns this row", enforced by reading the source.
//
// WHY THIS TEST EXISTS
//
// outreach_campaigns, outreach_contacts and outreach_contact_lists each carry
// a foreign key from owner_id to auth.users(id), and their RLS policies match
// auth.uid(). public.users.id is a DIFFERENT primary key on a different table,
// and in production it differs from auth_id for every single row.
//
// Writing the profile id into owner_id therefore fails the foreign key where
// one exists (outreach_campaigns, outreach_contacts, outreach_contact_lists)
// and, where one does not (outreach_sends), silently writes rows the owner's
// own SELECT policy will never match. Both failure modes are invisible in
// review: the code reads perfectly sensibly, and `profileRow.id` looks more
// correct than `user.id`, not less.
//
// It happened four times independently — contact-import, outreach-send,
// outreach-campaign-preview, and the service layer's currentUserId(). So this
// is asserted rather than remembered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

/** Edge functions that resolve a caller and write an outreach_* owner_id. */
const FUNCTIONS = [
  'supabase/functions/contact-import/index.ts',
  'supabase/functions/outreach-send/index.ts',
  'supabase/functions/outreach-campaign-preview/index.ts',
];

test('no edge function assigns the profile id as an outreach owner', () => {
  for (const path of FUNCTIONS) {
    if (!existsSync(path)) continue;
    const src = readFileSync(path, 'utf8');

    // The exact shape of the defect: ownerId taken from the users-table row.
    assert.doesNotMatch(
      src,
      /const\s+ownerId\s*=\s*profileRow\s*\.\s*id/,
      `${path} assigns ownerId from the profile row; owner_id must be the auth user id`,
    );
  }
});

test('every one of those functions still resolves the auth user', () => {
  // The fix must not have been "delete the profile lookup and hardcode
  // something": the caller still has to be a real authenticated user.
  for (const path of FUNCTIONS) {
    if (!existsSync(path)) continue;
    const src = readFileSync(path, 'utf8');
    assert.match(src, /auth\.getUser\(\)/, `${path} no longer authenticates its caller`);
    assert.match(
      src,
      /const\s+ownerId\s*=\s*user\s*\.\s*id/,
      `${path} must own rows by the auth user id`,
    );
  }
});

test('the browser service layer owns rows by the auth id too', () => {
  const path = 'src/services/communications.ts';
  const src = readFileSync(path, 'utf8');

  // currentUserId() is the single identity helper the Communications service
  // uses for both comm_* (auth.uid policies) and outreach_* (auth.uid policies
  // since the alignment migration). It must return the auth id.
  const fn = src.slice(src.indexOf('async function currentUserId'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /supabase\.auth\.getUser\(\)/, 'currentUserId must read the auth user');
  assert.doesNotMatch(body, /from\(['"]users['"]\)/, 'currentUserId must not resolve the profile id');
});

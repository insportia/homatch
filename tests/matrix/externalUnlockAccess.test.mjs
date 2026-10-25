// unlock-external-contact: who may read a legacy external match, and when it may be sold.
//
// The function reads `matches` with the service role, so RLS does not protect it. Before
// PR #335 the PREVIEW (confirm=false) answered for any match id to any signed-in user;
// ownership was checked only inside the unlock RPC. And the legacy external discovery
// service (find_buyers_external) being switched off did not stop new unlocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('supabase/functions/unlock-external-contact/index.ts', 'utf8');
const at = (needle) => {
  const i = SRC.indexOf(needle);
  assert.ok(i >= 0, `missing: ${needle}`);
  return i;
};

test('ownership is checked before anything about the match is returned', () => {
  const owned = at(".from('properties').select('id').eq('id',match.property_id).eq('user_id',actor.id)");
  assert.ok(owned < at('const preview='), 'ownership before the preview is built');
  assert.ok(owned < at('if(!confirm) return respond({preview})'), 'ownership before the preview is returned');
  assert.match(SRC, /if\(!owned\) return respond\(\{error:'Match not found'\},404\)/, 'same answer as a missing match: ids cannot be probed');
});

test('nothing new is sold while find_buyers_external is off; what was bought stays readable', () => {
  const gate = at("match.status!=='UNLOCKED' && !(await serviceBackendEnabled(supabase,'find_buyers_external'))");
  assert.ok(gate < at("supabase.rpc('atomic_external_match_unlock'"), 'gate before the paid unlock');
  assert.ok(gate < at('if(!confirm) return respond({preview})'), 'gate before a preview that leads to a sale');
});

test('the reveal still carries no phone field', () => {
  assert.doesNotMatch(SRC, /phone/i);
});

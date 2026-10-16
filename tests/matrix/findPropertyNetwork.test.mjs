// FIND PROPERTY → THE HOMATCH NETWORK, and the consent rule for a member's number.
//
// Find Property = matching properties for a person. A Marketplace Search's requirements
// reach the native matcher exactly as a confirmed plan's do; internal properties surface
// only through that match (never a catalogue), contact is private messaging, and a
// listing's number goes to a matched person only with the owner's explicit consent.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const MS = code(read('supabase/functions/marketplace-search/index.ts'));
const SEEKER = code(read('supabase/functions/_shared/seekerIntent.ts'));
const PIPELINE = read('supabase/migrations/20260928010000_native_intent_pipeline.sql');

test('a Marketplace Search becomes a native demand: intent, SUPPLY subscription, matcher request', () => {
  assert.match(MS, /recordSeekerIntent\(db, userId, toSearchPlanDraft\(brief\), \{ marketplaceSearchId: searchId \}\)/);
  assert.match(MS, /requestNativeMatching\(\[intentId\]\)/);
  // Best effort: the network pass can never fail the marketplace search.
  assert.match(MS, /const network = \(async \(\) => \{\s*try \{[\s\S]*?\} catch \(error\)/);
  assert.match(SEEKER, /from\('intent_profiles'\)\s*\.insert\(planToIntentProfile\(plan/);
  assert.match(SEEKER, /side: 'SUPPLY'/);
  assert.match(SEEKER, /is_active: true/);
  assert.match(SEEKER, /planReadiness\(plan\)\.ready/, 'an unready brief is not a demand');
});

test('the network pass is free and never starts broker or external discovery', () => {
  assert.match(SEEKER, /discover_brokers: false/);
  for (const forbidden of [/billing/i, /wallet/i, /credit/i, /reserve/i, /settle/i, /find-property-run/, /beginExecution/]) {
    assert.doesNotMatch(SEEKER, forbidden, String(forbidden));
  }
});

test('no catalogue: the seeker reads member properties only through its own matches', () => {
  const ui = ['src/components/findProperty/ResultsView.tsx', 'src/components/findProperty/workspace/SearchesTab.tsx'].map((p) => code(read(p))).join('\n');
  assert.match(ui, /<NativeMatchesPanel role="SEEKER" \/>/);
  assert.doesNotMatch(ui, /from\('properties'\)|\.from\("properties"\)/, 'Find Property never lists the properties table');
});

test('calling: a matched person gets that property\'s own listing contact — never an account phone, never another property\'s', () => {
  const fn = PIPELINE.slice(PIPELINE.indexOf('create or replace function public.reveal_native_contact'), PIPELINE.indexOf('grant execute on function public.reveal_native_contact'));
  // Resolved from the match row, for its two parties only.
  assert.match(fn, /from public\.supply_matches\s+where id = p_id and source_kind = 'INTERNAL_HOMATCH' and compatibility = 'COMPATIBLE'/);
  assert.match(fn, /v_me not in \(v_supply, v_demand\)/);
  // The seeker reads the listing contact of THAT property (live listings only), and every reveal is recorded.
  const seeker = fn.slice(fn.indexOf('if v_me = v_demand then'), fn.indexOf('/* The owner asking'));
  assert.match(seeker, /select contact_phone_e164 into v_phone\s+from public\.properties\s+where id = v_property and is_deleted = false and archived_at is null/);
  assert.doesNotMatch(seeker, /public\.users|\.phone\b(?!_)/, 'never the account phone');
  assert.match(seeker, /insert into public\.contact_disclosures/);
  // The owner sees the seeker\'s number only if the seeker shared it in their conversation.
  assert.match(fn, /from public\.conversation_contact_shares s/);
  assert.match(PIPELINE, /revoke all on function public\.reveal_native_contact\(text, uuid\) from public, anon;/);
});

test('no migration in this workstream redefines who may be called', () => {
  const { readdirSync } = require_('node:fs');
  const later = readdirSync(new URL('../../supabase/migrations/', import.meta.url)).filter((f) => f > '20260928010000_native_intent_pipeline.sql');
  for (const f of later) assert.doesNotMatch(read(`supabase/migrations/${f}`), /function public\.reveal_native_contact/, f);
});

test('the listing form says who will call the number; the seeker panel dials and copies it', () => {
  const field = code(read('src/components/owner/ContactPhoneField.tsx'));
  assert.match(field, /t\('contact_phone_match_notice'\)/);
  const panel = code(read('src/components/matching/NativeMatchesPanel.tsx'));
  assert.match(panel, /href=\{`tel:\$\{contact\.phone\}`\}/);
  assert.match(panel, /navigator\.clipboard\?\.writeText\(contact\.phone/);
  assert.match(panel, /revealNativeContact\(row\.kind, row\.id\)/, 'the number comes only from the server, per match');
});

// FIND PROPERTY → THE HOMATCH NETWORK, and the consent rule for a member's number.
//
// Find Property = matching properties for a person. A Marketplace Search's requirements
// reach the native matcher exactly as a confirmed plan's do; internal properties surface
// only through that match (never a catalogue), contact is private messaging, and a
// listing's number goes to a matched person only with the owner's explicit consent.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const MS = code(read('supabase/functions/marketplace-search/index.ts'));
const SEEKER = code(read('supabase/functions/_shared/seekerIntent.ts'));
const CONSENT = read('supabase/migrations/20261102100000_property_phone_share_consent.sql');

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
  const ui = ['src/components/findProperty/ResultsView.tsx', 'src/components/findProperty/SearchDashboard.tsx'].map((p) => code(read(p))).join('\n');
  assert.match(ui, /<NativeMatchesPanel role="SEEKER" \/>/);
  assert.doesNotMatch(ui, /from\('properties'\)|\.from\("properties"\)/, 'Find Property never lists the properties table');
});

test('consent: a member\'s number reaches a matched person only when the owner chose to share it', () => {
  assert.match(CONSENT, /add column if not exists contact_phone_shareable boolean not null default false/);
  assert.match(CONSENT, /grant update \(contact_phone_shareable\) on public\.properties to authenticated/);
  const seeker = CONSENT.slice(CONSENT.indexOf('if v_me = v_demand then'), CONSENT.indexOf('/* The owner asking'));
  const gate = seeker.indexOf("if v_shareable is distinct from true then return jsonb_build_object('phone', null, 'reason', 'NOT_SHARED')");
  assert.ok(gate > 0, 'the seeker branch refuses without consent');
  assert.ok(gate < seeker.indexOf('insert into public.contact_disclosures'), 'refused before anything is disclosed or recorded');
  // The owner branch and the party / anon rules are unchanged.
  assert.match(CONSENT, /v_me not in \(v_supply, v_demand\)/);
  assert.match(CONSENT, /from public\.conversation_contact_shares s/);
  assert.match(CONSENT, /revoke all on function public\.reveal_native_contact\(text, uuid\) from public, anon;/);
});

test('owner forms offer the consent and send it; it is off unless chosen', () => {
  const api = code(read('src/services/api.ts'));
  assert.match(api, /contact_phone_shareable: input\.phoneShareable === true/);
  for (const page of ['PrivateListingPage', 'URLImportPage', 'EditPropertyPage']) {
    const src = code(read(`src/pages/property/${page}.tsx`));
    assert.match(src, /useState\(false\)/, page);
    assert.match(src, /onShareableChange=\{setPhoneShareable\}/, page);
  }
});

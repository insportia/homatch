// Pure-logic regression test for src/pages/VerifyPage.tsx's PHASE_LABEL_KEYS
// map (2026-09-07 Verify mandate — "CUSTOMER PROGRESS/CAPTCHA UI ... hide
// internal selectors/errors/stack traces"). Before this fix, the loading
// panel rendered `progress?.phase` directly (only markdown-stripped, never
// translated), so every raw internal FSM token
// supabase/functions/research-agent/index.ts writes via
// `progress: { phase: ... }` — "official_browser_complete", "enreg_entity",
// "captcha_required", etc. — appeared verbatim, untranslated, to the
// customer. PHASE_LABEL_KEYS now maps every one of those raw tokens to a
// real i18n key so the panel always shows localized, human-readable text,
// falling back to the existing verify_loading_phase_fallback key for
// anything unrecognized.
//
// VerifyPage.tsx is a .tsx file this sandbox cannot compile/import
// directly (see companyProfileReconciliationFallback.test.mjs in this same
// directory for why pure logic is copied verbatim elsewhere in this repo).
// The map below is copied verbatim from VerifyPage.tsx — keep both in sync.
// The RAW_PHASE_VALUES list is every `phase:` value
// supabase/functions/research-agent/index.ts writes today (grep `phase:` in
// that file to re-derive it) — keep that list in sync too whenever a new
// stage/phase is added there.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const PHASE_LABEL_KEYS = {
  queued: 'verify_phase_queued',
  identity: 'verify_phase_identity',
  identity_complete: 'verify_phase_identity_complete',
  official_browser: 'verify_phase_official_browser',
  captcha_required: 'verify_phase_captcha_required',
  official_browser_complete: 'verify_phase_official_browser_complete',
  enreg_entity: 'verify_phase_enreg_entity',
  rstax_entity: 'verify_phase_rstax_entity',
  debtor_entity: 'verify_phase_debtor_entity',
  official_collection: 'verify_phase_official_collection',
  official_complete: 'verify_phase_official_complete',
  public_research: 'verify_phase_public_research',
  public_research_complete: 'verify_phase_public_research_complete',
  market: 'verify_phase_market',
  market_complete: 'verify_phase_market_complete',
  synthesis: 'verify_phase_synthesis',
  complete: 'verify_phase_complete',
};

// Every progress.phase value research-agent/index.ts's finish()/launch()/
// startBrowser()/pollFinancialEntity()/startFinancialEntity() write today.
const RAW_PHASE_VALUES = [
  'queued',
  'identity', 'official_collection', 'public_research', 'market', 'synthesis', // s.toLowerCase() for each pipeline stage
  'identity_complete',
  'official_browser',
  'captcha_required',
  'official_browser_complete',
  'enreg_entity', 'rstax_entity', 'debtor_entity', // `${source}_entity` for source in ['enreg','rstax','debtor']
  'official_complete',
  'public_research_complete',
  'market_complete',
  'complete',
];

// The exact lookup VerifyPage.tsx performs at render time.
function resolvePhaseLabelKey(phase) {
  return PHASE_LABEL_KEYS[String(phase || '')] || 'verify_loading_phase_fallback';
}

test('every phase value research-agent/index.ts can write today has a dedicated, non-fallback translation key', () => {
  for (const phase of RAW_PHASE_VALUES) {
    const key = resolvePhaseLabelKey(phase);
    assert.notEqual(key, 'verify_loading_phase_fallback', `phase "${phase}" must map to its own key, not silently fall back to the generic one`);
    assert.equal(key, PHASE_LABEL_KEYS[phase]);
  }
});

test('no two distinct raw phase values collide on the same translation key', () => {
  const keys = RAW_PHASE_VALUES.map(resolvePhaseLabelKey);
  assert.equal(new Set(keys).size, keys.length, 'each phase must render distinguishable text to the customer');
});

test('an unrecognized/future phase value falls back to the generic, translated fallback key rather than ever rendering a raw token', () => {
  assert.equal(resolvePhaseLabelKey('some_brand_new_internal_stage_name'), 'verify_loading_phase_fallback');
  assert.equal(resolvePhaseLabelKey(undefined), 'verify_loading_phase_fallback');
  assert.equal(resolvePhaseLabelKey(null), 'verify_loading_phase_fallback');
  assert.equal(resolvePhaseLabelKey(''), 'verify_loading_phase_fallback');
});

test('no translation key value is itself a raw snake_case phase token (guards against a copy-paste key-as-value mistake)', () => {
  for (const [phase, key] of Object.entries(PHASE_LABEL_KEYS)) {
    assert.notEqual(key, phase);
    assert.ok(key.startsWith('verify_phase_'), `${key} should follow the verify_phase_* naming convention`);
  }
});

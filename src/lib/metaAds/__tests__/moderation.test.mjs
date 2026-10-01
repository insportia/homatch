// What an admin approval of a held claim means: the review closes, the exact
// approved text is not held again, the campaign returns to the normal check —
// and nothing is ever launched, published, resumed or spent by approving.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { claimFingerprint, approvedClaim, openClaimCase, afterApproval, claimText, CLAIM_FLAG } from '../moderation.ts';
import { canTransition } from '../strategy.ts';

const read = (p) => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8');
const engine = read('supabase/functions/meta-ads-api/engine.ts');
const actions = read('supabase/functions/meta-ads-api/actions.ts');
const caseBody = (src, name) => {
  const start = src.indexOf(`case '${name}':`);
  const rest = src.slice(start + 1);
  return rest.slice(0, rest.search(/\n {6}(case '|default:)/));
};
const decide = caseBody(actions, 'admin_moderation_decide');

const creative = { headline: 'Vake 2BR', primary_text: 'Guaranteed profit from day one.', description: null };

test('the fingerprint names exactly the approved words: same text, same print; any edit, a new one', async () => {
  const a = await claimFingerprint(creative);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(await claimFingerprint({ ...creative }), a);
  assert.notEqual(await claimFingerprint({ ...creative, primary_text: 'Guaranteed profit from day two.' }), a);
  assert.notEqual(await claimFingerprint({ ...creative, headline: 'Vake 3BR' }), a);
  assert.equal(claimText(creative), 'Vake 2BR\nGuaranteed profit from day one.\n');
});

test('an approved claim is not held again; an edited one, another creative, or a rejection still is', async () => {
  const fp = await claimFingerprint(creative);
  const cases = [{ id: 'm1', creative_id: 'cr1', status: 'APPROVED', findings: { flags: [CLAIM_FLAG], claim_fingerprint: fp } }];
  assert.equal(approvedClaim(cases, 'cr1', fp)?.id, 'm1');
  assert.equal(approvedClaim(cases, 'cr1', await claimFingerprint({ ...creative, primary_text: 'Guaranteed income.' })), null, 'edited text is reviewed afresh');
  assert.equal(approvedClaim(cases, 'cr2', fp), null, 'approval is per creative');
  assert.equal(approvedClaim([{ ...cases[0], status: 'REJECTED' }], 'cr1', fp), null);
  assert.equal(approvedClaim([{ ...cases[0], status: 'OPEN' }], 'cr1', fp), null);
});

test('a review already waiting is never opened twice', async () => {
  const fp = await claimFingerprint(creative);
  assert.equal(openClaimCase([{ id: 'o1', creative_id: 'cr1', status: 'OPEN', findings: { claim_fingerprint: fp } }], 'cr1', fp)?.id, 'o1');
  assert.equal(openClaimCase([{ id: 'o0', creative_id: 'cr1', status: 'OPEN', findings: { flags: [CLAIM_FLAG] } }], 'cr1', fp)?.id, 'o0', 'an older case without a print');
  assert.equal(openClaimCase([{ id: 'o2', creative_id: 'cr1', status: 'APPROVED', findings: { claim_fingerprint: fp } }], 'cr1', fp), null);
});

test('approval returns a held campaign to the normal check — never to READY, never past it', () => {
  assert.deepEqual(afterApproval('MANUAL_REVIEW', 0), { status: 'PREFLIGHT_REQUIRED', next: 'RUN_PREFLIGHT' });
  assert.deepEqual(afterApproval('MANUAL_REVIEW', 1), { status: null, next: 'OTHER_REVIEWS_OPEN' }, 'another creative is still held');
  for (const s of ['NEEDS_CHANGES', 'REJECTED', 'READY', 'ACTIVE', 'PAUSED', 'DRAFT']) assert.deepEqual(afterApproval(s, 0), { status: null, next: 'NONE' }, s);
  assert.ok(canTransition('MANUAL_REVIEW', 'PREFLIGHT_REQUIRED'));
  assert.ok(!canTransition('MANUAL_REVIEW', 'LAUNCHING') && !canTransition('MANUAL_REVIEW', 'ACTIVE'));
  // The next step is the ordinary check, which builds the plan or says what is missing.
  assert.ok(canTransition('PREFLIGHT_REQUIRED', 'READY') && canTransition('PREFLIGHT_REQUIRED', 'NEEDS_CHANGES'));
});

test('the HOMATCH check honours an approval and never duplicates an open review', () => {
  assert.match(engine, /from\('meta_moderation_cases'\)\.select\('id,creative_id,status,findings'\)\.eq\('campaign_id', c\.id\)/);
  assert.match(engine, /approved = approvedClaim\(modCases \?\? \[\], cr\.id, claimFp\);\s*if \(!approved\) flags\.push\(CLAIM_FLAG\);/);
  assert.match(engine, /if \(status === 'MANUAL_REVIEW' && claimFp && !openClaimCase\(modCases \?\? \[\], cr\.id, claimFp\)\)/);
  assert.match(engine, /findings: \{ flags, claim_fingerprint: claimFp \}/);
  // Every other creative rule still applies to an approved creative.
  for (const f of ['NO_MEDIA', 'PRIMARY_TEXT_REQUIRED', 'HEADLINE_REQUIRED', 'TEXT_TOO_LONG', 'MEDIA_INCOMPATIBLE']) assert.ok(engine.includes(`flags.push('${f}')`), f);
});

test('admin approval: admin only, OPEN only, note, decided_by, approved print, audit with actor/reason/before/after', () => {
  assert.match(decide, /if \(!me\.is_admin \|\| me\.suspended_at\) return json\(\{ error: 'forbidden', code: 'FORBIDDEN' \}, 403\);/);
  assert.match(decide, /REASON_REQUIRED/);
  assert.match(decide, /if \(kase\.status !== 'OPEN'\)/);
  assert.match(decide, /\.eq\('id', id\)\.eq\('status', 'OPEN'\)/, 'a stale screen cannot re-decide');
  assert.match(decide, /decided_by: uid/);
  assert.match(decide, /claim_fingerprint: fp, approval: \{ by: uid, at: now, note \}/);
  assert.match(decide, /afterApproval\(c\.status, count \?\? 0\)/);
  assert.match(decide, /update\(\{ status: after\.status, preflight: null \}\)/, 'the stale check is cleared, so the builder asks for a fresh one');
  assert.match(decide, /x\.audit\(sb, uid, `META_MODERATION_\$\{decision\}`, id, \{[\s\S]*note,[\s\S]*before: \{ case: 'OPEN', campaign: campaignBefore \},[\s\S]*after: \{ case: decision, campaign: campaignStatus \?\? campaignBefore \}/);
});

test('approval alone never launches, publishes, resumes, pauses or spends', () => {
  for (const forbidden of [/publishCampaign/, /syncCampaign/, /setCampaignStatus/, /setAdStatus/, /changePlan/, /endCampaign/, /graph\(/, /meta_ads_ledger/,
    /'LAUNCHING'/, /'ACTIVE'/, /'READY'/, /reserve/i, /rpc\(/]) {
    assert.doesNotMatch(decide, forbidden, String(forbidden));
  }
  // Launch is untouched: still needs READY and a passing, current check with a plan.
  const index = read('supabase/functions/meta-ads-api/index.ts');
  assert.match(index, /if \(c\.status !== 'READY' \|\| c\.preflight\?\.status !== 'READY'\)/);
  assert.match(index, /if \(\(await configFingerprint\(sb, c\)\) !== c\.preflight\?\.fingerprint \|\| !c\.plan\)/);
});

test('customers see the hold and the next step, admins see what approval did', () => {
  const dash = read('src/components/metaAds/workspace/GlobalDashboard.tsx');
  assert.match(dash, /u === 'HOMATCH_REVIEW'[\s\S]*mm_w_note_homatch_review/);
  assert.match(dash, /row\.status === 'PREFLIGHT_REQUIRED' \? 'mm_w_warn_recheck'/);
  assert.match(read('src/components/metaAds/builder/steps.ts'), /c\.preflight\?\.status === 'READY' \? null : 'madsb_gap_preflight'/, 'a cleared check is a visible gap in the builder');
  assert.match(read('src/pages/admin/AdminMetaAdsPage.tsx'), /data\?\.next === 'RUN_PREFLIGHT' \? t\('mm_a_mod_next_preflight'\)/);
});

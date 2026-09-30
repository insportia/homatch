// HOMATCH NOW answers from stored facts, respects where the campaign is, and
// never claims autonomy the code does not have.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assistantAnswers, lastExternalChange, phaseOf } from '../assistant.ts';

const read = (p) => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8');
const base = { hasDelivery: false, openRecommendations: 0, actionableRecommendations: 0, needsAttention: 0, lastExternal: null, lastSyncedAt: null };

test('phases follow Meta\'s status, and ACTIVE without delivery is "waiting", not "delivering"', () => {
  assert.equal(phaseOf('META_REVIEW', false), 'REVIEW');
  assert.equal(phaseOf('ACTIVE', false), 'WAITING_DATA');
  assert.equal(phaseOf('ACTIVE', true), 'DELIVERING');
  assert.equal(phaseOf('PAUSED', true), 'PAUSED');
  assert.equal(phaseOf('COMPLETED', true), 'ENDED');
  assert.equal(phaseOf('DRAFT', false), 'NOT_LAUNCHED');
});

test('a paused campaign is watched for a restart, and the next step is resuming from HOMATCH', () => {
  const a = assistantAnswers({ ...base, status: 'PAUSED' });
  assert.equal(a.watched, true);
  assert.equal(a.watching, 'mm_as_watch_paused');
  assert.equal(a.found, 'mm_as_found_PAUSED');
  assert.equal(a.next, 'mm_as_next_PAUSED');
  assert.equal(a.nextTab, null);
});

test('an outside change is reported as found; attention outranks it and points to Guard', () => {
  const ext = { type: 'CAMPAIGN_PAUSED_OUTSIDE', at: '2026-09-30T18:45:02Z' };
  assert.equal(assistantAnswers({ ...base, status: 'PAUSED', lastExternal: ext }).found, 'mm_as_found_paused_outside');
  assert.equal(assistantAnswers({ ...base, status: 'PAUSED', lastExternal: { ...ext, type: 'EXTERNAL_MODIFICATION' } }).found, 'mm_as_found_changed_outside');
  const att = assistantAnswers({ ...base, status: 'ACTIVE', needsAttention: 2, lastExternal: ext });
  assert.equal(att.found, 'mm_as_found_attention');
  assert.deepEqual(att.foundVars, { n: 2 });
  assert.equal(att.nextTab, 'integrity');
});

test('recommendations are offered for review only while delivering, and only actionable ones get a button', () => {
  const r = assistantAnswers({ ...base, status: 'ACTIVE', hasDelivery: true, openRecommendations: 2, actionableRecommendations: 1 });
  assert.equal(r.found, 'mm_as_found_recs');
  assert.equal(r.next, 'mm_as_next_review_rec');
  assert.equal(r.nextTab, 'optimization');
  const none = assistantAnswers({ ...base, status: 'ACTIVE', hasDelivery: true, openRecommendations: 1, actionableRecommendations: 0 });
  assert.equal(none.nextTab, null);
  // Paused: a lingering recommendation is not pushed.
  assert.equal(assistantAnswers({ ...base, status: 'PAUSED', openRecommendations: 3, actionableRecommendations: 3 }).nextTab, null);
  assert.equal(assistantAnswers({ ...base, status: 'ACTIVE' }).found, 'mm_as_found_WAITING_DATA');
});

test('only recent outside changes count', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  const ev = [
    { type: 'CAMPAIGN_PAUSED_OUTSIDE', last_seen_at: '2026-09-25T10:00:00Z' },
    { type: 'EXTERNAL_MODIFICATION', last_seen_at: '2026-09-30T18:45:02Z' },
    { type: 'LEAD_RECEIVED', last_seen_at: '2026-10-01T11:00:00Z' },
  ];
  assert.deepEqual(lastExternalChange(ev, now), { type: 'EXTERNAL_MODIFICATION', at: '2026-09-30T18:45:02Z' });
  assert.equal(lastExternalChange(ev.slice(0, 1), now), null);
});

test('every answer key exists in all six locales, and the copy claims no autonomy', () => {
  const tr = read('src/i18n/translations.ts');
  const src = read('src/lib/metaAds/assistant.ts');
  const phases = ['REVIEW', 'WAITING_DATA', 'DELIVERING', 'PAUSED', 'ENDED', 'REJECTED', 'NOT_LAUNCHED'];
  const keys = [
    ...phases.flatMap((p) => [`mm_as_found_${p}`, `mm_as_doing_${p}`, `mm_as_next_${p}`]),
    'mm_as_watch_live', 'mm_as_watch_paused', 'mm_as_watch_none', 'mm_as_found_attention', 'mm_as_found_recs',
    'mm_as_found_paused_outside', 'mm_as_found_resumed_outside', 'mm_as_found_status_changed', 'mm_as_found_changed_outside',
    'mm_as_next_attention', 'mm_as_next_review_rec', 'mm_as_control', 'mm_as_hero', 'mm_as_monitoring',
  ];
  for (const k of keys) assert.equal((tr.match(new RegExp(`^  ${k}:`, 'gm')) ?? []).length, 6, k);
  assert.match(tr, /mm_as_hero: 'თქვენ განსაზღვრავთ მიზანს\. HOMATCH მართავს პროცესს\.'/);
  assert.match(tr, /mm_as_monitoring: 'HOMATCH აკვირდება ამ კამპანიას'/);
  // The control line says recommendations need confirmation and Guard is the only automatic actor.
  assert.match(tr, /mm_as_control: 'HOMATCH recommends; nothing changes without your confirmation\. Only Campaign Guard can pause on its own/);
  assert.doesNotMatch(tr, /mm_as_[a-z_A-Z]+: '[^'\n]*(automatically optimi[sz]|autopilot|ავტომატურად ოპტიმ)/i);
  assert.match(src, /meta_ads_autopilot_enabled` is off and unused/);
});

test('the campaign page shows HOMATCH NOW and a rename that only touches the HOMATCH name', () => {
  const page = read('src/pages/outreach/MetaAdsCampaignPage.tsx');
  assert.match(page, /<AssistantPanel t=\{t\} fmt=\{fmt\} d=\{d\} onOpenTab=\{setTab\} \/>/);
  assert.match(page, /<CampaignNameButton/);
  const actions = read('supabase/functions/meta-ads-api/actions.ts');
  const rename = actions.slice(actions.indexOf("case 'campaign_rename'"), actions.indexOf("case 'campaign_detail'"));
  assert.match(rename, /ownCampaign\(sb, uid, body\.campaignId\)/, 'owner only');
  assert.match(rename, /name\.length < 3 \|\| name\.length > 120/);
  assert.match(rename, /\.update\(\{ name \}\)\.eq\('id', c\.id\)\.eq\('user_id', uid\)/, 'only the name column');
  assert.doesNotMatch(rename, /graph\(|graphAll\(/, 'nothing is sent to Meta');
  assert.match(rename, /timeline\(sb, c, 'RENAMED', 'tl_renamed', \{ from: c\.name \?\? null, to: name \}\)/, 'audited with before and after');
  assert.match(read('src/components/metaAds/campaign/OptimizationSection.tsx'), /'tl_renamed'/);
  // The launch name is not in the check fingerprint, so a rename never forces a new check.
  const engine = read('supabase/functions/meta-ads-api/engine.ts');
  const fp = engine.slice(engine.indexOf('export async function configFingerprint'), engine.indexOf('export async function configFingerprint') + 900);
  assert.doesNotMatch(fp, /name:/);
  const create = read('src/pages/outreach/MetaAdsCreatePage.tsx');
  assert.match(create, /defaultCampaignName\(\{ subject: advertised/);
  assert.match(create, /if \(!campaign\.name\?\.trim\(\)\) await updateMetaDraft\(campaign\.id, \{ name: nameSuggestion \}\)/);
});

test('the admin Meta API health panel reads percentages only and masks account ids', async () => {
  const panel = read('src/components/admin/metaAds/ApiHealthPanel.tsx');
  assert.match(panel, /from\('meta_api_usage'\)/);
  assert.doesNotMatch(panel, /access_token|app_secret|appsecret/i);
  assert.match(panel, /maskBucket/);
  assert.match(read('src/pages/admin/AdminMetaAdsPage.tsx'), /tab === 'api' && <ApiHealthPanel \/>/);
});

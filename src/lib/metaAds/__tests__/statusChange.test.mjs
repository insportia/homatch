// A status change seen at reconciliation → at most one notification, with the
// provenance the evidence proves and no more.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyStatusChange, statusChangeEvent } from '../statusChange.ts';
import { EVENT_META, route } from '../events.ts';
import { renderEvent, stateWord } from '../messages.ts';

const read = (p) => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8');
const ext = { homatchCommandRecently: false };

test('the real event: in Meta review → paused outside HOMATCH → one external-pause notification', () => {
  const ch = classifyStatusChange('META_REVIEW', 'PAUSED', ext);
  assert.deepEqual(ch, { from: 'META_REVIEW', to: 'PAUSED', kind: 'PAUSED', provenance: 'EXTERNAL_CHANGE' });
  assert.deepEqual(statusChangeEvent(ch), { type: 'CAMPAIGN_PAUSED_OUTSIDE', severity: 'IMPORTANT' });
  // In-app always; push when the customer has it; the category cannot be switched off.
  const prefs = { push: true, email: true, performance: false, leads: false, billing: false, dailyBrief: false, weeklyBrief: false };
  assert.deepEqual(route('CAMPAIGN_PAUSED_OUTSIDE', 'IMPORTANT', 'OPEN', prefs, { hasPush: false, hasEmail: true }), ['IN_APP']);
  assert.deepEqual(route('CAMPAIGN_PAUSED_OUTSIDE', 'IMPORTANT', 'OPEN', prefs, { hasPush: true, hasEmail: true }), ['IN_APP', 'PUSH']);
  const ka = renderEvent('CAMPAIGN_PAUSED_OUTSIDE', 'OPEN', 'ka', { campaign: 'Krtsanisi' });
  assert.equal(ka.title, 'კამპანია Meta-ში შეჩერდა');
  assert.match(ka.body, /HOMATCH-მა ცვლილება აღმოაჩინა და კამპანიის მდგომარეობა ავტომატურად განაახლა/);
});

test('still paused on the next pass → nothing', () => {
  assert.equal(classifyStatusChange('PAUSED', 'PAUSED', ext), null);
  assert.equal(statusChangeEvent(null), null);
  // The emitter only runs on a real change, and each change has its own occurrence.
  const index = read('supabase/functions/meta-ads-api/index.ts');
  assert.match(index, /if \(fresh\.status !== before\) \{\s*const n = await statusChangeNotice\(sb, fresh, before, settings\);/);
  const monitor = read('supabase/functions/meta-ads-api/monitor.ts');
  assert.match(monitor, /occurrence: `\$\{change\.from\}>\$\{change\.to\}@\$\{c\.last_synced_at \?\? now\}`/);
});

test('paused → switched on outside HOMATCH → one external-resume notification', () => {
  const ch = classifyStatusChange('PAUSED', 'ACTIVE', ext);
  assert.equal(ch.provenance, 'EXTERNAL_CHANGE');
  assert.deepEqual(statusChangeEvent(ch), { type: 'CAMPAIGN_RESUMED_OUTSIDE', severity: 'IMPORTANT' });
  assert.equal(renderEvent('CAMPAIGN_RESUMED_OUTSIDE', 'OPEN', 'ka', { campaign: 'X' }).title, 'კამპანია Meta-ში განახლდა');
});

test('Meta approving the campaign is a lifecycle event, never "changed outside HOMATCH"', () => {
  for (const from of ['META_REVIEW', 'SUBMITTED']) {
    const ch = classifyStatusChange(from, 'ACTIVE', ext);
    assert.equal(ch.provenance, 'META_LIFECYCLE');
    assert.equal(statusChangeEvent(ch).type, 'CAMPAIGN_ACTIVATED');
  }
  assert.equal(renderEvent('CAMPAIGN_ACTIVATED', 'OPEN', 'ka', { campaign: 'X' }).title, 'თქვენი კამპანია აქტიურია');
  assert.doesNotMatch(renderEvent('CAMPAIGN_ACTIVATED', 'OPEN', 'en', { campaign: 'X' }).body, /outside|Ads Manager/);
  // Ending at its scheduled time is lifecycle too (CAMPAIGN_STOPPED already tells it).
  assert.equal(classifyStatusChange('ACTIVE', 'COMPLETED', { homatchCommandRecently: false, endTimePassed: true }).provenance, 'META_LIFECYCLE');
  assert.equal(statusChangeEvent(classifyStatusChange('ACTIVE', 'COMPLETED', { homatchCommandRecently: false, endTimePassed: true })), null);
});

test('HOMATCH\'s own commands are not re-announced; an unreadable log never claims "outside HOMATCH"', () => {
  assert.equal(statusChangeEvent(classifyStatusChange('ACTIVE', 'PAUSED', { homatchCommandRecently: true })), null);
  assert.equal(statusChangeEvent(classifyStatusChange('PAUSED', 'ACTIVE', { homatchCommandRecently: true })), null);
  const unknown = classifyStatusChange('ACTIVE', 'PAUSED', { homatchCommandRecently: null });
  assert.equal(unknown.provenance, 'UNKNOWN');
  assert.equal(statusChangeEvent(unknown).type, 'CAMPAIGN_STATUS_CHANGED');
  const words = renderEvent('CAMPAIGN_STATUS_CHANGED', 'OPEN', 'ka', { campaign: 'X', state: stateWord('PAUSED', 'ka') });
  assert.equal(words.title, 'Meta-ზე კამპანიის სტატუსი შეიცვალა');
  assert.match(words.body, /შეჩერებული/);
  assert.doesNotMatch(words.body, /HOMATCH-ის გარეთ|Ads Manager/);
  // The HOMATCH-command lookup uses the real column.
  assert.match(read('supabase/functions/meta-ads-api/monitor.ts'), /\.gte\('requested_at', since\)/);
});

test('every new event type is registered, always reaches in-app, and has six-locale words', () => {
  for (const type of ['CAMPAIGN_PAUSED_OUTSIDE', 'CAMPAIGN_RESUMED_OUTSIDE', 'CAMPAIGN_ACTIVATED', 'CAMPAIGN_STATUS_CHANGED', 'CAMPAIGN_BUDGET_CHANGED_OUTSIDE', 'CAMPAIGN_SCHEDULE_CHANGED_OUTSIDE']) {
    assert.ok(EVENT_META[type], `${type} registered`);
    assert.ok(['lifecycle', 'integrity'].includes(EVENT_META[type].preference), `${type} cannot be switched off`);
    for (const loc of ['en', 'ka', 'ru', 'tr', 'ar', 'he']) {
      const w = renderEvent(type, 'OPEN', loc, { campaign: 'C', state: 'x' });
      assert.ok(w.title && w.body && !/\{\{/.test(w.title + w.body), `${type}/${loc}`);
    }
  }
});

test('notification text: the recipient\'s language, a name that is never blank, status codes in words', () => {
  const notifier = read('supabase/functions/meta-ads-api/notifier.ts');
  assert.match(notifier, /select\('email,preferred_language'\)/, 'users.language does not exist; selecting it broke locale and email');
  assert.doesNotMatch(notifier, /select\('[^']*\blanguage,/);
  assert.match(notifier, /String\(campaign\?\.name \?\? ''\)\.trim\(\) \|\| t6\(CAMPAIGN_FALLBACK, recipient\.locale\)/);
  assert.match(notifier, /out\.what = stateWord\(facts\.what, locale\) \?\? facts\.what;/);
  assert.equal(stateWord('SUBMITTED', 'ka'), 'გაგზავნილია Meta-ში');
  assert.doesNotMatch(read('supabase/functions/_shared/metaLeads.ts'), /select\('preferred_language,language'\)/);
  // Guard no longer sends its generic alert for a pause/resume; edits get specific words.
  const monitor = read('supabase/functions/meta-ads-api/monitor.ts');
  assert.match(monitor, /\(d\.action === 'MANUAL_PAUSE' \|\| d\.action === 'MANUAL_RESUME'\) && d\.decision\.action !== 'PAUSE_CAMPAIGN'\) return null;/);
  assert.match(monitor, /fields\.has\('daily_budget'\)[\s\S]*'CAMPAIGN_BUDGET_CHANGED_OUTSIDE'/);
});

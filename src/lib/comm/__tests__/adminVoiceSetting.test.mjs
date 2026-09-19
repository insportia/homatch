/*
 * CHANGING MARIAM'S VOICE MUST NOT REQUIRE A DEPLOYMENT.
 *
 * Three voices in one day, each one a uuid pasted out of the Cartesia
 * dashboard, and each one cost a code edit, a migration edit, a full gate, a
 * push and a fifteen-minute CI run. The value was never the problem; where it
 * lived was. It lives in admin_settings now -- the table every other AI Talk
 * setting already lives in -- and aiTalkVoice() reads it on the way to every
 * spoken phrase, for every language.
 *
 * What these protect is the shape of that, because the failure modes are
 * quiet: a setting nothing reads, a preview that silently changes production,
 * a hardcoded id that outranks the setting, or a malformed value that makes
 * the product mute instead of falling back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const EDGE = code(read('supabase/functions/ai-talk-session/index.ts'));
const PANEL = read('src/components/admin/CommunicationsVoicePanel.tsx');
const PANEL_CODE = code(PANEL);
const SERVICE = read('src/services/communications.ts');
const SERVICE_CODE = code(SERVICE);
const I18N = read('src/i18n/translations.ts');
const MIGRATION = read('supabase/migrations/20260919210000_mariam_is_the_voice.sql');

const ACTIVE = 'eb629e3f-3223-4e71-9d46-72637532270b';

/* ── The source of truth ─────────────────────────────────────────────────*/

test('the runtime asks the setting before it asks anything else', () => {
  assert.match(EDGE, /async function configuredVoice\(sb: Sb\)/);
  assert.match(EDGE, /\.eq\('key', 'ai_talk_voice'\)/);
  // Read alongside the route, not after it: this runs before every phrase.
  assert.match(EDGE, /Promise\.all\(\[[\s\S]{0,400}configuredVoice\(sb\),/);
  // And it wins, for every language, before the per-language lookup.
  const fn = EDGE.slice(EDGE.indexOf('async function aiTalkVoice'));
  const decide = fn.indexOf("if (configured.voiceId && provider === 'CARTESIA')");
  const perLanguage = fn.indexOf("from('voice_language_defaults')");
  assert.ok(decide > 0, 'the configured voice is no longer preferred');
  assert.ok(decide < perLanguage, 'the per-language rows now outrank the setting');
});

test('one setting answers for all six languages', () => {
  const fn = EDGE.slice(EDGE.indexOf('async function aiTalkVoice'), EDGE.indexOf('async function aiTalkVoice') + 2200);
  // No per-language branching around the configured value: it is returned for
  // whatever language was asked for.
  assert.ok(
    !/configured[\s\S]{0,120}(code === '|language === ')/.test(fn),
    'the configured voice is being applied to only some languages',
  );
  assert.match(fn, /if \(configured.voiceId && provider === 'CARTESIA'\) \{/);
});

test('an unusable setting falls back rather than silencing the product', () => {
  const fn = EDGE.slice(EDGE.indexOf('async function configuredVoice'), EDGE.indexOf('async function aiTalkVoice'));
  assert.match(fn, /let voiceId: string \| null = null;/);
  assert.match(fn, /VOICE_ID_SHAPE\.test\(id\)/);
  assert.match(fn, /voice_setting_invalid/, 'a malformed setting is swallowed silently');
  // The per-language rows are still there to fall back to, and still
  // fail-closed if a language has none.
  assert.match(EDGE, /code: 'VOICE_NOT_APPROVED_FOR_LANGUAGE'/);
});

test('no hardcoded id outranks the setting', () => {
  const fn = EDGE.slice(EDGE.indexOf('async function aiTalkVoice'), EDGE.indexOf('async function aiTalkVoice') + 2200);
  assert.ok(!/MARIAM_VOICE_ID/.test(fn), 'the constant is back in the resolution path');
  // The constant still exists for the legacy non-streaming actions, and it
  // must not be a different voice from the one that is configured.
  assert.match(EDGE, new RegExp(`const MARIAM_VOICE_ID = '${ACTIVE}';`));
});

test('a fresh environment resolves the same way production does', () => {
  assert.match(MIGRATION, /insert into public\.admin_settings \(key, value, description\)/);
  assert.ok(MIGRATION.includes("'ai_talk_voice'"), 'the setting is not seeded');
  assert.ok(MIGRATION.includes(ACTIVE), 'the seeded voice is not the active one');
  assert.match(MIGRATION, /on conflict \(key\) do update/, 'seeding twice would fail');
});

/* ── Admin ───────────────────────────────────────────────────────────────*/

test('the Admin screen can change the voice without a deployment', () => {
  assert.match(SERVICE_CODE, /export function getAiTalkVoice\(\)/);
  assert.match(SERVICE_CODE, /export async function saveAiTalkVoice\(/);
  assert.match(SERVICE_CODE, /writeSetting\(\s*'ai_talk_voice'/);
  // The same settings writer every other control on this screen uses.
  assert.equal((SERVICE_CODE.match(/async function writeSetting/g) ?? []).length, 1,
    'a second settings writer appeared');
  assert.ok(!/ai_talk_voice_config|voice_settings|mariam_voice_table/.test(SERVICE_CODE + EDGE),
    'a parallel settings system was introduced');
});

test('a malformed id cannot be saved, and says so', () => {
  assert.match(SERVICE_CODE, /export const VOICE_ID_SHAPE = \/\^\[0-9a-f\]\{8\}-/);
  const save = SERVICE_CODE.slice(SERVICE_CODE.indexOf('export async function saveAiTalkVoice'));
  assert.match(save.slice(0, 400), /if \(!VOICE_ID_SHAPE\.test\(id\)\) return false;/);
  // And the screen refuses before it ever calls the service.
  assert.match(PANEL_CODE, /if \(!VOICE_ID_SHAPE\.test\(id\)\) \{[\s\S]{0,80}admin_talk_voice_invalid/);
});

test('Test Voice auditions through the production path and writes nothing', () => {
  assert.match(EDGE, /async function voicePreview\(/);
  // The same function a real reply goes through, with an explicit voice.
  assert.match(EDGE, /const out = await speakPhraseStreaming\(sb, \{[\s\S]{0,300}voice: \{ provider: 'CARTESIA', voiceId \}/);
  const preview = EDGE.slice(EDGE.indexOf('async function voicePreview'), EDGE.indexOf('async function heartbeat'));
  assert.ok(!/writeSetting|admin_settings|voice_language_defaults|update\(/.test(preview),
    'the preview mutates configuration');
  // Admin only, decided from the verified token.
  assert.match(preview, /usageTier !== 'ADMIN_UNLIMITED'/);
  assert.match(preview, /VOICE_ID_SHAPE\.test\(voiceId\)/);
});

test('an audition is metered, and not as a conversation', () => {
  const preview = EDGE.slice(EDGE.indexOf('async function voicePreview'), EDGE.indexOf('async function heartbeat'));
  assert.match(preview, /surface: 'AI_TALK_VOICE_PREVIEW'/);
  // speakPhraseStreaming prices and records; the preview must not be given a
  // session id, or a test would land in a visitor's conversation costs.
  assert.match(preview, /sessionId: null/);
  assert.match(EDGE, /costBasis: 'CALCULATED'/);
});

test('the screen says which voice is actually live', () => {
  // The difference between what is typed and what is saved is the whole
  // safety of the control: an unsaved box that looks saved is how somebody
  // walks away believing the voice changed.
  assert.match(PANEL_CODE, /savedVoiceId === voiceId\.trim\(\)/);
  for (const key of ['admin_talk_voice_active', 'admin_talk_voice_unsaved', 'admin_talk_voice_unset']) {
    assert.ok(PANEL.includes(key), `${key} is not rendered`);
    const rows = I18N.match(new RegExp(`^  ${key}: '`, 'gm')) ?? [];
    assert.equal(rows.length, 6, `${key} is in ${rows.length} locales, not six`);
  }
});

test('the model is shown but not editable, because nothing would read it', () => {
  assert.match(PANEL, /id="mariam-voice-model" value="sonic-3" readOnly disabled/);
  assert.ok(!/model_id: /.test(PANEL_CODE), 'the panel is writing a model nothing reads');
  const rows = I18N.match(/^  admin_talk_voice_model_hint: '/gm) ?? [];
  assert.equal(rows.length, 6);
});

test('the change is recorded, and carries no secret', () => {
  const save = SERVICE_CODE.slice(SERVICE_CODE.indexOf('export async function saveAiTalkVoice'));
  assert.match(save, /rpc\('log_admin_audit'/, 'the existing audit table is not used');
  assert.match(save, /p_action: 'AI_TALK_VOICE_CHANGED'/);
  for (const field of ['old_voice_id', 'new_voice_id', 'model', 'changed_at']) {
    assert.ok(save.includes(field), `the audit row has no ${field}`);
  }
  assert.match(save, /auth\.getUser\(\)/, 'changed_by is not the caller');
  assert.ok(!/CARTESIA_API_KEY|apiKey|secret/i.test(save), 'a provider secret is in the audit path');
});

test('how fast she talks is a dial, not a deployment', () => {
  // It was AI_TALK_TTS_SPEED, an environment variable, so "a bit slow" was a
  // secret change and a redeploy.
  assert.match(EDGE, /const rawSpeed = Number\(raw\?\.speed\);/);
  assert.match(EDGE, /rawSpeed >= 0\.6 && rawSpeed <= 1\.5/);
  assert.match(EDGE, /voice_speed_setting_invalid/, 'an out-of-range speed is swallowed');
  // Resolved once with the voice, not read per phrase: this runs before every
  // spoken phrase and a second round trip would be audible.
  assert.match(EDGE, /speed: voice\.speed \?\? ttsSpeed\(\)/);
  // The environment variable stays as the fallback for a deployment with no
  // setting, so nothing breaks where the row does not exist.
  assert.match(EDGE, /AI_TALK_TTS_SPEED/);

  // Refused rather than clamped on the way in.
  const save = SERVICE_CODE.slice(SERVICE_CODE.indexOf('export async function saveAiTalkVoice'));
  assert.match(save.slice(0, 600), /speed >= 0\.6 && speed <= 1\.5/);
  const rows = I18N.match(/^  admin_talk_voice_speed: '/gm) ?? [];
  assert.equal(rows.length, 6, 'the speed label is not in six locales');
});

/* ── What must not have moved ────────────────────────────────────────────*/

test('the voice swap took nothing else with it', () => {
  assert.match(EDGE, /streamCartesiaPcm/);
  assert.match(EDGE, /GOOGLE_STT_MODEL/);
  assert.match(EDGE, /decideGrant\(/);
  assert.match(EDGE, /recordTurnUsage/);
  assert.match(EDGE, /rpc\('is_admin'\)/);
  assert.match(EDGE, /You are Mariam, Homatch's AI assistant/);
  const cartesia = read('supabase/functions/_shared/comm/cartesia.ts');
  assert.match(cartesia, /const TTS_MODELS = \['sonic-3', 'sonic-2', 'sonic-english', 'sonic'\];/);
  assert.match(cartesia, /container: 'raw', encoding: 'pcm_s16le'/);
});

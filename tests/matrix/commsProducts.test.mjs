// TWO PRODUCTS, TWO DISCIPLINES — the master mandate's hard lines, held.
//
// HOMATCH AI is the intelligent conversation: selective web, validated
// chips, billing through the ledger. Live Chat is human conversation:
// database + realtime + storage + deterministic UI, and NO model call in
// any message path. These tests pin the boundaries that would otherwise
// erode one convenient commit at a time.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');

/* ────────────────────────────────────────────────────────────────────────
 * LIVE CHAT: no AI anywhere in the message path
 * ──────────────────────────────────────────────────────────────────────── */

test('Live Chat never invokes a model — for any message, media, reaction or save', () => {
  for (const file of [
    ['src', 'pages', 'LiveChatPage.tsx'],
    ['src', 'services', 'liveChat.ts'],
  ]) {
    const body = read(...file);
    assert.ok(!/homatch-ai|functions\/v1|openai|anthropic|useAIChat|invokeAI|web_search/i.test(body),
      `${file.join('/')} reaches for AI — Live Chat is database + realtime + storage + deterministic UI`);
  }
});

test('the starter chips are deterministic templates that fill the composer', () => {
  const page = read('src', 'pages', 'LiveChatPage.tsx');
  assert.match(page, /live_chat_starter_hello/);
  /* A tap PLACES the text for editing — setText — and never auto-sends. */
  assert.match(page, /onClick=\{\(\) => setText\(t\(key\)\)\}/,
    'starters must fill the composer, not send on the user\'s behalf');
});

/* ────────────────────────────────────────────────────────────────────────
 * LIVE CHAT: media discipline — 60s voice, sender-owned paths, private bucket
 * ──────────────────────────────────────────────────────────────────────── */

const MIGRATION = read('supabase', 'migrations', '20260929120000_live_chat_messenger_v2.sql');

test('voice is capped at 60 seconds on the SERVER, not just in the recorder', () => {
  assert.match(MIGRATION, /duration_seconds'\)::numeric <= 60/,
    'the DB no longer enforces the 60-second ceiling');
  const service = read('src', 'services', 'liveChat.ts');
  assert.match(service, /LIVE_CHAT_VOICE_MAX_SECONDS = 60/,
    'the client constant drifted from the DB rule');
  const page = read('src', 'pages', 'LiveChatPage.tsx');
  assert.match(page, /LIVE_CHAT_VOICE_MAX_SECONDS && rec\.state === 'recording'\) rec\.stop\(\)/,
    'the recorder no longer hard-stops at the ceiling');
});

test('a message can only reference media under its own sender\'s prefix', () => {
  assert.match(MIGRATION, /media_path LIKE \(user_id::text \|\| '\/%'\)/,
    'the sender-prefix CHECK is gone — anyone could attach anyone\'s upload');
  assert.match(MIGRATION, /\(storage\.foldername\(name\)\)\[1\] = public\.auth_user_id\(\)::text/,
    'the storage policy no longer confines uploads to the uploader\'s folder');
});

test('the media bucket is private with bounded size and MIME', () => {
  assert.match(MIGRATION, /'live-chat-media', false, 8388608/,
    'the bucket became public or lost its size limit');
  assert.ok(!/'live-chat-media', true/.test(MIGRATION));
});

test('reactions palette: the UI offers exactly what the DB accepts', () => {
  const service = read('src', 'services', 'liveChat.ts');
  const m = /LIVE_CHAT_REACTIONS = \[([^\]]+)\]/.exec(service);
  assert.ok(m, 'reaction palette constant missing');
  const uiEmojis = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  const dbम = /emoji IN \(([^)]+)\)/.exec(MIGRATION);
  const dbEmojis = [...dbम[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  assert.deepEqual(uiEmojis, dbEmojis,
    'the UI palette and the DB CHECK drifted apart — one side will reject the other');
});

test('saved messages are private: owner-only policy, and nothing notifies', () => {
  assert.match(MIGRATION, /live_chat_saved_own ON public\.live_chat_saved\s+FOR ALL USING \(user_id = public\.auth_user_id\(\)\)/,
    'the bookmark table lost its owner-only policy');
  assert.ok(!/notify_emit[\s\S]*live_chat_saved|live_chat_saved[\s\S]*notify_emit/.test(MIGRATION),
    'saving a message must never notify the other participant');
});

test('the anti-spam system is preserved and its cooldown is surfaced honestly', () => {
  /* v1's 2-second RLS floor and the escalating burst guard are untouched —
     both migration files are history and stay history. */
  const v1 = read('supabase', 'migrations', '20260831130000_live_chat_v1.sql');
  assert.match(v1, /interval '2 seconds'/);
  const guard = read('supabase', 'migrations', '20260911195000_live_chat_escalating_burst_guard.sql');
  assert.match(guard, /LIVE_CHAT_COOLDOWN:%/);
  /* And the page parses the REAL remaining seconds out of that error —
     never an invented number. */
  const page = read('src', 'pages', 'LiveChatPage.tsx');
  assert.match(page, /LIVE_CHAT_COOLDOWN:\(\\d\+\)/, 'the cooldown parser is gone');
  assert.match(page, /live_chat_cooldown_wait/, 'the human cooldown copy is gone');
});

/* ────────────────────────────────────────────────────────────────────────
 * HOMATCH AI: validated actions, honest freshness, no plan-speak
 * ──────────────────────────────────────────────────────────────────────── */

const AI_FN = read('supabase', 'functions', 'homatch-ai', 'index.ts');

test('service actions go through the catalogue validator on the server', () => {
  assert.match(AI_FN, /parseServiceActions\(lead\?\.suggested_actions\)/,
    'the envelope no longer validates model-proposed actions');
  assert.match(AI_FN, /SERVICE_ACTIONS_INSTRUCTION/,
    'the model is no longer told the actions contract');
});

test('the prompt catalogue names the real products at their real routes', () => {
  for (const route of ['/find-property', '/investment', '/brokers', '/contracts', '/mortgage', '/verify']) {
    assert.ok(AI_FN.includes(`(${route})`), `the prompt catalogue lost ${route}`);
  }
});

test('freshness is reported, never claimed', () => {
  assert.match(AI_FN, /webChecked: searchCount > 0/,
    'the envelope no longer says whether this turn really searched');
  const ui = read('src', 'components', 'ai', 'ServiceActions.tsx');
  assert.match(ui, /if \(!webChecked\) return null/,
    'the freshness line would render for turns that never searched');
});

test('web search stays selective: tool_choice auto, charged per call', () => {
  assert.match(AI_FN, /tool_choice: 'auto'/,
    'web search is no longer the model\'s selective decision');
  assert.match(AI_FN, /searchCount/, 'per-call search accounting is gone');
});

test('the fair-use message no longer sells plans HOMATCH does not have', () => {
  assert.ok(!/upgrade your plan|тарифный план|планınızı|გეგმა უფრო/i.test(AI_FN),
    'plan-upsell copy came back — HOMATCH is PAYG only');
});

test('reply chips and action chips stay different species', () => {
  const replies = read('src', 'lib', 'ai', 'suggestedReplies.ts');
  assert.match(replies, /chip cannot open/,
    'the replies module lost its "chips never navigate" contract');
  const actions = read('src', 'lib', 'ai', 'serviceActions.ts');
  assert.match(actions, /can never say anything/,
    'the actions module lost its "actions never speak" contract');
});

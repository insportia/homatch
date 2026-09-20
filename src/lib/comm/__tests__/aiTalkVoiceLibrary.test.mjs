/*
 * A SHELF OF VOICES, AND THE TWO HALVES OF THE BIGGEST NUMBER IN A TURN.
 *
 * Two things, both asked for by the owner after the v111 physical test.
 *
 * THE SHELF. Pasting a uuid, hearing it and saving it already worked; what it
 * did not do was remember. Comparing Nino against Mariam meant keeping two
 * uuids outside the product and pasting them back and forth, and a uuid is
 * exactly the kind of string that loses one character and gets blamed on the
 * voice. The rule that matters is not the cards -- it is that picking one
 * moves the VOICE and nothing else.
 *
 * THE SPLIT. Production session 7d01064e: speech-end to first audio is
 * 2,715ms median and 1,630ms of it -- sixty per cent -- is the STT segment.
 * But speechEndedAtMs is backdated by the silence window, so that number is
 * our endpointer's patience and Google's finalisation added together. Tuning
 * either without knowing which dominates is a guess that risks Georgian
 * quality, so the split is reported BEFORE any behaviour changes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');
const CLIENT = read('src/lib/comm/voiceClient.ts');
const EDGE = read('supabase/functions/ai-talk-session/index.ts');
const CARTESIA = read('supabase/functions/_shared/comm/cartesia.ts');
const SERVICE = read('src/services/communications.ts');
const LIBRARY = read('src/components/admin/AiTalkVoiceLibrary.tsx');
const PANEL = read('src/components/admin/CommunicationsVoicePanel.tsx');

/* ── The latency split, shipped first ────────────────────────────────────*/

test('LATENCY_SPLIT_INSTRUMENTED: our endpointer and Google are reported apart', () => {
  // OURS: voice actually stopped -> we believed the turn ended.
  assert.match(CLIENT, /endpointerWaitMs: speechEnd && confirmed \? Math\.round\(confirmed - speechEnd\) : null/);
  // THEIRS: half-close -> the final arrived.
  assert.match(CLIENT, /endpointConfirmedToFinalMs: confirmed && final \? Math\.round\(final - confirmed\) : null/);
  // ...and both reach the trace, or they are not measurements.
  assert.match(EDGE, /client_endpointer_wait_ms: body\.clientStages\?\.endpointerWaitMs/);
  assert.match(EDGE, /client_endpoint_to_final_ms: body\.clientStages\?\.endpointConfirmedToFinalMs/);
});

test('the segment it splits is still reported whole, so before and after compare', () => {
  assert.match(CLIENT, /speechEndToFinalMs: speechEnd && final \? Math\.round\(final - speechEnd\) : null/);
  assert.match(EDGE, /client_speech_end_to_final_ms: body\.clientStages\?\.speechEndToFinalMs/);
});

test('NO_LATENCY_BEHAVIOUR_CHANGED: the endpointer windows are untouched', () => {
  /*
   * Measuring first was the instruction and it is also the point: these are
   * the numbers a guess would have moved. They may only change once the
   * split above says our patience is the cost rather than Google's.
   */
  assert.match(CLIENT, /const END_TURN_ACK_MS = 300;/);
  assert.match(CLIENT, /const END_TURN_SHORT_MS = 600;/);
  assert.match(CLIENT, /const END_TURN_LONG_MS = 900;/);
  assert.match(CLIENT, /const END_TURN_GREETING_MS = 900;/);
});

/* ── Cartesia metadata: real fields only ─────────────────────────────────*/

test('VOICE_METADATA_FROM_PROVIDER: asked for, never invented', () => {
  assert.match(CARTESIA, /export async function getCartesiaVoice\(voiceId: string\)/);
  assert.match(CARTESIA, /\$\{CARTESIA_API\}\/voices\/\$\{encodeURIComponent\(voiceId\)\}/);
  // Only what the provider returned. A voice with no description gets none.
  assert.match(CARTESIA, /description: typeof v\.description === 'string' \? v\.description : null/);
  // An id the provider does not know is an error, not an empty card.
  assert.match(CARTESIA, /code: 'NOT_FOUND'/);
});

test('the lookup is admin-only and leaks no key', () => {
  const fn = EDGE.slice(EDGE.indexOf('async function voiceLookup'), EDGE.indexOf('async function voicePreview'));
  assert.match(fn, /if \(usageTier !== 'ADMIN_UNLIMITED'\) return json\(\{ ok: false, reason: 'FORBIDDEN' \}, 403\);/);
  assert.match(fn, /VOICE_ID_SHAPE\.test\(voiceId\)/);
  // The response carries four descriptive fields and nothing else.
  assert.ok(!/apiKey|CARTESIA_API_KEY|authorization/i.test(fn), 'a credential is reachable from the lookup response');
});

/* ── The shelf ───────────────────────────────────────────────────────────*/

test('USING_A_VOICE_CHANGES_ONLY_THE_VOICE', () => {
  /*
   * THE WHOLE POINT. saveAiTalkVoice writes `{ voice_id }` when speed is
   * undefined and `{ voice_id, speed }` when it is not, so omitting speed
   * leaves it exactly as configured. Nothing about the recogniser, the model,
   * the prompt, the endpointing, the streaming or the language lives in that
   * key, so this screen cannot move any of it.
   */
  assert.match(LIBRARY, /const ok = await saveAiTalkVoice\(id, activeVoiceId\);/);
  assert.ok(!/saveAiTalkVoice\(id, activeVoiceId, /.test(LIBRARY), 'Use Voice started writing speed too');
  assert.match(SERVICE, /'ai_talk_voice', speed === undefined \? \{ voice_id: id \} : \{ voice_id: id, speed \}/);
  // The library is its own key and is never read by a spoken turn.
  assert.match(SERVICE, /readSetting<\{ voices\?: SavedVoice\[\] \}>\('ai_talk_voice_library'\)/);
  assert.ok(!EDGE.includes('ai_talk_voice_library'), 'the edge started reading the presentation library');
});

test('AN_INVALID_ID_NEVER_REACHES_PRODUCTION', () => {
  // Resolved against Cartesia on the way ONTO the shelf...
  assert.match(LIBRARY, /const found = await lookupCartesiaVoice\(id\);/);
  assert.match(LIBRARY, /if \(!found\.ok\) \{/);
  // ...so a failed lookup returns before the card exists, and Use Voice can
  // only ever be pressed on a card.
  const add = LIBRARY.slice(LIBRARY.indexOf('const onAdd'), LIBRARY.indexOf('const onPreview'));
  assert.ok(add.indexOf('return;') < add.indexOf('persist(['), 'a card is created before the id is verified');
  // Shape is refused even earlier, in the service, in both directions.
  assert.match(SERVICE, /if \(!VOICE_ID_SHAPE\.test\(id\)\) return \{ ok: false, reason: 'VOICE_ID_INVALID' \};/);
  assert.match(SERVICE, /if \(!VOICE_ID_SHAPE\.test\(id\) \|\| seen\.has\(id\)\) continue;/);
});

test('CURRENT_PREVIOUS_AND_RESTORE are all present', () => {
  assert.match(LIBRARY, /admin_talk_lib_current/);
  assert.match(LIBRARY, /admin_talk_lib_previous/);
  assert.match(LIBRARY, /admin_talk_lib_restore/);
  // Restore is the same one action, so it cannot drift from Use Voice.
  assert.match(LIBRARY, /onClick=\{\(\) => void onUse\(previousVoiceId\)\}/);
  // The panel remembers what was replaced.
  assert.match(PANEL, /if \(savedVoiceId && savedVoiceId !== id\) setPreviousVoiceId\(savedVoiceId\);/);
});

test('a card shows what is useful and nothing that was made up', () => {
  for (const key of [
    'admin_talk_lib_preview', 'admin_talk_lib_use', 'admin_talk_lib_edit', 'admin_talk_lib_delete',
  ]) assert.ok(LIBRARY.includes(key), `${key} is missing from the card`);
  // Description is conditional: no description from Cartesia, none shown.
  assert.match(LIBRARY, /\{v\.description \? \(/);
});

test('preview uses the real production path, not a browser imitation', () => {
  assert.match(LIBRARY, /await previewAiTalkVoice\(id, 'ka'\)/);
  assert.match(SERVICE, /body: \{ action: 'voicePreview', voiceId: voiceId\.trim\(\), locale \}/);
  // voicePreview synthesises through the same function a real reply uses.
  const pv = EDGE.slice(EDGE.indexOf('async function voicePreview'));
  assert.match(pv.slice(0, 2500), /speakPhraseStreaming\(sb, \{/);
});

test('deleting a card cannot silence production', () => {
  // The live voice is a different setting; removing the card does not touch it.
  const del = LIBRARY.slice(LIBRARY.indexOf('const onDelete'), LIBRARY.indexOf('const onRename'));
  assert.match(del, /persist\(voices\.filter/);
  assert.ok(!/saveAiTalkVoice/.test(del), 'removing a card writes the live voice');
});

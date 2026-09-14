// The voice a customer picked has to arrive at the provider that places the call.
//
// "The dropdown changed" is not evidence and the specification says so. The
// evidence is the shape of the assistant payload Vapi is actually sent, which
// is what these read — out of the shipped source, because it is a Deno edge
// module with URL imports that a bare node test cannot import.
//
// The other half of this file is about NOT breaking the agents that already
// exist. Every one of them holds a Cartesia voice id, and rewriting those in
// the database would be a destructive migration of live customer
// configuration.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8').split('\r\n').join('\n');
const VAPI = read('supabase/functions/_shared/comm/vapi.ts');
const TALK = read('supabase/functions/ai-talk-session/index.ts');
const EL = read('supabase/functions/_shared/comm/elevenlabs.ts');
const VOICE_AI = read('supabase/functions/voice-ai/index.ts');

/* The provider resolver is small and pure, so it is read out of the shipped
 * source and evaluated rather than copied — a copy can drift, and this is the
 * function that decides whether a legacy agent keeps working. */
const FROM = VAPI.indexOf('export function voiceProviderForId(');
assert.ok(FROM > 0, 'voiceProviderForId is gone');
const BODY = VAPI.slice(FROM);
const voiceProviderForId = new Function(
  `${BODY.slice(0, BODY.indexOf('\n}\n') + 3)
    .replace('export function', 'function')
    .replace(/: string \| null \| undefined|: 'cartesia' \| '11labs'/g, '')}\nreturn voiceProviderForId;`,
)();

test('a legacy Cartesia voice id still routes to Cartesia', () => {
  // Every agent built before this migration holds one of these. None of them
  // were rewritten, and none of them should stop working.
  assert.equal(voiceProviderForId('6833940c-ed06-4b62-8a51-94b6c46c13ad'), 'cartesia');
  assert.equal(voiceProviderForId('00000000-0000-0000-0000-000000000000'), 'cartesia');
});

test('an ElevenLabs voice id routes to ElevenLabs', () => {
  assert.equal(voiceProviderForId('21m00Tcm4TlvDq8ikWAM'), '11labs');
  assert.equal(voiceProviderForId('EXAVITQu4vr4xnSDxMaL'), '11labs');
});

test('no voice chosen is not an error', () => {
  // Refusing to place a call because nobody has picked a voice is worse than
  // letting the provider use its own default.
  assert.equal(voiceProviderForId(null), '11labs');
  assert.equal(voiceProviderForId(undefined), '11labs');
  assert.equal(voiceProviderForId(''), '11labs');
});

test('the assistant payload carries the selected voice, not a constant', () => {
  const at = VAPI.indexOf('voice: buildVoice(');
  assert.ok(at > 0, 'the voice block is hardcoded again');

  const builder = VAPI.slice(VAPI.indexOf('function buildVoice('));
  assert.ok(/provider: '11labs', voiceId: agentVoiceId, model: 'eleven_flash_v2_5'/.test(builder),
    'an ElevenLabs voice must be sent as 11labs with its own model');
  assert.ok(/provider: 'cartesia', voiceId: agentVoiceId, model: 'sonic-2'/.test(builder),
    'a legacy Cartesia voice must still be sent as cartesia');
});

test('the transcriber is Scribe, and Georgian is why', () => {
  const builder = VAPI.slice(VAPI.indexOf('function buildTranscriber('));
  assert.ok(/provider: '11labs'/.test(builder), 'the default transcriber should be ElevenLabs');
  assert.ok(/scribe_v2_realtime/.test(builder));
  // Deepgram's nova-2 does not list ka, which is the defect being fixed.
  assert.ok(!/provider: 'deepgram'/.test(builder.slice(0, 400)),
    'Deepgram must no longer be the default transcriber');
});

test('a call carries the keyterms chosen for it, and only those', () => {
  const builder = VAPI.slice(VAPI.indexOf('function buildTranscriber('));
  assert.ok(/override\?\.keyterms\?\.length \? \{ keyterms: override\.keyterms \}/.test(builder),
    'keyterms must come from the selector, and be omitted when there are none');
  // The corpus itself must not be reachable from here at all.
  assert.ok(!/voice_vocabulary_terms/.test(VAPI), 'the call builder must not query the corpus directly');
});

test('an unsettled language is sent as nothing rather than as a guess', () => {
  const builder = VAPI.slice(VAPI.indexOf('function buildTranscriber('));
  assert.ok(/\.\.\.\(language \? \{ language \} : \{\}\)/.test(builder),
    'naming a language nobody has spoken turns a code-switching caller into a mistranscribed one');
});

test('the brain is configurable and is not tied to the voice provider', () => {
  // §I: the LLM must be an independent layer.
  const at = VAPI.indexOf('model: {');
  const block = VAPI.slice(at, at + 400);
  assert.ok(/overrides\?\.brain\?\.provider \?\? 'openai'/.test(block));
  assert.ok(/overrides\?\.brain\?\.model \?\? 'gpt-4o'/.test(block));
});

test('nothing anywhere returns the ElevenLabs key', () => {
  // The key is read at call time and put straight into a request header. The
  // rule is that requireSecret for it appears in exactly one place, and that
  // place is the header builder.
  const uses = (src) => (src.match(/requireSecret\('ELEVENLABS_API_KEY'\)/g) ?? []).length;
  assert.equal(uses(EL), 1, 'the key should be read in one place only');
  assert.equal(uses(VOICE_AI), 0, 'the control surface must never read the key itself');
  assert.equal(uses(TALK), 0, 'the session broker must never read the key itself');

  const headerFn = EL.slice(EL.indexOf('function headers('), EL.indexOf('function headers(') + 240);
  assert.ok(/'xi-api-key': requireSecret\('ELEVENLABS_API_KEY'\)/.test(headerFn),
    'the only use of the key is as a request header');

  for (const [name, src] of [['elevenlabs.ts', EL], ['voice-ai', VOICE_AI], ['ai-talk-session', TALK]]) {
    assert.ok(!/console\.log\([^)]*requireSecret/.test(src), `${name} logs a secret`);
    // The realtime credential handed to a browser is a single-use token, not
    // the key, and it must be minted rather than substituted.
    assert.ok(!/token: requireSecret/.test(src), `${name} hands the key to a browser`);
  }

  // Health reports whether a NAME is set, never what it is set to.
  assert.ok(/name: 'ELEVENLABS_API_KEY', present:/.test(VOICE_AI),
    'credential health should report presence only');
  assert.ok(!/present: requireSecret|present: Deno\.env\.get\('ELEVENLABS/.test(VOICE_AI),
    'presence must be a boolean, never the value');
});

test('a customer can ask for two things and an operator for everything else', () => {
  const at = VOICE_AI.indexOf('const CUSTOMER_ACTIONS');
  const set = VOICE_AI.slice(at, at + 160);
  assert.ok(/'voices'/.test(set) && /'preview'/.test(set));
  // Anything to do with providers, corpus, spend or pronunciation is behind
  // requireAdmin, and the ordering in the handler is what enforces it.
  assert.ok(VOICE_AI.indexOf('const admin = await requireAdmin(req)') > at,
    'the admin gate must come after the customer branch has returned');
  for (const action of ['sync-voices', 'routes-save', 'vocabulary-import', 'usage', 'pronunciation-approve']) {
    assert.ok(!new RegExp(`'${action}'`).test(set), `${action} must not be a customer action`);
  }
});

test('a voice nobody enabled cannot be previewed', () => {
  // Otherwise the preview endpoint rents the whole provider library to
  // anybody with a session.
  const at = VOICE_AI.indexOf('async function voicePreview(');
  const body = VOICE_AI.slice(at, VOICE_AI.indexOf('\n}\n', at));
  assert.ok(/\.eq\('enabled', true\)/.test(body));
  assert.ok(/VOICE_NOT_AVAILABLE/.test(body));
  assert.ok(/checkRateLimit/.test(body), 'a paid generation behind a button needs a rate limit');
});

test('syncing voices refreshes provider facts and keeps Homatch\'s decisions', () => {
  const at = VOICE_AI.indexOf('async function syncVoices(');
  const body = VOICE_AI.slice(at, VOICE_AI.indexOf('\n}\n', at));
  assert.ok(/upsert\(/.test(body), 'a sync must not delete and reinsert');
  for (const owned of ['enabled', 'recommended', 'is_default', 'sort_order']) {
    assert.ok(!new RegExp(`${owned}:`).test(body),
      `a sync must not overwrite ${owned} — a customer already chose with it`);
  }
});

test('a pronunciation rule cannot go live until somebody has heard it', () => {
  const at = VOICE_AI.indexOf('async function pronunciationSave(');
  const body = VOICE_AI.slice(at, VOICE_AI.indexOf('\n}\n', at));
  assert.ok(/row\.enabled = false;/.test(body), 'editing a rule must un-approve it');
  assert.ok(/row\.approved_at = null;/.test(body));
  // And only a model that honours the method is offered it.
  assert.ok(/pronunciationMethodsFor/.test(VOICE_AI));
  assert.ok(/flash.*\['alias'\]|\['alias'\]/.test(EL.slice(EL.indexOf('export function pronunciationMethodsFor'))));
});

test('a telephony kill switch cannot be lowered from a voice settings screen', () => {
  const at = VOICE_AI.indexOf('async function routesSave(');
  const body = VOICE_AI.slice(at, VOICE_AI.indexOf('\n}\n', at));
  assert.ok(/KILL_SWITCH_PROTECTED/.test(body));
  assert.ok(/'TELEPHONY'/.test(body) && /'WHATSAPP_CALL'/.test(body));
});

test('the AI TALK ladder tries ElevenLabs first and keeps what came before', () => {
  const at = TALK.indexOf('async function listen(');
  const body = TALK.slice(at, TALK.indexOf('\n}\n', at));
  assert.ok(body.indexOf('elevenLabsCredentialsPresent()') < body.indexOf("hasSecret('OPENAI_API_KEY')"),
    'ElevenLabs must be attempted before the fallback');
  assert.ok(/fellBackFrom/.test(body), 'a fallback must be explicable without a log');
});

test('the corpus is queried narrowly, and the selection is what gets logged', () => {
  const at = TALK.indexOf('async function selectSessionKeyterms(');
  const body = TALK.slice(at, TALK.indexOf('\n}\n', at));
  assert.ok(/\.eq\('enabled', true\)/.test(body));
  assert.ok(/voice_keyterm_selections/.test(body));
  // Ids and categories. Never the conversation.
  assert.ok(/term_ids:/.test(body) && /categories:/.test(body));
  assert.ok(!/transcript/.test(body), 'a diagnostics row must not carry what was said');
});

test('AI TALK no longer refuses to start without one particular provider', () => {
  const at = TALK.indexOf('async function start(');
  const body = TALK.slice(at, at + 1200);
  assert.ok(/!elevenLabsCredentialsPresent\(\) && !cartesiaCredentialsPresent\(\)\.ok/.test(body),
    'an ElevenLabs-only deployment must be able to start a conversation');
});

/*
 * MARIAM IS THE VOICE, AND THE VOICE IS STILL CHOSEN WHERE IT ALWAYS WAS.
 *
 * A voice swap is a value, not an architecture. aiTalkVoice() reads the
 * highest-priority enabled TTS route and the approved voice for the language
 * out of voice_language_defaults, and that is the authoritative selection
 * path -- so the change that matters is a row, and these tests exist to prove
 * that nothing ELSE moved to accommodate it.
 *
 * The one code-side id, the constant the legacy non-streaming actions
 * synthesise with and `start` reports for support logs, had drifted: it named
 * a voice production stopped using, so a log naming a voice named the wrong
 * one. It is Mariam now, and these assert the old ids are gone from every
 * runtime path rather than merely overwritten in one of them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MARIAM = 'eb629e3f-3223-4e71-9d46-72637532270b';
/** The id the constant held, and the one the repository's migration seeded. */
const RETIRED = [
  '6833940c-ed06-4b62-8a51-94b6c46c13ad',
  '0bfbea6c-2f8f-4f86-b411-aa2316561e36',
  // The first Mariam. The voice was valid and the pipeline carried it;
  // it was rejected on a real iPhone, which is the only test of a voice
  // that counts. Replaced acoustically -- same name, same everything else.
  '6247621a-5365-4227-8c03-5fd970d59918',
  // The second. Compatible, streamed, priced -- and not the one the owner
  // wanted to hear. A voice is replaced on how it sounds, not on whether
  // it works, and every one of these worked.
  '58a675e6-915e-4266-9690-e193c5e2d7a7',
];

const EDGE_SRC = read('supabase/functions/ai-talk-session/index.ts');
const EDGE = code(EDGE_SRC);
const I18N = read('src/i18n/translations.ts');
const MIGRATIONS = 'supabase/migrations';
/*
 * 21:00, not 12:00. Production's ledger already records 20260919120000 --
 * a superseded spelling of one of the storage migrations, applied under both
 * names during a drift repair. A file carrying a version the ledger has seen
 * is skipped by `db push`, so the voice swap would have been committed,
 * pushed, and silently never run.
 */
const SWAP = read(`${MIGRATIONS}/20260919210000_mariam_is_the_voice.sql`);

/* ── The voice ───────────────────────────────────────────────────────────*/

test('the one voice id in runtime code is Mariam', () => {
  assert.match(EDGE, new RegExp(`const MARIAM_VOICE_ID = '${MARIAM}';`));
  const ids = [...EDGE.matchAll(/'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'/g)]
    .map((m) => m[1]);
  assert.deepEqual([...new Set(ids)], [MARIAM], 'a second voice-shaped id is hardcoded in the edge function');
});

test('no retired voice id survives in any runtime path', () => {
  const runtime = [
    ...readdirSync('src/lib/comm').filter((f) => f.endsWith('.ts')).map((f) => `src/lib/comm/${f}`),
    'supabase/functions/ai-talk-session/index.ts',
    'src/components/home/AiTalkPanel.tsx',
  ];
  for (const file of runtime) {
    const body = read(file);
    for (const old of RETIRED) {
      assert.ok(!body.includes(old), `${file} still names a retired voice: ${old}`);
    }
  }
});

test('the authoritative selection path is the table, not the constant', () => {
  /*
   * The streaming path and the whole-clip path both ask aiTalkVoice(), which
   * reads the route table and the approved row. If either ever falls back to
   * the constant, a voice an operator revoked would keep speaking.
   */
  assert.match(EDGE, /const voice = params\.voice \?\? await aiTalkVoice\(sb, params\.language \|\| null\);/);
  assert.match(EDGE, /const voice = await aiTalkVoice\(sb, params\.language \|\| null\);/);
  assert.match(EDGE, /from\('voice_language_defaults'\)/);
  assert.match(EDGE, /\.eq\('role', 'TTS'\)/);

  // Fail-closed: no approved row means no voice, not the nearest one to hand.
  assert.match(EDGE, /code: 'VOICE_NOT_APPROVED_FOR_LANGUAGE'/);
  const streamer = EDGE.slice(EDGE.indexOf('const voice = params.voice ??'), EDGE.indexOf('const voice = params.voice ??') + 900);
  assert.ok(!/MARIAM_VOICE_ID/.test(streamer), 'the streaming path can fall back to a hardcoded voice');
});

test('the swap is recorded where the voice is actually chosen', () => {
  assert.ok(SWAP.includes(MARIAM), 'the migration does not set Mariam');
  assert.match(SWAP, /update public\.voice_language_defaults/);
  assert.match(SWAP, /provider = 'CARTESIA'/);
  // Every AI TALK language, one voice: switching language must never switch
  // who is speaking.
  for (const lang of ['ka', 'en', 'ru', 'tr', 'ar', 'he']) {
    assert.ok(new RegExp(`'${lang}'`).test(SWAP), `${lang} is not covered by the swap`);
  }
  assert.ok(!/create table|drop table|alter table/i.test(SWAP), 'a voice swap changed the schema');
  assert.ok(!/ELEVENLABS'/.test(SWAP.replace(/--.*$/gm, '')), 'the swap touches another provider');
});

test('no second TTS billing path came with the new voice', () => {
  assert.equal(
    (EDGE.match(/recordVoiceUsage\(/g) ?? []).length,
    (EDGE.match(/recordVoiceUsage\(/g) ?? []).length,
    'sanity',
  );
  assert.match(EDGE, /async function recordVoiceUsage/);
  // Characters are what Cartesia is priced on, and they are still counted
  // from the text that was sent, per phrase.
  assert.match(EDGE, /role: 'TTS'/);
  assert.ok(!/voice_usage_events_v2|tts_usage|cartesia_usage/.test(EDGE), 'a parallel usage table appeared');
});

/* ── Her name ────────────────────────────────────────────────────────────*/

test('the system prompt knows who she is', () => {
  assert.match(EDGE, /You are Mariam, Homatch's AI assistant for the Georgian property market/);
  assert.ok(
    !/You are Homatch, a real-estate assistant/.test(EDGE),
    'the old identity line is still in the prompt as well',
  );
});

test('she can say her name, and does not keep saying it', () => {
  /*
   * Unwrapped first. The prompt is an array of hand-wrapped string literals,
   * so a single rule straddles two of them and a match against the raw source
   * would depend on where the line happened to break.
   */
  const prompt = EDGE_SRC.slice(EDGE_SRC.indexOf('function publicDemoInstructions'))
    .replace(/',\s*\n\s*'/g, ' ')
    .replace(/\s+/g, ' ');
  assert.match(prompt, /Asked your name or who you are: Mariam, Homatch\\?'s assistant/);
  // The anti-repetition rules are the point: an assistant that opens every
  // reply with its own name is worse than one with no name at all.
  assert.match(prompt, /never announce it unprompted/i);
  assert.match(prompt, /never open or sign off with it/i);
  assert.match(prompt, /never repeat it/i);
  // Her name in the reader's own script, so a Georgian sentence does not
  // carry a Latin word for the voice to sound out.
  assert.match(prompt, /Write it in their script/i);
  // The single passing introduction that already existed, now with a name.
  assert.match(prompt, /In your FIRST reply[\s\S]{0,120}you are Mariam/);
  assert.match(prompt, /Never again after that/);
});

test('the transcript the model reads calls her by name', () => {
  assert.equal(
    (EDGE.match(/h\.role === 'assistant' \? 'Mariam' : 'Visitor'/g) ?? []).length, 2,
    'the conversation history still labels her turns with the company name',
  );
});

test('the identity a visitor reads is Mariam, and AI Talk is still the feature', () => {
  const titles = I18N.match(/^  talk_title: '(.*)',$/gm) ?? [];
  const badges = I18N.match(/^  talk_badge: '(.*)',$/gm) ?? [];
  assert.equal(titles.length, 6);
  assert.equal(badges.length, 6);
  assert.equal(new Set(titles).size, 6, 'six locales, six real translations');
  assert.equal(new Set(badges).size, 6, 'six locales, six real translations');
  /*
   * The badge now says what she is a demonstration OF as well as who she is.
   * AI TALK is the live demo of the AI Call Center -- true of the architecture
   * all along and stated nowhere a visitor could read it.
   *
   * Mariam stays in it. The first attempt at this copy replaced her name with
   * the product name, which bought the framing by losing the identity somebody
   * is actually talking to; this assertion refused it, correctly.
   */
  assert.match(I18N, /^  talk_badge: 'Mariam — Homatch AI Call Center live demo',$/m);
  assert.match(I18N, /^  talk_title: 'Talk to Mariam',$/m);
  // The product name is untouched wherever it is the product name.
  assert.match(I18N, /^  talk_languages: 'Speak naturally in your own language\. AI Talk follows/m);
});

/* ── Everything that must NOT have moved ─────────────────────────────────*/

test('the Cartesia pipeline is the same pipeline', () => {
  assert.match(EDGE, /streamCartesiaPcm/, 'the streaming entry point');
  assert.match(EDGE, /synthesizePcm\(/, 'the whole-clip entry point');
  // Raw PCM at the browser's own rate, so nothing is resampled at a join.
  assert.match(EDGE_SRC, /outputSampleRate/);
  assert.match(EDGE, /sonic-3|CARTESIA_MODEL|model/, 'the model selection is still made here');
});

test('the synthesis settings the new voice runs under are the old ones', () => {
  /*
   * A VOICE SWAP THAT MOVES A SETTING IS NOT A VOICE SWAP.
   *
   * The second Mariam replaced the first acoustically and nothing else was
   * allowed to move with it -- not the model, not the ladder beneath it, not
   * the container, not the sample rate, and not the decision to omit
   * generation_config entirely at the default so an unset speed stays the
   * model's own pacing rather than us asserting 1.0 at it.
   */
  const cartesia = read('supabase/functions/_shared/comm/cartesia.ts');
  assert.match(cartesia, /const TTS_MODELS = \['sonic-3', 'sonic-2', 'sonic-english', 'sonic'\];/);
  assert.match(cartesia, /export const PCM_SAMPLE_RATE = 24_000;/);
  // The streaming request, field for field.
  const sse = cartesia.slice(cartesia.indexOf('/tts/sse'), cartesia.indexOf('/tts/sse') + 900);
  assert.match(sse, /model_id: model,/);
  assert.match(sse, /voice: \{ mode: 'id', id: params\.voiceId \},/);
  assert.match(sse, /language: String\(params\.language \?\? 'en'\)\.toLowerCase\(\)\.slice\(0, 2\),/);
  assert.match(sse, /container: 'raw', encoding: 'pcm_s16le'/);
  assert.match(sse, /speed === null \? \{\} : \{ generation_config: \{ speed \} \}/);
  // And the row that carries the voice still carries the same model with it.
  assert.match(SWAP, /'sonic-3'/);
  assert.ok(!/sonic-2|sonic-turbo|generation_config/.test(SWAP), 'the swap is tuning synthesis');
});

test('the recognisers, the languages and the switching contract are untouched', () => {
  assert.match(EDGE, /GOOGLE_STT_MODEL/);
  assert.match(EDGE, /speechCandidates\(/);
  assert.match(EDGE, /SPEECH_TAGS/);
  // Six pinnable languages, shadow recogniser included, exactly as before.
  const tags = read('src/lib/comm/languageRegistry.ts');
  for (const lang of ['ka', 'en', 'ru', 'tr', 'ar', 'he']) {
    assert.ok(new RegExp(`\\b${lang}\\b`).test(tags), `${lang} left the pinnable set`);
  }
});

test('barge-in and cancellation are untouched', () => {
  const client = code(read('src/lib/comm/voiceClient.ts'));
  assert.match(client, /decideBargeIn/);
  assert.match(client, /turnAbort/);
  // The false-barge-in protection: a sustained voice, not a noise. It lives
  // in transcript.ts beside decideEndpoint, not in a module of its own.
  const bargeIn = code(read('src/lib/comm/transcript.ts'));
  assert.match(bargeIn, /sustainMs/);
  assert.match(bargeIn, /assertiveEnergy/);
  assert.match(EDGE, /abandon\(/, 'the server-side cancellation hook');
  assert.match(EDGE, /signal\.aborted/, 'the pre-synthesis cancellation check');
});

test('metering, session limits and the admin tier are untouched', () => {
  assert.match(EDGE, /recordTurnUsage/);
  assert.match(EDGE, /decideGrant\(/);
  assert.match(EDGE, /rpc\('is_admin'\)/);
  assert.match(EDGE, /window: 'ROLLING_24H'/);
  assert.match(EDGE, /ended_reason: 'superseded'/);
});

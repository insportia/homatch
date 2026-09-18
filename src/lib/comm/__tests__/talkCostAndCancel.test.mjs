/*
 * WHAT A CONVERSATION COSTS, AND WHAT STOPS WHEN NOBODY IS LISTENING.
 *
 * Two things that were structurally impossible before this pass and are now
 * only true because specific lines exist. Both are asserted against the real
 * source, because both failed silently: the cost was NULL on every one of
 * 2,238 production rows, and the cancellation was a controller that was
 * created, handed to Cartesia, and never fired.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  rateFor, charge, llmCost, sttCost, ttsCost, audioSecondsFromBytes, LIVE_BYTES_PER_SECOND,
} from '../../../../supabase/functions/_shared/comm/voiceCogs.ts';

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (p) => readFileSync(p, 'utf8');
const edge = read('supabase/functions/ai-talk-session/index.ts');
const client = read('src/lib/comm/voiceClient.ts');
const cartesia = read('supabase/functions/_shared/comm/cartesia.ts');
const llm = read('supabase/functions/_shared/comm/llm.ts');

/** The rates actually on file in production, as the migration wrote them. */
const BOOK = [
  { provider: 'OPENAI', model: 'gpt-5.6-luna', unit: 'INPUT_TOKEN', rate: 0.2, per_units: 1e6, effective_from: '2026-07-30T00:00:00Z', effective_to: null },
  { provider: 'OPENAI', model: 'gpt-5.6-luna', unit: 'CACHED_INPUT_TOKEN', rate: 0.02, per_units: 1e6, effective_from: '2026-07-30T00:00:00Z', effective_to: null },
  { provider: 'OPENAI', model: 'gpt-5.6-luna', unit: 'OUTPUT_TOKEN', rate: 1.2, per_units: 1e6, effective_from: '2026-07-30T00:00:00Z', effective_to: null },
  { provider: 'CARTESIA', model: 'sonic-3', unit: 'CHARACTER', rate: 65, per_units: 1e6, effective_from: '2026-09-13T00:00:00Z', effective_to: null },
  { provider: 'GOOGLE', model: 'chirp_3', unit: 'AUDIO_SECOND', rate: 0.016, per_units: 60, effective_from: '2026-09-13T00:00:00Z', effective_to: null },
];

/* ── 1. A cost that is not known is not zero ───────────────────────────── */

test('a missing rate produces null, never zero', () => {
  // The whole point. Every AI Talk row in production carried a NULL cost, and
  // the danger in fixing that is a helper that returns 0 for "no rate on
  // file": a cost centre that reports $0.00 is one nobody looks at again.
  assert.equal(charge(BOOK, { provider: 'ANTHROPIC', model: 'x', unit: 'INPUT_TOKEN', quantity: 1000 }), null);
  assert.equal(charge(BOOK, { provider: 'CARTESIA', model: 'sonic-3', unit: 'AUDIO_SECOND', quantity: 10 }), null);
  assert.equal(ttsCost(BOOK, { provider: 'ELEVENLABS', model: 'eleven_v3', characters: 500 }), null);
  assert.equal(sttCost([], { provider: 'GOOGLE', model: 'chirp_3', audioSeconds: 60 }), null);
  // And a real rate produces a real number rather than a shrug.
  assert.equal(ttsCost(BOOK, { provider: 'CARTESIA', model: 'sonic-3', characters: 1_000_000 }), 65);
  assert.equal(sttCost(BOOK, { provider: 'GOOGLE', model: 'chirp_3', audioSeconds: 60 }), 0.016);
});

test('the rate in force is the one the period covers', () => {
  const rows = [
    { provider: 'CARTESIA', model: 'sonic-3', unit: 'CHARACTER', rate: 80, per_units: 1e6, effective_from: '2026-01-01T00:00:00Z', effective_to: '2026-09-13T00:00:00Z' },
    ...BOOK,
  ];
  const before = charge(rows, { provider: 'CARTESIA', model: 'sonic-3', unit: 'CHARACTER', quantity: 1e6, at: new Date('2026-06-01T00:00:00Z') });
  const after = charge(rows, { provider: 'CARTESIA', model: 'sonic-3', unit: 'CHARACTER', quantity: 1e6, at: new Date('2026-09-18T00:00:00Z') });
  assert.equal(before, 80, 'the old rate priced the old usage');
  assert.equal(after, 65, 'and the new one prices the new usage');
  // Half-open: the instant one ends the next is already in force, so a
  // correction can never leave a gap or an overlap.
  assert.equal(charge(rows, { provider: 'CARTESIA', model: 'sonic-3', unit: 'CHARACTER', quantity: 1e6, at: new Date('2026-09-13T00:00:00Z') }), 65);
  // An exact model beats a provider-wide rate.
  const wide = [{ provider: 'CARTESIA', model: null, unit: 'CHARACTER', rate: 999, per_units: 1e6, effective_from: '2026-01-01T00:00:00Z', effective_to: null }, ...BOOK];
  assert.equal(rateFor(wide, { provider: 'CARTESIA', model: 'sonic-3', unit: 'CHARACTER' }).rate, 65);
  assert.equal(rateFor(wide, { provider: 'CARTESIA', model: 'sonic-9', unit: 'CHARACTER' }).rate, 999);
});

test('cached input tokens are a subset of input, not an addition to it', () => {
  /*
   * The system prompt is most of a voice turn's input and it is byte-identical
   * every turn, so the provider serves most of it from cache at a tenth the
   * rate. Charging both lines in full would roughly double the input cost of
   * every conversation this product has.
   */
  const all = llmCost(BOOK, { model: 'gpt-5.6-luna', inputTokens: 2400, cachedInputTokens: 2000, outputTokens: 100 });
  const none = llmCost(BOOK, { model: 'gpt-5.6-luna', inputTokens: 2400, cachedInputTokens: 0, outputTokens: 100 });
  // 400 fresh at 0.2/M + 2000 cached at 0.02/M + 100 out at 1.2/M
  assert.equal(all, 0.00024);
  assert.equal(none, 0.0006);
  assert.ok(all < none, 'the cache saves money and the ledger shows it');
  // A cached count larger than the input it belongs to is the provider being
  // odd, not a discount to be mined.
  assert.equal(llmCost(BOOK, { model: 'gpt-5.6-luna', inputTokens: 100, cachedInputTokens: 900, outputTokens: 0 }),
    llmCost(BOOK, { model: 'gpt-5.6-luna', inputTokens: 100, cachedInputTokens: 100, outputTokens: 0 }));
  // Not knowing is not zero-cached.
  assert.equal(llmCost(BOOK, { model: 'gpt-5.6-luna', inputTokens: 2400, cachedInputTokens: null, outputTokens: 100 }), none);
  // A model with no rates at all prices to null rather than to a partial sum.
  assert.equal(llmCost(BOOK, { model: 'gpt-9-unknown', inputTokens: 100, cachedInputTokens: 0, outputTokens: 10 }), null);
});

test('audio seconds come from the bytes actually put on the wire', () => {
  assert.equal(LIVE_BYTES_PER_SECOND, 32_000, '16 kHz, signed 16-bit, mono');
  assert.equal(audioSecondsFromBytes(32_000), 1);
  assert.equal(audioSecondsFromBytes(0), null, 'no audio is not zero-cost audio, it is no measurement');
  assert.equal(audioSecondsFromBytes(-5), null);
});

/* ── 2. The three legs are recorded, and the two new ones exist at all ─── */

test('every provider call in a turn is now written to the ledger', () => {
  const e = strip(edge);
  // Synthesis was the only leg ever recorded, and it recorded a NULL cost.
  assert.match(e, /provider: 'CARTESIA', role: 'TTS'/);
  assert.match(e, /const ttsCogs = ttsCost\(await priceBook\(sb\), \{/);
  assert.match(e, /costUsd: ttsCogs,/);
  // The model's tokens reached a console log and stopped there.
  assert.match(e, /provider: 'OPENAI', role: 'LLM', model,/);
  assert.match(e, /const cost = llmCost\(book, \{/);
  assert.match(e, /cachedInputTokens: llmCachedInputTokens,/);
  // Recognition was never recorded anywhere at all.
  assert.match(e, /provider: 'GOOGLE', role: 'STT', model: `\$\{GOOGLE_STT_MODEL\}:\$\{leg\.stream\}`/);
  assert.match(e, /const cost = sttCost\(book, \{ provider: 'GOOGLE'/);
  // Both recogniser streams, because Google bills both.
  assert.match(e, /\{ seconds: body\.sttAudioSeconds, stream: 'PRIMARY' \}/);
  assert.match(e, /\{ seconds: body\.sttShadowAudioSeconds, stream: 'SECOND_OPINION' \}/);
  // And the columns that existed and were never filled.
  assert.match(e, /cost_usd: event\.costUsd \?\? null,/);
  assert.match(e, /cached_input_tokens: event\.cachedInputTokens \?\? null,/);
});

test('an unmeasured second is never recorded as a free one', () => {
  const e = strip(edge);
  // An older browser sends no figure, and then there is no row at all --
  // rather than a row saying this conversation's recognition cost nothing.
  assert.match(e, /if \(typeof leg\.seconds !== 'number' \|\| !\(leg\.seconds > 0\)\) continue;/);
  // cost_basis follows the cost: no cost, no basis, and never a stray
  // 'CALCULATED' sitting beside a NULL.
  assert.match(e, /cost_basis: event\.costUsd === null \|\| event\.costUsd === undefined \? null :/);
});

test('the browser measures what the server cannot see', () => {
  const c = strip(client);
  // Microphone audio goes from the page to the speech worker and never
  // reaches the server that does the accounting. This is the only place the
  // duration exists.
  assert.match(c, /get sttSeconds\(\): \{ primary: number; shadow: number \}/);
  assert.match(c, /const perSecond = LIVE_SAMPLE_RATE \* 2;/);
  assert.match(c, /this\.sttShadowBytes \+= pcm\.byteLength;/);
  assert.match(c, /clearSttSeconds\(\): void \{/);
  const panel = strip(read('src/components/home/AiTalkPanel.tsx'));
  assert.match(panel, /sttAudioSeconds: sessionRef\.current\.sttSeconds\.primary,/);
  assert.match(panel, /sttShadowAudioSeconds: sessionRef\.current\.sttSeconds\.shadow,/);
  // Cleared once reported, or the next turn bills this turn's audio again.
  assert.match(panel, /sessionRef\.current\?\.clearSttSeconds\(\);/);
});

/* ── 3. The cancellation seam ──────────────────────────────────────────── */

test('the server now fires the abort it has always created', () => {
  const e = strip(edge);
  // The controller existed, its signal was handed to Cartesia, and nothing in
  // the file ever called abort(). This is that call, from all three places a
  // listener can be lost.
  assert.match(e, /const abandon = \(why: string\) => \{/);
  assert.match(e, /try \{ turnAbort\.abort\(\); \} catch/);
  assert.match(e, /cancel\(reason\) \{/, 'the ReadableStream had no cancel handler at all');
  assert.match(e, /abandon\(`STREAM_CANCELLED:/);
  assert.match(e, /abandon\('STREAM_CLOSED'\);/);
  assert.match(e, /abandon\('REQUEST_ABORTED'\)/);
  // The Request itself was never even a parameter, so req.signal was not
  // merely unused, it was out of scope.
  assert.match(e, /async function converse\(sb: Sb, body: TalkRequest, req\?: Request\)/);
  assert.match(e, /case 'converse':\s+return await converse\(sb, body, req\);/);
});

test('no further synthesis starts once the listener has gone', () => {
  const e = strip(edge);
  // The cheapest phrase is the one never sent: Cartesia bills the text
  // submitted, so refusing to start is the entire saving.
  assert.match(e, /if \(turnAbort\.signal\.aborted\) \{\s*skippedPhrases \+= 1;/);
  assert.match(e, /if \(turnAbort\.signal\.aborted\) break;/, 'and the model stops writing too');
  assert.match(e, /if \(!failed && !turnAbort\.signal\.aborted && pending\.trim\(\)\) queuePhrase/);
  // Visible in the trace, so the saving can be counted rather than believed.
  assert.match(e, /tts_skipped_phrases: skippedPhrases,/);
  assert.match(e, /abandoned_why: abandoned,/);
});

test('a phrase queued before the abort does not attach a listener that can never fire', () => {
  const c = strip(cartesia);
  /*
   * An abort listener attached to an ALREADY-aborted signal never runs. That
   * is specified behaviour, and phrases are independent tasks, so without
   * this check a turn cancelled while three were waiting to start would
   * synthesise and bill all three in full.
   */
  assert.match(c, /if \(params\.signal\?\.aborted\) \{/);
  assert.match(c, /code: 'CANCELLED', message: 'caller cancelled before synthesis started'/);
  // Our caller leaving and the provider being slow are different events, and
  // calling both TIMEOUT made a healthy provider look unreliable.
  assert.match(c, /const cancelled = aborted && params\.signal\?\.aborted === true;/);
  assert.match(c, /code: cancelled \? 'CANCELLED' : aborted \? 'TIMEOUT' : 'TRANSIENT'/);
  assert.match(c, /retryable: !cancelled,/, 'a cancelled request does not try the next model');
});

test('the model stops writing, and its stream is released', () => {
  const l = strip(llm);
  assert.match(l, /signal\?: AbortSignal;/);
  assert.match(l, /if \(opts\.signal\?\.aborted\) onCallerAbort\(\);/,
    'checked before subscribing, or an already-cancelled turn generates in full');
  assert.match(l, /const why = aborted \? \(cancelled \? 'cancelled' : 'timeout'\)/);
  assert.match(l, /try \{ await body\?\.cancel\(\); \} catch/,
    'returning early out of the caller loop used to leave the provider socket open');
});

test('what was already submitted stays honestly billed', () => {
  const e = strip(edge);
  /*
   * Cartesia charges for the text SUBMITTED. A phrase refused before it was
   * ever sent cost nothing and says so. A phrase sent and then cut off
   * mid-stream WAS paid for, and pretending otherwise would understate what
   * this product spends on conversations nobody finished hearing.
   */
  assert.match(e, /const neverSubmitted = out\.error\?\.code === 'CANCELLED'/);
  assert.match(e, /characters: neverSubmitted \? 0 : params\.text\.length,/);
  assert.match(e, /costUsd: neverSubmitted \? 0 : ttsCost\(await priceBook\(sb\), \{/);
});

test('the browser half of the chain is unchanged, because it was already right', () => {
  const c = strip(client);
  // Every abandonment path reaches stopPlayback, which aborts the fetch.
  assert.match(c, /try \{ this\.turnAbort\?\.abort\(\); \} catch/);
  assert.match(c, /this\.stopPlayback\('USER_BARGE_IN'\);/);
  assert.match(c, /this\.stopPlayback\(reason === 'allowance' \? 'SESSION_END' : 'SESSION_STOP'\);/);
  const converse = strip(read('src/lib/comm/converse.ts'));
  assert.match(converse, /signal: req\.signal,/);
  assert.match(converse, /await reader\.cancel\(\);/);
  // And the turn after an interruption still works: the generation is bumped
  // and listening is handed back rather than the state merely relabelled.
  assert.match(c, /if \(this\.state === 'INTERRUPTED'\) this\.resumeListening\(\);/);
  assert.match(c, /this\.turnGeneration = this\.player\?\.currentGeneration/);
});

/* ── 4. Interrupting is still hard to do by accident ───────────────────── */

test('cancelling for cost must not have made interrupting easier', () => {
  // The saving is worthless if it makes the assistant twitchy. These are the
  // same bars the previous pass set, asserted here because the cancellation
  // work is what would be tempted to lower them.
  const t = read('src/lib/comm/transcript.ts');
  assert.match(t, /assertiveEnergy: 0\.34,/);
  assert.match(t, /confirmMs: 450,/);
  assert.match(t, /graceMs: 200,/);
  assert.match(t, /tailSeconds: 0\.35,/);
  assert.match(t, /if \(typeof pending === 'number' && pending <= cfg\.tailSeconds\) return 'NONE';/);
});

/* ── 5. A person who can take a joke ───────────────────────────────────── */

test('swearing and teasing are answered, not policed', () => {
  assert.match(edge, /WHEN THEY SWEAR, JOKE OR COME AT YOU/);
  for (const banned of ['NEVER a line about staying respectful', 'a lecture about', 'a policy voice',
    'going cold', 'ending a call because somebody swore', 'those answers are worse']) {
    assert.ok(edge.includes(banned), banned);
  }
  assert.match(edge, /Mild profanity of your/);
  assert.match(edge, /own is fine where the language carries it/);
  assert.match(edge, /do not get wounded; take the joke/);
  assert.match(edge, /a confident specific answer is the best comeback there is/);
  // Generated from the turn, never picked off a shelf.
  assert.match(edge, /Build the reply out of what they said: never a stock comeback, never one you have used/);
  // And not a sales funnel with a laugh track on it.
  assert.match(edge, /NOT end every joke by steering back to Homatch/);
  assert.match(edge, /never as copy/);
  // Swearing alone can no longer end a conversation.
  assert.match(edge, /swearing alone is never this/);
});

test('the limits on it are stated as plainly as the licence', () => {
  assert.match(edge, /Their accent, religion, race, disability, body,/);
  assert.match(edge, /grief or bad luck never are/);
  assert.match(edge, /Banter is not abuse/);
  assert.match(edge, /a credible threat, or somebody who is only there to/);
  assert.match(edge, /degrade another person, gets a short flat answer and no comedy/);
  assert.match(edge, /READ THE ROOM/);
  assert.match(edge, /legal, fraud, somebody frightened, grieving, in trouble or complaining seriously/);
  assert.match(edge, /the lightness/);
  assert.match(edge, /completely, without being announced/);
  // Still not a comedian.
  assert.match(edge, /You are not a comedian/);
  assert.match(edge, /never a joke instead of an answer/);
  assert.match(edge, /most replies have none in them/);
});

test('and a brief wander off the subject is allowed', () => {
  assert.match(edge, /Property is the subject, not a leash/);
  assert.match(edge, /If it never comes back, say the demo is about property and wrap up/);
});

test('the prompt is still read on every turn, so it is still measured', () => {
  const i = edge.indexOf('function publicDemoInstructions');
  const j = edge.indexOf('\n}\n', i);
  const lines = (edge.slice(i, j).match(/^\s*[`'].*[`'],\s*$/gm) ?? [])
    .map((line) => line.trim().replace(/^[`']/, '').replace(/[`'],$/, ''));
  const chars = lines.join('\n').length;
  /*
   * 10,383 before the latency pass, 8,098 after it. The personality this pass
   * adds is real instruction rather than prose, and it was condensed twice
   * and paid for with cuts elsewhere -- but it is not free, and pretending a
   * budget was held when it was not is how the next pass inherits a problem.
   */
  assert.ok(chars < 9600, `the prompt is ${chars} characters`);
  assert.ok(chars < 10_383, 'still smaller than it was before any of this work');
});

/* ── 6. The failures the owner's live session actually exposed ──────────── */

test('usage is recorded on every path out of a turn, not just the happy one', () => {
  /*
   * PRODUCTION, session e380ff84, 2026-09-18 19:12-19:14 UTC: 23 Cartesia
   * rows, 1,017 characters, every cost NULL, no recognition row and no model
   * row. The first cause was that the edge function carrying this code was
   * never deployed -- its CI run failed at lint, which skips the deploy job.
   *
   * The second cause was mine and would have survived the deploy: the
   * recorder was written inline just before converse_ok, which sits after
   * three early returns and inside the try the catch escapes. A turn that
   * failed its language check, produced no text, was cancelled or crashed
   * recorded nothing -- having already spent the tokens and the seconds.
   */
  const e = strip(edge);
  assert.match(e, /const recordTurnUsage = async \(outcome: \{ ok: boolean; error: string \| null \}\)/);
  assert.match(e, /let usageRecorded = false;/);
  assert.match(e, /if \(usageRecorded\) return;/, 'and never twice for one turn');
  // Called from the finally, after the drain, so it cannot be skipped.
  assert.match(e, /await recordTurnUsage\(\s*abandoned\s*\? \{ ok: false, error: 'CANCELLED' \}\s*: \{ ok: true, error: null \},\s*\)/);
  const fin = e.slice(e.indexOf('await drain.catch('), e.indexOf('await drain.catch(') + 700);
  assert.ok(fin.includes('recordTurnUsage'), 'it runs in the finally block');
  assert.ok(fin.includes('controller.close()'), 'before the response is closed');
  // The recorder must not be back inside the try it escaped from.
  const okAt = e.indexOf("logEvent('ai-talk', 'converse_ok'");
  assert.ok(e.indexOf('const recordTurnUsage') < okAt, 'declared before the happy path, not inside it');
  assert.ok(!e.slice(okAt, okAt + 400).includes('recordVoiceUsage'), 'and not duplicated there');
});

test('a price that does not resolve is an event, not a silent null', () => {
  /*
   * A row with real characters and no cost looks exactly like a row that was
   * priced at nothing. That is how 23 live rows sat unpriced without anything
   * raising its hand, so every leg now says so when the book fails it.
   */
  const e = strip(edge);
  const unpriced = e.match(/cogs_unpriced/g) ?? [];
  assert.ok(unpriced.length >= 3, `all three legs report it (found ${unpriced.length})`);
  assert.match(e, /provider: 'CARTESIA', role: 'TTS', model: out\.data\.model, characters: out\.data\.characters,\s*\}\);/);
  assert.match(e, /provider: 'OPENAI', role: 'LLM', model, input_tokens: inTok, output_tokens: outTok,/);
  assert.match(e, /provider: 'GOOGLE', role: 'STT', model: GOOGLE_STT_MODEL, audio_seconds: seconds,/);
  // And a price book that cannot be read at all is louder still, because that
  // failure would otherwise be indistinguishable from "no rate for this model".
  const cogs = strip(read('supabase/functions/_shared/comm/voiceCogs.ts'));
  assert.match(cogs, /event: 'price_book_unavailable'/);
  assert.match(cogs, /stale_rows: cache\?\.rows\.length \?\? 0,/);
});

test('the two recogniser streams are stored apart, never summed first', () => {
  // The whole point of measuring them is to know what the language-switching
  // second opinion costs. Adding them before storage would destroy that.
  const e = strip(edge);
  assert.match(e, /\{ seconds: body\.sttAudioSeconds, stream: 'PRIMARY' \}/);
  assert.match(e, /\{ seconds: body\.sttShadowAudioSeconds, stream: 'SECOND_OPINION' \}/);
  assert.match(e, /model: `\$\{GOOGLE_STT_MODEL\}:\$\{leg\.stream\}`/);
  // One row per stream per turn, and only for a stream that actually ran.
  assert.match(e, /if \(typeof leg\.seconds !== 'number' \|\| !\(leg\.seconds > 0\)\) continue;/);
  assert.ok(!/sttAudioSeconds \+ .*sttShadowAudioSeconds/.test(e), 'never added together');
});

test('the model priced is the model the provider said it ran', () => {
  const e = strip(edge);
  assert.match(e, /const LUNA_MODEL_FALLBACK = 'gpt-5\.6-luna';/);
  assert.match(e, /const model = llmModel \?\? LUNA_MODEL_FALLBACK;/);
  // llmModel is only set from the provider's own completed event.
  assert.match(e, /if \(event\.model !== undefined\) llmModel = event\.model;/);
  const l = strip(llm);
  assert.match(l, /cachedInputTokens: event\.response\.usage\.input_tokens_details\?\.cached_tokens \?\? null,\s*outputTokens: event\.response\.usage\.output_tokens \?\? 0,\s*model,/);
  // Nothing anywhere estimates tokens from text length.
  assert.ok(!/inputTokens:.*length \/ 4/.test(e), 'tokens are never guessed from characters');
});

test('a cancelled turn still records what it actually spent', () => {
  const e = strip(edge);
  // The provider bills for work, not for work that pleased us.
  assert.match(e, /\? \{ ok: false, error: 'CANCELLED' \}/);
  // Synthesis never submitted costs nothing and says so; synthesis cut off
  // mid-stream was submitted and is priced in full.
  assert.match(e, /const neverSubmitted = out\.error\?\.code === 'CANCELLED'/);
  assert.match(e, /characters: neverSubmitted \? 0 : params\.text\.length,/);
  assert.match(e, /costUsd: neverSubmitted \? 0 : ttsCost\(/);
});

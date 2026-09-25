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
import { resolveTurnLanguage } from '../talkLanguage.ts';
import { LISTENING_LANGUAGES } from '../languageRegistry.ts';
import {
  rateFor, charge, llmCost, sttCost, ttsCost, audioSecondsFromBytes, LIVE_BYTES_PER_SECOND,
} from '../../../../supabase/functions/_shared/comm/voiceCogs.ts';

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
/*
 * Line endings are normalised because these assertions read SOURCE, and a
 * Windows working copy and a fresh CI checkout disagree about them. A test
 * that passes on one machine and fails on another is worse than no test: it
 * teaches people to ignore the result. Caught by running this suite in a
 * clean worktree rather than trusting the tree it was written in.
 */
const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');

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
  assert.match(edge, /take the joke, then answer the real point under it well/);
  assert.match(edge, /take the joke, then answer the real point under it well/);
  // Generated from the turn, never picked off a shelf.
  assert.match(edge, /Build the reply out of what they said: never a stock comeback, never one you have used/);
  // And not a sales funnel with a laugh track on it.
  // The blanket ban cancelled the off-topic landing in production session
  // 4be2bc31. It is now scoped: no PITCH after every joke, but landing the
  // conversation back on their search is welcome and, off-topic, required.
  assert.match(edge, /Do NOT end every joke with a PITCH for Homatch/);
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
  assert.match(edge, /Be good company\. Lively, warm, quick, a little playful/);
  // Was: 'and most replies have none in them'. Removed deliberately after the
  // 2026-09-20 physical test -- it is what made Mariam read as dry. The
  // BOUNDS on humour below are unchanged; only the discouragement is gone.
  assert.match(edge, /Wit comes from what was just said or not at all/);
});

test('a wander off the subject is allowed, and answered like a person', () => {
  /*
   * This used to assert "Property is the subject, not a leash", which was too
   * permissive: it licensed a full general-purpose answer to anything, and
   * the assistant duly became a general assistant. The replacement keeps the
   * permission -- a swerve is not a refusal -- and bounds the reply.
   */
  assert.match(edge, /4\. NOWHERE NEAR IT/);
  assert.match(edge, /One to/);
  assert.match(edge, /THIS TOPIC DOES NOT GET A SECOND EXCHANGE/);
  assert.match(edge, /Somebody still far off property after two redirects is not here for this/);
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
  /*
   * 10,383 before the latency pass, 8,098 after it, 9,444 after the
   * personality one, and the domain correction is about 800 more. Most of the
   * latency reduction is given back, deliberately and once: the prompt is
   * read on every turn and the model's first token was 84% of server latency
   * when last measured. The canonical ceiling and the reasoning live in
   * talkCostAndCancel.test.mjs; this only checks it still says everything.
   */
  /*
   * 10,383 WAS A HISTORICAL CLAIM, AND IT IS NO LONGER TRUE.
   *
   * It said the prompt was still smaller than before the latency pass. Naming
   * the assistant cost 187 characters net: the identity line, one rule for
   * answering "what is your name" without introducing herself every turn, and
   * the label the conversation history gives her turns. 10,570 today.
   *
   * It was 347 before that rule was condensed to two lines. It was briefly
   * 152 as well, by merging two instructions about never reusing a line --
   * which are pinned by name in the personality tests below, because an
   * earlier pass wrote them to stop exactly that kind of tidying. They went
   * back word for word and the name is paid for out of its own rule instead.
   *
   * Asserting the old number would mean asserting something false, so this
   * defers to the canonical ceiling, unchanged at 10,600 and stated with its
   * reasoning in 'the prompt grew, and by how much is stated rather than
   * discovered' below. The budget is not raised here; its duplicate is gone.
   */
  assert.ok(chars > 9_000, `the prompt is ${chars} characters`);
  /*
   * RAISED FROM 10,600 TO 11,400, DELIBERATELY, ON 2026-09-20.
   *
   * The physical test asked for two things that cost words: a real-estate
   * gravity strong enough that an off-topic question cannot become a second
   * conversation, and a personality that is actually good company. Both were
   * failures of instruction, not of model, and both were paid for by trimming
   * the wording rather than by adding sections -- the net growth is about 500
   * characters, roughly 145 tokens.
   *
   * The per-turn cost of that is smaller than it looks: the prompt is prefix-
   * cached, and production session 4be2bc31 shows 2,642 of 2,808 input tokens
   * arriving cached on repeat turns. The ceiling still exists, and it is still
   * the thing that stops this file growing a paragraph per incident.
   */
  /*
   * RAISED FROM 11,400 TO 12,200 ON 2026-09-25, AND THIS ONE IS PAID FOR.
   *
   * AI TALK is the live demo of the AI Call Center, which was true of the
   * architecture and absent from the prompt -- so the demo never said what it
   * was, and no visitor could have known. That identity, the honest list of
   * what a campaign can actually configure, and the mapping from a stated
   * need to ONE product cost about 620 characters after two passes of
   * trimming. They are capability, not explanation.
   *
   * WHAT CHANGED SINCE THE LAST CEILING, AND WHY IT MATTERS HERE.
   *
   * This ceiling was set when the first turn of every conversation read the
   * whole prompt cold: production measured llm_cached_input_tokens = 0 on
   * turn one and a first token at 2,473-2,990 ms. The prompt-cache warm-up
   * now asks once at session creation, and the first turn of session
   * 65bd451d arrived with 2,765 of 2,937 input tokens CACHED -- 94% -- with a
   * first token at 1,500 ms. The marginal cost of prompt length on turn one
   * is a fraction of what this ceiling was originally protecting.
   *
   * It is still a ceiling, and it is still the thing that stops this file
   * growing a paragraph per incident. The next person who wants more must
   * trim first, as this change did, and then say what they measured.
   */
  assert.ok(chars < 12_200, `the prompt is ${chars} characters, past the canonical ceiling`);
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

/* ── 12. The session that ended up in Telugu ────────────────────────────── */

const TELUGU = 'నేను తెలుగు మాట్లాడుతున్నాను ఇక్కడ చాలా బాగుంది';

test('a language this conversation has never spoken waits one turn', () => {
  /*
   * PRODUCTION, session 053fc5ef, 2026-09-18 20:02:41 UTC. The `auto` socket
   * returned a transcript in TELUGU SCRIPT during a Georgian conversation on
   * the Georgian site. Telugu script belongs to exactly one language, so
   * SCRIPT resolved it at confidence 1 and the session switched. The pinned
   * recogniser then became te-IN, which can never emit Georgian letters, so
   * no later turn could bring the conversation home. It ended in Telugu.
   * The visitor had been speaking Georgian and English.
   *
   * Script says WHICH language with great authority and says nothing at all
   * about whether that language belongs in this conversation.
   */
  const first = resolveTurnLanguage({
    transcript: TELUGU, providerLanguage: 'te', providerDetected: true,
    previousSessionLanguage: 'en', pageLocale: 'ka', sessionLanguages: ['ka', 'ru', 'ar', 'en'],
  });
  assert.equal(first.resolvedLanguage, 'en', 'the session is not carried off on one turn');
  assert.equal(first.resolutionReason, 'UNSUPPORTED_LANGUAGE');
  assert.equal(first.proposedLanguage, 'te', 'but what it asked for is remembered');
  assert.ok(first.confidence < 0.6, 'and never becomes a settled fact');

  /*
   * AND ON 2026-09-19 THE CURE BECAME STRONGER: NEVER, NOT "NOT YET".
   *
   * One turn of hysteresis was the right answer while any of forty-four
   * languages could carry a conversation. Production session caeddb62 showed
   * the cost of that premise -- Hindi, out of a socket pinned ka-GE, from
   * somebody speaking Georgian, answered aloud in Hindi. Telugu is not a
   * language this product converses in, so asking twice changes nothing.
   */
  const second = resolveTurnLanguage({
    transcript: TELUGU, providerLanguage: 'te', providerDetected: true, unconfirmedLanguage: 'te',
    previousSessionLanguage: 'en', pageLocale: 'ka', sessionLanguages: ['ka', 'ru', 'ar', 'en'],
  });
  assert.equal(second.resolvedLanguage, 'en', 'asking twice is still not a supported language');
  assert.equal(second.resolutionReason, 'UNSUPPORTED_LANGUAGE');
});

test('the six the microphone can be pinned to still switch on the first turn', () => {
  // These are not a favoured list, they are what the recogniser can be
  // configured to hear. A switch into one of them is the product working.
  const cases = [
    ['ru', 'Здравствуйте, я ищу двухкомнатную квартиру в Ваке.'],
    ['ar', 'مرحبا، أبحث عن شقة بغرفتي نوم في تبليسي.'],
    ['he', 'שלום, אני מחפש דירת שני חדרים בתל אביב.'],
    ['en', 'Hello, I am looking for a two bedroom flat in Vake.'],
    ['tr', "Vake'de metrekare fiyatı nedir?"],
  ];
  for (const [lang, said] of cases) {
    const r = resolveTurnLanguage({
      transcript: said, providerLanguage: lang, providerDetected: true,
      previousSessionLanguage: 'ka', pageLocale: 'ka', sessionLanguages: ['ka'],
    });
    assert.equal(r.resolvedLanguage, lang, `ka -> ${lang}: "${said}" (${r.resolutionReason})`);
    assert.equal(r.switched, true);
  }
  assert.deepEqual([...LISTENING_LANGUAGES].sort(), ['ar', 'en', 'he', 'ka', 'ru', 'tr']);
});

test('a language outside the six is read, and never becomes the conversation', () => {
  /*
   * This asserted the opposite until 2026-09-19: Spanish, French and German
   * were languages the assistant could answer in, believed on their own
   * letters. Production session caeddb62 retired that idea. A language the
   * microphone cannot be pinned to can only ever arrive as somebody's guess,
   * and a guess must not be able to take a conversation somewhere it cannot
   * come back from. They are still read and still named; the session holds.
   */
  for (const [lang, said] of [
    ['es', 'Hola, ¿cuánto cuesta un piso de dos habitaciones?'],
    ['fr', 'Bonjour, je cherche un appartement avec deux chambres.'],
    ['de', 'Hallo, ich suche eine Wohnung mit zwei Zimmern.'],
  ]) {
    const r = resolveTurnLanguage({
      transcript: said, providerLanguage: lang, providerDetected: true,
      previousSessionLanguage: 'ka', pageLocale: 'ka', sessionLanguages: ['ka'],
    });
    assert.equal(r.resolvedLanguage, 'ka', `${lang}: ${r.resolutionReason}`);
  }
});

test('returning home is untouched, from every language including the one that captured it', () => {
  for (const from of ['en', 'ru', 'ar', 'tr', 'he', 'te', 'es']) {
    for (const said of ['კარგი, მაშინ მითხარი რამდენი ღირს ვაკეში.', 'კი', 'ხო, მერე?', 'არა']) {
      const r = resolveTurnLanguage({
        transcript: said, providerLanguage: from, providerDetected: false,
        previousSessionLanguage: from, pageLocale: 'ka', sessionLanguages: ['ka', from],
      });
      assert.equal(r.resolvedLanguage, 'ka', `${from} -> "${said}" (${r.resolutionReason})`);
    }
  }
});

test('a language already spoken here comes straight back, with no second asking', () => {
  /*
   * The gate is about arriving somewhere new, never about going back -- but
   * only among the six a conversation may be in. Telugu left this list on
   * 2026-09-19: "already spoken here" cannot make a language supported, or
   * one bad transcript would grant itself permanent residency.
   */
  for (const lang of ['ru', 'ar', 'he', 'en']) {
    const r = resolveTurnLanguage({
      transcript: lang === 'ru' ? 'Да, сколько это стоит?'
        : lang === 'ar' ? 'نعم، كم سعر الشقة؟'
          : lang === 'he' ? 'כן, כמה זה עולה?'
            : lang === 'te' ? TELUGU : 'Yes, how much does it cost?',
      providerLanguage: lang, providerDetected: true,
      previousSessionLanguage: 'ka', pageLocale: 'ka', sessionLanguages: ['ka', lang],
    });
    assert.equal(r.resolvedLanguage, lang, `back to ${lang} (${r.resolutionReason})`);
  }
});

test('a single foreign word, a proper noun or a fragment still moves nothing', () => {
  for (const [said, label] of [
    ['developer', 'en'], ['Tbilisi', 'en'], ['Abba', 'en'], ['Karki', 'en'],
    ['रामाखूया', 'hi'], ['RAM x 6Y', 'en'],
    ['Madoba, ratom ar mitxari es adre, me minda vnaxo bina', 'es'],
  ]) {
    const r = resolveTurnLanguage({
      transcript: said, providerLanguage: label, providerDetected: true,
      previousSessionLanguage: 'ka', pageLocale: 'ka', sessionLanguages: ['ka'],
    });
    assert.equal(r.resolvedLanguage, 'ka', `"${said}" moved it to ${r.resolvedLanguage}`);
  }
});

/* ── 13. The ratchet: a refused turn used to repin the microphone ───────── */

test('a turn we refuse to send cannot decide what we listen in next', () => {
  /*
   * The same session issued eighteen turn ids and sent ten. The eight that
   * were refused as gibberish had ALREADY repinned the session language,
   * because the assignment ran before the refusal. Repinning the session
   * repoints the recogniser socket, so the next utterance was heard by a
   * recogniser configured from a transcript we had just declared unusable --
   * which produced more gibberish, which repinned again.
   *
   * The trace shows it: every turn that reached the server arrived with
   * previous_session_language already set to a language no accepted turn had
   * ever resolved to. ka -> ru -> ar -> en -> te.
   */
  const c = strip(client);
  const refuseAt = c.indexOf('if (this.shouldRefuse(said, resolution.resolvedLanguage))');
  const pinAt = c.indexOf('const before = this.language.current;');
  assert.ok(refuseAt > 0 && pinAt > 0);
  assert.ok(refuseAt < pinAt, 'the refusal decides before the session is repinned');
  // And the refusal path leaves before reaching the pin.
  const block = c.slice(refuseAt, pinAt);
  assert.match(block, /this\.resumeListening\(\);\s*return;/);
  assert.match(block, /this\.refusedSinceLastTurn \+= 1;/, 'and is counted for the next trace');
  // Only an accepted turn teaches the session a language or a candidate.
  assert.match(c, /this\.unconfirmedLanguage = resolution\.proposedLanguage;/);
  assert.match(c, /this\.spokenLanguages\.add\(resolution\.resolvedLanguage\);/);
  assert.ok(c.indexOf('this.spokenLanguages.add') > refuseAt, 'after the refusal, not before');
});

/* ── 14. Thinking must mean thinking ────────────────────────────────────── */

test('the assistant does not claim to be thinking because a silence was detected', () => {
  /*
   * UNDERSTANDING -- "ვფიქრობ..." on screen -- was entered the moment an
   * endpointer decided speech had stopped, before any transcript existed and
   * before anything had been qualified. On the owner's session most of those
   * became nothing: a fragment refused two seconds later, and the state went
   * back to listening having promised an answer that was never coming. The
   * ones that were not refused reached the model as fragments and came back
   * as "I'm listening", which is the only honest answer to being handed
   * nothing.
   */
  const c = strip(client);
  // Neither endpointer announces thinking any more.
  const endTurn = c.slice(c.indexOf('private maybeEndLiveTurn'), c.indexOf('private maybeEndLiveTurn') + 2600);
  assert.ok(!endTurn.includes("setState('UNDERSTANDING')"), 'the local endpointer does not');
  // The primary socket's handler, not the shadow's empty one beside it.
  const at = c.indexOf('this.marks.endpointConfirmedAtMs = Date.now();');
  assert.ok(at > 0, 'the moment is still stamped');
  const onSpeechEnd = c.slice(at - 300, at + 300);
  assert.ok(!onSpeechEnd.includes("setState('UNDERSTANDING')"), "the provider's endpointer does not");
  // It is set where a turn is actually committed to the model.
  const take = c.slice(c.indexOf("this.setState('UNDERSTANDING');\n    this.milestone('user_turn_sent'"));
  assert.ok(take.startsWith("this.setState('UNDERSTANDING');"), 'immediately before the turn is sent');
});

test('the shape of a turn, and of the turns that never were, reaches the trace', () => {
  // Reconstructing the Telugu session needed both and neither was recorded:
  // a refused turn produces no server event, because it never reaches one.
  const c = strip(client);
  assert.match(c, /get turnShape\(\)/);
  assert.match(c, /refusedBefore: this\.refusedForThisTurn,/);
  assert.match(c, /shadowLanguage: this\.shadowResult\?\.language \?\? null,/);
  assert.match(c, /proposedLanguage: this\.lastResolution\?\.proposedLanguage \?\? null,/);
  const panel = strip(read('src/components/home/AiTalkPanel.tsx'));
  assert.match(panel, /turnShape: sessionRef\.current\.turnShape/);
  const e = strip(edge);
  for (const field of ['transcript_chars', 'transcript_words', 'shadow_language',
    'proposed_language', 'refused_before']) {
    assert.ok(e.includes(field), `${field} is logged`);
  }
  // Lengths and counts, never the words themselves.
  assert.ok(!/transcript_text|said_text|transcript_body/.test(e), 'no transcript content is logged');
  // What IS logged about the words is their count and their alphabet.
  assert.match(e, /transcript_chars: body\.turnShape\?\.transcriptChars \?\? null,/);
  assert.match(e, /transcript_script:/);
});

test('the six listening languages are declared once, not in two places', () => {
  // The edge granted sockets from its own copy while the resolver judged
  // switches from another; two copies of "what can this product hear" drift.
  const e = strip(edge);
  assert.match(e, /import \{ LANGUAGE_NAMES as REGISTRY_LANGUAGE_NAMES, SPEECH_TAGS \}/);
  assert.ok(!/const SPEECH_TAGS: Record<string, string> = \{/.test(e), 'the edge no longer defines its own');
  const reg = read('src/lib/comm/languageRegistry.ts');
  assert.match(reg, /export const SPEECH_TAGS: Record<string, string> = \{/);
  assert.match(reg, /export const LISTENING_LANGUAGES: readonly string\[\] = Object\.keys\(SPEECH_TAGS\);/);
});

/* ── 15. A real-estate assistant, not a general one ─────────────────────── */

/*
 * These assert the CONTRACT the prompt makes, not the sentences a model
 * produces from it. A test that pinned an expected reply would be testing
 * the model, would break on every rewording, and would teach nobody
 * anything. What can be checked deterministically is whether the
 * instruction that produces the behaviour is present, unambiguous and not
 * contradicted somewhere else in the same prompt.
 */

test('the domain is stated as an identity, not as background reading', () => {
  // It used to say "Background, not an agenda", which is why the assistant
  // drifted into answering anything at all: nothing told it what it was FOR.
  assert.match(edge, /WHAT YOU ARE FOR\. Property in Georgia, and Homatch/);
  assert.match(edge, /Deep here\. A general assistant nowhere else\./);
  assert.ok(!edge.includes('Background, not an agenda'), 'the passive framing is gone');
  // The four kinds of turn, each named.
  for (const mode of ['1. ABOUT PROPERTY', '2. AROUND IT', '3. SERIOUS', '4. NOWHERE NEAR IT']) {
    assert.ok(edge.includes(mode), mode);
  }
  assert.match(edge, /telling them apart matters more than any single rule above/);
});

test('a question from nowhere near property gets two sentences, not an essay', () => {
  /*
   * The reported regression: ask about something a general chatbot would
   * answer, and it answered like one. The failure is not rudeness, it is
   * competence misapplied, so the prompt names it as the failure.
   */
  assert.match(edge, /ANSWERING THAT PROPERLY IS THE ONE FAILURE THAT MATTERS HERE/);
  assert.match(edge, /One to/);
  assert.match(edge, /sentences -- notice the swerve, be funny about it in their own language, land back on property/);
  // The topics named are examples of a KIND, not a filter to match against.
  assert.match(edge, /dating, celebrities, politics, homework, code, recipes, philosophy/);
  assert.match(edge, /what somebody',\s*'\s*would ask a general chatbot/);
});

test('the redirect is human, and every corporate escape hatch is closed', () => {
  assert.match(edge, /Never',\s*'\s*a refusal, "I cannot discuss", "my scope", a policy line or a paragraph/);
  // And the same prohibitions the personality pass established still stand.
  assert.match(edge, /NEVER a line about staying respectful/);
  assert.match(edge, /never "as an AI"/);
  assert.ok(!/I am unable to discuss|My scope is limited|I cannot help with that topic/.test(edge),
    'no canned refusal is written into the prompt for the model to copy');
});

test('it is generated from the turn, never picked off a shelf', () => {
  assert.match(edge, /Built from what they just',\s*'\s*said, never the same line twice/);
  assert.match(edge, /Build the reply out of what they said: never a stock comeback, never one you have used/);
  /*
   * No topic filter and no joke library anywhere in the voice path. The
   * model is given a distinction to understand, not a list to match, because
   * a keyword list is wrong at the edges in both directions: it fires on
   * "the bedroom faces north" and misses everything it did not anticipate.
   */
  const paths = [
    'supabase/functions/ai-talk-session/index.ts',
    'src/lib/comm/voiceClient.ts',
    'src/lib/comm/talkLanguage.ts',
  ];
  for (const p of paths) {
    const src = read(p);
    assert.ok(!/OFF_TOPIC_(WORDS|TOPICS|PATTERNS)|BANNED_TOPICS|TOPIC_FILTER|REDIRECT_LINES|JOKES\s*=/.test(src),
      `${p} has no topic filter or joke library`);
  }
});

test('conversation around the search is not treated as off-topic', () => {
  // The other way to get this wrong: refuse everything that is not literally
  // about a flat, and make the thing unusable.
  for (const allowed of ['greetings, how they are, sick of viewings',
    'a partner who hates the district, kids, the',
    'what they can afford, not knowing what they want, a joke mid-search',
    'This IS the']) {
    assert.ok(edge.includes(allowed), allowed);
  }
  assert.match(edge, /conversation: answer like a person and steer nowhere/);
  // A greeting has an explicit worked example elsewhere in the prompt.
  assert.match(edge, /"How are you\?" gets "Good, and/);
});

test('serious subjects get a complete answer and no joke at all', () => {
  assert.match(edge, /3\. SERIOUS -- money at risk, contracts, legal trouble, a lost deposit, a stalled developer/);
  assert.match(edge, /Complete, precise, professional, and no joke anywhere in it including the opening/);
  // And the standing rule that removes the lightness entirely.
  assert.match(edge, /READ THE ROOM/);
  assert.match(edge, /the lightness/);
  assert.match(edge, /goes, completely, without being announced/);
  // Value is never traded away for brevity.
  assert.match(edge, /Never shorten something worth knowing to sound conversational/);
});

test('humour is still wanted, and still situational', () => {
  for (const kept of ['genuinely fun to talk to', 'Notice the funny thing',
    'make the small dry observation', 'be dry or sarcastic when the moment invites it',
    'tease back when', 'You are not a comedian', 'never a joke instead of an answer',
    'Be good company', 'Tease the apartment hunt itself']) {
    assert.ok(edge.includes(kept), kept);
  }
  // Was: 'and most replies have none in them'. Removed deliberately after the
  // 2026-09-20 physical test -- it is what made Mariam read as dry. The
  // BOUNDS on humour below are unchanged; only the discouragement is gone.
  assert.match(edge, /Wit comes from what was just said or not at all/);
});

test('the wit is native to whichever language is being spoken', () => {
  assert.match(edge, /Humour must be native to the language/);
  assert.match(edge, /Georgian wit in Georgian, never an English joke wearing Georgian words/);
  assert.match(edge, /Russian, Turkish, Arabic and Hebrew\. If it only works in translation, drop it/);
  // Georgian keeps its own section and its own register.
  assert.match(edge, /GEORGIAN\. Speak the Georgian a sharp Tbilisi broker speaks out loud/);
  assert.match(edge, /if they are casual with you, be/);
  assert.match(edge, /MATCH THEM/);
  assert.match(edge, /Formal, be',\s*'\s*professional/);
});

test('coming back to property resumes the work, and only persistence ends it', () => {
  assert.match(edge, /THIS TOPIC DOES NOT GET A SECOND EXCHANGE/);
  assert.match(edge, /Somebody still far off property after two redirects is not here for this/);
  // Ending is for somebody who will not come back, never for one swerve.
  assert.match(edge, /or somebody who will not come back to property/);
  assert.ok(!edge.includes('Property is the subject, not a leash'),
    'the rule that licensed the drift is gone');
});

test('none of the deployed voice work was touched to achieve this', () => {
  /*
   * This is a prompt change. The architecture underneath it was measured,
   * fixed and physically verified in production, and nothing here may move
   * it. Named explicitly because "while I was in there" is how that gets
   * undone.
   */
  const e = strip(edge);
  assert.match(e, /recordTurnUsage/, 'per-path COGS recording');
  assert.match(e, /cogs_unpriced/, 'the unpriced alarm');
  assert.match(e, /stream: 'SECOND_OPINION'/, 'the two recogniser streams, separately');
  assert.match(e, /abandon\(/, 'the cancellation seam');
  assert.match(e, /cancel\(reason\)/, 'the stream cancel handler');
  assert.match(e, /SPEECH_TAGS/, 'the six listening languages, one copy');
  const c = strip(client);
  assert.match(c, /get turnShape\(\)/);
  assert.match(c, /this\.unconfirmedLanguage = resolution\.proposedLanguage;/);
  const t = read('src/lib/comm/transcript.ts');
  assert.match(t, /assertiveEnergy: 0\.34,/);
  assert.match(t, /confirmMs: 450,/);
  assert.match(t, /tailSeconds: 0\.35,/);
  // And the model is unchanged.
  assert.match(read('supabase/functions/_shared/comm/llm.ts'), /'gpt-5\.6-luna'/);
});

test('the prompt grew, and by how much is stated rather than discovered', () => {
  const i = edge.indexOf('function publicDemoInstructions');
  const j = edge.indexOf('\n}\n', i);
  const lines = (edge.slice(i, j).match(/^\s*[`'].*[`'],\s*$/gm) ?? [])
    .map((line) => line.trim().replace(/^[`']/, '').replace(/[`'],$/, ''));
  const chars = lines.join('\n').length;
  /*
   * 10,383 before the latency pass, 8,098 after it, 9,444 after the
   * personality one, and this domain correction is about 800 more. That is
   * most of the latency reduction given back, and it is a real cost: the
   * prompt is read on every turn and the model's first token was 84% of
   * server latency when it was last measured. It was condensed three times
   * and paid for with a duplicated clause, an overlap between two sections
   * and a repeated language list. The number is asserted so the next person
   * to add a paragraph has to look at it.
   *
   * Naming the assistant Mariam added 187 net on top of that -- 10,570 -- and
   * the ceiling has NOT moved to absorb it: the identity rule was condensed
   * from four lines to two to pay for most of it. Thirty characters of
   * headroom left, which is the point of asserting the measured number rather
   * than a bound nobody ever approaches.
   */
  /*
   * 12,200 on 2026-09-25, for the AI Call Center demo identity -- what this
   * call IS, what a campaign can honestly be configured with, and the mapping
   * from a stated need to ONE product. About 620 characters after two passes
   * of trimming, and the reasoning, including the prompt-cache measurement
   * that changed the cost of prompt length, is stated once beside the other
   * ceiling assertion above rather than twice.
   */
  assert.ok(chars < 12_200, `the prompt is ${chars} characters`);
  assert.ok(chars > 9_000, 'and it still says everything it has to say');
});

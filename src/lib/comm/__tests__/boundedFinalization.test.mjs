/*
 * THE ELEVEN SECONDS WERE OURS, NOT GOOGLE'S.
 *
 * MEASURED, production session 66e4e448 turn t6:
 *
 *   our endpointer confirmed the turn        345 ms
 *   the finalisation path then took       10,870 ms
 *   the visitor heard nothing for         ~11 s
 *
 * The obvious reading was "the provider froze". It was not. NO_FINAL_TIMEOUT_MS
 * was 6,000, so after the half-close the client sat through six seconds of its
 * OWN timer before it would even begin recovery -- and then recovery, and then
 * a batch round trip. Against the distribution of finals that actually arrive:
 *
 *   normal            647, 740, 767, 767, 817 ms
 *   slower, healthy   1,639 ms
 *
 * six seconds is not patience, it is a hang. This file exists to hold the new
 * deadline to both ends of that: it must not cut the 1,639ms final, and it must
 * not let the 10,870ms case run.
 *
 * WHY THESE RUN RATHER THAN READ. FinalWatch takes its clock as an argument, so
 * every case below is the real decision function on an injected timeline, not a
 * regex over a source file. The three cases that source-reading cannot express
 * -- a late final, a stale final, and a turn boundary in between -- are exactly
 * the ones that shipped broken.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { FinalWatch } from '../finalWatch.ts';
import { LiveAudioRouter } from '../liveAudioRouter.ts';

const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');
const CLIENT = read('src/lib/comm/voiceClient.ts');
const ROUTER = read('src/lib/comm/liveAudioRouter.ts');
const EDGE = read('supabase/functions/ai-talk-session/index.ts');

/** The deadline the product actually ships, read off the source. */
const DEADLINE = Number(
  /const NO_FINAL_TIMEOUT_MS = ([\d_]+);/.exec(CLIENT)[1].split('_').join(''),
);

/** The watch as VoiceSession constructs it: the shipped deadline, three misses. */
const watch = () => new FinalWatch({ timeoutMs: DEADLINE, maxConsecutive: 3 });

/* ── The deadline, against the distribution it was derived from ───────────*/

test('DERIVED_NOT_GUESSED: the deadline sits between the worst healthy final and the stall', () => {
  /*
   * The two numbers that bound it. Anything inside this range is defensible;
   * 6,000 was not, and neither would 1,500 be -- that one cuts a real final.
   */
  assert.ok(DEADLINE > 1_639, `${DEADLINE}ms would cut the slowest final that actually arrived (1,639ms)`);
  assert.ok(DEADLINE < 10_870, `${DEADLINE}ms does not bound the measured stall`);
  // And materially below it, not a token trim: a visitor waiting through a
  // quarter of the stall has still been abandoned.
  assert.ok(DEADLINE <= 3_000, `${DEADLINE}ms is still a hang from the visitor's side`);
  // The reasoning travels with the constant, or the next person re-guesses it.
  const why = CLIENT.slice(CLIENT.indexOf('HOW LONG A FINAL MAY BE OWED'), CLIENT.indexOf('const NO_FINAL_TIMEOUT_MS'));
  for (const n of ['10,870', '1,639', '647']) {
    assert.ok(why.includes(n), `the derivation does not cite ${n}`);
  }
});

test('A_NORMAL_FINAL_IS_NEVER_CUT: every measured healthy latency arrives', () => {
  // The five normal finals and the slow-but-healthy one, each on its own turn.
  for (const ms of [647, 740, 767, 767, 817, 1_639]) {
    const w = watch();
    w.requested(0);
    // The session ticks throughout the wait; none of these may resolve as a miss.
    for (let t = 0; t < ms; t += 50) {
      assert.equal(w.tick(t), null, `a ${ms}ms final was cut at ${t}ms`);
    }
    w.arrived();
    assert.equal(w.isPending, false);
    assert.equal(w.noFinalCount, 0, `a ${ms}ms final was counted as missing`);
    assert.equal(w.consecutiveNoFinals, 0);
  }
});

test('THE_BOUNDARY: one millisecond inside arrives, one millisecond outside recovers', () => {
  const inside = watch();
  inside.requested(1_000);
  assert.equal(inside.tick(1_000 + DEADLINE - 1), null, 'a final one ms inside the deadline was cut');
  inside.arrived();
  assert.equal(inside.noFinalCount, 0);

  const outside = watch();
  outside.requested(1_000);
  const decision = outside.tick(1_000 + DEADLINE);
  assert.deepEqual(decision, { kind: 'RECOVER', reason: 'FINAL_TIMEOUT' });
});

test('NO_FINAL: recovery begins at the deadline and not eleven seconds later', () => {
  const w = watch();
  w.requested(0);
  let recoveredAt = null;
  for (let t = 0; t <= 12_000 && recoveredAt === null; t += 1) {
    if (w.tick(t)) recoveredAt = t;
  }
  assert.equal(recoveredAt, DEADLINE);
  /*
   * The whole point, stated as the visitor experiences it: the same stall that
   * cost eleven seconds of silence now costs the deadline plus recovery. The
   * old constant is named so a future edit back to it fails here.
   */
  assert.ok(recoveredAt < 6_000, 'the six-second wait is back');
});

test('LATE_FINAL_AFTER_RECOVERY_STARTS: it cannot recover a second time', () => {
  const w = watch();
  w.requested(0);
  assert.ok(w.tick(DEADLINE), 'the deadline did not fire');
  assert.equal(w.noFinalRecoveries, 1);

  // Google's answer turns up 400ms after we gave up on it. It is welcome --
  // but it is not a second event, and it must not start a second recovery.
  w.arrived();
  assert.equal(w.noFinalRecoveries, 1, 'a late final started another recovery');
  assert.equal(w.consecutiveNoFinals, 0, 'a late final did not clear the miss streak');
  // And no further tick can resurrect the resolved request.
  assert.equal(w.tick(DEADLINE + 5_000), null);
  assert.equal(w.noFinalCount, 1);
});

test('OLD_FINAL_AFTER_THE_NEXT_TURN_BEGINS: the new turn keeps its own clock', () => {
  const w = watch();
  // Turn one: half-closed at 0, missed at the deadline, recovered.
  w.requested(0);
  assert.ok(w.tick(DEADLINE));
  // Turn two begins. Its half-close resets the clock.
  const secondTurnAt = DEADLINE + 500;
  w.requested(secondTurnAt);
  /*
   * A tick that is past turn ONE's deadline but inside turn TWO's must not
   * fire. If the watch had kept the older timestamp the second turn would be
   * declared missing the instant it started -- which is how a bounded deadline
   * turns into a session that never completes a turn again.
   */
  assert.equal(w.tick(secondTurnAt + DEADLINE - 1), null, "turn two was judged on turn one's clock");
  assert.ok(w.tick(secondTurnAt + DEADLINE), 'turn two never resolved');
});

test('BOUNDED_IN_BOTH_DIRECTIONS: three misses stop reconnecting, and say so', () => {
  const w = watch();
  let last = null;
  for (let turn = 0; turn < 3; turn += 1) {
    const at = turn * 10_000;
    w.requested(at);
    last = w.tick(at + DEADLINE);
  }
  // A provider that answers nothing three times running is not a provider to
  // keep reconnecting to; the shorter deadline reaches this verdict sooner,
  // which is the improvement, not a regression.
  assert.deepEqual(last, { kind: 'GIVE_UP', reason: 'FINAL_TIMEOUT' });
});

/* ── The stale primary ───────────────────────────────────────────────────*/

test('A_RETIRED_STREAM_CANNOT_ANSWER_FOR_SOMEBODY_ELSES_TURN', () => {
  /*
   * CODE-PROVEN before the fix: onFinal called onLiveFinal with no reference to
   * the socket it came from, and the only guard compared producedEpoch to
   * utteranceEpoch -- equal ONLY while the epoch is unchanged. Once the next
   * turn had begun the epochs differed, the guard passed, and a transcript from
   * a replaced stream was committed as the new turn's words.
   */
  assert.match(CLIENT, /onFinal: \(text, heard\) => \{ void this\.onLiveFinal\(text, heard \?\? null, 'LIVE', live\); \}/);
  // The licence is stamped at the half-close, so the socket that answered for
  // the previous epoch loses it at the same instant the next one opens.
  const finalise = CLIENT.slice(CLIENT.indexOf('this.finalWatch.requested(Date.now());'));
  assert.ok(
    finalise.indexOf('this.finalOwedFrom = live;') < finalise.indexOf('this.utteranceEpoch += 1;'),
    'the licence is stamped after the epoch moves, which leaves a window',
  );
  // And the guard itself: a draining socket is still allowed, a retired one is not.
  assert.match(CLIENT, /if \(origin === 'LIVE' && from && from !== this\.live && from !== this\.finalOwedFrom\) \{/);
  assert.match(CLIENT, /this\.diag\.staleFinalsRejected \+= 1;/);
});

test('the normal path -- a half-closed socket still draining -- is NOT rejected', () => {
  /*
   * This is the case a blunter fix breaks. rotateLive() nulls `this.live`
   * before the replacement is ready, and Google flushes its last transcript
   * AFTER finalize(); a rule of "only the current socket may answer" would
   * throw away the final on every single turn boundary.
   */
  const guard = /from !== this\.live && from !== this\.finalOwedFrom/;
  assert.match(CLIENT, guard);
  assert.ok(
    !/from !== this\.live\)\s*\{\s*this\.diag\.staleFinalsRejected/.test(CLIENT),
    'the guard rejects the socket that is legitimately draining this turn',
  );
});

/* ── The second opinion is armed by evidence ─────────────────────────────*/

test('A_HEALTHY_TURN_OPENS_ONE_STREAM', () => {
  /*
   * CODE-PROVEN and measured: openShadow ran on every socket open, so every
   * turn cost two Google streams -- Railway shows them 1-103ms apart, including
   * a 19,709ms and a 19,427ms pair, and a three-turn session opened about
   * seventeen. The capability is not removed; the prepayment is.
   */
  assert.match(CLIENT, /if \(!this\.secondOpinionArmed\) \{\s*\n\s*this\.diag\.secondOpinionSkipped \+= 1;\s*\n\s*return;/);
  // It starts disarmed, which is what makes the common turn cheap.
  assert.match(CLIENT, /private secondOpinionArmed = false;/);
  // The capability itself is untouched: this is a when, not a whether.
  assert.match(CLIENT, /const SECOND_OPINION = true;/);
});

test('EVERY_KIND_OF_UNRELIABLE_PRIMARY_ARMS_IT', () => {
  // The four independent signals, each from the site that actually knows.
  for (const reason of [
    "this.armSecondOpinion(`NO_FINAL_${decision.reason}`)",       // no final at all
    "this.armSecondOpinion('EMPTY_FINAL_AFTER_SPEECH')",          // speech in, no words out
    "this.armSecondOpinion('UNSUPPORTED_LABEL')",                 // Georgian answered in Devanagari
    "this.armSecondOpinion(`RECOVERY_${plan.reason}`)",           // the batch path had to step in
    "this.armSecondOpinion('OPINION_CARRIED_TURN')",              // the opinion was right last time
  ]) {
    assert.ok(CLIENT.includes(reason), `nothing arms the opinion for ${reason}`);
  }
  /*
   * The two that matter most are decided BEFORE the rotation that opens the
   * next socket -- otherwise the arming lands two turns late, and the turn that
   * most needs a second reading is the very next one.
   */
  const rotation = CLIENT.indexOf('if (this.live?.isFinalizing) void this.rotateLive();');
  assert.ok(CLIENT.indexOf("this.armSecondOpinion('EMPTY_FINAL_AFTER_SPEECH')") < rotation,
    'the empty-final arming happens after the socket it should have armed');
  assert.ok(CLIENT.indexOf("this.armSecondOpinion('UNSUPPORTED_LABEL')") < rotation,
    'the unsupported-label arming happens after the socket it should have armed');
});

test('AND_IT_LETS_GO_AGAIN, slower than it grabs', () => {
  assert.match(CLIENT, /const CLEAN_TURNS_TO_DISARM = 3;/);
  const note = CLIENT.slice(CLIENT.indexOf('private noteCleanTurn()'), CLIENT.indexOf('private closeShadow()'));
  assert.match(note, /if \(this\.cleanTurnsSinceArmed < CLEAN_TURNS_TO_DISARM\) return;/);
  assert.match(note, /this\.secondOpinionArmed = false;/);
  // Silence is not evidence that recognition is healthy, so only turns that
  // produced a sentence count towards letting go.
  assert.match(CLIENT, /else if \(said\) this\.noteCleanTurn\(\);/);
  // Arming resets the ledger, so a clean turn before the trouble does not
  // shorten the cover after it.
  assert.match(CLIENT, /private armSecondOpinion\(reason: string\): void \{\s*\n\s*this\.cleanTurnsSinceArmed = 0;/);
});

test('MULTILINGUAL_RECOVERY_IS_UNTOUCHED', () => {
  // The carve-out that fixed the return to Georgian still stands exactly as it
  // was: an unsupported label lifts the exemption and the batch path reads the
  // audio. Nothing here was relaxed to make the cheaper path look better.
  assert.match(CLIENT, /const heardUnsupported = Boolean\(heardLanguage\) && !SPOKEN_LANGUAGES\.includes\(heardLanguage as TalkLanguage\);/);
  assert.match(CLIENT, /const exempt = \(opinion \|\| origin === 'SHADOW'\) && !heardUnsupported;/);
  assert.match(CLIENT, /const plan = exempt \? null\s*\n\s*: \(planRecovery\(recoveryInput\) \?\? planFragmentRecovery\(recoveryInput\)\);/);
});

test('SOCKETS_ARE_COUNTED_BY_ROLE', () => {
  /*
   * One number called "rotations" is what let two streams per turn hide: it
   * moved by two and read as one busy turn. These split it, and the claim the
   * next production trace has to support is recoverySocketOpenCount === 0
   * across a healthy multi-turn session.
   */
  for (const k of ['primarySocketOpenCount', 'recoverySocketOpenCount', 'staleFinalsRejected',
    'secondOpinionSkipped', 'secondOpinionArmings', 'secondOpinionDisarmings']) {
    assert.ok(CLIENT.includes(`${k}: 0,`), `${k} is not initialised`);
    assert.ok(CLIENT.includes(`${k}: number;`), `${k} is not declared on the diagnostics contract`);
  }
  // The primary is counted where the socket is actually adopted, not where one
  // was attempted -- a failed open is a failure, not a stream.
  assert.match(CLIENT, /this\.live = live;\s*\n\s*this\.diag\.primarySocketOpenCount \+= 1;/);
});

/* ── The prompt cache ────────────────────────────────────────────────────*/

test('THE_FIRST_TURN_NO_LONGER_PAYS_TO_READ_THE_PROMPT', () => {
  /*
   * MEASURED across two sessions: llm_cached_input_tokens was 0 on the first
   * turn and the first token took 2,473/2,990ms against 610-1,623ms later.
   * The instruction is identical every turn, so from turn two the provider
   * serves it from cache. This asks once, at session creation.
   */
  const warm = EDGE.slice(EDGE.indexOf('async function warmPromptCache'), EDGE.indexOf('async function start('));
  // The SAME authority for the text, called not copied, so they cannot drift
  // apart and silently stop sharing a cache prefix.
  assert.match(warm, /system: publicDemoInstructions\(locale\)/);
  assert.match(warm, /reasoningEffort: 'none'/);
  assert.match(warm, /maxOutputTokens: 16/);
});

test('and it cannot become a turn, a sound, or a delay', () => {
  const warm = EDGE.slice(EDGE.indexOf('async function warmPromptCache'), EDGE.indexOf('async function start('));
  // Not a turn: nothing is written, nothing is returned to the browser.
  assert.ok(!/comm_talk_sessions|reduceTranscript|turns:/.test(warm), 'the warm-up touches conversation state');
  // Not a sound: it ends at the model. No TTS of any kind, from any provider.
  assert.ok(!/speakPhrase|cartesia|Cartesia|elevenlabs|ElevenLabs|pcmBase64/.test(warm),
    'the warm-up reaches a speech provider');
  // Not a tool call.
  assert.ok(!/tools:|tool_choice/.test(warm), 'the warm-up sends tools');
  /*
   * AND IT NEVER BLOCKS THE MICROPHONE. Handed to waitUntil, unawaited, after
   * the grant response is built -- so it runs inside the time the visitor
   * spends on the permission prompt and the AudioContext. A runtime without
   * waitUntil skips it rather than risking the grant.
   */
  assert.match(EDGE, /EdgeRuntime\.waitUntil\(warmPromptCache\(warmLocale, session\.id\)\);/);
  assert.ok(!/await warmPromptCache/.test(EDGE), 'the warm-up is awaited and can delay the grant');
  assert.match(EDGE, /logEvent\('ai-talk', 'cache_warm_unavailable'/);
});

test('the measurement can tell a failed warm-up from an evicted cache', () => {
  // Both ends of it: what the warm-up itself saw...
  assert.match(EDGE, /logEvent\('ai-talk', 'cache_warm_start'/);
  assert.match(EDGE, /warmCachedInputTokens: cached,/);
  // ...and, on the turn, which turn it was and how old the session is. Without
  // these, llm_cached_input_tokens = 0 is unreadable.
  assert.match(EDGE, /first_turn: turnIndex === 0,/);
  assert.match(EDGE, /session_age_ms: sessionAgeMs,/);
  // Read off the session row, so a reconnect cannot make a later turn look
  // like a first one -- the direction that would flatter this measurement.
  assert.match(EDGE, /const turnIndex = session\.turns \?\? 0;/);
});

test('CARTESIA_REMAINS_THE_VOICE: nothing here changed the speech provider', () => {
  // The owner's guardrail, held as a test rather than a promise. sonic-3 and
  // the Cartesia path are what a turn still speaks with.
  assert.match(EDGE, /provider: 'CARTESIA', role: 'TTS', model: 'sonic-3'/);
  assert.match(EDGE, /speakPhraseStreaming/);
  // And no ElevenLabs call was introduced into the realtime turn path.
  const turn = EDGE.slice(EDGE.indexOf('for await (const event of streamLlm({'));
  assert.ok(!/elevenlabs\.|speakElevenLabs|ELEVENLABS_API_KEY/.test(turn),
    'an ElevenLabs call reached the realtime turn path');
});

/* ── Audio accounting, driven rather than read ───────────────────────────*/

const RATE = 16_000;
/** One 20ms block of canonical PCM: 320 samples, 640 bytes. */
const block = () => new Int16Array(320);

function router(now) {
  return new LiveAudioRouter({ sampleRate: RATE, maxBufferMs: 3_000, maxWaitMs: 2_000, now });
}

test('EVERY_DROPPED_BYTE_HAS_A_NAMED_REASON, and there is no UNKNOWN', () => {
  assert.match(ROUTER, /export type DropReason = 'ABANDONED_NO_SOCKET' \| 'HOLD_BUFFER_OVERFLOW';/);
  /*
   * "No UNKNOWN" checked against the union and the call sites rather than the
   * prose -- the first version of this assertion matched the word in its own
   * comment above and failed for saying so.
   */
  const reasons = /export type DropReason = ([^;]+);/.exec(ROUTER)[1]
    .split('|').map((r) => r.trim().slice(1, -1));
  assert.deepEqual(reasons, ['ABANDONED_NO_SOCKET', 'HOLD_BUFFER_OVERFLOW']);
  // Exactly one site attributes, and every discard goes through it, so a drop
  // cannot exist without naming one of the two above.
  assert.equal((ROUTER.match(/this\.discard\(/g) ?? []).length, 2);
  assert.equal((ROUTER.match(/this\.droppedPcmBytes \+=/g) ?? []).length, 1);

  // Abandonment: held audio whose socket never came.
  let t = 0;
  const a = router(() => t);
  a.expect('CONNECTING');
  a.route(block(), false);
  a.route(block(), false);
  a.abandon('no grant');
  assert.equal(a.droppedByReason.ABANDONED_NO_SOCKET, 1_280);
  assert.equal(a.droppedByReason.HOLD_BUFFER_OVERFLOW, 0);
  assert.ok(a.dropsAccountedFor());
  assert.ok(a.accountsBalance());

  // Overflow: the hold buffer filled. maxWaitMs should abandon first, so this
  // needs a frozen clock to reach at all -- which is the point of measuring it.
  const b = router(() => 0);
  b.expect('ROTATING');
  for (let i = 0; i < 200; i += 1) b.route(block(), false);
  assert.ok(b.droppedByReason.HOLD_BUFFER_OVERFLOW > 0, 'the buffer never bounded itself');
  assert.equal(b.droppedByReason.ABANDONED_NO_SOCKET, 0);
  assert.ok(b.dropsAccountedFor());
  assert.ok(b.accountsBalance());
});

test('LOSSLESS_AND_IN_ORDER: held audio is flushed once, whole, in sequence', () => {
  let t = 0;
  const r = router(() => t);
  r.expect('CONNECTING');
  // Five distinguishable blocks arrive while the socket is still opening.
  const sent = [];
  for (let i = 1; i <= 5; i += 1) {
    const b = block();
    b[0] = i;
    sent.push(i);
    t += 20;
    assert.deepEqual(r.route(b, false), { kind: 'HELD' }, `block ${i} was not held`);
  }
  const flushed = r.ready();
  assert.deepEqual(flushed.map((b) => b[0]), sent, 'the held audio came back out of order');
  assert.equal(r.droppedPcmBytes, 0, 'audio was lost while the socket was opening');
  // Exactly once: a second flush returns nothing, so no chunk can be sent twice.
  assert.deepEqual(r.ready(), []);
  assert.equal(r.flushes, 1);
  assert.ok(r.accountsBalance());
});

test('FIRST_TURN_SHAPES: short, normal, quiet, fast, and mid-rotation all keep their audio', () => {
  /*
   * The first utterance is the one the visitor judges the product on, and it is
   * the one that arrives while the socket is still being opened. Each shape is
   * driven here as blocks-before-ready, because that is what differs between
   * them -- "კი" is two blocks, a normal sentence is a hundred.
   */
  const shapes = [
    { name: 'short "კი"', blocks: 2 },
    { name: 'normal Georgian sentence', blocks: 100 },
    { name: 'quiet speaker', blocks: 40 },
    { name: 'fast start, before the handshake', blocks: 1 },
    { name: 'long, to the edge of patience', blocks: 90 },
  ];
  for (const shape of shapes) {
    let t = 0;
    const r = router(() => t);
    r.expect('CONNECTING');
    const ids = [];
    for (let i = 1; i <= shape.blocks; i += 1) {
      const b = block();
      b[0] = i % 32_000;
      ids.push(i % 32_000);
      t += 20;
      r.route(b, false);
    }
    const out = r.ready();
    assert.deepEqual(out.map((b) => b[0]), ids, `${shape.name}: audio lost or reordered`);
    assert.equal(r.droppedPcmBytes, 0, `${shape.name}: audio was dropped before the socket opened`);
    assert.ok(r.accountsBalance(), `${shape.name}: the byte accounts do not balance`);
    assert.ok(r.dropsAccountedFor());
  }
});

test('DURING_A_SOCKET_TRANSITION mid-conversation, nothing is lost either', () => {
  let t = 0;
  const r = router(() => t);
  r.expect('CONNECTING');
  r.ready();
  // Turn one, sent live.
  for (let i = 0; i < 10; i += 1) { t += 20; r.route(block(), true); }
  // The turn boundary rotates. The visitor starts the next sentence at once.
  r.expect('ROTATING');
  const during = [];
  for (let i = 1; i <= 15; i += 1) {
    const b = block(); b[0] = i; during.push(i);
    t += 20;
    assert.deepEqual(r.route(b, false), { kind: 'HELD' });
  }
  assert.deepEqual(r.ready().map((b) => b[0]), during, 'a rotation ate the start of a sentence');
  assert.equal(r.droppedPcmBytes, 0);
  assert.ok(r.accountsBalance());
});

test('PATIENCE_IS_BOUNDED: past maxWaitMs the batch path takes over rather than nothing', () => {
  let t = 0;
  const r = router(() => t);
  r.expect('CONNECTING');
  r.route(block(), false);
  t = 2_001;
  assert.deepEqual(r.route(block(), false), { kind: 'BATCH' });
  assert.equal(r.lastFellBack, 'socket not ready within 2000ms');
  assert.equal(r.droppedByReason.ABANDONED_NO_SOCKET, 640);
  assert.ok(r.dropsAccountedFor());
  assert.ok(r.accountsBalance());
});

/* ── Truthful readiness ─────────────────────────────────────────────────*/

test('LISTENING_MEANS_THE_AUDIO_HAS_SOMEWHERE_TO_GO', () => {
  const r = router(() => 0);
  // IDLE is the one state where claiming to listen is a lie -- and it is the
  // state the Android session that held 688,128 bytes and completed no turns
  // was effectively in.
  assert.equal(r.safeToListen, false);
  r.expect('CONNECTING');
  assert.equal(r.safeToListen, true, 'held audio is delayed, not lost');
  r.ready();
  assert.equal(r.safeToListen, true);
  r.abandon('provider gone');
  assert.equal(r.safeToListen, true, 'the batch path is still a destination');
});

test('and the session checks every LISTENING it shows against one definition', () => {
  assert.match(CLIENT, /private get safeToListen\(\): boolean \{/);
  // Both halves: the router's, plus the part only the session can see.
  const def = CLIENT.slice(CLIENT.indexOf('private get safeToListen()'), CLIENT.indexOf('/** Hand the floor back.'));
  assert.match(def, /if \(this\.micGated \|\| this\.muted\) return false;/);
  assert.match(def, /return this\.router\.safeToListen;/);
  // Checked on the transition itself, so no caller can bypass it.
  assert.match(CLIENT, /if \(state === 'LISTENING'\) this\.noteListenClaim\(\);/);
  // Recorded, not thrown: an exception in the audio path costs the visitor the
  // conversation, while a wrong label costs them one repeated sentence.
  assert.match(CLIENT, /this\.unsafeListenClaims \+= 1;/);
});

test('DELAYED_IS_NOT_LOST, and the trace now says which', () => {
  /*
   * MEASURED: voiced_before_ready_ms reached 5,291ms in a session whose
   * router_phase_at_speech_start was READY, which reads like five seconds of
   * lost speech and was nothing of the kind -- almost all of it was audio held
   * across mid-conversation rotations and flushed intact. The two need separate
   * numbers because they have completely different fixes.
   */
  assert.match(CLIENT, /if \(!this\.safeToListen\) this\.voicedWithoutDestinationMs \+= blockMs;/);
  for (const k of ['voicedWithoutDestinationMs', 'unsafeListenClaims', 'droppedByReason', 'dropsAccountedFor']) {
    assert.ok(CLIENT.includes(k), `${k} never reaches the trace`);
  }
  // The old cumulative counter is kept, so a before-and-after comparison is
  // still possible rather than the number simply disappearing.
  assert.match(CLIENT, /voicedBeforeReadyMs: Math\.round\(this\.voicedBeforeReadyMs\),/);
});

/* ── Volume: measured, and deliberately not "fixed" ──────────────────────*/

const PLAYER = read('src/lib/comm/pcmPlayer.ts');

test('THE_QUIETNESS_IS_MEASURED_BEFORE_ANYTHING_IS_AMPLIFIED', () => {
  /*
   * "AI Talk starts too quiet" has two causes with opposite fixes: the audio
   * arrives quiet, or something here attenuates it. Reading the source settles
   * the second half and it is clean -- unity conversion, outputGain never
   * assigned, no fade, no ramp, no stored preference, ducking does not touch
   * gain. It cannot settle the first half, so the first half is measured.
   */
  assert.match(PLAYER, /if \(peak > this\.turnPcmPeak\) this\.turnPcmPeak = peak;/);
  assert.match(PLAYER, /pcmPeak: this\.turnPcmSamples \? Number\(this\.turnPcmPeak\.toFixed\(4\)\) : null,/);
  assert.match(PLAYER, /pcmRms: this\.turnPcmSamples/);
  // One pass. The measurement rides the loop that already walks every sample.
  assert.equal((PLAYER.match(/for \(let i = 0; i < count; i\+\+\)/g) ?? []).length, 1);
});

test('NOTHING_WAS_AMPLIFIED, clipped, or faked', () => {
  // The conversion stays unity: one site, dividing by full scale, nothing else.
  assert.match(PLAYER, /const v = view\.getInt16\(i \* 2, true\) \/ 0x8000;/);
  assert.ok(!/0x8000\s*\*\s*[\d.]/.test(PLAYER), 'the PCM conversion gained a multiplier');
  // No speculative gain anywhere in the output chain.
  assert.ok(!/gain\.value\s*=\s*(?!0;)[\d.]/.test(CLIENT), 'something now sets an output gain');
  assert.ok(!/gain\s*=\s*1\.5/.test(CLIENT + PLAYER), 'the gain = 1.5 that must not ship');
  // Math.min/Math.max clamping of samples would be clipping by another name.
  assert.ok(!/Math\.(min|max)\([^)]*input\[i\]/.test(PLAYER), 'samples are being clamped');
});

test('and the Android routing hypothesis is now falsifiable', () => {
  /*
   * The standing guess is that asking for echo cancellation moves Android onto
   * communication-call routing, which is quieter by design. The REQUEST has
   * always been in the source; the OUTCOME was never recorded, which is why the
   * guess survived three physical tests. Requested and actual, side by side.
   */
  assert.match(CLIENT, /echoCancellationRequested: true,/);
  assert.match(CLIENT, /echoCancellationActual: got\.echoCancellation === undefined \? null : Boolean\(got\.echoCancellation\),/);
  assert.match(CLIENT, /autoGainControlActual: got\.autoGainControl \?\? null,/);
  assert.match(CLIENT, /micActive: track \? track\.readyState === 'live' && track\.enabled && !track\.muted : null,/);
  // Requested is still `ideal`, i.e. nothing was switched off to chase volume.
  assert.match(CLIENT, /echoCancellation: \{ ideal: true \},/);
  assert.match(CLIENT, /noiseSuppression: \{ ideal: true \},/);
  // And it reaches the phone's own turn trace, not just a panel on a laptop.
  assert.match(CLIENT, /audioChain: \{/);
  assert.match(EDGE, /audio_chain: body\.turnShape\?\.audioChain \?\? null,/);
});

/* ── What must not have changed ──────────────────────────────────────────*/

test('BARGE_IN_IS_UNTOUCHED: duck first, stop on sustained speech, echo guard intact', () => {
  assert.match(CLIENT, /if \(action === 'DUCK'\) this\.duckPlayback\(\);/);
  assert.match(CLIENT, /if \(action === 'STOP'\) \{/);
  // The decision still belongs to decideBargeIn, and still gets the real
  // echoCancelled value rather than the hard-coded `true` it once had.
  assert.match(CLIENT, /echoCancelled: this\.echoCancelled,/);
  assert.match(CLIENT, /pendingSeconds: this\.player\?\.pendingSeconds,/);
  // Interruption is still measured from when the visitor started speaking.
  assert.match(CLIENT, /const spokeAt = this\.bargeSpeechAt \|\| Date\.now\(\);/);
  assert.match(CLIENT, /this\.lastBargeStopMs = Date\.now\(\) - spokeAt;/);
});

test('NO_ENDPOINTER_WINDOW_MOVED: recognition quality was not traded for latency', () => {
  /*
   * The deadline above bounds how long we wait AFTER the half-close. It does
   * not touch how long we wait to decide somebody stopped talking, and cutting
   * natural speech to make a benchmark look better is the one thing that would
   * make this release worse than the freeze.
   */
  for (const line of [
    'const END_TURN_ACK_MS = 300;',
    'const END_TURN_SHORT_MS = 600;',
    'const END_TURN_LONG_MS = 900;',
    'const END_TURN_GREETING_MS = 900;',
  ]) assert.ok(CLIENT.includes(line), `${line} was changed`);
  // The transcript arbitration thresholds are likewise untouched.
  const choice = read('src/lib/comm/transcriptChoice.ts');
  assert.match(choice, /CONTAINMENT_MIN = 0\.8/);
});

test('NO_AUDIOWORKLET_MIGRATION was smuggled in', () => {
  // Explicitly out of scope until measurements show ScriptProcessor is to
  // blame, and they do not.
  /*
   * Checked against the API, not the word: line 1899 explains in a comment
   * exactly WHY ScriptProcessor is used deliberately, and a test that forbids
   * the word forbids the explanation. The first version of this assertion did
   * precisely that.
   */
  assert.ok(!/audioWorklet\.addModule|new AudioWorkletNode/.test(CLIENT), 'an AudioWorklet migration appeared');
  assert.match(CLIENT, /createScriptProcessor/);
  // The reasoning stays in the file, which is the thing worth keeping.
  assert.match(CLIENT, /ScriptProcessor is deprecated and is used deliberately/);
});

/*
 * THE SEAM THAT WAS NEVER HEARD, AND THE ONE THAT COULD BE.
 *
 * Production measured 719ms between one synthesised phrase and the next, and
 * it read like the cause of "the voice pauses". It was not, and the reason is
 * arithmetic the metric left out: that turn carried about 23 seconds of audio
 * across four phrases, so while the next request was being made the browser
 * still held seconds of speech it had not played. Nothing stopped.
 *
 * A seam is only heard when the buffer runs dry first. RUNWAY is that
 * quantity -- speech handed over, minus time elapsed since playback began --
 * and it is the only number here that describes what a visitor heard.
 *
 * These tests hold three things: that the two numbers stay distinguishable,
 * that segmentation keeps the runway positive without making the first word
 * slower, and that the properties which make a streamed voice correct at all
 * (one request per phrase, strict order, cancellation) survived the change.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');
const EDGE = read('supabase/functions/ai-talk-session/index.ts');

/**
 * Source with comments removed.
 *
 * Absence assertions are otherwise answered by the prose explaining why the
 * thing is absent, which is a test that passes by reading itself.
 */
const CODE = EDGE
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => (l.trimStart().startsWith('//') ? '' : l))
  .join('\n');

/** A named region of the source, by its opening and closing markers. */
const slice = (from, to) => {
  const a = CODE.indexOf(from);
  assert.ok(a > 0, `${from} was renamed or removed`);
  const b = CODE.indexOf(to, a);
  assert.ok(b > a, `${to} no longer closes ${from}`);
  return CODE.slice(a, b + to.length);
};

/* ── The floors, as the running code sees them ───────────────────────────*/

const num = (name) => {
  const m = new RegExp(`const ${name} = ([0-9_]+);`).exec(CODE);
  assert.ok(m, `${name} is gone`);
  return Number(m[1].split('_').join(''));
};
const OPENING = num('OPENING_PHRASE_MIN_CHARS');
const HUNGRY = num('HUNGRY_PHRASE_MIN_CHARS');
const SETTLED = num('SETTLED_PHRASE_MIN_CHARS');
const COMFORTABLE = num('RUNWAY_COMFORTABLE_MS');

test('THE_FLOORS_ARE_ORDERED, and the opening is the quick one', () => {
  assert.ok(OPENING < HUNGRY, 'the opening floor must be the shortest');
  assert.ok(HUNGRY < SETTLED, 'a settled reply must be allowed longer phrases');
  /*
   * Measured first-byte latency for a phrase is 250-350ms and reaching the
   * settled floor costs a few hundred ms more of model output. A comfortable
   * runway has to cover both with room over, or raising the floor would be
   * the thing that causes the gap it exists to prevent.
   */
  assert.ok(COMFORTABLE >= 1_000, `${COMFORTABLE}ms does not cover a request plus the text it waits for`);
});

/**
 * The real `phraseFloor`, lifted out of the source and given a scope.
 *
 * Asserting on its text would pass for a function that returned the wrong
 * floor; this runs it.
 */
const phraseFloor = ({ phrases, firstAudioAt, queuedAudioMs, elapsed }) => {
  const body = slice('const phraseFloor = (): number => {', '\n      };')
    .replace('(): number =>', '() =>');
  return new Function(
    'OPENING_PHRASE_MIN_CHARS', 'HUNGRY_PHRASE_MIN_CHARS', 'SETTLED_PHRASE_MIN_CHARS',
    'RUNWAY_COMFORTABLE_MS', 'spoken', 'firstAudioAt', 'queuedAudioMs', 'startedAt', 'Date',
    `${body}\nreturn phraseFloor();`,
  )(
    OPENING, HUNGRY, SETTLED, COMFORTABLE,
    new Array(phrases), firstAudioAt, queuedAudioMs, 0, { now: () => elapsed },
  );
};

test('THE_FIRST_PHRASE_IS_STILL_CUT_SHORT, because silence is the cost', () => {
  // Nothing spoken yet: the visitor is waiting, and latency wins outright.
  assert.equal(phraseFloor({ phrases: 0, firstAudioAt: 0, queuedAudioMs: 0, elapsed: 0 }), OPENING);
});

test('AND_THE_SECOND_ONE_STAYS_SHORT UNTIL AUDIO IS ACTUALLY FLOWING', () => {
  /*
   * Phrase 0 is synthesised but nothing has been sent, so its duration is not
   * knowable and the runway cannot be computed. This is the one boundary where
   * starvation is genuinely possible, so it keeps the short floor.
   */
  assert.equal(phraseFloor({ phrases: 1, firstAudioAt: 0, queuedAudioMs: 0, elapsed: 400 }), HUNGRY);
});

test('A_THIN_BUFFER_KEEPS_THE_SHORT_FLOOR', () => {
  // 900ms of speech sent, 600ms of it already played: 300ms in hand is not
  // enough to go shopping for a longer sentence.
  const floor = phraseFloor({ phrases: 1, firstAudioAt: 1_000, queuedAudioMs: 900, elapsed: 1_600 });
  assert.equal(floor, HUNGRY, 'a thin buffer must not wait for more text');
});

test('A_COMFORTABLE_BUFFER_BUYS_A_WHOLE_SENTENCE', () => {
  // 4s of speech sent, 500ms played: waiting for a real sentence end costs
  // the listener nothing, because they are 3.5s behind the stream.
  const floor = phraseFloor({ phrases: 2, firstAudioAt: 1_000, queuedAudioMs: 4_000, elapsed: 1_500 });
  assert.equal(floor, SETTLED, 'with seconds buffered, the floor must rise');
});

test('and the boundary is a threshold, not a slope', () => {
  // Playback began at 1000 and it is now 1000, so nothing has been played yet
  // and the runway is exactly the audio handed over. firstAudioAt must be
  // non-zero here: zero is how the drain says playback has not started.
  const at = (queuedAudioMs) => phraseFloor({
    phrases: 2, firstAudioAt: 1_000, queuedAudioMs, elapsed: 1_000,
  });
  assert.equal(at(COMFORTABLE - 1), HUNGRY);
  assert.equal(at(COMFORTABLE), SETTLED, 'the comparison must include the boundary');
});

/* ── What a higher floor does to the real segmenter ──────────────────────*/

/** The real `takePhrase`, as converseStream.test.mjs also lifts it. */
const takePhrase = (() => {
  const from = EDGE.indexOf('function takePhrase(');
  assert.ok(from > 0, 'takePhrase was renamed or removed');
  const body = EDGE.slice(from);
  const end = body.indexOf('\n}\n');
  assert.ok(end > 0, 'takePhrase is no longer a top-level function');
  return new Function(
    `${body.slice(0, end + 3).replace(/: string|: number|: boolean| = false/g, '')}\nreturn takePhrase;`,
  )();
})();

test('THE_SETTLED_FLOOR_PRODUCES_FEWER_AND_LONGER_PHRASES', () => {
  /*
   * The point of the change, on one reply. The same text segmented at the two
   * floors: the short one breaks at the first terminator past 45 characters,
   * the long one carries on to a sentence end. Fewer phrases is fewer seams,
   * and each one hands over more audio.
   */
  const reply = 'Understood, you are after a two bedroom flat in Krtsanisi; the budget is'
    + ' about 160 thousand dollars. New build or a finished apartment? Either way'
    + ' I can narrow it down to a handful today.';

  const cut = (floor) => {
    const out = [];
    let pending = reply;
    for (;;) {
      const phrase = takePhrase(pending, floor, false);
      if (!phrase) break;
      out.push(phrase);
      pending = pending.slice(phrase.length);
    }
    return out;
  };

  const hungry = cut(HUNGRY);
  const settled = cut(SETTLED);
  assert.ok(hungry.length > settled.length,
    `expected fewer phrases at the higher floor, got ${hungry.length} and ${settled.length}`);
  for (const phrase of settled) {
    assert.ok(phrase.trim().length >= SETTLED - 1,
      `a settled phrase came out short: ${JSON.stringify(phrase)}`);
  }
});

test('THE_OPENING_IS_UNCHANGED by any of this', () => {
  // The measured 1.5s saving that the short opening floor exists for.
  const opening = takePhrase('Understood, a two bedroom flat in Krtsanisi up to 160 thousand.', OPENING, true);
  assert.ok(opening.trimEnd().endsWith(','), `expected a comma break, got ${JSON.stringify(opening)}`);
  assert.ok(opening.length < 30, 'the opening phrase must still be quick');
});

test('the segmenter is asked for the floor rather than told a constant', () => {
  /*
   * The bug this prevents is the floor being computed correctly and then not
   * used: a literal at the call site would pin every reply to one floor and
   * every test above would still pass.
   */
  const asked = CODE.match(/takePhrase\(pending, phraseFloor\(\), spoken\.length === 0\)/g) ?? [];
  assert.equal(asked.length, 2, 'the segmentation loop no longer asks for the floor twice');
  // Both the first cut and every cut after it. A literal at either one pins
  // that path to a single floor while every test above still passes.
  const all = CODE.match(/takePhrase\(pending,/g) ?? [];
  assert.equal(all.length, asked.length, 'a takePhrase call is passing something other than phraseFloor()');
});

/* ── The runway is measured, and measured before it is added to ──────────*/

const DRAIN = slice('const drain = (async () => {', '\n      })();');

test('RUNWAY_IS_MEASURED_AGAINST_WHAT_WAS_ALREADY_SENT', () => {
  /*
   * Order matters and is easy to get backwards. The piece about to go out is
   * what the browser was waiting FOR, so it must not be counted as something
   * the browser already had -- that would hide every gap by exactly the size
   * of the piece that ended it.
   */
  const measure = DRAIN.indexOf('const runway = queuedAudioMs -');
  const add = DRAIN.indexOf('queuedAudioMs +=');
  assert.ok(measure > 0, 'the runway is no longer measured in the drain');
  assert.ok(add > 0, 'the drain no longer accounts for the audio it sends');
  assert.ok(measure < add, 'the piece being sent is counted before the gap it ended is measured');
});

test('and only the drain adds to it, because only the drain sends', () => {
  // Audio counted anywhere else would be audio the browser never received.
  const adds = CODE.match(/queuedAudioMs \+=/g) ?? [];
  assert.equal(adds.length, 1, 'something outside the drain is crediting audio');
});

test('THE_DURATION_ARITHMETIC_IS_16_BIT_MONO at the phrase rate', () => {
  /*
   * Two bytes per sample, and the rate the phrase was actually synthesised
   * for -- not the rate requested. A mismatch here does not fail, it silently
   * reports a runway that is half or double the truth.
   */
  assert.match(
    DRAIN,
    /queuedAudioMs \+= \(pieceBytes \/ 2\) \/ \(\(phrase\.sampleRate \|\| outputSampleRate\) \/ 1_000\);/,
  );
});

test('the first piece sets the clock instead of measuring against nothing', () => {
  // Runway before playback has begun is not zero, it is undefined; reporting
  // zero there would invent a starved turn on every single reply.
  assert.match(DRAIN, /if \(!firstAudioAt\) \{\s*firstAudioAt = Date\.now\(\) - startedAt;\s*\} else \{/);
});

/* ── Zero and not-measured stay different numbers ────────────────────────*/

test('STARVATION_IS_NULL_WHEN_THERE_WAS_NONE, and never a zero', () => {
  const m = /tts_starvation_ms: (.+),\n/.exec(CODE);
  assert.ok(m, 'tts_starvation_ms is gone');
  const starvation = new Function('minRunwayMs', `return ${m[1]};`);

  assert.equal(starvation(null), null, 'an unmeasured turn must not report silence');
  assert.equal(starvation(0), null, 'a runway of exactly zero is not a gap');
  assert.equal(starvation(3_400), null, 'a healthy buffer reported starvation');
  // And a real gap is reported as a positive length, not a negative runway.
  assert.equal(starvation(-340), 340);
});

test('MIN_RUNWAY_REPORTS_ZERO_AS_ZERO', () => {
  /*
   * `|| null` is the habit this guards against. A runway of 0ms is the most
   * interesting measurement the field can carry -- the buffer reached exactly
   * empty -- and falsy-collapsing it would file it as "not measured".
   */
  assert.match(CODE, /tts_min_runway_ms: minRunwayMs,/);
  assert.ok(!/tts_min_runway_ms: minRunwayMs \|\| null/.test(CODE),
    'an empty buffer is being reported as an absent measurement');
});

test('THE_SEAM_IS_KEPT, because it is still a true fact about the pipeline', () => {
  // Replacing it would have thrown away the evidence that started this.
  assert.match(CODE, /tts_phrase_seam_ms: worstPhraseSeamMs \|\| null,/);
  assert.match(CODE, /const seam = \(\(at - startedAt\) \+ slot\.firstByteMs\) - lastPhraseDoneMs;/);
});

test('and both numbers reach the browser, which owns the other half', () => {
  assert.match(CODE, /minRunwayMs,/);
  assert.match(CODE, /phraseSeamMs: worstPhraseSeamMs \|\| null,/);
});

/* ── What the change was not allowed to break ────────────────────────────*/

test('SYNTHESIS_IS_STILL_NOT_AWAITED, so phrases overlap', () => {
  /*
   * This is the property that makes a seam small in the first place: phrase
   * N+1's request starts the moment its text exists, while N is still being
   * streamed. An await here would serialise the reply and no floor would save
   * it.
   */
  const queue = slice('const queuePhrase = (phrase: string) => {', '\n      };');
  assert.match(queue, /void \(async \(\) => \{/);
  assert.ok(!/await speakPhraseStreaming/.test(queue.replace(/const out = await speakPhraseStreaming/, '')),
    'synthesis is awaited outside its own task');
  /*
   * ONE REQUEST PER PHRASE, counted inside the reply path only.
   *
   * The reply path must synthesise each phrase exactly once, or a longer floor
   * becomes double billing and two voices reading the same sentence. The other
   * caller in this file is the admin voice audition, which is a different
   * surface on purpose and is not a second request for anything spoken here.
   */
  assert.equal((queue.match(/speakPhraseStreaming\(sb, \{/g) ?? []).length, 1);
  assert.equal((queue.match(/spoken\.push\(slot\)/g) ?? []).length, 1);
  const others = (CODE.match(/speakPhraseStreaming\(sb, \{/g) ?? []).length - 1;
  assert.equal(others, 1, 'a new synthesis call site appeared outside queuePhrase');
  assert.match(CODE, /surface: 'AI_TALK_VOICE_PREVIEW',/);
});

test('ORDER_IS_STILL_STRICT: phrase N+1 waits for N to finish', () => {
  /*
   * The drain forwards a piece the instant it exists but never looks at a
   * later phrase before the current one says it is done. Pipelining that lost
   * this would play the second sentence over the first.
   */
  assert.match(DRAIN, /if \(!phrase\.done\) \{/);
  assert.match(DRAIN, /sent \+= 1;/);
  assert.match(DRAIN, /index: seq\+\+,/);
});

test('CANCELLATION_STILL_WINS over anything buffered', () => {
  // A visitor who interrupts must not be spoken over by a phrase that was
  // queued while they were talking.
  const queue = slice('const queuePhrase = (phrase: string) => {', '\n      };');
  assert.match(queue, /if \(turnAbort\.signal\.aborted\) \{/);
  assert.match(queue, /skippedPhrases \+= 1;/);
  // And the token loop stops cutting new phrases the moment it is aborted.
  assert.match(CODE, /if \(turnAbort\.signal\.aborted\) break;/);
});

test('THE_LANGUAGE_GATE_STILL_PRECEDES_SYNTHESIS', () => {
  /*
   * Nothing is queued until there is enough text to judge the script. A floor
   * change that moved the first cut earlier than this check would speak a
   * wrong-language reply aloud before abandoning it.
   */
  const gate = CODE.indexOf('if (!languageChecked && shown.trim().length >= 12)');
  const cut = CODE.indexOf('takePhrase(pending, phraseFloor()');
  assert.ok(gate > 0 && cut > gate, 'a phrase can now be cut before the language is judged');
  assert.match(CODE, /if \(languageChecked\) \{/);
});

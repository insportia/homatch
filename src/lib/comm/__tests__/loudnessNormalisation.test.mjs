/*
 * THE LOUDNESS THE OLD IMPLEMENTATION GOT FOR FREE, AND WHY THE FIRST FIX FAILED.
 *
 * Until 2026-09-15 (c23dbcb2) AI TALK received the reply as mp3 and played it
 * with `new Audio(url)`: provider-encoded audio arrives normalised and an
 * <audio> element needs no help. That commit replaced BOTH halves at once --
 * raw pcm_s16le instead of mp3, and a WebAudio graph instead of the element --
 * and nothing normalises raw PCM.
 *
 * MEASURED, two physical Android sessions on the Georgian site:
 *   43b3c3ea  speech RMS  -21.7  -25.8  -22.8 dBFS
 *   d1d5645d  speech RMS  -23.9  -24.6        dBFS
 *   the client's own independent calculation:  want = 6.3 dB
 *
 * Six decibels is half the amplitude, which is what the owner reports hearing.
 *
 * THE FIRST ATTEMPT FAILED FOR TWO REASONS, BOTH VISIBLE IN THE TRACE.
 *
 *   It was measured from the PREVIOUS turn, so turn 1 of every session read
 *   `outputGainReason UNITY_NOT_MEASURED:NO_PREVIOUS_TURN`, gain 1 -- the first
 *   reply, which is the one a listener judges, always played unaltered. The
 *   complaint was specifically that it starts quiet.
 *
 *   And flat gain is the wrong instrument. Cartesia's crest factor is about
 *   19 dB (peak -4.0 against speech RMS -22.8) where processed speech sits at
 *   10-14, so a gain capped by the peak yields ~3 dB against a 6.3 dB deficit.
 *   Half the correction in decibels is not half as loud; it is inaudible.
 *
 * So: normalise at the source, from the first phrase, with a real limiter. These
 * tests run the actual class on signals shaped like the measured ones.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');
const EDGE = read('supabase/functions/ai-talk-session/index.ts');

const CODE = EDGE
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => (l.trimStart().startsWith('//') ? '' : l))
  .join('\n');

/** The real PcmLoudness, lifted from the edge source and run. */
const { PcmLoudness, CEILING, MAX_DB, TARGET } = (() => {
  const consts = ['LOUDNESS_TARGET_DBFS', 'LOUDNESS_CEILING', 'LOUDNESS_MAX_DB', 'LIMITER_LOOKAHEAD_SAMPLES']
    .map((n) => {
      const m = new RegExp(`const ${n} = ([^;]+);`).exec(CODE);
      assert.ok(m, `${n} is gone`);
      return `const ${n} = ${m[1]};`;
    }).join('\n');
  const from = CODE.indexOf('class PcmLoudness {');
  assert.ok(from > 0, 'PcmLoudness was renamed or removed');
  const after = CODE.slice(from);
  const end = after.indexOf('\n}\n');
  assert.ok(end > 0, 'PcmLoudness is no longer a top-level class');
  const body = after.slice(0, end + 3)
    .replace(/private readonly |private /g, '')
    // ` as number` and friends, before the annotations they sit beside.
    .replace(/ as [A-Za-z_][A-Za-z0-9_<>[\]]*/g, '')
    .replace(/: number\[\]|: number|: Uint8Array|: void/g, '');
  const src = `${consts}\n${body}\nreturn { PcmLoudness, CEILING: LOUDNESS_CEILING, MAX_DB: LOUDNESS_MAX_DB, TARGET: LOUDNESS_TARGET_DBFS };`;
  return new Function(src)();
})();

/** Int16 LE bytes from float samples, the shape Cartesia sends. */
const toPcm = (floats) => {
  const out = new Uint8Array(floats.length * 2);
  const view = new DataView(out.buffer);
  floats.forEach((f, i) => view.setInt16(i * 2, Math.max(-32768, Math.min(32767, Math.round(f * 0x8000))), true));
  return out;
};

const fromPcm = (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  for (let i = 0; i < Math.floor(bytes.byteLength / 2); i++) out.push(view.getInt16(i * 2, true) / 0x8000);
  return out;
};

const dbfs = (x) => 20 * Math.log10(x);
const peakOf = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rmsOf = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / (a.length || 1));

/**
 * Speech-shaped signal: a tone at `rms` with occasional transients, so the
 * crest factor matches what Cartesia actually produces (~19 dB).
 */
const speechLike = (n, rmsTarget, crestDb) => {
  const out = new Array(n);
  const amp = rmsTarget * Math.SQRT2;
  const peak = rmsTarget * Math.pow(10, crestDb / 20);
  for (let i = 0; i < n; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * 140 * i) / 48000);
    // A transient every 40 ms, which is what makes the crest factor real.
    if (i % 1920 === 0) out[i] = (i % 3840 === 0 ? peak : -peak);
  }
  return out;
};

/** Run a signal through the normaliser in realistic chunks, plus the flush. */
const run = (floats, chunkSamples = 4096) => {
  const n = new PcmLoudness(6);
  const out = [];
  for (let i = 0; i < floats.length; i += chunkSamples) {
    out.push(...fromPcm(n.process(toPcm(floats.slice(i, i + chunkSamples)))));
  }
  out.push(...fromPcm(n.flush()));
  return { out, normaliser: n };
};

/* ── It actually gets louder ──────────────────────────────────────────────*/

test('THE_MEASURED_PRODUCTION_LEVEL_IS_BROUGHT_UP, and audibly', () => {
  /*
   * -22.8 dBFS speech RMS at a 19 dB crest factor is the real turn t4 of
   * session 43b3c3ea. This is the test the first attempt would have failed.
   */
  const input = speechLike(48000, Math.pow(10, -22.8 / 20), 19);
  const { out } = run(input);
  const before = dbfs(rmsOf(input));
  const after = dbfs(rmsOf(out));
  assert.ok(after - before > 5,
    `only ${(after - before).toFixed(2)}dB louder; the deficit measured 6.3dB`);
});

test('EVERY_MEASURED_SESSION_LEVEL is corrected, not just the loudest', () => {
  for (const rmsDb of [-21.7, -22.8, -23.9, -24.6, -25.8]) {
    const input = speechLike(24000, Math.pow(10, rmsDb / 20), 19);
    const { out } = run(input);
    const gained = dbfs(rmsOf(out)) - dbfs(rmsOf(input));
    assert.ok(gained > 5, `${rmsDb}dBFS gained only ${gained.toFixed(2)}dB`);
  }
});

test('THE_FIRST_CHUNK_IS_ALREADY_CORRECTED, which is the whole point', () => {
  /*
   * The previous design could not raise the first reply at all: it needed a
   * previous turn to measure. The owner judges the product on the first reply,
   * and said so -- "it starts quiet". So the very first chunk of the very first
   * phrase must come out louder, with no history of any kind.
   */
  const input = speechLike(4096, Math.pow(10, -23 / 20), 19);
  const n = new PcmLoudness(6);
  const first = fromPcm(n.process(toPcm(input)));
  assert.ok(first.length > 0, 'the first chunk produced no audio at all');
  // Compared against the same span of input, allowing for the lookahead delay.
  const span = input.slice(0, first.length);
  assert.ok(dbfs(rmsOf(first)) - dbfs(rmsOf(span)) > 4,
    'the first chunk came out at the provider level');
});

/* ── And nothing clips ────────────────────────────────────────────────────*/

test('NOTHING_EVER_EXCEEDS_THE_CEILING, across the measured range', () => {
  for (const rmsDb of [-30, -25.8, -22.8, -19, -14, -8]) {
    for (const crest of [10, 14, 19, 24]) {
      const input = speechLike(24000, Math.pow(10, rmsDb / 20), crest);
      const { out } = run(input);
      const p = peakOf(out);
      /*
       * One 16-bit step of tolerance, and not because the limiter is
       * approximate. It holds the FLOAT at or under the ceiling; writing that
       * float as an Int16 rounds to the nearest step, which can land half a step
       * above. The number that actually matters is the second assertion: a
       * sample at or past full scale is a click, and that never happens.
       */
      assert.ok(p <= CEILING + (1 / 0x8000),
        `peak ${dbfs(p).toFixed(3)}dBFS exceeds the ${dbfs(CEILING).toFixed(1)}dBFS ceiling at ${rmsDb}/${crest}`);
      assert.ok(p < 1, 'a sample reached full scale');
    }
  }
});

test('A_SIGNAL_ALREADY_AT_FULL_SCALE_SURVIVES without distortion or clipping', () => {
  // Full-scale input plus 6 dB is the worst case the limiter exists for.
  const input = new Array(9600).fill(0).map((_, i) => 0.99 * Math.sin((2 * Math.PI * 200 * i) / 48000));
  const { out, normaliser } = run(input);
  assert.ok(peakOf(out) <= CEILING + (1 / 0x8000), 'the limiter let a full-scale signal through');
  // The hard clamp is the backstop, not the mechanism. If it is doing the work,
  // the envelope is wrong and the result would be audibly distorted.
  assert.ok(normaliser.clampedSamples < out.length * 0.01,
    `${normaliser.clampedSamples} samples were hard-clamped; the limiter is not tracking`);
});

test('DIGITAL_SILENCE_STAYS_SILENT, and is not amplified into a hiss', () => {
  const { out } = run(new Array(9600).fill(0));
  assert.equal(peakOf(out), 0);
});

/* ── No sample is lost or duplicated ──────────────────────────────────────*/

test('EVERY_SAMPLE_COMES_OUT_ONCE, lookahead included', () => {
  /*
   * A lookahead holds samples back, so a phrase whose flush is forgotten loses
   * its last milliseconds -- on every phrase, which would be heard as clipped
   * word endings. Count them.
   */
  const n = 20000;
  const input = speechLike(n, Math.pow(10, -23 / 20), 19);
  const { out } = run(input, 3000);
  assert.equal(out.length, n, `${out.length} samples out for ${n} in`);
});

test('and a chunk boundary is not a discontinuity', () => {
  /*
   * The lookahead and the gain envelope both have to survive a chunk boundary.
   * If either resets, every boundary is a click -- which is what "not smooth"
   * sounds like. Compared against the same signal processed in one pass.
   */
  const input = speechLike(24000, Math.pow(10, -23 / 20), 19);
  const whole = run(input, 24000).out;
  const split = run(input, 1000).out;
  assert.equal(whole.length, split.length);
  let worst = 0;
  for (let i = 0; i < whole.length; i++) worst = Math.max(worst, Math.abs(whole[i] - split[i]));
  assert.ok(worst < 0.02, `chunking changed a sample by ${worst.toFixed(4)}; state is not surviving`);
});

test('THE_FLUSH_IS_CALLED, or every phrase loses its tail', () => {
  assert.match(CODE, /const tail = loudness\.flush\(\);/);
  assert.match(CODE, /if \(tail\.byteLength\) \{/);
});

/* ── The correction is bounded and reversible ─────────────────────────────*/

test('THE_MAKEUP_IS_BOUNDED_AND_OPERATOR_SETTABLE', () => {
  /*
   * 6 dB is the measurement, not a preference -- two sessions and the client's
   * own calculation agree. It is an environment variable because "loud enough on
   * a phone" is settled by listening, and the owner must be able to move it
   * without a deploy. Bounded, so a typo cannot destroy the voice.
   */
  assert.match(CODE, /Deno\.env\.get\('AI_TALK_LOUDNESS_MAKEUP_DB'\)/);
  assert.match(CODE, /Math\.max\(0, Math\.min\(LOUDNESS_MAX_DB, n\)\)/);
  assert.ok(MAX_DB <= 12, `a ${MAX_DB}dB ceiling on the correction is not a correction`);
  assert.ok(TARGET >= -20 && TARGET <= -14, `${TARGET}dBFS is not a speech target`);
});

test('ZERO_MAKEUP_IS_A_PASSTHROUGH, byte for byte', () => {
  // The escape hatch has to be exact: an operator who sets 0 must get the
  // provider's audio, not a limiter's opinion of it.
  const input = speechLike(8000, Math.pow(10, -23 / 20), 19);
  const n = new PcmLoudness(0);
  const bytes = toPcm(input);
  const out = n.process(bytes);
  assert.equal(out.byteLength, bytes.byteLength);
  assert.deepEqual(fromPcm(out), fromPcm(bytes));
  assert.equal(n.flush().byteLength, 0);
});

/* ── The client no longer second-guesses it ───────────────────────────────*/

test('THE_CLIENT_GAIN_IS_GONE, and the output node is unity again', () => {
  /*
   * Two corrections in two places is how a product ends up 3dB quiet with every
   * metric green. The browser's makeup gain is removed: it could not reach the
   * first reply, and it was capped by the peak at half the needed correction.
   */
  const CLIENT = read('src/lib/comm/voiceClient.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => (l.trimStart().startsWith('//') ? '' : l)).join('\n');
  assert.ok(!/applyMeasuredMakeupGain/.test(CLIENT), 'the client still applies a makeup gain');
  assert.ok(!/makeupGainFor/.test(CLIENT), 'the client still computes a makeup gain');
  assert.ok(!/outputGain\.gain\.value = /.test(CLIENT), 'something still assigns the output gain');
  // The node stays, because the visualiser reads it and barge-in ducks through it.
  assert.match(CLIENT, /this\.outputGain = this\.audioContext\.createGain\(\);/);
  assert.match(CLIENT, /outputGainValue: this\.outputGain\?\.gain\.value \?\? null,/);
});

test('BOTH_LEVELS_REACH_THE_TRACE, so a silent regression is visible', () => {
  /*
   * The pair is the instrument. `tts_speech_rms_dbfs` is Cartesia's level and
   * `tts_sent_speech_rms_dbfs` is what the browser was given; the gap between
   * them IS the normaliser. If it ever stops running the two converge, which is
   * a query rather than another physical test.
   */
  assert.match(CODE, /tts_sent_speech_rms_dbfs: sentSpeechRmsDbFS,/);
  assert.match(CODE, /tts_sent_peak_dbfs: sentPeakDbFS,/);
  assert.match(CODE, /tts_loudness_makeup_db: loudnessMakeupDb,/);
  assert.match(CODE, /tts_loudness_clamped_samples: loudnessClamped \|\| null,/);
  // Measured on the raw bytes BEFORE normalisation, and on the sent bytes after.
  assert.match(CODE, /meter\.add\(chunk\);/);
  assert.match(CODE, /outMeter\.add\(louder\);/);
});

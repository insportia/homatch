/*
 * THE INSTRUMENT THAT REPORTED ZERO AND MEANT "I DID NOT LOOK".
 *
 * MEASURED, production session ffa36b53 (2026-09-25): pcmPeak, pcmRms,
 * sessionPcmPeak, receivedChunks and receivedBytes were 0 on all five turns.
 * Not quiet audio -- no measurement at all. turnShape is assembled inside the
 * converse REQUEST, so every per-turn playback counter it carries describes a
 * turn whose audio does not exist yet. Before the counters were reset per turn
 * they had been cumulative, which is the only reason they ever looked
 * populated, and that reading was wrong in a different way.
 *
 * So the low-volume question could not be answered at all: unity gain and a
 * running 48 kHz context were confirmed, and everything downstream of the
 * decode was dark.
 *
 * This file holds the instrument to the two properties that matter:
 *
 *   IT MUST MEASURE WHAT IT CLAIMS. Peak, RMS and dBFS are checked against
 *   synthetic PCM whose answer is known by construction, and silence
 *   detection against a signal with silences placed deliberately.
 *
 *   IT MUST NOT TOUCH WHAT IT MEASURES. The samples handed to playback, the
 *   scheduling and the recovery decision are all asserted unchanged -- an
 *   instrument that alters the thing it reads is worse than none.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PcmStreamPlayer } from '../pcmPlayer.ts';
import {
  describeRecoveryDecline, RECOVERY_MIN_SPEECH_MS, RECOVERY_MAX_PER_SESSION,
} from '../sameTurnRecovery.ts';

const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');
const CLIENT = read('src/lib/comm/voiceClient.ts');
const PLAYER = read('src/lib/comm/pcmPlayer.ts');
const EDGE = read('supabase/functions/ai-talk-session/index.ts');

const RATE = 48_000;

/** A context that records what was scheduled without making a sound. */
class FakeContext {
  constructor() {
    this.sampleRate = RATE;
    this.currentTime = 0;
    this.state = 'running';
    this.sources = [];
    this.copied = [];
  }

  createBuffer(_ch, n, rate) {
    const data = new Float32Array(n);
    const ctx = this;
    return {
      length: n,
      sampleRate: rate,
      duration: n / rate,
      copyToChannel: (a) => { data.set(a); ctx.copied.push(Float32Array.from(a)); },
      getChannelData: () => data,
    };
  }

  createBufferSource() {
    const ctx = this;
    const s = {
      buffer: null, onended: null, _at: null,
      connect() {}, disconnect() {},
      start(at) { s._at = at; ctx.sources.push(s); },
      stop() { s._stopped = true; },
    };
    return s;
  }
}

/** base64 of signed 16-bit little-endian samples from a generator. */
function pcm(samples, value) {
  const b = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) b.writeInt16LE(value(i), i * 2);
  return b.toString('base64');
}

function playerWith(chunks) {
  const ctx = new FakeContext();
  const p = new PcmStreamPlayer(ctx, {});
  p.startTurn(1);
  // push(pcmBase64, sampleRate, generation) -- the generation must match the
  // one startTurn was given or the chunk belongs to a turn that has moved on.
  for (const c of chunks) p.push(c, RATE, 1);
  return { p, ctx };
}

/* ── The maths, on PCM whose answer is known ─────────────────────────────*/

test('FULL_SCALE: a square wave at ±32767 reads peak 0 dBFS', () => {
  const { p } = playerWith([pcm(RATE, (i) => (i % 2 ? 32767 : -32767))]);
  const r = p.turnAudioReport();
  assert.equal(r.measured, true);
  assert.ok(Math.abs(r.pcm.peak - 1) < 0.001, `peak ${r.pcm.peak}`);
  // 20*log10(1) = 0 dBFS, the loudest a sample can be.
  assert.ok(Math.abs(r.pcm.peakDbFS) < 0.1, `peakDbFS ${r.pcm.peakDbFS}`);
  // A square wave's RMS equals its peak.
  assert.ok(Math.abs(r.pcm.rmsDbFS) < 0.1, `rmsDbFS ${r.pcm.rmsDbFS}`);
});

test('HALF_SCALE reads about -6 dBFS, which is what halving amplitude means', () => {
  const { p } = playerWith([pcm(RATE, (i) => (i % 2 ? 16384 : -16384))]);
  const r = p.turnAudioReport();
  assert.ok(Math.abs(r.pcm.peakDbFS + 6.02) < 0.15, `peakDbFS ${r.pcm.peakDbFS}`);
});

test('A_QUIET_SIGNAL is reported as quiet, not as missing', () => {
  // -40 dBFS: 0.01 of full scale.
  const v = Math.round(32767 * 0.01);
  const { p } = playerWith([pcm(RATE, (i) => (i % 2 ? v : -v))]);
  const r = p.turnAudioReport();
  assert.equal(r.measured, true, 'a quiet turn was reported as unmeasured');
  assert.ok(Math.abs(r.pcm.peakDbFS + 40) < 0.5, `peakDbFS ${r.pcm.peakDbFS}`);
});

test('DIGITAL_SILENCE has no dBFS, and says so with null rather than -Infinity', () => {
  const { p } = playerWith([pcm(RATE, () => 0)]);
  const r = p.turnAudioReport();
  // It WAS measured -- a second of samples arrived. They were all zero.
  assert.equal(r.measured, true);
  assert.equal(r.pcm.peak, 0);
  assert.equal(r.pcm.peakDbFS, null, 'log of zero leaked into the report');
  assert.equal(r.pcm.rmsDbFS, null);
  assert.equal(JSON.stringify(r).includes('Infinity'), false, 'Infinity cannot survive JSON');
});

/* ── ZERO SIGNAL vs NOT MEASURED ─────────────────────────────────────────*/

test('NOT_MEASURED_IS_NOT_ZERO: the distinction production could not make', () => {
  const ctx = new FakeContext();
  const p = new PcmStreamPlayer(ctx, {});
  p.startTurn(1);
  const r = p.turnAudioReport();
  assert.equal(r.measured, false);
  assert.equal(r.reason, 'NO_AUDIO_RECEIVED');
  // Nothing invented: no peak of 0, no rms of 0, no duration of 0.
  assert.equal(r.pcm, undefined, 'an unmeasured turn reported amplitudes');
  assert.equal(r.silence, undefined);

  // And a turn that DID receive audio is measured, so the two never collide.
  const { p: p2 } = playerWith([pcm(4800, (i) => (i % 2 ? 9000 : -9000))]);
  assert.equal(p2.turnAudioReport().measured, true);
});

/* ── Silence detection ───────────────────────────────────────────────────*/

test('SILENCE_REGIONS are found where they were put, and short gaps are not pauses', () => {
  /*
   * One second: 300 ms tone, 400 ms silence, 300 ms tone. The middle is the
   * only region long enough to be heard as a pause.
   */
  const loud = (i) => (i % 2 ? 20000 : -20000);
  const chunk = pcm(RATE, (i) => {
    const ms = (i / RATE) * 1000;
    return ms >= 300 && ms < 700 ? 0 : loud(i);
  });
  const { p } = playerWith([chunk]);
  const r = p.turnAudioReport();

  assert.equal(r.silence.regions, 1, `found ${r.silence.regions} regions`);
  assert.ok(Math.abs(r.silence.longestMs - 400) <= 40, `longest ${r.silence.longestMs}ms`);
  const at = r.silence.sample[0].atMs;
  assert.ok(Math.abs(at - 300) <= 40, `region started at ${at}ms`);
});

test('a 60 ms gap is articulation, not a pause, and is not reported', () => {
  const loud = (i) => (i % 2 ? 20000 : -20000);
  const chunk = pcm(RATE, (i) => {
    const ms = (i / RATE) * 1000;
    return ms >= 400 && ms < 460 ? 0 : loud(i);
  });
  const { p } = playerWith([chunk]);
  assert.equal(p.turnAudioReport().silence.regions, 0);
});

test('SILENCE_SPANS_CHUNKS: a pause split across arrivals is still one pause', () => {
  /*
   * The case instance state exists for. A provider chunk is not aligned to
   * anything, so a 400 ms silence commonly arrives as the tail of one chunk
   * and the head of the next; counted per chunk it would vanish below the
   * minimum or be reported as two.
   */
  const loud = (i) => (i % 2 ? 20000 : -20000);
  const quarter = Math.round(RATE * 0.25);
  const chunks = [
    pcm(quarter, loud),          // 250 ms tone
    pcm(quarter, () => 0),       // 250 ms silence
    pcm(quarter, () => 0),       // 250 ms silence  -> 500 ms in total
    pcm(quarter, loud),          // 250 ms tone
  ];
  const { p } = playerWith(chunks);
  const r = p.turnAudioReport();
  assert.equal(r.silence.regions, 1, `chunk-split silence became ${r.silence.regions} regions`);
  assert.ok(Math.abs(r.silence.longestMs - 500) <= 40, `longest ${r.silence.longestMs}ms`);
});

test('SPEECH_RMS excludes the silence a whole-turn RMS would average in', () => {
  const loud = (i) => (i % 2 ? 20000 : -20000);
  const chunk = pcm(RATE, (i) => ((i / RATE) * 1000 < 500 ? loud(i) : 0));
  const { p } = playerWith([chunk]);
  const r = p.turnAudioReport();
  // Half the turn is silent, so the whole-turn RMS is ~3 dB below the speech.
  assert.ok(r.pcm.speechRmsDbFS > r.pcm.rmsDbFS, 'speech RMS is not above the turn RMS');
  assert.ok(Math.abs(r.pcm.speechRmsDbFS - r.pcm.peakDbFS) < 1.5,
    `a square wave's speech RMS should sit near its peak: ${r.pcm.speechRmsDbFS} vs ${r.pcm.peakDbFS}`);
});

/* ── The instrument does not disturb the signal ──────────────────────────*/

test('MEASURING_DOES_NOT_ALTER_THE_SAMPLES handed to playback', () => {
  const value = (i) => (i % 2 ? 12345 : -12345);
  // A full second: the player batches before scheduling, so a 100 ms chunk
  // can sit in pendingSamples and never reach a buffer at all.
  const { p, ctx } = playerWith([pcm(RATE, value)]);
  p.turnAudioReport();
  assert.ok(ctx.copied.length > 0, 'nothing was scheduled');
  const written = ctx.copied[0];
  // Unity conversion, unchanged: the int divided by full scale, nothing else.
  for (let i = 0; i < 16; i += 1) {
    assert.ok(Math.abs(written[i] - value(i) / 0x8000) < 1e-7,
      `sample ${i} was modified: ${written[i]}`);
  }
});

test('and the conversion in source is still the single unity divide', () => {
  assert.match(PLAYER, /const v = view\.getInt16\(i \* 2, true\) \/ 0x8000;/);
  assert.ok(!/gain\s*=\s*[\d.]+\s*\*/.test(PLAYER), 'a gain multiplier appeared');
  assert.ok(!/Math\.(min|max)\([^)]*input\[i\]/.test(PLAYER), 'samples are being clamped');
  // One pass: the measurement rides the loop that already walks every sample.
  assert.equal((PLAYER.match(/for \(let i = 0; i < count; i\+\+\)/g) ?? []).length, 1);
});

test('the report is bounded: a long reply cannot inflate the payload', () => {
  const loud = (i) => (i % 2 ? 20000 : -20000);
  // Twenty separate 200 ms silences, well past the reporting cap.
  const chunks = [];
  for (let k = 0; k < 20; k += 1) {
    chunks.push(pcm(Math.round(RATE * 0.2), loud));
    chunks.push(pcm(Math.round(RATE * 0.2), () => 0));
  }
  const { p } = playerWith(chunks);
  const r = p.turnAudioReport();
  assert.ok(r.silence.regions >= 15, `only ${r.silence.regions} regions counted`);
  // The COUNT stays exact while the described sample stays bounded.
  assert.ok(r.silence.sample.length <= 12, `${r.silence.sample.length} regions described`);
  assert.ok(JSON.stringify(r).length < 4000, 'the report grew unbounded');
});

/* ── Delivery: measured after the audio exists ───────────────────────────*/

test('THE_REPORT_IS_FROZEN_BEFORE_THE_COUNTERS_ARE_CLEARED', () => {
  /*
   * TWO placements of this were wrong, both for the same reason, and both
   * reported nothing in production.
   *
   * turnShape is assembled inside the converse REQUEST -- and
   * player.startTurn() runs BEFORE that request is sent, clearing every
   * per-turn counter. So reading the live report at either point returns an
   * empty turn: session ffa36b53 reported zeros, and session 1837d8ff
   * reported `NO_AUDIO_RECEIVED` on every turn, from the opposite side of the
   * same reset.
   *
   * The snapshot is therefore taken INSIDE startTurn, in the one instant the
   * finished turn still exists and the next has not begun.
   */
  const PLAYER_SRC = read('src/lib/comm/pcmPlayer.ts');
  const startTurn = PLAYER_SRC.slice(PLAYER_SRC.indexOf('startTurn(generation: number): void {'));
  const freeze = startTurn.indexOf('this.lastReport =');
  const firstReset = startTurn.indexOf('this.turnReceivedChunks = 0;');
  assert.ok(freeze > 0, 'the finished turn is never frozen');
  assert.ok(freeze < firstReset, 'the snapshot is taken after the counters are cleared');

  // And the trace reads the frozen snapshot, not the live one.
  assert.match(CLIENT, /previousTurnAudio: this\.player\?\.lastTurnAudioReport\(\)/);
  assert.match(EDGE, /previous_turn_audio: body\.turnShape\?\.previousTurnAudio \?\? null,/);
});

test('a frozen report survives the next turn starting', () => {
  const ctx = new FakeContext();
  const p = new PcmStreamPlayer(ctx, {});
  p.startTurn(1);
  for (const c of [pcm(RATE, (i) => (i % 2 ? 20000 : -20000))]) p.push(c, RATE, 1);

  // Turn 2 begins: the counters are cleared, and the finished turn is kept.
  p.startTurn(2);
  const frozen = p.lastTurnAudioReport();
  assert.equal(frozen.measured, true, 'the finished turn was lost when the next began');
  // 20000/32768 = 0.6104 -> -4.3 dBFS. Asserted as the real figure rather
  // than a round number, so the freeze is proved to carry the actual signal
  // rather than merely a populated-looking object.
  assert.ok(Math.abs(frozen.pcm.peakDbFS + 4.3) < 0.2, `peakDbFS ${frozen.pcm.peakDbFS}`);
  // ...while the LIVE report correctly says the new turn has nothing yet.
  assert.equal(p.turnAudioReport().measured, false);
});

test('before any turn has finished, the snapshot says so rather than inventing one', () => {
  const p = new PcmStreamPlayer(new FakeContext(), {});
  const r = p.lastTurnAudioReport();
  assert.equal(r.measured, false);
  assert.equal(r.reason, 'NO_PREVIOUS_TURN');
});

/* ── Language diagnostics ────────────────────────────────────────────────*/

test('THE_SPEECH_DURATION_SURVIVES_FINALIZATION', () => {
  /*
   * The bug this replaced: lastTurnSpeechMs was assigned six lines after
   * `void this.rotateLive()`, and rotateLive's body runs synchronously as far
   * as its own `this.liveSpeechMs = 0` because it has no await before it. The
   * capture read zero on every turn of every session, both recovery planners
   * declined at their first guard, and a language switch had nothing to
   * rescue it.
   *
   * Both the diagnostic and the value recovery uses are now taken at the top
   * of the turn, before anything has run.
   */
  const final = CLIENT.slice(CLIENT.indexOf('private async onLiveFinal('));
  const diag = final.indexOf('this.diag.speechMsAtFinal = Math.round(this.liveSpeechMs);');
  const used = final.indexOf('this.lastTurnSpeechMs = Math.round(this.liveSpeechMs);');
  const rotate = final.indexOf('void this.rotateLive();');
  assert.ok(diag > 0 && used > 0, 'the speech duration is not captured');
  assert.ok(used < rotate, 'the value recovery uses is captured after the rotation that zeroes it');
  assert.ok(diag < rotate, 'the diagnostic is captured after the rotation');
  // And it is not reassigned afterwards, where it would read zero again.
  assert.equal((CLIENT.match(/this\.lastTurnSpeechMs = Math\.round/g) ?? []).length, 1);
  assert.match(CLIENT, /speechMs: this\.lastTurnSpeechMs \|\| \(this\.diag\.lastEndTurnSpeechMs \?\? 0\),/);
});

test('RECOVERY_DECLINE_REASON is explicit, and matches the planner order', () => {
  const t = (over) => ({ pinned: 'ka', transcript: '', speechMs: 2000, spent: 0, ...over });

  assert.equal(describeRecoveryDecline(t({}), true), 'EXEMPT_OPINION');
  assert.equal(
    describeRecoveryDecline(t({ spent: RECOVERY_MAX_PER_SESSION }), false),
    'SPENT_LIMIT',
  );
  // The production blocker: speech reads zero, so nothing else is ever reached.
  assert.equal(
    describeRecoveryDecline(t({ speechMs: 0, transcript: '안녕하세요 반갑습니다 오늘 날씨 좋네요' }), false),
    'SPEECH_TOO_SHORT',
  );
  // With a real duration the same turn is NOT declined -- the script mismatch
  // the production trace should have seen.
  assert.equal(
    describeRecoveryDecline(t({ speechMs: 2000, transcript: '안녕하세요 반갑습니다 오늘 날씨 좋네요' }), false),
    'NOT_DECLINED',
  );
  // A healthy Georgian turn declines for the right reason, not by accident.
  assert.equal(
    describeRecoveryDecline(t({ transcript: 'მინდა ბინა ბათუმში ზღვის ხედით და ორი საძინებლით' }), false),
    'FUNCTION_WORDS_PRESENT',
  );
  assert.equal(describeRecoveryDecline(t({ transcript: '' }), false), 'NO_TRANSCRIPT');
  assert.equal(RECOVERY_MIN_SPEECH_MS, 900);
});

test('the decline reason is RECORDED, never consulted', () => {
  /*
   * It is a separate pure function taking the same input, called after `plan`
   * is decided, and `plan` is not read back from it. That separation is the
   * guarantee; this test is what keeps it true.
   */
  /*
   * Asserted as separate facts rather than one multi-line shape: pinning
   * exact line breaks is how a correct implementation fails a test for its
   * formatting, which has already cost this session two runs.
   */
  assert.match(CLIENT, /this\.diag\.recoveryDecision = plan/);
  assert.match(CLIENT, /describeRecoveryDecline\(recoveryInput, exempt\);/);
  /*
   * Comments stripped first. The comment above the recording explains why the
   * diagnostic is kept apart from the decision, and naming the function there
   * is the point -- a test that forbids the name forbids the explanation.
   */
  const decide = CLIENT
    .slice(CLIENT.indexOf('const plan = exempt'), CLIENT.indexOf('this.diag.recoveryDecision'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(String.fromCharCode(10))
    .filter((l) => !l.trim().startsWith('//'))
    .join(String.fromCharCode(10));
  assert.ok(!/describeRecoveryDecline/.test(decide), 'the diagnostic is used to decide the plan');
});

test('BEHAVIOUR_UNCHANGED: this pass tunes nothing', () => {
  for (const line of [
    'const NO_FINAL_TIMEOUT_MS = 2_500;',
    'const END_TURN_ACK_MS = 300;',
    'const END_TURN_SHORT_MS = 600;',
    'const END_TURN_LONG_MS = 900;',
    'const SECOND_OPINION = true;',
  ]) assert.ok(CLIENT.includes(line), `${line} was changed`);
  assert.match(CLIENT, /const exempt = \(opinion \|\| origin === 'SHADOW'\) && !heardUnsupported;/);
  assert.match(CLIENT, /if \(!this\.secondOpinionArmed\) \{/);
  assert.match(CLIENT, /private get safeToListen\(\): boolean \{/);
  // Cartesia, sonic-3 and the speed that is deliberately not sent.
  assert.match(EDGE, /provider: 'CARTESIA', role: 'TTS', model: 'sonic-3'/);
  assert.match(EDGE, /const CARTESIA_DEFAULT_SPEED = 1\.0;/);
});

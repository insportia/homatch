// The arithmetic between a phone's microphone and a transcription service.
//
// This is the bug these tests exist for: AI TALK asked for a 16 kHz
// AudioContext, did not check what it got, and told the provider the audio
// was 16 kHz regardless. On a device that hands back 48 kHz — most phones —
// every byte sent was three times too long for its own label.
//
// Proven against production, same Georgian sentence: correctly resampled it
// came back as a transcript; the native-rate bytes under a 16000 label came
// back as " Yeah." A level meter moves in both cases, which is why it reads
// from the outside as "the microphone works and nothing else does".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Resampler, floatToPcm16, rms, encodeWav, joinBlocks, bytesToBase64,
  TARGET_SAMPLE_RATE,
} from '../audio.ts';

/** One second of a sine wave at `hz`, as the microphone would deliver it. */
function tone(hz, rate, seconds = 1) {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * hz * i) / rate) * 0.5;
  return out;
}

/** Feed a signal through a resampler in realistic 128-sample blocks. */
function streamed(resampler, signal, block = 128) {
  const out = [];
  for (let i = 0; i < signal.length; i += block) {
    out.push(resampler.process(signal.subarray(i, i + block)));
  }
  return joinBlocks(out);
}

test('a context that already runs at 16 kHz is left alone', () => {
  const r = new Resampler(16_000);
  assert.equal(r.passthrough, true);
  const input = tone(440, 16_000, 0.1);
  const out = r.process(input);
  assert.equal(out.length, input.length);
  assert.deepEqual(Array.from(out.slice(0, 8)), Array.from(input.slice(0, 8)));
});

test('48 kHz in gives 16 kHz out, at the right length, block by block', () => {
  // The phone case. One second in must be one second out, or the audio is
  // sped up or slowed down and every word lands on the wrong phoneme.
  const r = new Resampler(48_000);
  assert.equal(r.passthrough, false);
  const out = streamed(r, tone(440, 48_000, 1));
  assert.ok(Math.abs(out.length - TARGET_SAMPLE_RATE) <= 32,
    `one second of 48 kHz should give about ${TARGET_SAMPLE_RATE} samples, got ${out.length}`);
});

test('44.1 kHz — a non-integer ratio — also gives one second for one second', () => {
  const out = streamed(new Resampler(44_100), tone(440, 44_100, 1));
  assert.ok(Math.abs(out.length - TARGET_SAMPLE_RATE) <= 32,
    `expected about ${TARGET_SAMPLE_RATE} samples, got ${out.length}`);
});

test('the resampled signal is still the signal, not noise', () => {
  // A 440 Hz tone is well inside the speech band and must survive intact.
  // Zero crossings are a cheap, honest frequency measurement: a resampler
  // that dropped or duplicated samples would change the count.
  const out = streamed(new Resampler(48_000), tone(440, 48_000, 1));
  let crossings = 0;
  for (let i = 1; i < out.length; i++) if ((out[i - 1] < 0) !== (out[i] < 0)) crossings++;
  const hz = crossings / 2;
  assert.ok(Math.abs(hz - 440) < 12, `expected roughly 440 Hz after resampling, measured ${hz}`);

  // And it must still carry energy: a filter that silenced everything would
  // pass a frequency check on an empty signal.
  assert.ok(rms(out) > 0.2, `resampled tone lost its level: rms ${rms(out)}`);
});

test('downsampling averages rather than decimating, so it cannot alias', () => {
  // 12 kHz at 48 kHz sampling is above the 8 kHz Nyquist limit of 16 kHz.
  // Plain every-third-sample decimation folds it back down into the middle of
  // the speech band as a loud tone that is not there. Averaging attenuates it.
  const out = streamed(new Resampler(48_000), tone(12_000, 48_000, 0.5));
  assert.ok(rms(out) < 0.2,
    `content above Nyquist should be attenuated, not folded into speech: rms ${rms(out)}`);
});

test('8 kHz hardware is interpolated up rather than refused', () => {
  const out = streamed(new Resampler(8_000), tone(300, 8_000, 1));
  assert.ok(Math.abs(out.length - TARGET_SAMPLE_RATE) <= 64,
    `expected about ${TARGET_SAMPLE_RATE} samples, got ${out.length}`);
  assert.ok(rms(out) > 0.2);
});

test('float to 16-bit uses the whole range and clips instead of wrapping', () => {
  const pcm = floatToPcm16(Float32Array.from([0, 1, -1, 2, -2, 0.5]));
  assert.equal(pcm[0], 0);
  assert.equal(pcm[1], 32767);
  assert.equal(pcm[2], -32768);
  // Out of range must saturate. Wrapping turns a loud syllable into a bang.
  assert.equal(pcm[3], 32767);
  assert.equal(pcm[4], -32768);
  assert.equal(pcm[5], Math.round(0.5 * 32767));
});

test('the WAV header states the rate the samples were actually taken at', () => {
  // The whole bug in one assertion: a header that says 16000 over 48 kHz
  // samples is how "the microphone works but nothing is transcribed" happens.
  const pcm = floatToPcm16(tone(440, 16_000, 0.25));
  const wav = encodeWav(pcm, 16_000);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.subarray(8, 12)), 'WAVE');
  assert.equal(view.getUint16(20, true), 1, 'format must be PCM');
  assert.equal(view.getUint16(22, true), 1, 'mono');
  assert.equal(view.getUint32(24, true), 16_000, 'sample rate');
  assert.equal(view.getUint32(28, true), 32_000, 'byte rate must match the sample rate');
  assert.equal(view.getUint16(34, true), 16, 'bit depth');
  assert.equal(view.getUint32(40, true), pcm.length * 2, 'data length');
  assert.equal(wav.length, 44 + pcm.length * 2);

  // Little-endian samples, because that is what pcm_s16le means.
  assert.equal(view.getInt16(44, true), pcm[0]);
  assert.equal(view.getInt16(46, true), pcm[1]);
});

test('a WAV written at a different rate says so', () => {
  const wav = encodeWav(new Int16Array(10), 48_000);
  const view = new DataView(wav.buffer);
  assert.equal(view.getUint32(24, true), 48_000);
});

test('base64 survives a buffer bigger than the argument limit', () => {
  // 300 kB is a normal utterance. String.fromCharCode(...bytes) throws on it.
  const bytes = new Uint8Array(300_000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const b64 = bytesToBase64(bytes);
  const back = Buffer.from(b64, 'base64');
  assert.equal(back.length, bytes.length);
  assert.equal(back[0], bytes[0]);
  assert.equal(back[299_999], bytes[299_999]);
});

test('joining blocks preserves order and length', () => {
  const out = joinBlocks([Float32Array.from([1, 2]), new Float32Array(0), Float32Array.from([3])]);
  assert.deepEqual(Array.from(out), [1, 2, 3]);
});

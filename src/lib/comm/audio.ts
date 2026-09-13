// HOMATCH — the arithmetic between a microphone and a transcription service.
//
// WHY THIS IS ITS OWN FILE, WITH TESTS
//
// The old path asked the browser for a 16 kHz AudioContext, assumed it got
// one, and told the provider the audio was 16 kHz. `new AudioContext({
// sampleRate })` is a REQUEST. Plenty of devices — phones especially — hand
// back 44.1 kHz or 48 kHz anyway, and then every byte sent is three times too
// long for the rate it was labelled with. Proven against production: the same
// Georgian sentence, correctly resampled, came back as a real transcript; the
// same bytes at their native rate under a 16000 label came back as " Yeah."
//
// A level meter still moves in that state, which is why it reads as "the
// microphone is working and nothing else is".
//
// So: read the rate the browser actually gave, convert deterministically, and
// label the audio with what was actually sent. None of that is guesswork, all
// of it is arithmetic, and arithmetic can be tested without a browser.

/** What every speech model in this product is trained on. */
export const TARGET_SAMPLE_RATE = 16_000;

/**
 * Rate conversion that survives being fed one 128-sample block at a time.
 *
 * Stateful on purpose. Resampling each block independently leaves a seam at
 * every boundary — a click every few milliseconds, which is audible to a
 * transcription model as consonants that are not there.
 *
 * Downsampling averages across the source window rather than picking one
 * sample from it. That averaging IS the anti-alias filter: plain decimation
 * folds everything above 8 kHz back down into the speech band as a hiss that
 * costs real accuracy.
 */
export class Resampler {
  private readonly ratio: number;
  private readonly fromRate: number;
  private readonly toRate: number;
  private tail = new Float32Array(0);
  /** Fractional position carried across blocks when interpolating upward. */
  private phase = 0;

  constructor(fromRate: number, toRate = TARGET_SAMPLE_RATE) {
    this.fromRate = fromRate;
    this.toRate = toRate;
    this.ratio = fromRate / toRate;
  }

  /** True when the browser already gave us what we wanted and nothing is done. */
  get passthrough(): boolean { return this.fromRate === this.toRate; }

  get inputRate(): number { return this.fromRate; }
  get outputRate(): number { return this.toRate; }

  process(input: Float32Array): Float32Array {
    if (!input.length) return new Float32Array(0);
    if (this.passthrough) return input.slice();

    const buf = this.tail.length ? concatFloat(this.tail, input) : input;

    if (this.ratio > 1) {
      /*
       * Downsampling: one output sample per `ratio` input samples, averaged.
       *
       * The fractional position is carried across blocks. Rounding it away
       * each time leaves under a sample behind per block, which sounds like
       * nothing and is not: at 44.1 kHz it accumulated into half a percent of
       * extra audio, so a minute of speech arrived as a minute and a fifth and
       * every word drifted off its own timing.
       */
      const out: number[] = [];
      let pos = this.phase;
      while (pos + this.ratio <= buf.length) {
        const start = Math.floor(pos);
        const end = Math.min(buf.length, Math.floor(pos + this.ratio));
        let sum = 0;
        let count = 0;
        for (let i = start; i < end; i++) { sum += buf[i]; count++; }
        out.push(count ? sum / count : 0);
        pos += this.ratio;
      }
      const consumed = Math.floor(pos);
      this.tail = buf.slice(consumed);
      this.phase = pos - consumed;
      return Float32Array.from(out);
    }

    // Upsampling (8 kHz hardware, rare): linear interpolation, phase carried.
    const out: number[] = [];
    let pos = this.phase;
    while (pos < buf.length - 1) {
      const i = Math.floor(pos);
      const f = pos - i;
      out.push(buf[i] * (1 - f) + buf[i + 1] * f);
      pos += this.ratio;
    }
    // Keep the last sample so the next block can interpolate against it.
    const keepFrom = Math.max(0, Math.floor(pos) - 1);
    this.tail = buf.slice(keepFrom);
    this.phase = pos - keepFrom;
    return Float32Array.from(out);
  }
}

function concatFloat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Float samples in [-1, 1] to signed 16-bit, little-endian by construction. */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** Root-mean-square of a block: how loud it is, 0 to 1. */
export function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/**
 * A complete WAV file around raw PCM.
 *
 * Written rather than assumed: a transcription endpoint is given a file, and
 * a file with the wrong rate in its header is exactly the bug this module
 * exists to stop. The header says what the samples actually are.
 */
export function encodeWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const bytes = pcm.length * 2;
  const out = new Uint8Array(44 + bytes);
  const view = new DataView(out.buffer);

  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);          // PCM header length
  view.setUint16(20, 1, true);           // format: PCM
  view.setUint16(22, 1, true);           // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);           // block align
  view.setUint16(34, 16, true);          // bits per sample
  ascii(36, 'data');
  view.setUint32(40, bytes, true);

  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  return out;
}

/** Bytes to base64, in chunks small enough not to blow the argument limit. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  // btoa exists in every browser this runs in; the tests provide it in node.
  return btoa(binary);
}

/** Join captured blocks into one buffer. */
export function joinBlocks(blocks: Float32Array[]): Float32Array {
  let total = 0;
  for (const b of blocks) total += b.length;
  const out = new Float32Array(total);
  let at = 0;
  for (const b of blocks) { out.set(b, at); at += b.length; }
  return out;
}

// HOMATCH Design Studio — the walked home's sounds, synthesised in the browser.
//
// What each interaction sounds like is chosen in lib/designStudio/walkSounds.ts;
// this plays it with Web Audio from filtered noise and short tones (a latch's
// click, a door's thud, a flush's rush, a running tap), so nothing is
// downloaded and nothing leaves the page. The context is created on the first
// cue, which always follows a visitor's own click, tap or key (the browser's
// autoplay rule). Running water keeps sounding until its tap is turned off or
// the walk ends.

import { distanceGain, LOOPING, type SoundCue } from '@/lib/designStudio/walkSounds';

type Ctx = AudioContext;

export class WalkSounds {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private loops = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
  enabled = true;

  private ensure(): Ctx | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      try { this.ctx = new AC(); } catch { return null; }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.stopAll();
  }

  /** Play a cue `distanceM` away; `key` names a looping cue's source (the tap that runs). */
  cue(cue: SoundCue, distanceM: number, key: string) {
    if (cue === 'WATER_OFF' || !LOOPING.has(cue)) this.stopLoop(key);
    const level = distanceGain(distanceM);
    if (level <= 0) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const out = ctx.createGain();
    out.gain.value = level;
    out.connect(this.master);
    const t = ctx.currentTime + 0.01;
    switch (cue) {
      case 'SWITCH': this.click(out, t, 3200, 0.5); this.click(out, t + 0.03, 2600, 0.3); break;
      case 'DOOR_OPEN': this.click(out, t, 2400, 0.5); this.creak(out, t + 0.05, 0.55); break;
      case 'DOOR_CLOSE': this.thud(out, t, 0.75, 95); this.click(out, t + 0.04, 2200, 0.45); break;
      case 'WINDOW_OPEN': this.click(out, t, 2800, 0.35); this.swish(out, t + 0.04, 0.35, 1300, 0.18); break;
      case 'WINDOW_CLOSE': this.thud(out, t, 0.4, 130); this.click(out, t + 0.03, 2800, 0.35); break;
      case 'CABINET_OPEN': this.click(out, t, 3000, 0.3); this.knock(out, t + 0.02, 750, 0.25); break;
      case 'CABINET_CLOSE': this.knock(out, t, 520, 0.55); this.thud(out, t, 0.3, 150); break;
      case 'DRAWER_OPEN': this.swish(out, t, 0.32, 420, 0.3); break;
      case 'DRAWER_CLOSE': this.swish(out, t, 0.18, 420, 0.28); this.knock(out, t + 0.17, 480, 0.5); break;
      case 'FRIDGE_OPEN': this.burst(out, t, 0.09, 'lowpass', 380, 0.7, 0.5); break;
      case 'FRIDGE_CLOSE': this.thud(out, t, 0.45, 110); this.burst(out, t, 0.12, 'lowpass', 260, 0.7, 0.35); break;
      case 'TV_ON': this.click(out, t, 3500, 0.35); this.burst(out, t + 0.05, 0.28, 'bandpass', 3200, 0.6, 0.12); this.tone(out, t + 0.05, 'sine', 60, 60, 0.6, 0.05); break;
      case 'TV_OFF': this.click(out, t, 3500, 0.35); this.tone(out, t + 0.02, 'sine', 700, 90, 0.09, 0.12); break;
      case 'FLUSH': this.click(out, t, 1800, 0.4); this.flush(out, t + 0.12); break;
      case 'WATER_ON': this.squeak(out, t); this.water(out, t + 0.04, key); break;
      case 'WATER_OFF': this.squeak(out, t); break;
      case 'CURTAIN': this.swish(out, t, 0.5, 2200, 0.2); break;
      case 'HOB_CLICK': for (let i = 0; i < 3; i += 1) this.click(out, t + i * 0.09, 4200, 0.4); this.burst(out, t + 0.28, 0.4, 'lowpass', 700, 0.7, 0.2); break;
      case 'COFFEE': this.tone(out, t, 'sawtooth', 115, 120, 1.8, 0.05); this.burst(out, t, 1.8, 'bandpass', 1500, 1.2, 0.12); break;
      case 'MOTOR': this.tone(out, t, 'sawtooth', 75, 82, 1.2, 0.07, 320); break;
      case 'SIT': this.burst(out, t, 0.22, 'lowpass', 260, 0.7, 0.45); break;
      case 'STAND': this.burst(out, t, 0.16, 'lowpass', 320, 0.7, 0.25); break;
    }
  }

  stopLoop(key: string) {
    const l = this.loops.get(key);
    if (!l || !this.ctx) return;
    this.loops.delete(key);
    const t = this.ctx.currentTime;
    l.gain.gain.cancelScheduledValues(t);
    l.gain.gain.setValueAtTime(l.gain.gain.value, t);
    l.gain.gain.linearRampToValueAtTime(0, t + 0.25);
    try { l.src.stop(t + 0.3); } catch { /* already stopped */ }
  }

  stopAll() {
    for (const key of [...this.loops.keys()]) this.stopLoop(key);
  }

  dispose() {
    this.stopAll();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.master = null;
  }

  // ── Building blocks ──────────────────────────────────────────────

  /** Filtered noise with a quick attack and a decay to silence over `dur`. */
  private burst(out: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, freqEnd?: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.01, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random()); src.stop(t + dur + 0.02);
  }

  private tone(out: AudioNode, t: number, type: OscillatorType, from: number, to: number, dur: number, gain: number, lowpass?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.setValueAtTime(gain, t + Math.max(0.02, dur * 0.7));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (lowpass) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; node = o.connect(f); }
    node.connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** A latch, a switch: a few milliseconds of bright noise. */
  private click(out: AudioNode, t: number, freq: number, gain: number) { this.burst(out, t, 0.018, 'highpass', freq, 0.7, gain); }
  /** Wood struck: a short ring at its pitch. */
  private knock(out: AudioNode, t: number, freq: number, gain: number) { this.burst(out, t, 0.07, 'bandpass', freq, 6, gain); this.tone(out, t, 'sine', freq / 2, freq / 2.4, 0.06, gain * 0.4); }
  /** A heavy leaf meeting its frame. */
  private thud(out: AudioNode, t: number, gain: number, freq: number) { this.tone(out, t, 'sine', freq, freq * 0.6, 0.18, gain); this.burst(out, t, 0.12, 'lowpass', 420, 0.7, gain * 0.6); }
  /** Something sliding: a soft band of noise that swells and fades. */
  private swish(out: AudioNode, t: number, dur: number, freq: number, gain: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random()); src.stop(t + dur + 0.02);
  }
  /** A hinge: a rough low tone that wavers. */
  private creak(out: AudioNode, t: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(170, t); o.frequency.linearRampToValueAtTime(235, t + dur);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 23;
    const depth = ctx.createGain(); depth.gain.value = 18;
    lfo.connect(depth).connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06, t + 0.08); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(out);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
  }
  /** A tap's handle. */
  private squeak(out: AudioNode, t: number) { this.tone(out, t, 'sine', 1150, 1500, 0.06, 0.04); }
  /** A cistern emptying: a rush that swells, gurgles and drains away over three seconds. */
  private flush(out: AudioNode, t: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(700, t); f.frequency.linearRampToValueAtTime(2600, t + 0.5); f.frequency.exponentialRampToValueAtTime(380, t + 3.2);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 7;
    const depth = ctx.createGain(); depth.gain.value = 260;
    lfo.connect(depth).connect(f.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.42, t + 0.35); g.gain.setValueAtTime(0.42, t + 1.4); g.gain.linearRampToValueAtTime(0.0001, t + 3.4);
    src.connect(f).connect(g).connect(out);
    src.start(t); lfo.start(t); src.stop(t + 3.5); lfo.stop(t + 3.5);
  }
  /** Running water: kept until its tap is turned off (stopLoop). */
  private water(out: AudioNode, t: number, key: string) {
    const ctx = this.ctx!;
    this.stopLoop(key);
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16, t + 0.2);
    src.connect(hp).connect(bp).connect(g).connect(out);
    src.start(t);
    this.loops.set(key, { src, gain: g });
  }
}

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
    if (!LOOPING.has(cue)) this.stopLoop(key);
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
      case 'COFFEE': this.brew(out, t); break;
      case 'SLURP': this.slurp(out, t); break;
      case 'SIZZLE': this.click(out, t, 4200, 0.3); this.sizzle(out, t + 0.05, key); break;
      case 'SIZZLE_END': break;
      case 'PLATE': this.tone(out, t, 'sine', 2900, 2850, 0.35, 0.05); this.tone(out, t + 0.004, 'sine', 4300, 4250, 0.25, 0.03); this.knock(out, t, 900, 0.2); break;
      case 'FAN_ON': this.click(out, t, 3000, 0.45); this.fan(out, t + 0.03, key); break;
      case 'FAN_OFF': this.click(out, t, 3000, 0.45); break;
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
  /**
   * A cistern emptying, the way it sounds in a small tiled room: a soft rush of water (a broad band, no siren-like
   * sweep), bubbles and a gurgle as the bowl drains, then the quiet hiss of the cistern refilling.
   */
  private flush(out: AudioNode, t: number) {
    const ctx = this.ctx!;
    // The rush: two bands of noise (body and splash), swelling fast and draining away over ~2.5 s.
    const layer = (freq: number, q: number, peak: number, hold: number, fade: number) => {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.18);
      g.gain.setValueAtTime(peak, t + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t + hold + fade);
      src.connect(f).connect(g).connect(out);
      src.start(t, Math.random()); src.stop(t + hold + fade + 0.05);
    };
    layer(650, 0.7, 0.16, 0.9, 1.6);
    layer(2600, 0.9, 0.06, 0.7, 1.2);
    // Bubbles: short rising blips as the bowl drains, scattered and fading.
    for (let i = 0; i < 14; i += 1) {
      const at = t + 0.7 + Math.random() * 1.5;
      const f0 = 260 + Math.random() * 360;
      this.tone(out, at, 'sine', f0, f0 * (1.6 + Math.random() * 0.6), 0.04 + Math.random() * 0.03, 0.035 * (1 - (at - t - 0.7) / 1.8));
    }
    // The gurgle as the last of it goes down.
    this.burst(out, t + 2.0, 0.35, 'bandpass', 380, 3, 0.07, 220);
    // The cistern refilling: a thin hiss, quiet, for a few seconds.
    const hiss = ctx.createBufferSource(); hiss.buffer = this.noise; hiss.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 5200; hp.Q.value = 1.4;
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.0001, t + 2.2); hg.gain.linearRampToValueAtTime(0.018, t + 2.6); hg.gain.setValueAtTime(0.018, t + 4.6); hg.gain.linearRampToValueAtTime(0.0001, t + 5.6);
    hiss.connect(hp).connect(hg).connect(out);
    hiss.start(t + 2.2); hiss.stop(t + 5.7);
  }
  /** A coffee machine: the pump's buzz, then the brew dripping and spluttering into the cup. */
  private brew(out: AudioNode, t: number) {
    this.tone(out, t, 'sawtooth', 52, 50, 1.6, 0.035, 260);
    for (let i = 0; i < 18; i += 1) {
      const at = t + 0.4 + Math.random() * 2.2;
      this.burst(out, at, 0.05 + Math.random() * 0.05, 'bandpass', 900 + Math.random() * 900, 4, 0.08);
    }
    this.burst(out, t + 2.4, 0.4, 'bandpass', 1400, 1.5, 0.1, 600); // the last splutter
  }
  /** A sip of hot coffee: air drawn in over the cup (a rising slurp), then a swallow. */
  private slurp(out: AudioNode, t: number) {
    const at = t + 0.55; // the cup reaches the lips first
    this.burst(out, at, 0.32, 'bandpass', 700, 2.5, 0.16, 2600);
    this.burst(out, at + 0.38, 0.18, 'bandpass', 900, 2.5, 0.08, 2000);
    this.tone(out, at + 0.62, 'sine', 210, 120, 0.09, 0.12);
  }
  /** Fat in a hot pan: a crackling hiss, kept until the cooking is done (stopLoop). */
  private sizzle(out: AudioNode, t: number, key: string) {
    const ctx = this.ctx!;
    this.stopLoop(key);
    if (!this.crackle) {
      // Two seconds of hiss with sharp crackles in it, made once and looped.
      const len = ctx.sampleRate * 2;
      this.crackle = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.crackle.getChannelData(0);
      for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * 0.35;
      for (let k = 0; k < 260; k += 1) {
        const at = Math.floor(Math.random() * (len - 400));
        const amp = 0.5 + Math.random() * 0.5;
        for (let j = 0; j < 120; j += 1) d[at + j] += (Math.random() * 2 - 1) * amp * Math.exp(-j / 18);
      }
    }
    const src = ctx.createBufferSource(); src.buffer = this.crackle; src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.22, t + 0.15); g.gain.linearRampToValueAtTime(0.12, t + 1.2);
    src.connect(hp).connect(g).connect(out);
    src.start(t);
    this.loops.set(key, { src, gain: g });
  }
  private crackle: AudioBuffer | null = null;
  /** Running water: kept until its tap is turned off (stopLoop). */
  /** A range hood's fan: a low airy rush with a faint motor hum under it, looped while it runs. */
  private fan(out: AudioNode, t: number, key: string) {
    const ctx = this.ctx!;
    this.stopLoop(key);
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.14, t + 0.8);
    src.connect(lp).connect(g).connect(out);
    const hum = ctx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 118;
    const hg = ctx.createGain(); hg.gain.value = 0.18;
    hum.connect(hg).connect(g);
    src.start(t); hum.start(t);
    src.addEventListener('ended', () => { try { hum.stop(); } catch { /* already stopped */ } });
    this.loops.set(key, { src, gain: g });
  }

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

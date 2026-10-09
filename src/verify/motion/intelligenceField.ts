/*
 * HOMATCH VERIFY — THE INTELLIGENCE FIELD (motion engine, framework-free).
 *
 * The research animation is a living field of evidence around the property,
 * not a ring of identical dots. Everything here is pure or self-contained so
 * it can be tested in Node and driven by one requestAnimationFrame loop in
 * ResearchNetwork.tsx.
 *
 * WHAT IT SHOWS IS REAL
 *
 * The field's FORMATION comes from the server-derived network state
 * (verify/researchNetwork.ts → activeKey / terminal / settled), i.e. from the
 * research-agent stage the job is actually in. Nothing here invents progress:
 * there is no percentage, no countdown, and a formation never claims a source
 * succeeded — it shows which kind of work is happening now.
 *
 *   identity / location   GATHER    a loose, breathing ring closing on the property
 *   official / documents  LATTICE   structured constellations — documents being read
 *   registry              ORBIT     concentric orbits — ownership, mortgages, finances
 *   context               WAVE      flowing waves — public research
 *   market                STREAMS   comparative bands — prices side by side
 *   crosscheck            WEAVE     two bodies of evidence, bridged — reconciliation
 *   synthesis             CONVERGE  a bright spiral into the core — the report
 *   complete              REST      calm, slow breathing
 *   failed / cancelled    DIM       sparse and still
 *
 * PARTICLE FAMILIES (each individually varied in size, depth, brightness,
 * speed, phase and lifetime — seeded, so a remount draws the same field):
 *   DUST     tiny, faint, deep; drifts on the flow field with parallax
 *   MOTE     medium; follows the formation loosely, links to neighbours
 *   ANCHOR   few, larger, glowing; holds the formation's structure
 *   CARRIER  bright travellers on curved paths from the edge into the core —
 *            evidence arriving; only while research is running
 */

export type Formation = 'GATHER' | 'LATTICE' | 'ORBIT' | 'WAVE' | 'STREAMS' | 'WEAVE' | 'CONVERGE' | 'REST' | 'DIM';
export type Family = 'DUST' | 'MOTE' | 'ANCHOR' | 'CARRIER';

export interface FieldNetworkInput {
  activeKey: string | null;
  terminal: string;
  settled: boolean;
}

const FORMATION_BY_NODE: Record<string, Formation> = {
  started: 'GATHER',
  identity: 'GATHER',
  location: 'GATHER',
  official: 'LATTICE',
  documents: 'LATTICE',
  registry: 'ORBIT',
  context: 'WAVE',
  market: 'STREAMS',
  crosscheck: 'WEAVE',
  synthesis: 'CONVERGE',
  complete: 'REST',
};

/** The formation for the research state the server reported. */
export function formationFor(n: FieldNetworkInput): Formation {
  if (n.terminal === 'FAILED' || n.terminal === 'CANCELLED') return 'DIM';
  if (n.settled || n.terminal === 'COMPLETE') return 'REST';
  return (n.activeKey && FORMATION_BY_NODE[n.activeKey]) || 'GATHER';
}

/** Small, fast, seeded PRNG (mulberry32): the same field after a remount. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Budget {
  dust: number;
  motes: number;
  anchors: number;
  carriers: number;
}

/**
 * How many of each family a surface can afford. Scales with area, trimmed on
 * low-power devices; never so few that the field reads as empty, never so
 * many that it reads as clutter.
 */
export function particleBudget(widthCss: number, heightCss: number, lowPower = false): Budget {
  const area = Math.max(1, widthCss * heightCss);
  const scale = lowPower ? 0.6 : 1;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
  return {
    dust: clamp((area / 2600) * scale, 18, 90),
    motes: clamp((area / 4200) * scale, 16, 46),
    anchors: lowPower ? 9 : 12,
    carriers: lowPower ? 4 : 7,
  };
}

export interface Particle {
  fam: Family;
  /** Index within its family — its slot in the formation. */
  slot: number;
  /** Position and velocity in field units: x in [-aspect, aspect], y in [-1, 1]. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 0.35 (far) … 1 (near): size, brightness and parallax all follow it. */
  z: number;
  size: number;
  alpha: number;
  /** 0 ivory, 1 gold, 2 steel blue. */
  tint: 0 | 1 | 2;
  phase: number;
  speed: number;
  /** CARRIER only: progress along its path, its path endpoints and duration. */
  t: number;
  dur: number;
  from: [number, number];
  bend: number;
}

export function createParticles(budget: Budget, aspect: number, seed = 0x5eed): Particle[] {
  const rnd = seeded(seed);
  const out: Particle[] = [];
  const make = (fam: Family, slot: number): Particle => {
    const z = fam === 'DUST' ? 0.35 + rnd() * 0.4 : fam === 'ANCHOR' ? 0.8 + rnd() * 0.2 : 0.55 + rnd() * 0.45;
    const size =
      fam === 'DUST' ? 0.5 + rnd() * 0.9 : fam === 'MOTE' ? 1.1 + rnd() * 1.4 : fam === 'ANCHOR' ? 2.2 + rnd() * 1.6 : 1.4 + rnd() * 0.8;
    const alpha = fam === 'DUST' ? 0.18 + rnd() * 0.3 : fam === 'MOTE' ? 0.4 + rnd() * 0.35 : fam === 'ANCHOR' ? 0.75 + rnd() * 0.25 : 0.9;
    const tint: 0 | 1 | 2 = fam === 'ANCHOR' || fam === 'CARRIER' ? 1 : rnd() < 0.22 ? 1 : rnd() < 0.5 ? 2 : 0;
    const angle = rnd() * Math.PI * 2;
    return {
      fam,
      slot,
      x: Math.cos(angle) * aspect * (0.3 + rnd() * 0.7),
      y: Math.sin(angle) * (0.3 + rnd() * 0.7),
      vx: 0,
      vy: 0,
      z,
      size,
      alpha,
      tint,
      phase: rnd() * Math.PI * 2,
      speed: 0.6 + rnd() * 0.9,
      t: rnd(),
      dur: 3.2 + rnd() * 3.4,
      from: edgePoint(rnd(), aspect),
      bend: (rnd() - 0.5) * 1.4,
    };
  };
  for (let i = 0; i < budget.dust; i++) out.push(make('DUST', i));
  for (let i = 0; i < budget.motes; i++) out.push(make('MOTE', i));
  for (let i = 0; i < budget.anchors; i++) out.push(make('ANCHOR', i));
  for (let i = 0; i < budget.carriers; i++) out.push(make('CARRIER', i));
  return out;
}

/** A point on the field's edge, from a unit value. */
export function edgePoint(u: number, aspect: number): [number, number] {
  const a = u * Math.PI * 2;
  return [Math.cos(a) * aspect * 1.08, Math.sin(a) * 1.08];
}

/**
 * Where a MOTE / ANCHOR wants to be in a formation at time `t` (seconds).
 * Smooth in t; the engine springs toward it, so a formation change is a
 * glide, never a jump.
 */
export function targetFor(f: Formation, fam: Family, slot: number, count: number, t: number, aspect: number): [number, number] {
  const n = Math.max(1, count);
  const u = slot / n;
  const a = u * Math.PI * 2;
  const anchor = fam === 'ANCHOR';
  switch (f) {
    case 'GATHER': {
      const r = (anchor ? 0.62 : 0.5 + 0.28 * ((slot * 0.618) % 1)) * (1 + 0.04 * Math.sin(t * 0.6 + slot));
      const rot = t * 0.05;
      return [Math.cos(a + rot) * r * aspect * 0.78, Math.sin(a + rot) * r];
    }
    case 'LATTICE': {
      // A soft grid of "documents": anchors are the pages, motes cluster on them.
      const cols = 4;
      const rows = 3;
      const cell = anchor ? slot % (cols * rows) : Math.floor(u * cols * rows);
      const cx = ((cell % cols) - (cols - 1) / 2) * 0.42 * aspect;
      const cy = (Math.floor(cell / cols) - (rows - 1) / 2) * 0.48;
      if (anchor) return [cx, cy + 0.015 * Math.sin(t * 0.8 + slot)];
      const o = (slot * 2.399) % (Math.PI * 2);
      const rr = 0.07 + 0.05 * ((slot * 0.37) % 1);
      return [cx + Math.cos(o + t * 0.7) * rr * aspect * 0.6, cy + Math.sin(o + t * 0.7) * rr];
    }
    case 'ORBIT': {
      const ring = anchor ? slot % 2 : slot % 3;
      const r = 0.3 + ring * 0.22;
      const dir = ring % 2 === 0 ? 1 : -1;
      const sp = 0.16 / (1 + ring * 0.6);
      const ang = a * 3 + t * sp * dir;
      return [Math.cos(ang) * r * aspect * 0.9, Math.sin(ang) * r * 0.82];
    }
    case 'WAVE': {
      const band = slot % 3;
      const x = (((u * 3 + t * 0.045 * (1 + band * 0.3)) % 1) * 2 - 1) * aspect * 0.92;
      const y = (band - 1) * 0.36 + Math.sin(x * 2.2 + t * 0.9 + band) * 0.13;
      return [x, y];
    }
    case 'STREAMS': {
      // Comparative bands: lanes of different pace, like listings side by side.
      const lane = slot % 5;
      const pace = 0.03 + lane * 0.012;
      const x = (((u * 5 + t * pace) % 1) * 2 - 1) * aspect * 0.95;
      const y = (lane - 2) * 0.27 + Math.sin(t * 0.5 + lane * 1.7) * 0.03;
      if (anchor) {
        // Anchors sit on a gentle price line across the field.
        const k = (slot / Math.max(1, n - 1)) * 2 - 1;
        return [k * aspect * 0.8, -k * 0.28 + 0.02 * Math.sin(t + slot)];
      }
      return [x, y];
    }
    case 'WEAVE': {
      const side = slot % 2 === 0 ? -1 : 1;
      const r = 0.22 + 0.12 * ((slot * 0.53) % 1);
      const ang = a * 2 + t * 0.25 * side;
      const shuttle = anchor ? 0 : Math.sin(t * 0.35 + slot) * 0.12;
      return [side * aspect * (0.48 - shuttle) + Math.cos(ang) * r * 0.7, Math.sin(ang) * r];
    }
    case 'CONVERGE': {
      const r = (anchor ? 0.16 : 0.2 + 0.18 * ((slot * 0.618) % 1)) * (1 + 0.06 * Math.sin(t * 1.2 + slot));
      const ang = a + t * 0.32 + r * 4;
      return [Math.cos(ang) * r * aspect * 0.9, Math.sin(ang) * r];
    }
    case 'REST': {
      const r = anchor ? 0.42 : 0.55 + 0.3 * ((slot * 0.618) % 1);
      const ang = a + t * 0.012;
      return [Math.cos(ang) * r * aspect * 0.8, Math.sin(ang) * r * 0.85];
    }
    case 'DIM':
    default: {
      const r = 0.7 + 0.25 * ((slot * 0.618) % 1);
      return [Math.cos(a) * r * aspect * 0.85, Math.sin(a) * r * 0.9];
    }
  }
}

/** Per-formation feel: how hard particles hold the shape, how much the flow moves them, how bright. */
export const FEEL: Record<Formation, { spring: number; flow: number; glow: number; links: number; carriers: boolean }> = {
  GATHER: { spring: 1.1, flow: 0.05, glow: 0.85, links: 0.7, carriers: true },
  LATTICE: { spring: 2.2, flow: 0.025, glow: 0.9, links: 1, carriers: true },
  ORBIT: { spring: 1.8, flow: 0.03, glow: 0.9, links: 0.8, carriers: true },
  WAVE: { spring: 1.4, flow: 0.07, glow: 0.85, links: 0.6, carriers: true },
  STREAMS: { spring: 1.6, flow: 0.04, glow: 0.85, links: 0.55, carriers: true },
  WEAVE: { spring: 1.5, flow: 0.05, glow: 0.95, links: 1.15, carriers: true },
  CONVERGE: { spring: 1.9, flow: 0.03, glow: 1.15, links: 1.1, carriers: true },
  REST: { spring: 0.7, flow: 0.025, glow: 0.7, links: 0.6, carriers: false },
  DIM: { spring: 0.5, flow: 0.015, glow: 0.35, links: 0.25, carriers: false },
};

/** A smooth, cheap flow field (sum of sines) — organic drift, no noise library. */
export function flow(x: number, y: number, t: number): [number, number] {
  return [
    Math.sin(y * 1.7 + t * 0.21) * 0.6 + Math.sin((x + y) * 0.9 - t * 0.13) * 0.4,
    Math.cos(x * 1.5 - t * 0.17) * 0.6 + Math.sin((x - y) * 1.1 + t * 0.11) * 0.4,
  ];
}

/** A point on a carrier's curved path (quadratic Bézier from the edge to the core). */
export function carrierPoint(p: Particle, s: number): [number, number] {
  const [x0, y0] = p.from;
  // Control point: perpendicular to the straight path, by `bend`.
  const mx = x0 / 2 - y0 * p.bend * 0.5;
  const my = y0 / 2 + x0 * p.bend * 0.5;
  const q = 1 - s;
  return [q * q * x0 + 2 * q * s * mx, q * q * y0 + 2 * q * s * my];
}

/**
 * One physics step. dt in seconds (clamped by the caller). Mutates particles.
 * Returns nothing; the renderer reads positions.
 */
export function step(
  ps: Particle[],
  f: Formation,
  t: number,
  dt: number,
  aspect: number,
  counts: { motes: number; anchors: number },
  /** Where evidence is coming from right now: the active research theme. */
  source?: [number, number] | null,
): void {
  const feel = FEEL[f];
  for (const p of ps) {
    if (p.fam === 'CARRIER') {
      if (!feel.carriers) {
        p.t = Math.min(1, p.t + dt / p.dur);
        continue;
      }
      p.t += dt / p.dur;
      if (p.t >= 1) {
        p.t = 0;
        // A new arrival from somewhere else on the edge (deterministic walk).
        const u = (p.phase / (Math.PI * 2) + p.slot * 0.137 + t * 0.013) % 1;
        // From the theme being researched, when there is one: evidence
        // visibly travels from that topic into the property.
        p.from = source ? [source[0] + Math.cos(u * 6.283) * 0.05, source[1] + Math.sin(u * 6.283) * 0.05] : edgePoint(u, aspect);
        p.bend = Math.sin(p.phase + t) * 0.7;
      }
      const [x, y] = carrierPoint(p, easeInOut(p.t));
      p.x = x;
      p.y = y;
      continue;
    }
    // Velocities are in field units per SECOND; semi-implicit Euler, so the
    // motion is the same at 30, 60 or 120 frames per second.
    const [fx, fy] = flow(p.x * 0.9, p.y * 0.9, t * p.speed);
    if (p.fam === 'DUST') {
      const drift = feel.flow * 3 * p.z;
      p.vx += (fx * drift - p.vx * 1.2) * dt;
      p.vy += (fy * drift - p.vy * 1.2) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Wrap softly at the edges so dust never piles up.
      if (p.x > aspect * 1.1) p.x = -aspect * 1.1;
      if (p.x < -aspect * 1.1) p.x = aspect * 1.1;
      if (p.y > 1.1) p.y = -1.1;
      if (p.y < -1.1) p.y = 1.1;
      continue;
    }
    const count = p.fam === 'ANCHOR' ? counts.anchors : counts.motes;
    const [tx, ty] = targetFor(f, p.fam, p.slot, count, t, aspect);
    // A near-critically damped spring: a formation change is a glide of about
    // a second, individually paced, never a wobble.
    const stiff = feel.spring * 3.2 * (p.fam === 'ANCHOR' ? 1.15 : 0.75 + 0.5 * ((p.slot * 0.37) % 1));
    const damping = 1.7 * Math.sqrt(stiff);
    p.vx += ((tx - p.x) * stiff - p.vx * damping + fx * feel.flow * 2) * dt;
    p.vy += ((ty - p.y) * stiff - p.vy * damping + fy * feel.flow * 2) * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

export const easeInOut = (s: number): number => (s < 0.5 ? 2 * s * s : 1 - Math.pow(-2 * s + 2, 2) / 2);

export const PALETTE = {
  ground: '#0B1018',
  groundEdge: '#070A10',
  gold: [221, 170, 72] as const,
  ivory: [236, 230, 216] as const,
  steel: [138, 160, 190] as const,
};

export const tintRgb = (tint: 0 | 1 | 2): readonly [number, number, number] =>
  tint === 1 ? PALETTE.gold : tint === 2 ? PALETTE.steel : PALETTE.ivory;

/*
 * THE THEME RING — the research topics around the house.
 *
 * Positions in field units (x scaled by aspect), clockwise from the top, and
 * the same as CSS percentages of the canvas box, so canvas lines and HTML
 * labels meet exactly at any size: left% = 50 + cos·RX·46, top% = 50 + sin·RY·46.
 */
export const RING_RX = 0.62;
export const RING_RY = 0.72;
const FIELD_SCALE = 0.46;

export function ringAngle(i: number, n: number): number {
  return -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
}

/** A theme's position in field units. */
export function ringPosition(i: number, n: number, aspect: number): [number, number] {
  const a = ringAngle(i, n);
  return [(Math.cos(a) * RING_RX * aspect) / 1, Math.sin(a) * RING_RY];
}

/** The same position as percentages of the canvas box (for HTML labels). */
export function ringPercent(i: number, n: number): { left: number; top: number; cos: number; sin: number } {
  const a = ringAngle(i, n);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { left: 50 + cos * RING_RX * FIELD_SCALE * 100, top: 50 + sin * RING_RY * FIELD_SCALE * 100, cos, sin };
}

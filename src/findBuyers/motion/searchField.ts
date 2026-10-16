/*
 * FIND BUYERS — THE SEARCH NETWORK FIELD (motion engine, framework-free).
 *
 * The active-search picture: a large interconnected network of nodes and
 * paths, a snake-like search head travelling through it, branching pulses
 * that run ahead along neighbouring paths, paths that fade and reconnect, and
 * fine particles drifting through the field. It is atmosphere, not data:
 *
 *   - its INTENSITY is the only thing the server decides — searching (full),
 *     pausing (slowing), paused (still), finished (a calm, slow rest);
 *   - it draws no counts, no percentages, no completed tasks and no source
 *     names — nothing in it can be read as a claim about results.
 *
 * Deterministic: one seeded PRNG (mulberry32) drives every choice, so the same
 * seed and the same steps always produce the same field (no unseeded randomness).
 * Pure and self-contained so node:test loads it; SearchNetworkField.tsx draws
 * it with one requestAnimationFrame loop.
 */

export type FieldMode = 'searching' | 'pausing' | 'paused' | 'finished';

/** The field's mode for a server lifecycle state (find_buyers_campaign_status). */
export function fieldModeFor(state: string | null | undefined): FieldMode {
  switch (state) {
    case 'PREPARING': case 'QUEUED': case 'SEARCHING': case 'PARTIAL_RESULTS': return 'searching';
    case 'PAUSING': return 'pausing';
    case 'PAUSED': return 'paused';
    default: return 'finished';
  }
}

/** How fast the field moves in a mode: 0 is a still frame. */
export function intensityFor(mode: FieldMode): number {
  return mode === 'searching' ? 1 : mode === 'pausing' ? 0.35 : mode === 'finished' ? 0.12 : 0;
}

/** Small, fast, seeded PRNG (mulberry32). */
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

/** A stable 32-bit seed for a string (the campaign id): the same search draws the same field. */
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export interface FieldBudget { nodes: number; motes: number; pulses: number; trail: number }

/** What a surface can afford: scales with area, trimmed on low-power devices and phones. */
export function particleBudget(widthCss: number, heightCss: number, lowPower = false): FieldBudget {
  const area = Math.max(1, widthCss * heightCss);
  const k = lowPower ? 0.55 : 1;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
  return {
    nodes: clamp((area / 2100) * k, 26, lowPower ? 70 : 120),
    motes: clamp((area / 1900) * k, 16, lowPower ? 60 : 130),
    pulses: lowPower ? 5 : 10,
    trail: lowPower ? 22 : 34,
  };
}

export interface FieldNode { x: number; y: number; r: number; phase: number; glow: number }
export interface FieldEdge { a: number; b: number; born: number; dying: number | null }
export interface Pulse { from: number; to: number; t: number; speed: number }
export interface Mote { x: number; y: number; z: number; phase: number }
export interface Head { from: number; to: number; t: number; speed: number }

export interface Field {
  /** Field units: x in [0, aspect], y in [0, 1]. */
  aspect: number;
  nodes: FieldNode[];
  edges: FieldEdge[];
  head: Head;
  /** The snake's body, newest point first. */
  trail: Array<{ x: number; y: number }>;
  pulses: Pulse[];
  motes: Mote[];
  /** Recently visited nodes, newest last — the head avoids walking straight back. */
  recent: number[];
  time: number;
  nextRewire: number;
  budget: FieldBudget;
  rand: () => number;
}

const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

function nearest(nodes: FieldNode[], i: number, k: number): number[] {
  return nodes.map((n, j) => [j, dist2(nodes[i], n)] as const).filter(([j]) => j !== i)
    .sort((p, q) => p[1] - q[1]).slice(0, k).map(([j]) => j);
}

const hasEdge = (f: Field, a: number, b: number) => f.edges.some((e) => e.dying == null && ((e.a === a && e.b === b) || (e.a === b && e.b === a)));
export const neighbours = (f: Field, i: number): number[] =>
  f.edges.filter((e) => e.dying == null && (e.a === i || e.b === i)).map((e) => (e.a === i ? e.b : e.a));

/** A jittered grid of nodes, each joined to its nearest few: one large connected-looking network. */
export function buildField(seed: number, aspect: number, budget: FieldBudget): Field {
  const rand = seeded(seed);
  const a = Math.max(0.6, Math.min(6, aspect));
  const rows = Math.max(3, Math.round(Math.sqrt(budget.nodes / a)));
  const cols = Math.max(3, Math.round(budget.nodes / rows));
  const nodes: FieldNode[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = ((c + 0.5 + (rand() - 0.5) * 0.85) / cols) * a;
      const y = (r + 0.5 + (rand() - 0.5) * 0.85) / rows;
      nodes.push({ x: Math.max(0.01, Math.min(a - 0.01, x)), y: Math.max(0.03, Math.min(0.97, y)), r: 0.6 + rand() * 1.1, phase: rand() * Math.PI * 2, glow: 0 });
    }
  }
  const f: Field = {
    aspect: a, nodes, edges: [], head: { from: 0, to: 0, t: 1, speed: 1.6 }, trail: [], pulses: [], motes: [], recent: [],
    time: 0, nextRewire: 1.2, budget, rand,
  };
  for (let i = 0; i < nodes.length; i += 1) {
    for (const j of nearest(nodes, i, 3)) if (!hasEdge(f, i, j)) f.edges.push({ a: i, b: j, born: -10, dying: null });
  }
  const start = Math.floor(rand() * nodes.length);
  f.head = { from: start, to: nextNode(f, start), t: 0, speed: 1.4 + rand() * 0.6 };
  const p = nodes[start];
  for (let i = 0; i < budget.trail; i += 1) f.trail.push({ x: p.x, y: p.y });
  for (let i = 0; i < budget.motes; i += 1) f.motes.push({ x: rand() * a, y: rand(), z: 0.3 + rand() * 0.7, phase: rand() * Math.PI * 2 });
  return f;
}

/** The head's next node: a neighbour it has not just visited, chosen by the seeded PRNG. */
function nextNode(f: Field, at: number): number {
  const options = neighbours(f, at);
  if (options.length === 0) return nearest(f.nodes, at, 1)[0] ?? at;
  const fresh = options.filter((n) => !f.recent.includes(n));
  const pool = fresh.length ? fresh : options;
  return pool[Math.floor(f.rand() * pool.length) % pool.length];
}

export function headPosition(f: Field): { x: number; y: number } {
  const a = f.nodes[f.head.from]; const b = f.nodes[f.head.to];
  const t = f.head.t;
  /* A gentle sideways sway, so the head reads as a living search, not a cursor. */
  const sway = Math.sin(t * Math.PI) * 0.018 * Math.sin(f.time * 2.1);
  const nx = -(b.y - a.y); const ny = b.x - a.x;
  const len = Math.hypot(nx, ny) || 1;
  return { x: a.x + (b.x - a.x) * t + (nx / len) * sway, y: a.y + (b.y - a.y) * t + (ny / len) * sway };
}

/** Swap one path for a new one nearby: the network keeps reconnecting while it is searched. */
function rewire(f: Field): void {
  const i = Math.floor(f.rand() * f.nodes.length);
  const mine = f.edges.filter((e) => e.dying == null && (e.a === i || e.b === i));
  if (mine.length > 2) {
    const victim = mine[Math.floor(f.rand() * mine.length)];
    const other = victim.a === i ? victim.b : victim.a;
    if (neighbours(f, other).length > 2) victim.dying = f.time;
  }
  const near = nearest(f.nodes, i, 7).filter((j) => !hasEdge(f, i, j));
  if (near.length) f.edges.push({ a: i, b: near[Math.floor(f.rand() * near.length)], born: f.time, dying: null });
}

const EDGE_FADE = 1.6;

/**
 * Advance the field by `dt` seconds at `intensity` (0 = nothing moves). The
 * head walks edge to edge; on each arrival it lights the node and may branch
 * pulses down other paths; paths fade out and reconnect; particles drift.
 */
export function stepField(f: Field, dt: number, intensity: number): void {
  const k = Math.max(0, Math.min(1, intensity));
  if (k === 0 || dt <= 0) return;
  const step = Math.min(dt, 0.05) * k;
  f.time += step;

  /* the head */
  const a = f.nodes[f.head.from]; const b = f.nodes[f.head.to];
  const len = Math.max(0.02, Math.sqrt(dist2(a, b)));
  f.head.t += (step * f.head.speed * 0.16) / len;
  while (f.head.t >= 1) {
    const arrived = f.head.to;
    f.nodes[arrived].glow = 1;
    f.recent.push(arrived);
    if (f.recent.length > 6) f.recent.shift();
    /* branching: a pulse runs ahead down other paths from where the head arrived */
    for (const n of neighbours(f, arrived)) {
      if (f.pulses.length >= f.budget.pulses) break;
      if (n !== f.head.from && f.rand() < 0.42 * k + 0.08) f.pulses.push({ from: arrived, to: n, t: 0, speed: 0.7 + f.rand() * 0.8 });
    }
    f.head = { from: arrived, to: nextNode(f, arrived), t: f.head.t - 1, speed: 1.3 + f.rand() * 0.7 };
  }
  const h = headPosition(f);
  f.trail.unshift(h);
  if (f.trail.length > f.budget.trail) f.trail.length = f.budget.trail;

  /* pulses: travel, light their target, sometimes branch once more */
  for (const p of f.pulses) p.t += step * p.speed;
  const landed = f.pulses.filter((p) => p.t >= 1);
  f.pulses = f.pulses.filter((p) => p.t < 1);
  for (const p of landed) {
    f.nodes[p.to].glow = Math.max(f.nodes[p.to].glow, 0.65);
    if (f.pulses.length < f.budget.pulses && f.rand() < 0.3) {
      const onward = neighbours(f, p.to).filter((n) => n !== p.from);
      if (onward.length) f.pulses.push({ from: p.to, to: onward[Math.floor(f.rand() * onward.length)], t: 0, speed: 0.6 + f.rand() * 0.6 });
    }
  }

  /* glow decays; edges reconnect */
  for (const n of f.nodes) n.glow = Math.max(0, n.glow - step * 0.45);
  if (f.time >= f.nextRewire) {
    rewire(f);
    f.nextRewire = f.time + 0.9 + f.rand() * 1.4;
  }
  f.edges = f.edges.filter((e) => e.dying == null || f.time - e.dying < EDGE_FADE);

  /* motes drift on a slow flow field, with depth parallax, and wrap */
  for (const m of f.motes) {
    m.x += Math.cos(m.y * 5.3 + f.time * 0.4 + m.phase) * step * 0.022 * m.z + step * 0.012 * m.z;
    m.y += Math.sin(m.x * 4.1 + f.time * 0.3) * step * 0.016 * m.z;
    if (m.x > f.aspect) m.x -= f.aspect; else if (m.x < 0) m.x += f.aspect;
    if (m.y > 1) m.y -= 1; else if (m.y < 0) m.y += 1;
  }
}

/** 0..1 visibility of a path (fading in when new, out when retired). */
export function edgeAlpha(f: Field, e: FieldEdge): number {
  if (e.dying != null) return Math.max(0, 1 - (f.time - e.dying) / EDGE_FADE);
  return Math.max(0, Math.min(1, (f.time - e.born) / EDGE_FADE));
}

/** Warm the field up so a reduced-motion still frame shows a composed scene, not a cold start. */
export function settle(f: Field, seconds = 6): void {
  for (let t = 0; t < seconds; t += 0.05) stepField(f, 0.05, 1);
}

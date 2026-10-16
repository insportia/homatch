/*
 * Find Property — THE SEARCH FIELD (motion engine, framework-free, no DOM).
 *
 * A calm picture of a search under way: a gold search head travels through a
 * field of listings, leaving a fading path; branches reach out from it to
 * nearby listings, light them, and fade; lit listings sometimes reconnect to
 * each other. Dust drifts on a slow flow field.
 *
 * WHAT IT SHOWS IS REAL — AND ONLY THAT
 *
 * The motion has exactly two states, both from the server: SEARCHING (the
 * search is not terminal) and SETTLED (it is). Nothing here counts, measures
 * or names a source. The number of nodes is a function of the canvas size,
 * not of results; a lit node is decoration, not a listing found. There is no
 * percentage, no countdown and no Math.random: every field is seeded, so a
 * remount draws the same picture.
 */

export type FieldMode = 'SEARCHING' | 'SETTLED';
export interface Point { x: number; y: number }
export interface FieldNode extends Point { r: number; phase: number; glow: number }
export interface Branch { from: Point; ctrl: Point; to: number; via: number | null; progress: number; speed: number; fade: number }
export interface Particle extends Point { vx: number; vy: number; size: number; alpha: number; phase: number }
export interface Budget { nodes: number; particles: number; branches: number; trail: number; fps: number }
export interface FieldState {
  rand: () => number;
  w: number; h: number; time: number; mode: FieldMode;
  head: Point & { angle: number; speed: number; target: number | null };
  trail: Point[];
  nodes: FieldNode[];
  branches: Branch[];
  particles: Particle[];
  budget: Budget;
  nextBranchIn: number;
}

/** mulberry32 — small, fast, seeded. */
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

/** A stable seed from a search id, so one search always draws its own field. */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** How much the field may draw: by area, and much less on low-power devices. */
export function budgetFor(w: number, h: number, lowPower: boolean): Budget {
  const area = Math.max(1, w * h);
  const k = lowPower ? 0.55 : 1;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
  return {
    nodes: clamp((area / 5200) * k, 10, lowPower ? 34 : 64),
    particles: clamp((area / 2600) * k, 12, lowPower ? 60 : 140),
    branches: lowPower ? 3 : 5,
    trail: lowPower ? 70 : 120,
    fps: lowPower ? 30 : 60,
  };
}

export function createField(seed: number, w: number, h: number, budget: Budget, mode: FieldMode = 'SEARCHING'): FieldState {
  const rand = seeded(seed);
  const pad = Math.min(w, h) * 0.08;
  const nodes: FieldNode[] = Array.from({ length: budget.nodes }, () => ({
    x: pad + rand() * (w - 2 * pad), y: pad + rand() * (h - 2 * pad),
    r: 1.2 + rand() * 1.8, phase: rand() * Math.PI * 2, glow: 0,
  }));
  const particles: Particle[] = Array.from({ length: budget.particles }, () => ({
    x: rand() * w, y: rand() * h, vx: 0, vy: 0, size: 0.4 + rand() * 1.1, alpha: 0.08 + rand() * 0.22, phase: rand() * Math.PI * 2,
  }));
  const head = { x: w * (0.2 + rand() * 0.6), y: h * (0.3 + rand() * 0.4), angle: rand() * Math.PI * 2, speed: Math.max(40, Math.min(w, 900) * 0.11), target: null };
  return { rand, w, h, time: 0, mode, head, trail: [{ x: head.x, y: head.y }], nodes, branches: [], particles, budget, nextBranchIn: 0.4 };
}

/** Keep the field when the canvas changes size: positions scale, nothing restarts. */
export function resizeField(s: FieldState, w: number, h: number): void {
  if (w <= 0 || h <= 0 || (w === s.w && h === s.h)) return;
  const sx = w / s.w, sy = h / s.h;
  const scale = (p: Point) => { p.x *= sx; p.y *= sy; };
  s.nodes.forEach(scale); s.particles.forEach(scale); s.trail.forEach(scale); scale(s.head);
  for (const b of s.branches) { scale(b.from); scale(b.ctrl); }
  s.w = w; s.h = h;
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function nearestDark(s: FieldState, from: Point, exclude: number | null): number | null {
  let best: number | null = null, bestD = Infinity;
  const reach = Math.max(s.w, s.h) * 0.45;
  for (let i = 0; i < s.nodes.length; i++) {
    if (i === exclude) continue;
    const n = s.nodes[i];
    const d = Math.hypot(n.x - from.x, n.y - from.y) * (0.7 + n.glow * 2) * (0.85 + s.rand() * 0.3);
    if (d < bestD && d < reach) { bestD = d; best = i; }
  }
  return best;
}

/** One step of dt seconds. Mutates the state; uses only its own seeded generator. */
export function stepField(s: FieldState, dtRaw: number): void {
  const dt = Math.max(0, Math.min(dtRaw, 0.05));
  s.time += dt;
  const searching = s.mode === 'SEARCHING';
  const head = s.head;

  // The head: a slow wander, drawn toward a listing, turned back from the edges. Settled: it comes to rest.
  head.speed += ((searching ? Math.max(40, Math.min(s.w, 900) * 0.11) : 0) - head.speed) * Math.min(1, dt * 1.6);
  if (searching) {
    if (head.target === null || s.rand() < dt * 0.25) head.target = nearestDark(s, head, head.target);
    let desired = head.angle + Math.sin(s.time * 0.9 + head.x * 0.01) * 0.9;
    if (head.target !== null) {
      const n = s.nodes[head.target];
      const toward = Math.atan2(n.y - head.y, n.x - head.x);
      desired = toward + Math.sin(s.time * 1.7) * 0.5;
      if (Math.hypot(n.x - head.x, n.y - head.y) < 14) { n.glow = 1; head.target = null; }
    }
    const margin = Math.min(s.w, s.h) * 0.1;
    if (head.x < margin || head.x > s.w - margin || head.y < margin || head.y > s.h - margin) desired = Math.atan2(s.h / 2 - head.y, s.w / 2 - head.x);
    head.angle += wrapAngle(desired - head.angle) * Math.min(1, dt * 2.2);
  }
  head.x = Math.max(0, Math.min(s.w, head.x + Math.cos(head.angle) * head.speed * dt));
  head.y = Math.max(0, Math.min(s.h, head.y + Math.sin(head.angle) * head.speed * dt));
  const last = s.trail[s.trail.length - 1];
  if (!last || Math.hypot(head.x - last.x, head.y - last.y) > 3) s.trail.push({ x: head.x, y: head.y });
  const keep = searching ? s.budget.trail : Math.max(0, s.trail.length - 1);
  if (s.trail.length > keep && (searching || s.rand() < dt * 30)) s.trail.splice(0, s.trail.length - Math.max(keep, 1));

  // Branches reach from the head (or reconnect two lit listings), light the listing, then fade.
  s.nextBranchIn -= dt;
  if (searching && s.nextBranchIn <= 0 && s.branches.length < s.budget.branches) {
    const lit = s.nodes.map((n, i) => [n, i] as const).filter(([n]) => n.glow > 0.35);
    const reconnect = lit.length >= 2 && s.rand() < 0.35;
    const fromIndex = reconnect ? lit[Math.floor(s.rand() * lit.length)][1] : null;
    const from = fromIndex !== null ? { x: s.nodes[fromIndex].x, y: s.nodes[fromIndex].y } : { x: head.x, y: head.y };
    const to = nearestDark(s, from, fromIndex);
    if (to !== null) {
      const n = s.nodes[to];
      const mx = (from.x + n.x) / 2, my = (from.y + n.y) / 2;
      const bend = (s.rand() - 0.5) * Math.hypot(n.x - from.x, n.y - from.y) * 0.7;
      const ang = Math.atan2(n.y - from.y, n.x - from.x) + Math.PI / 2;
      s.branches.push({ from, ctrl: { x: mx + Math.cos(ang) * bend, y: my + Math.sin(ang) * bend }, to, via: fromIndex, progress: 0, speed: 0.7 + s.rand() * 0.6, fade: 1 });
    }
    s.nextBranchIn = 0.35 + s.rand() * 0.9;
  }
  for (const b of s.branches) {
    if (b.progress < 1) {
      b.progress = Math.min(1, b.progress + b.speed * dt);
      if (b.progress >= 1) s.nodes[b.to].glow = 1;
    } else b.fade -= dt * (searching ? 0.45 : 0.9);
  }
  s.branches = s.branches.filter((b) => b.fade > 0);

  for (const n of s.nodes) n.glow = Math.max(searching ? 0 : Math.min(n.glow, 0.25), n.glow - dt * (searching ? 0.12 : 0.3));

  // Dust on a slow flow field; it wraps at the edges.
  const flow = searching ? 1 : 0.35;
  for (const p of s.particles) {
    const a = Math.sin(p.y * 0.012 + s.time * 0.3 + p.phase) + Math.cos(p.x * 0.009 - s.time * 0.2);
    p.vx += (Math.cos(a) * 9 * flow - p.vx) * Math.min(1, dt * 1.2);
    p.vy += (Math.sin(a) * 6 * flow - p.vy) * Math.min(1, dt * 1.2);
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.x < -4) p.x += s.w + 8; else if (p.x > s.w + 4) p.x -= s.w + 8;
    if (p.y < -4) p.y += s.h + 8; else if (p.y > s.h + 4) p.y -= s.h + 8;
  }
}

export function setMode(s: FieldState, mode: FieldMode): void { s.mode = mode; }

/** A composed still picture for reduced motion: the same field, advanced deterministically. */
export function stillField(seed: number, w: number, h: number, budget: Budget, mode: FieldMode): FieldState {
  const s = createField(seed, w, h, budget, 'SEARCHING');
  for (let i = 0; i < 180; i++) stepField(s, 1 / 30);
  if (mode === 'SETTLED') { setMode(s, 'SETTLED'); for (let i = 0; i < 60; i++) stepField(s, 1 / 30); }
  return s;
}

/** A point on the quadratic curve of a branch. */
export function along(b: Branch, to: Point, u: number): Point {
  const v = 1 - u;
  return { x: v * v * b.from.x + 2 * v * u * b.ctrl.x + u * u * to.x, y: v * v * b.from.y + 2 * v * u * b.ctrl.y + u * u * to.y };
}

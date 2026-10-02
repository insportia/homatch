// Test-only: draws synthetic floor plans (in metres) into grey rasters, and
// writes the "model reading" of them the way a vision model gets them wrong:
// walls a few pixels off, openings at their wall's end (ds-read-1) or near
// their centre (ds-read-2), room outlines sketched. Seeded, so deterministic.

export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A plan in metres. walls: { id, a:[x,y], b:[x,y], ext }. openings:
 * { id, wall, at (m from a), width, kind: 'DOOR'|'WINDOW' }. rooms:
 * { id, label, kind, poly:[[x,y]...], dims: '3.40 x 4.20' | null }.
 * stairs: { box:[x0,y0,x1,y1], treads, vertical }. tiles: { box, step }.
 */
export function render(plan, opts = {}) {
  const mpp = opts.mpp ?? 0.01;
  const margin = opts.marginPx ?? 80;
  const angle = ((opts.angleDeg ?? 0) * Math.PI) / 180;
  const T = (opts.thicknessM ?? 0.2) / mpp;
  const style = opts.style ?? 'solid';
  const xs = plan.walls.flatMap((w) => [w.a[0], w.b[0]]);
  const ys = plan.walls.flatMap((w) => [w.a[1], w.b[1]]);
  const wM = Math.max(...xs) - Math.min(...xs);
  const hM = Math.max(...ys) - Math.min(...ys);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const diag = Math.hypot(wM, hM) / mpp;
  const width = Math.ceil((angle ? diag : wM / mpp) + 2 * margin);
  const height = Math.ceil((angle ? diag : hM / mpp) + 2 * margin);
  const toPx = (p) => {
    const x = (p[0] - cx) / mpp;
    const y = (p[1] - cy) / mpp;
    return { x: width / 2 + x * Math.cos(angle) - y * Math.sin(angle), y: height / 2 + x * Math.sin(angle) + y * Math.cos(angle) };
  };
  const data = new Uint8Array(width * height).fill(255);
  const seg = (a, b, half, value) => {
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - half - 1));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x) + half + 1));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - half - 1));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y) + half + 1));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        let t = ((x - a.x) * dx + (y - a.y) * dy) / l2;
        if (t < 0 || t > 1) continue;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
        if (d <= half) data[y * width + x] = Math.min(data[y * width + x], value);
      }
    }
  };
  const along = (w, m) => {
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    return [w.a[0] + ((w.b[0] - w.a[0]) * m) / L, w.a[1] + ((w.b[1] - w.a[1]) * m) / L];
  };
  for (const w of plan.walls) {
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const holes = plan.openings.filter((o) => o.wall === w.id).map((o) => [o.at - o.width / 2, o.at + o.width / 2]).sort((p, q) => p[0] - q[0]);
    // Extend each wall by half a thickness so corners close.
    const ext = (opts.thicknessM ?? 0.2) / 2;
    const pieces = [];
    let cur = -ext;
    for (const [h0, h1] of holes) { if (h0 > cur) pieces.push([cur, h0]); cur = Math.max(cur, h1); }
    if (cur < L + ext) pieces.push([cur, L + ext]);
    for (const [m0, m1] of pieces) {
      const a = toPx(along(w, m0));
      const b = toPx(along(w, m1));
      if (style === 'solid') seg(a, b, T / 2, 20);
      else {
        // Hollow: two face lines, light hatch inside.
        const ux = (b.x - a.x) / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
        const uy = (b.y - a.y) / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
        const n = { x: -uy, y: ux };
        for (const s of [-1, 1]) seg({ x: a.x + n.x * s * T / 2, y: a.y + n.y * s * T / 2 }, { x: b.x + n.x * s * T / 2, y: b.y + n.y * s * T / 2 }, 0.9, 30);
        seg(a, a, T / 2, 30);
        seg(b, b, T / 2, 30);
      }
    }
    for (const o of plan.openings.filter((q) => q.wall === w.id && q.kind === 'WINDOW')) {
      const a = toPx(along(w, o.at - o.width / 2));
      const b = toPx(along(w, o.at + o.width / 2));
      const ux = (b.x - a.x) / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
      const uy = (b.y - a.y) / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
      const n = { x: -uy, y: ux };
      // Frame lines on the faces (grey) and two glazing lines in the middle (dark).
      for (const s of [-1, 1]) seg({ x: a.x + n.x * s * T / 2, y: a.y + n.y * s * T / 2 }, { x: b.x + n.x * s * T / 2, y: b.y + n.y * s * T / 2 }, 0.6, 130);
      for (const s of [-0.12, 0.12]) seg({ x: a.x + n.x * s * T, y: a.y + n.y * s * T }, { x: b.x + n.x * s * T, y: b.y + n.y * s * T }, 0.7, 60);
    }
  }
  for (const st of plan.stairs ?? []) {
    const [x0, y0, x1, y1] = st.box;
    for (let k = 0; k <= st.treads; k += 1) {
      if (st.vertical) {
        const x = x0 + ((x1 - x0) * k) / st.treads;
        seg(toPx([x, y0]), toPx([x, y1]), 0.6, 200);
      } else {
        const y = y0 + ((y1 - y0) * k) / st.treads;
        seg(toPx([x0, y]), toPx([x1, y]), 0.6, 200);
      }
    }
  }
  for (const tl of plan.tiles ?? []) {
    const [x0, y0, x1, y1] = tl.box;
    for (let x = x0; x <= x1 + 1e-9; x += tl.step) seg(toPx([x, y0]), toPx([x, y1]), 0.5, 205);
    for (let y = y0; y <= y1 + 1e-9; y += tl.step) seg(toPx([x0, y]), toPx([x1, y]), 0.5, 205);
  }
  if (opts.noise) {
    const rand = rng(opts.seed ?? 7);
    for (let i = 0; i < data.length; i += 1) {
      let v = data[i] + (rand() - 0.5) * 2 * opts.noise * 40;
      if (rand() < opts.noise * 0.02) v = rand() < 0.5 ? 40 : 255;
      data[i] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return { gray: { width, height, data }, toPx, mpp, T };
}

/** The model's reading of a rendered plan: right about what, approximate about where. */
export function reading(plan, r, opts = {}) {
  const rand = rng(opts.seed ?? 3);
  const jit = (v) => v + (rand() - 0.5) * 2 * (opts.jitterPx ?? 5);
  const P = (p) => { const q = r.toPx(p); return { x: jit(q.x), y: jit(q.y) }; };
  const walls = plan.walls.filter((w) => !(opts.omitWalls ?? []).includes(w.id)).map((w) => {
    const off = (rand() - 0.5) * 2 * (opts.wallOffsetPx ?? 4);
    const a = r.toPx(w.a);
    const b = r.toPx(w.b);
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const n = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
    return {
      id: w.id, kind: w.ext ? 'EXTERIOR' : 'INTERIOR', start: { x: a.x + n.x * off, y: a.y + n.y * off }, end: { x: b.x + n.x * off, y: b.y + n.y * off },
      thicknessPx: Math.round(r.T), confidence: 0.9, state: 'UNVERIFIED',
    };
  });
  const along = (w, m) => {
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    return [w.a[0] + ((w.b[0] - w.a[0]) * m) / L, w.a[1] + ((w.b[1] - w.a[1]) * m) / L];
  };
  const openings = plan.openings.map((o, k) => {
    const w = plan.walls.find((x) => x.id === o.wall);
    const mode = opts.openings ?? 'center';
    const centre = r.toPx(along(w, o.at));
    return {
      id: o.id, wallId: o.wall, widthPx: Math.round((o.width / r.mpp) * (0.8 + 0.4 * rand())),
      position: mode === 'ends' ? k % 2 : Math.max(0, Math.min(1, o.at / Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]))),
      centerPx: mode === 'center' ? { x: jit(centre.x), y: jit(centre.y) } : null,
      confidence: 0.85, state: 'UNVERIFIED', _kind: o.kind,
    };
  });
  const rooms = plan.rooms.map((rm) => ({
    id: rm.id, kind: rm.modelKind ?? 'UNKNOWN', label: rm.label, polygon: rm.poly.map(P), statedAreaM2: null,
    dimensionText: opts.noDims ? null : rm.dims ?? null, confidence: 0.85, state: 'UNVERIFIED',
  }));
  const strip = ({ _kind, ...o }) => o;
  const doc = {
    sourceAssetId: 'synthetic', imageWidth: r.gray.width, imageHeight: r.gray.height,
    detectedScale: null, scaleConfidence: 0, ceilingHeight: null, ceilingHeightSource: null,
    walls, doors: openings.filter((o) => o._kind === 'DOOR').map(strip), windows: openings.filter((o) => o._kind === 'WINDOW').map(strip),
    rooms: rooms.filter((x) => !['BALCONY', 'TERRACE'].includes(plan.rooms.find((p) => p.id === x.id).modelKind)),
    balconies: rooms.filter((x) => ['BALCONY', 'TERRACE'].includes(plan.rooms.find((p) => p.id === x.id).modelKind)),
    unknownElements: [], warnings: [], extractionConfidence: 0.85,
    stairs: [], texts: [], ignored: [], footprint: null, northDeg: null,
  };
  const dimensionStrings = opts.noDims ? [] : (plan.overall ?? []).map((d) => ({
    valueM: d.valueM, text: d.text, from: r.toPx(d.from), to: r.toPx(d.to), confidence: 0.95, evidence: null,
  }));
  return { doc, dimensionStrings };
}

/**
 * A 9.0 × 7.0 m flat: living (5.0 × 7.0 incl. hall), two bedrooms, a bath,
 * metric sizes printed. Interior faces: walls are 0.2 m thick on centrelines.
 */
export function flat() {
  const walls = [
    { id: 'E1', a: [0, 0], b: [9, 0], ext: true },
    { id: 'E2', a: [9, 0], b: [9, 7], ext: true },
    { id: 'E3', a: [9, 7], b: [0, 7], ext: true },
    { id: 'E4', a: [0, 7], b: [0, 0], ext: true },
    { id: 'I1', a: [5, 0], b: [5, 7], ext: false },
    { id: 'I2', a: [5, 3.6], b: [9, 3.6], ext: false },
    { id: 'I3', a: [0, 4.8], b: [5, 4.8], ext: false },
    { id: 'I4', a: [2.6, 4.8], b: [2.6, 7], ext: false },
  ];
  const openings = [
    { id: 'D1', wall: 'E3', at: 5.2, width: 0.9, kind: 'DOOR' }, // the entrance, into the hall (x = 3.8)
    { id: 'D2', wall: 'I1', at: 1.6, width: 0.8, kind: 'DOOR' },
    { id: 'D3', wall: 'I1', at: 5.4, width: 0.8, kind: 'DOOR' },
    { id: 'D4', wall: 'I3', at: 3.8, width: 0.8, kind: 'DOOR' },
    { id: 'D5', wall: 'I4', at: 1.2, width: 0.7, kind: 'DOOR' },
    { id: 'W1', wall: 'E1', at: 2.5, width: 1.4, kind: 'WINDOW' },
    { id: 'W2', wall: 'E1', at: 7.0, width: 1.2, kind: 'WINDOW' },
    { id: 'W3', wall: 'E2', at: 5.3, width: 1.2, kind: 'WINDOW' },
    { id: 'W4', wall: 'E4', at: 1.2, width: 1.0, kind: 'WINDOW' },
  ];
  // Clear inner sizes (centreline minus one thickness).
  const rooms = [
    { id: 'R1', label: 'LIVING ROOM', poly: [[0.1, 0.1], [4.9, 0.1], [4.9, 4.7], [0.1, 4.7]], dims: '4.80 x 4.60' },
    { id: 'R2', label: 'BEDROOM', poly: [[5.1, 0.1], [8.9, 0.1], [8.9, 3.5], [5.1, 3.5]], dims: '3.80 x 3.40' },
    { id: 'R3', label: 'BEDROOM 2', poly: [[5.1, 3.7], [8.9, 3.7], [8.9, 6.9], [5.1, 6.9]], dims: '3,80 × 3,20' },
    { id: 'R4', label: 'HALL', poly: [[2.7, 4.9], [4.9, 4.9], [4.9, 6.9], [2.7, 6.9]], dims: '2.20 x 2.00' },
    { id: 'R5', label: 'BATHROOM', poly: [[0.1, 4.9], [2.5, 4.9], [2.5, 6.9], [0.1, 6.9]], dims: '2.40 x 2.00' },
  ];
  const overall = [
    { text: '9.20', valueM: 9.2, from: [-0.1, -0.6], to: [9.1, -0.6] },
    { text: '7.20', valueM: 7.2, from: [-0.6, -0.1], to: [-0.6, 7.1] },
  ];
  return { walls, openings, rooms, overall, stairs: [], tiles: [] };
}

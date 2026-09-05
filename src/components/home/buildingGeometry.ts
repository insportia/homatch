// Shared axonometric geometry for the PropertyDigitalTwin illustration.
// Pure math + constants — no rendering, so both the desktop (scroll-linked)
// and mobile (timed) variants draw from the exact same building.

const COS30 = Math.sqrt(3) / 2; // 0.8660
const SIN30 = 0.5;

export interface IsoFaces {
  /** Top face — the lightest tint. */
  top: string;
  /** Left face — mid tint. */
  left: string;
  /** Right face — darkest tint. */
  right: string;
  /** Screen-space center of the block, for transform-origin. */
  center: { x: number; y: number };
}

/** Builds the 3 visible faces of an axonometric box.
 *  (cx, y0) is the back-top corner (the "apex" of the top diamond). */
export function isoBox(cx: number, y0: number, w: number, h: number): IsoFaces {
  const apex = { x: cx, y: y0 };
  const right = { x: cx + COS30 * w, y: y0 + SIN30 * w };
  const nadir = { x: cx, y: y0 + w };
  const left = { x: cx - COS30 * w, y: y0 + SIN30 * w };

  const apexB = { x: apex.x, y: apex.y + h };
  const rightB = { x: right.x, y: right.y + h };
  const nadirB = { x: nadir.x, y: nadir.y + h };
  const leftB = { x: left.x, y: left.y + h };

  const pts = (p: { x: number; y: number }[]) => p.map(v => `${v.x.toFixed(1)},${v.y.toFixed(1)}`).join(' ');

  return {
    top: pts([apex, right, nadir, left]),
    left: pts([left, nadir, nadirB, leftB]),
    right: pts([nadir, right, rightB, nadirB]),
    center: { x: cx, y: y0 + w / 2 + h / 2 },
  };
}

export type LayerKey = 'foundation' | 'floor1' | 'floor2' | 'floor3' | 'roof';

export const LAYER_ORDER: LayerKey[] = ['foundation', 'floor1', 'floor2', 'floor3', 'roof'];

export const VIEW = { w: 600, h: 700 };
const CX = 300;

// Dimensions per layer: footprint half-extent (w) and extrusion height (h).
const DIMS: Record<LayerKey, { w: number; h: number }> = {
  foundation: { w: 150, h: 16 },
  floor1: { w: 92, h: 58 },
  floor2: { w: 92, h: 58 },
  floor3: { w: 92, h: 58 },
  roof: { w: 60, h: 34 },
};

// Stack bottom → top; each block's apex sits `h` above the block beneath it.
function buildStack() {
  const order: LayerKey[] = ['foundation', 'floor1', 'floor2', 'floor3', 'roof'];
  let y0 = 360; // foundation apex
  const faces: Record<LayerKey, IsoFaces> = {} as any;
  for (const key of order) {
    const { w, h } = DIMS[key];
    faces[key] = isoBox(CX, y0, w, h);
    y0 -= h; // next block's bottom touches this apex
  }
  return faces;
}

export const INTACT_FACES = buildStack();

// Uniform exploded-view spacing around floor2 (the visual center).
const GAP = 52;
const CENTER_INDEX = LAYER_ORDER.indexOf('floor2');

export const EXPLODE_OFFSET: Record<LayerKey, { ty: number; tx: number; rot: number }> = {
  foundation: { ty: (CENTER_INDEX - 0) * GAP, tx: 0, rot: 0 },
  floor1: { ty: (CENTER_INDEX - 1) * GAP, tx: -16, rot: -1.4 },
  floor2: { ty: (CENTER_INDEX - 2) * GAP, tx: 18, rot: 1.2 },
  floor3: { ty: (CENTER_INDEX - 3) * GAP, tx: -16, rot: -1.2 },
  roof: { ty: (CENTER_INDEX - 4) * GAP, tx: 14, rot: 1.4 },
};

// Which side each intelligence node sits on relative to its layer, purely
// for a pleasant left/right zig-zag composition.
export const NODE_SIDE: Record<LayerKey, 'left' | 'right'> = {
  foundation: 'right',
  floor1: 'left',
  floor2: 'right',
  floor3: 'left',
  roof: 'right',
};

/** Scan line travels from just above the roof to just below the foundation. */
export const SCAN_RANGE = { top: 130, bottom: 470 };

const STUB_LEN = 118;

/** Percentage-of-viewBox anchor for each layer's HTML intelligence chip —
 *  matches the end of the SVG signal stub drawn in BuildingIllustration. */
export const NODE_ANCHOR: Record<LayerKey, { leftPct: number; topPct: number }> = (() => {
  const out = {} as Record<LayerKey, { leftPct: number; topPct: number }>;
  for (const key of LAYER_ORDER) {
    const f = INTACT_FACES[key];
    const off = EXPLODE_OFFSET[key];
    const dir = NODE_SIDE[key] === 'right' ? 1 : -1;
    const x = f.center.x + off.tx + dir * STUB_LEN;
    const y = f.center.y + off.ty;
    out[key] = { leftPct: (x / VIEW.w) * 100, topPct: (y / VIEW.h) * 100 };
  }
  return out;
})();

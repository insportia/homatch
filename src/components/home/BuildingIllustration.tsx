import React from 'react';
import { motion, type MotionValue } from 'motion/react';
import { INTACT_FACES, EXPLODE_OFFSET, NODE_SIDE, LAYER_ORDER, VIEW, type LayerKey } from './buildingGeometry';

type Num = MotionValue<number> | number;

export interface LayerMotionValues {
  x: Num;
  y: Num;
  rotate: Num;
}

interface BuildingIllustrationProps {
  layerMotion: Record<LayerKey, LayerMotionValues>;
  scanOpacity: Num;
  scanY: Num;
  connectorsOpacity: Num;
  glowOpacity: Num;
  /** Subtle always-on idle float (disabled under prefers-reduced-motion). */
  ambient?: boolean;
  className?: string;
  /**
   * false (default, desktop): x/y/rotate/opacity are MotionValues bound
   * live to scroll progress via `style` — no added easing, so the building
   * tracks the scrollbar 1:1.
   * true (mobile): plain numbers that change per discrete timed phase —
   * bound via `animate` so motion tweens smoothly between phases instead
   * of snapping.
   */
  animated?: boolean;
}

const PHASE_TRANSITION = { duration: 0.9, ease: [0.22, 1, 0.36, 1] as const };

// Graphite + amber palette lifted straight from the design tokens in
// index.css (hsl(222 * ) for the structure, hsl(38 92% 55%) amber for the
// intelligence accents) — no new colors introduced.
// NOTE: these are set as raw SVG presentation attributes (fill=/stroke=),
// not via `style`, so they go through the SVG attribute color grammar
// rather than the CSS4 parser — that grammar doesn't accept the modern
// space-separated hsl(H S% L%) form used elsewhere in this codebase (e.g.
// index.css, which is real CSS). An unparseable fill/stroke silently falls
// back to its SVG initial value (fill: black, stroke: none), which is
// exactly the "invisible black building" bug this comma syntax fixes.
const FACE = {
  top: 'hsl(222, 16%, 24%)',
  topRoof: 'hsl(38, 45%, 30%)',
  left: 'hsl(222, 20%, 15%)',
  right: 'hsl(222, 24%, 10%)',
  stroke: 'hsla(38, 60%, 55%, 0.35)',
};

function Layer({ id, x, y, rotate, roof, animated }: { id: LayerKey; x: Num; y: Num; rotate: Num; roof?: boolean; animated?: boolean }) {
  const f = INTACT_FACES[id];
  const transformOrigin = `${f.center.x}px ${f.center.y}px`;
  const faces = (
    <>
      <polygon points={f.right} fill={FACE.right} stroke={FACE.stroke} strokeWidth={0.75} />
      <polygon points={f.left} fill={FACE.left} stroke={FACE.stroke} strokeWidth={0.75} />
      <polygon points={f.top} fill={roof ? FACE.topRoof : FACE.top} stroke={FACE.stroke} strokeWidth={0.75} />
    </>
  );
  if (animated) {
    return (
      <motion.g animate={{ x, y, rotate }} transition={PHASE_TRANSITION} style={{ transformOrigin }}>
        {faces}
      </motion.g>
    );
  }
  return (
    <motion.g style={{ x, y, rotate, transformOrigin }}>
      {faces}
    </motion.g>
  );
}

/** Static cadastral-style dashed grid clipped to the foundation's top face. */
function ParcelGrid() {
  const f = INTACT_FACES.foundation;
  const clipId = 'twin-parcel-clip';
  return (
    <g opacity={0.5}>
      <clipPath id={clipId}>
        <polygon points={f.top} />
      </clipPath>
      <g clipPath={`url(#${clipId})`} stroke="hsla(38, 70%, 55%, 0.28)" strokeWidth={1} strokeDasharray="3 4">
        {[-2, -1, 0, 1, 2].map(i => (
          <line key={`a${i}`} x1={f.center.x - 200 + i * 40} y1={f.center.y - 200} x2={f.center.x + 200 + i * 40} y2={f.center.y + 200} />
        ))}
      </g>
      <polygon points={f.top} fill="none" stroke="hsla(38, 80%, 60%, 0.5)" strokeWidth={1.2} strokeDasharray="5 5" />
    </g>
  );
}

export function BuildingIllustration({
  layerMotion, scanOpacity, scanY, connectorsOpacity, glowOpacity, ambient = true, className, animated = false,
}: BuildingIllustrationProps) {
  const connectorsProps = animated
    ? { animate: { opacity: connectorsOpacity }, transition: PHASE_TRANSITION }
    : { style: { opacity: connectorsOpacity } };
  const scanProps = animated
    ? { animate: { y: scanY, opacity: scanOpacity }, transition: PHASE_TRANSITION }
    : { style: { y: scanY, opacity: scanOpacity } };

  return (
    <div className={className} style={{ position: 'relative', width: '100%', aspectRatio: `${VIEW.w} / ${VIEW.h}`, overflow: 'hidden' }}>
      {/* Pre-blurred static glow image — only its opacity animates. */}
      <motion.div
        aria-hidden
        {...(animated ? { animate: { opacity: glowOpacity }, transition: PHASE_TRANSITION } : { style: { opacity: glowOpacity } })}
        style={{
          position: 'absolute', inset: '-15%', pointerEvents: 'none',
          background: 'radial-gradient(closest-side, hsl(38 92% 55% / 0.22), transparent 70%)',
          filter: 'blur(2px)',
          ...(animated ? {} : { opacity: glowOpacity as any }),
        }}
      />
      <motion.svg
        viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
        width="100%"
        height="100%"
        style={{ position: 'relative', overflow: 'visible' }}
        animate={ambient ? { y: [0, -6, 0] } : undefined}
        transition={ambient ? { duration: 7, repeat: Infinity, ease: 'easeInOut' } : undefined}
      >
        <ParcelGrid />

        {LAYER_ORDER.map(key => (
          <Layer key={key} id={key} roof={key === 'roof'} animated={animated} {...layerMotion[key]} />
        ))}

        {/* short signal stubs from each exploded layer toward its intelligence node */}
        <motion.g {...(connectorsProps as any)}>
          {LAYER_ORDER.map(key => {
            const f = INTACT_FACES[key];
            const off = EXPLODE_OFFSET[key];
            const x1 = f.center.x + off.tx;
            const y1 = f.center.y + off.ty;
            const dir = NODE_SIDE[key] === 'right' ? 1 : -1;
            const x2 = x1 + dir * 118;
            return (
              <g key={key}>
                <line x1={x1} y1={y1} x2={x2} y2={y1}
                  stroke="hsla(38, 90%, 60%, 0.4)" strokeWidth={1} strokeDasharray="2 4" />
                <circle cx={x1} cy={y1} r={2.5} fill="hsl(38, 92%, 60%)" />
              </g>
            );
          })}
        </motion.g>

        {/* scanning plane */}
        <motion.rect
          x={40} width={VIEW.w - 80} height={3} rx={1.5}
          fill="hsl(38, 92%, 60%)"
          {...(scanProps as any)}
          style={{ ...(animated ? {} : (scanProps as any).style), filter: 'drop-shadow(0 0 6px hsl(38 92% 55% / 0.8))' }}
        />
      </motion.svg>
    </div>
  );
}

import React from 'react';

/**
 * The launcher's drawing: an isometric room in line, the way an architect
 * sketches a space before designing it — walls, a window, a door opening,
 * and one gold piece of furniture being placed. Pure SVG; decorative only.
 */
export function RoomSketch({ className }: { className?: string }) {
  const line = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <svg viewBox="0 -20 360 250" className={className} aria-hidden="true">
      {/* floor */}
      <path d="M40 150 180 80l140 70-140 70z" {...line} strokeWidth="1.2" opacity="0.55" />
      {/* back walls */}
      <path d="M40 150V60L180 -10v90" {...line} strokeWidth="1.2" opacity="0.7" />
      <path d="M180 -10l140 70v90" {...line} strokeWidth="1.2" opacity="0.7" />
      {/* floor grid, quiet */}
      {[1, 2, 3, 4].map((i) => (
        <path key={`a${i}`} d={`M${40 + i * 28} ${150 - i * 14} ${180 + i * 28} ${220 - i * 14}`} {...line} strokeWidth="0.6" opacity="0.18" />
      ))}
      {[1, 2, 3, 4].map((i) => (
        <path key={`b${i}`} d={`M${180 + i * 28} ${80 + i * 14} ${40 + i * 28} ${150 + i * 14}`} {...line} strokeWidth="0.6" opacity="0.18" />
      ))}
      {/* window in the right wall */}
      <path d="M232 36l56 28v44l-56-28z" {...line} strokeWidth="1.1" opacity="0.8" />
      <path d="M260 50v44" {...line} strokeWidth="0.8" opacity="0.5" />
      {/* door opening in the left wall */}
      <path d="M78 131V83l30-15v48" {...line} strokeWidth="1.1" opacity="0.8" />
      {/* the piece being placed: a sofa, in gold */}
      <g stroke="hsl(38 92% 58%)" fill="none" strokeWidth="1.5" strokeLinejoin="round">
        <path d="M150 150l60 30 34-17-60-30z" fill="hsl(38 92% 58% / 0.14)" />
        <path d="M150 150v-12l34-17v12" />
        <path d="M184 121l60 30v12" />
        <path d="M150 138l60 30 34-17" />
        <path d="M210 168v12" />
      </g>
      {/* footprint dimension, dashed */}
      <path d="M146 158l60 30" stroke="hsl(38 92% 58%)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.7" />
    </svg>
  );
}

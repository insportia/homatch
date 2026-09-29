import React from 'react';
import type { SpaceModel } from '@/lib/designStudio/space';
import { cn } from '@/lib/utils';

/**
 * The plan, small, in a corner of the canvas: click a room to go there; the
 * selected room is marked. The same polygons the 3D space is built from, so
 * the two can never disagree. Plan coordinates are never mirrored for RTL —
 * a building does not change shape with the reader's language.
 */
export function PlanNavigator({
  space, activeRoomId, names, onRoom, label, className,
}: {
  space: SpaceModel;
  activeRoomId: string | null;
  names: Map<string, string>;
  onRoom: (roomId: string) => void;
  label: string;
  className?: string;
}) {
  const pad = 0.4;
  const w = space.extent.width + pad * 2;
  const h = space.extent.depth + pad * 2;
  // Plan y is up; SVG y is down.
  const pt = (p: { x: number; y: number }) => `${(p.x + pad).toFixed(3)},${(space.extent.depth - p.y + pad).toFixed(3)}`;

  return (
    <nav aria-label={label} className={cn('rounded-lg bg-white/95 p-2 shadow-md ring-1 ring-black/10 backdrop-blur', className)} dir="ltr">
      <svg viewBox={`0 0 ${w} ${h}`} className="block h-auto w-full" role="presentation">
        {space.rooms.map((room) => {
          const active = room.id === activeRoomId;
          return (
            <polygon
              key={room.id}
              points={room.polygon.map(pt).join(' ')}
              className={cn('cursor-pointer transition-colors', active ? 'fill-[hsl(41_88%_84%)]' : 'fill-[#EEF0F3] hover:fill-[hsl(41_88%_91%)]')}
              stroke={active ? 'hsl(34 90% 31%)' : '#8A93A3'}
              strokeWidth={active ? 0.09 : 0.05}
              onClick={() => onRoom(room.id)}
            >
              <title>{names.get(room.id)}</title>
            </polygon>
          );
        })}
        {space.walls.map((wall) => (
          <line
            key={wall.id}
            x1={wall.mesh.start.x + pad} y1={space.extent.depth - wall.mesh.start.y + pad}
            x2={wall.mesh.end.x + pad} y2={space.extent.depth - wall.mesh.end.y + pad}
            stroke="#0C1119"
            strokeWidth={Math.max(0.06, wall.mesh.thicknessM)}
            strokeLinecap="square"
            pointerEvents="none"
          />
        ))}
      </svg>
      {/* Keyboard and screen-reader route to the same action. */}
      <ul className="sr-only">
        {space.rooms.map((room) => (
          <li key={room.id}>
            <button type="button" onClick={() => onRoom(room.id)}>{names.get(room.id)}</button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

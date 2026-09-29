// HOMATCH DESIGN STUDIO — WALKTHROUGH CONTROLS.
//
// Over the canvas while walking: where you are, the rooms in the order a
// visitor meets them (the Camera Director's tour), back to the entry, and
// out. Desktop walks with W A S D / arrows and looks by dragging; touch
// walks with the joystick and looks by dragging anywhere else.

import React, { useRef, useState } from 'react';
import { Footprints, RotateCcw, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

export function WalkthroughOverlay({
  roomName, rooms, currentRoomId, touch, onRoom, onReset, onExit, onStick,
}: {
  roomName: string | null;
  rooms: Array<{ id: string; name: string }>;
  currentRoomId: string | null;
  touch: boolean;
  onRoom: (roomId: string) => void;
  onReset: () => void;
  onExit: () => void;
  onStick: (x: number, y: number) => void;
}) {
  const { t } = useLanguage();
  return (
    <>
      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-col items-stretch gap-2">
        <div className="pointer-events-auto mx-auto flex w-full max-w-2xl items-center gap-2 rounded-xl bg-[#0C1119]/90 px-3 py-2 text-white shadow-lg ring-1 ring-white/10 backdrop-blur">
          <Footprints className="h-4 w-4 shrink-0 text-[hsl(38_92%_62%)]" aria-hidden="true" />
          <p className="min-w-0 flex-1 truncate text-[14px]" aria-live="polite">
            <span className="font-semibold">{t('ds_walk_title')}</span>
            {roomName ? <span className="text-white/75"> · {roomName}</span> : null}
          </p>
          <button type="button" onClick={onReset} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-white/85 ring-1 ring-white/20 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
            <RotateCcw className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
            <span className="hidden sm:inline">{t('ds_walk_reset')}</span>
          </button>
          <button type="button" onClick={onExit} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-2.5 text-[13px] font-semibold text-[#0C1119] hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            {t('ds_walk_exit')}
          </button>
        </div>
        <nav aria-label={t('ds_walk_rooms')} className="pointer-events-auto mx-auto flex max-w-full gap-1.5 overflow-x-auto pb-1">
          {rooms.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onRoom(r.id)}
              aria-current={r.id === currentRoomId ? 'location' : undefined}
              className={cn('h-8 shrink-0 rounded-full px-3 text-[13px] font-medium shadow-sm ring-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]',
                r.id === currentRoomId ? 'bg-[#0C1119] text-white ring-[#0C1119]' : 'bg-white/90 text-[#0C1119] ring-black/10 hover:bg-white')}
            >
              {r.name}
            </button>
          ))}
        </nav>
      </div>
      {touch ? (
        <Joystick label={t('ds_walk_joystick')} onChange={onStick} />
      ) : (
        <p className="pointer-events-none absolute bottom-3 start-1/2 z-10 -translate-x-1/2 rounded-md bg-[#0C1119]/80 px-3 py-1.5 text-[13px] text-white/90 rtl:translate-x-1/2">
          {t('ds_walk_help_keys')}
        </p>
      )}
    </>
  );
}

/** A thumb joystick: drag inside the ring; up walks forward. Releases to centre. */
function Joystick({ label, onChange }: { label: string; onChange: (x: number, y: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);
  const R = 44;

  const update = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    let x = e.clientX - (box.left + box.width / 2);
    let y = e.clientY - (box.top + box.height / 2);
    const len = Math.hypot(x, y);
    if (len > R) { x = (x / len) * R; y = (y / len) * R; }
    setKnob({ x, y });
    onChange(x / R, y / R);
  };
  const end = () => {
    active.current = null;
    setKnob({ x: 0, y: 0 });
    onChange(0, 0);
  };

  return (
    <div
      ref={ref}
      role="application"
      aria-label={label}
      className="absolute bottom-5 start-5 z-10 grid h-32 w-32 touch-none place-items-center rounded-full bg-[#0C1119]/35 ring-1 ring-white/30 backdrop-blur-sm"
      onPointerDown={(e) => { active.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); update(e); }}
      onPointerMove={(e) => { if (active.current === e.pointerId) update(e); }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <span className="h-14 w-14 rounded-full bg-white/85 shadow-md" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} aria-hidden="true" />
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import type { FieldMark } from '@/site/content';
import { useMotion } from '@/hooks/useMotion';

/**
 * A MODERN RESIDENTIAL BUILDING, BEING ANALYSED.
 *
 * WHAT THIS REPLACED
 *
 * Seven rounded slabs, each wider than the one above, with small squares on
 * them. It was meant to read as a tower of intelligence layers and it read as
 * a wedding cake: nothing in it was architectural, so nothing in it said
 * "building". The mobile version was worse — the same slabs as a list.
 *
 * WHAT MAKES THIS READ AS A BUILDING
 *
 * Not detail for its own sake. Four things the eye uses to recognise
 * residential architecture, and it needs all four:
 *
 *   A CONSISTENT FLOOR RHYTHM. Every floor the same height, slab lines
 *   running the full width. This is what separates a building from a stack.
 *
 *   A SERVICE CORE. The blind vertical band with small stacked windows is
 *   the stair and lift. Real towers have one and it breaks the façade into
 *   two wings, which is most of why this looks planned rather than drawn.
 *
 *   BALCONIES. Recessed glass with a rail in front, on a regular module.
 *   Offices have ribbon glazing; homes have balconies. This is the single
 *   strongest "people live here" signal available in a silhouette.
 *
 *   A GROUND THAT IS DIFFERENT. A taller glazed lobby with an entrance and
 *   a canopy, sitting on a shadow. A building meets the street; an object
 *   floats.
 *
 * IT IS ONE BUILDING AT REST
 *
 * The floors never separate. The previous concept exploded into slices, and
 * an exploded building stops being a building. Analysis is expressed by
 * MARKING — a slab line brightening, one floor outlined, the rest receding —
 * which is what an architect's drawing does and what reads as intelligence
 * rather than demolition.
 *
 * SVG, not a 3D engine: it scales to any width without losing the rhythm,
 * costs nothing to load, and every part of it can be addressed by the
 * sequence below.
 */

/* ── Geometry. One place, so the parts cannot drift apart. ───────────── */
const W = 300;
const H = 400;
const LEFT = 46;         // building's left edge
const RIGHT = 254;
const ROOF = 46;         // top of the residential stack
const GROUND = 372;      // street line
const LOBBY_H = 46;      // the taller glazed ground floor
const FLOORS = 8;
const STACK_BOTTOM = GROUND - LOBBY_H;
const FLOOR_H = (STACK_BOTTOM - ROOF) / FLOORS;
const CORE_L = 137;      // the stair and lift core
const CORE_R = 163;
/** The floor the analysis settles on, counted from the top. */
const PICKED = 2;
/** Which module of that floor becomes the unit. */
const PICKED_UNIT = 1;

/** y of a floor's top edge, floors numbered from the top. */
const floorTop = (i: number) => ROOF + i * FLOOR_H;
/** Storey number as a resident would say it, counting up from the lobby. */
const storeyOf = (i: number) => FLOORS - i;

/** The three window modules in one wing. */
function modules(x0: number, x1: number) {
  const n = 3;
  const w = (x1 - x0) / n;
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * w, w }));
}
const LEFT_MODULES = modules(LEFT + 4, CORE_L);
const RIGHT_MODULES = modules(CORE_R, RIGHT - 4);

export interface BuildingCopy {
  stages: string[];
  callouts: { label: string; value: string }[];
  note: string;
  alt: string;
}

/** phase 0 idle · 1 scan · 2 floors · 3 floor · 4 unit · 5 settled */
const LAST = 5;

export function BuildingScene({
  copy, focus, compact = false, fields,
}: {
  copy: BuildingCopy;
  /*
   * THE FLOOR SOMEBODY ELSE HAS DECIDED ON.
   *
   * This scene used to own its focus completely: an internal sequence, a
   * pointer, and a timer that walked the floors on a phone. Beside it, the
   * section ran its OWN timer walking the seven intelligence layers and the
   * sentence that explains them. Two clocks, never started together, drifting
   * apart within seconds — which is exactly the "the animation and the text
   * are not synchronised" the owner kept reporting. The building was talking
   * about floor 5 while the paragraph talked about Contract.
   *
   * When `focus` is supplied the building stops keeping time and follows: the
   * lit floor IS the active layer, changing on the same tick as the words,
   * because it is the same number.
   *
   * Left undefined — the desktop, where the pointer is the input — nothing
   * changes and the scene behaves exactly as before.
   */
  focus?: number;
  /** Sized to sit beside the text rather than above it. */
  compact?: boolean;
  /*
   * The editor's field marks, supplied by the section that owns the fields.
   *
   * This component draws copy it does not own: `copy` arrives already
   * resolved. Without a way to say WHICH field produced each string, Site
   * Studio could not find the stage line or the callouts on the desktop
   * layout — they were registry fields that nothing on screen admitted to
   * being. Passed in rather than hooked here, so the scene stays usable
   * outside a section scope.
   */
  fields?: {
    stage?: FieldMark;
    callout?: (i: number) => FieldMark;
    value?: (i: number) => FieldMark;
    note?: FieldMark;
  };
}) {
  const level = useMotion();
  const still = level === 'none';
  const ref = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState(0);
  /*
   * WHERE THE POINTER IS, AS A FLOOR.
   *
   * Exploring a building should not require clicking it. Once the sequence
   * has settled, moving the pointer over the façade moves the analysis: the
   * floor under the cursor is the floor being read, and the unit under it is
   * the unit. Null means "nobody is pointing", and the scene falls back to
   * the floor the sequence chose.
   */
  const [hover, setHover] = useState<{ floor: number; unit: number } | null>(null);

  /** One step up the stack, wrapping at the roof. Shared by tap and timer. */
  const nextFloor = (h: { floor: number; unit: number } | null) => ({
    floor: ((h?.floor ?? PICKED) + 1) % FLOORS,
    unit: h?.unit ?? LEFT_MODULES.length + PICKED_UNIT,
  });

  /*
   * Starts when it is SEEN. A timer started at mount has always finished by
   * the time a thumb reaches this far down a phone page.
   */
  useEffect(() => {
    if (still) { setPhase(LAST); return; }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setPhase(LAST); return; }

    let timers: number[] = [];
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.disconnect();
        // Slow enough to follow: building, scan, floors, floor, unit, done.
        timers = Array.from({ length: LAST }, (_, i) => window.setTimeout(
          () => setPhase(i + 1), 400 + i * 1250,
        ));
      }
      // A quarter of it visible is a reader arriving, not a reader passing.
    }, { threshold: 0.25 });

    io.observe(el);
    return () => { io.disconnect(); timers.forEach(clearTimeout); };
  }, [still]);

  const scanning = phase === 1;
  const floorsFound = phase >= 2;
  const floorPicked = phase >= 3;
  const unitPicked = phase >= 4;
  const done = phase >= LAST;

  /* The pointer wins once the story has finished telling itself. */
  /*
   * Precedence: an explicit focus, then the pointer, then the sequence.
   *
   * `focus` wins over `hover` deliberately. A phone has no hover, and on a
   * desktop a controlled focus only exists where the caller has decided the
   * story leads — in both cases the thing that must never happen is the
   * drawing and the sentence pointing at different floors.
   */
  const controlled = typeof focus === 'number';
  const activeFloor = controlled
    ? Math.min(FLOORS - 1, Math.max(0, focus))
    : (done && hover ? hover.floor : PICKED);
  const pickedY = floorTop(activeFloor);
  const ALL_MODULES = [...LEFT_MODULES, ...RIGHT_MODULES];
  const unit = !controlled && done && hover
    ? ALL_MODULES[hover.unit]
    : RIGHT_MODULES[PICKED_UNIT];

  /**
   * Pointer position in the SVG's own coordinates, turned into a floor and a
   * unit. getBoundingClientRect rather than offsetX, because the SVG is
   * scaled to its container and offsets are in screen pixels.
   */
  const onPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!done || e.pointerType === 'touch') return;
    const r = e.currentTarget.getBoundingClientRect();
    const y = ((e.clientY - r.top) / r.height) * H;
    const x = ((e.clientX - r.left) / r.width) * W;
    if (y < ROOF || y > STACK_BOTTOM) { setHover(null); return; }
    const floor = Math.min(FLOORS - 1, Math.max(0, Math.floor((y - ROOF) / FLOOR_H)));
    let unitIndex = ALL_MODULES.findIndex(m => x >= m.x && x < m.x + m.w);
    if (unitIndex < 0) unitIndex = x < CORE_L ? 0 : ALL_MODULES.length - 1;
    setHover({ floor, unit: unitIndex });
  };

  /*
   * TOUCH HAS NO HOVER, so a tap steps to the next floor.
   *
   * The alternative was to leave the phone with a still picture after the
   * sequence ends, which is the "static downgrade" this scene exists to
   * avoid. Stepping keeps the building explorable with one thumb and needs
   * no gesture anybody has to be taught.
   */
  const stepFloor = () => {
    if (!done) return;
    setHover(nextFloor);
  };

  /*
   * AND IT KEEPS GOING WITHOUT ONE.
   *
   * Tap-to-step alone was not enough. Measured on a 390px phone, the first
   * tap moved the focus and the next two did nothing: taps in the same place
   * inside half a second are a zoom gesture, and the browser swallowed the
   * click. So the scene now advances itself wherever there is no hover to
   * drive it, and a tap simply takes the next step early and restarts the
   * clock -- which is what `hover` in the dependency list buys.
   *
   * `touch-manipulation` on the SVG is the other half: it tells the browser
   * there is no double-tap zoom to wait for, so the taps that DO land are not
   * delayed either.
   *
   * Desktop is untouched. `(hover: none)` is false there, the pointer is in
   * charge, and a building that wandered off under a stationary cursor would
   * be worse than one that stayed still.
   */
  useEffect(() => {
    // Somebody else is driving. Two timers on one drawing is the bug.
    if (controlled) return;
    if (!done || still) return;
    if (typeof window.matchMedia !== 'function') return;
    if (!window.matchMedia('(hover: none)').matches) return;
    const id = window.setTimeout(() => setHover(nextFloor), 2200);
    return () => clearTimeout(id);
  }, [controlled, done, still, hover]);

  return (
    <div ref={ref} className="min-w-0">
      <div className={`relative mx-auto w-full lg:max-w-none ${compact ? '' : 'max-w-[22rem]'}`}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={`h-auto w-full touch-manipulation ${done ? 'cursor-crosshair' : ''}`}
          role="img"
          aria-label={copy.alt}
          onPointerMove={onPointer}
          onPointerLeave={() => setHover(null)}
          onClick={stepFloor}
        >
          <defs>
            {/* Glass: cool, slightly lit from the upper left. */}
            <linearGradient id="hm-glass" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#3A4450" />
              <stop offset="55%" stopColor="#2A323B" />
              <stop offset="100%" stopColor="#222930" />
            </linearGradient>
            {/* The lobby is brighter — it is lit from inside at street level. */}
            <linearGradient id="hm-lobby" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#48535F" />
              <stop offset="100%" stopColor="#2E353D" />
            </linearGradient>
            <linearGradient id="hm-scan" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(38 88% 54%)" stopOpacity="0" />
              <stop offset="70%" stopColor="hsl(38 88% 54%)" stopOpacity="0.30" />
              <stop offset="100%" stopColor="hsl(38 92% 56%)" stopOpacity="0.85" />
            </linearGradient>
            {/* Everything outside the façade is clipped, so the scan cannot
                spill onto the page. */}
            <clipPath id="hm-facade">
              <rect x={LEFT} y={ROOF} width={RIGHT - LEFT} height={GROUND - ROOF} rx="2" />
            </clipPath>
          </defs>

          {/* ── Ground: a shadow and a street edge, so it stands on something ── */}
          <ellipse cx={(LEFT + RIGHT) / 2} cy={GROUND + 6} rx={(RIGHT - LEFT) / 1.7} ry="7" fill="#000" opacity="0.5" />
          <line x1="14" y1={GROUND} x2={W - 14} y2={GROUND} stroke="#5B6570" strokeWidth="1" opacity="0.5" />

          {/* ── Roof: parapet and a technical volume ───────────────────── */}
          <rect x={LEFT + 26} y={ROOF - 15} width="52" height="15" fill="#252B32" stroke="#4A545F" strokeWidth="0.8" />
          <rect x={LEFT - 4} y={ROOF - 6} width={RIGHT - LEFT + 8} height="7" rx="1.5" fill="#2B323A" stroke="#525C67" strokeWidth="0.9" />

          {/* ── The mass ───────────────────────────────────────────────── */}
          <rect x={LEFT} y={ROOF} width={RIGHT - LEFT} height={GROUND - ROOF} fill="#1E242A" />

          <g clipPath="url(#hm-facade)">
            {/* Residential floors: glass, balconies, slab lines. */}
            {Array.from({ length: FLOORS }, (_, i) => {
              const y = floorTop(i);
              const dim = floorPicked && i !== PICKED;
              return (
                <g
                  key={i}
                  style={{
                    opacity: dim ? 0.4 : 1,
                    transition: still ? undefined : 'opacity 700ms cubic-bezier(0.4,0,0.2,1)',
                  }}
                >
                  {[...LEFT_MODULES, ...RIGHT_MODULES].map((m, j) => {
                    // Balconies alternate by floor and module, which is what
                    // gives a real façade its rhythm instead of a grid.
                    const balcony = (i + j) % 2 === 0;
                    return (
                      <g key={j}>
                        <rect
                          x={m.x + 3} y={y + 5}
                          width={m.w - 6} height={FLOOR_H - 11}
                          fill="url(#hm-glass)"
                        />
                        {balcony && (
                          <>
                            <rect
                              x={m.x + 2} y={y + FLOOR_H - 12}
                              width={m.w - 4} height="8"
                              fill="none" stroke="#6E7883" strokeWidth="0.8" opacity="0.85"
                            />
                            <line
                              x1={m.x + 2} y1={y + FLOOR_H - 8.5}
                              x2={m.x + m.w - 2} y2={y + FLOOR_H - 8.5}
                              stroke="#6E7883" strokeWidth="0.5" opacity="0.7"
                            />
                          </>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* The service core: blind, with small stacked windows. */}
            <rect x={CORE_L} y={ROOF} width={CORE_R - CORE_L} height={STACK_BOTTOM - ROOF} fill="#232A31" />
            {Array.from({ length: FLOORS }, (_, i) => (
              <rect
                key={i}
                x={CORE_L + 8} y={floorTop(i) + FLOOR_H / 2 - 4}
                width={CORE_R - CORE_L - 16} height="8"
                fill="#39424C"
              />
            ))}

            {/* Slab lines. The rhythm that makes it a building; they brighten
                as the scan passes and stay marked once floors are found. */}
            {Array.from({ length: FLOORS + 1 }, (_, i) => (
              <line
                key={i}
                x1={LEFT} y1={floorTop(i)} x2={RIGHT} y2={floorTop(i)}
                stroke={floorsFound ? 'hsl(38 88% 54%)' : '#5B6570'}
                strokeWidth={floorsFound ? 0.9 : 0.7}
                opacity={floorsFound ? 0.55 : 0.55}
                style={{ transition: still ? undefined : 'stroke 600ms ease, stroke-width 600ms ease' }}
              />
            ))}

            {/* ── The lobby ────────────────────────────────────────────── */}
            <rect x={LEFT} y={STACK_BOTTOM} width={RIGHT - LEFT} height={LOBBY_H} fill="url(#hm-lobby)" />
            {Array.from({ length: 7 }, (_, i) => (
              <line
                key={i}
                x1={LEFT + 12 + i * ((RIGHT - LEFT - 24) / 7)} y1={STACK_BOTTOM + 4}
                x2={LEFT + 12 + i * ((RIGHT - LEFT - 24) / 7)} y2={GROUND - 2}
                stroke="#66707B" strokeWidth="0.6" opacity="0.7"
              />
            ))}
            {/* Entrance and canopy. */}
            <rect x={(LEFT + RIGHT) / 2 - 17} y={GROUND - 30} width="34" height="30" fill="#151A1F" stroke="#7E8894" strokeWidth="0.9" />
            <line x1={(LEFT + RIGHT) / 2} y1={GROUND - 30} x2={(LEFT + RIGHT) / 2} y2={GROUND} stroke="#7E8894" strokeWidth="0.6" />
            <rect x={(LEFT + RIGHT) / 2 - 27} y={GROUND - 34} width="54" height="4" rx="1" fill="#39424C" />

            {/* ── The scan ─────────────────────────────────────────────── */}
            {!still && (
              <rect
                x={LEFT} width={RIGHT - LEFT} height="54"
                y={0}
                fill="url(#hm-scan)"
                style={{
                  transform: `translateY(${scanning ? STACK_BOTTOM - 20 : phase === 0 ? ROOF - 54 : STACK_BOTTOM - 20}px)`,
                  transition: 'transform 1250ms cubic-bezier(0.4,0,0.2,1)',
                  opacity: scanning ? 1 : 0,
                }}
              />
            )}

            {/* ── The floor under analysis ─────────────────────────────── */}
            {/* `y` is animated, not just faded, so the marker SLIDES between
                floors as the pointer moves rather than blinking. */}
            <rect
              x={LEFT - 1} y={pickedY}
              width={RIGHT - LEFT + 2} height={FLOOR_H}
              fill="hsl(38 88% 54%)"
              opacity={floorPicked ? 0.1 : 0}
              style={{ transition: still ? undefined : 'opacity 700ms ease, y 260ms cubic-bezier(0.4,0,0.2,1)' }}
            />
            <rect
              x={LEFT - 1} y={pickedY}
              width={RIGHT - LEFT + 2} height={FLOOR_H}
              fill="none" stroke="hsl(38 88% 54%)" strokeWidth="1.6"
              opacity={floorPicked ? 1 : 0}
              style={{ transition: still ? undefined : 'opacity 700ms ease, y 260ms cubic-bezier(0.4,0,0.2,1)' }}
            />

            {/* Unit divisions inside that floor, then the one unit. */}
            {ALL_MODULES.map((m, j) => (
              <rect
                key={j}
                x={m.x + 1} y={pickedY + 2}
                width={m.w - 2} height={FLOOR_H - 4}
                fill="none" stroke="hsl(38 88% 54%)" strokeWidth="0.6"
                opacity={unitPicked ? 0.45 : 0}
                style={{ transition: still ? undefined : 'opacity 500ms ease, y 260ms cubic-bezier(0.4,0,0.2,1)' }}
              />
            ))}
            <rect
              x={unit.x + 1} y={pickedY + 2}
              width={unit.w - 2} height={FLOOR_H - 4}
              fill="hsl(38 88% 54%)"
              opacity={unitPicked ? 0.5 : 0}
              style={{ transition: still ? undefined : 'opacity 600ms ease, x 260ms cubic-bezier(0.4,0,0.2,1), y 260ms cubic-bezier(0.4,0,0.2,1)' }}
            />
          </g>

          {/* The leader line from the unit out to the callouts. */}
          <g opacity={unitPicked ? 1 : 0} style={{ transition: still ? undefined : 'opacity 600ms ease' }}>
            <line
              x1={unit.x + unit.w / 2} y1={pickedY + FLOOR_H / 2}
              x2={RIGHT + 22} y2={pickedY + FLOOR_H / 2}
              stroke="hsl(38 88% 54%)" strokeWidth="0.9" opacity="0.7"
              style={{ transition: still ? undefined : 'all 260ms cubic-bezier(0.4,0,0.2,1)' }}
            />
            <circle
              cx={unit.x + unit.w / 2} cy={pickedY + FLOOR_H / 2} r="2.6" fill="hsl(38 88% 54%)"
              style={{ transition: still ? undefined : 'all 260ms cubic-bezier(0.4,0,0.2,1)' }}
            />
          </g>
        </svg>

        {/* ── What the analysis is doing, in words ─────────────────────
            Hidden in compact mode: beside the drawing there is no room for a
            letter-spaced caption under it, and the column to its right is
            already saying what is being read. */}
        {!compact && (
        <p
          className="mt-4 flex items-center justify-center gap-2 text-[14px] font-semibold uppercase tracking-[0.18em] text-gold lg:justify-start"
          {...(fields?.stage ?? {})}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${done ? 'bg-gold' : 'bg-gold/70'}`}
            style={{ transition: still ? undefined : 'opacity 400ms ease' }}
            aria-hidden="true"
          />
          {copy.stages[Math.min(phase, copy.stages.length - 1)]}
        </p>
        )}
      </div>

      {/*
        * The findings, stacked under the building on a phone and beside it on
        * a desktop. They appear one at a time as the analysis reaches them,
        * which is the difference between a result and a caption.
        */}
      {/*
        * THE FINDINGS.
        *
        * Three things were wrong with them on a phone, and all three are the
        * kind that survive review because they look right in the source:
        *
        *   `border-white/12` generated no CSS at all. Tailwind's opacity
        *   scale runs in fives, so /12 is not a class -- the cards had no
        *   border on any device, which is why they read as floating text.
        *
        *   6px of travel is not motion. It is the distance a line of text
        *   moves when a font finishes loading, and on a phone held at arm's
        *   length nobody perceives it as an arrival.
        *
        *   `truncate` on the value cut "Registered" to "Regi..." in
        *   Georgian and Russian, where these words are longer. A finding
        *   that has to be guessed at is not a finding.
        */}
      {!compact && (
      <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
        {copy.callouts.map((rawCallout, i) => {
          /* The first callout is the storey. While the pointer (or a tap) is
             choosing a floor it reports THAT floor, so the number and the
             highlight can never disagree; with nothing chosen it falls back
             to the editable demo value. */
          const c = i === 0 && hover
            ? { ...rawCallout, value: String(storeyOf(hover.floor)) }
            : rawCallout;
          return (
          <div
            key={c.label}
            className="min-w-0 rounded-[0.7rem] border border-white/15 bg-white/[0.04] px-3 py-2.5"
            style={{
              opacity: unitPicked ? 1 : 0,
              transform: unitPicked ? 'none' : 'translateY(20px)',
              transition: still ? undefined : `opacity 520ms cubic-bezier(0.16,1,0.3,1) ${i * 140}ms, transform 520ms cubic-bezier(0.16,1,0.3,1) ${i * 140}ms`,
            }}
          >
            <dt className="text-[13px] uppercase tracking-[0.14em] text-white/45" {...(fields?.callout?.(i) ?? {})}>
              {c.label}
            </dt>
            {/* The storey is computed from the lit floor, so only the other
                three values are editable: letting somebody type over the
                floor would let the number disagree with the drawing. */}
            <dd
              className="mt-0.5 text-pretty text-[17px] font-semibold leading-tight text-white"
              {...(i === 0 ? {} : (fields?.value?.(i) ?? {}))}
            >
              {c.value}
            </dd>
          </div>
          );
        })}
      </dl>
      )}
      {!compact && (
        <p className="mt-3 text-[13px] leading-relaxed text-white/40" {...(fields?.note ?? {})}>{copy.note}</p>
      )}
    </div>
  );
}

export { FLOORS, PICKED, storeyOf };

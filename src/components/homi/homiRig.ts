/*
 * HOMI — THE APPROVED 2D CHARACTER, AS A LAYERED SVG RIG.
 *
 * Ported from the HOMATCH film pipeline (homatch-video/h2/homi2d/js/homi.js,
 * the rig the owner approved for the HOMI film on 2026-10-24, after the face
 * refinement). Not a redesign: the same white shell, dark visor, blue LED
 * eyes and mouth, gold trim, gold house logo on the black chest shield and
 * the HOMATCH wordmark. Geometry and colours are copied, not re-drawn.
 *
 * What changed for the product:
 *   - typed, no `window` global, ids prefixed per instance so two HOMIs on
 *     one page never share a gradient;
 *   - the wordmark uses the product's own font stack (the film's font file
 *     is not shipped to the web);
 *   - `homiPose(state, t)` turns a named product state into the rig's pose.
 *     It is a pure function of time — no randomness, no AI, no network —
 *     so the same state always looks the same and costs nothing to run.
 *
 * The "thinking" state is a friendly progress indicator, nothing more. It
 * does not represent, and must never be described as, the model's reasoning.
 */

export const HOMI_STATES = [
  'idle', 'greeting', 'listening', 'thinking', 'searching', 'explaining',
  'happy', 'surprised', 'encouraging', 'success', 'error', 'goodbye', 'pointing',
] as const;
export type HomiState = typeof HOMI_STATES[number];

type ArmPose = 'relaxed' | 'open' | 'stop' | 'point';
export interface HomiArm { sh?: number; el?: number; hand?: number; pose?: ArmPose }
export interface HomiPoseValues {
  bob?: number; lean?: number; headTilt?: number; headYaw?: number;
  blink?: number; gazeX?: number; gazeY?: number; brow?: number;
  mouth?: [number, number, number]; glow?: number;
  armL?: HomiArm; armR?: HomiArm;
}

function hand(p: string, side: number): string {
  const s = side;
  const finger = (x: number, len: number, w: number, rot: number) =>
    `<g transform="rotate(${rot} ${x} 8)"><rect x="${x - w / 2}" y="8" width="${w}" height="${len}" rx="${w / 2}" fill="url(#${p}shellG)" stroke="#9aa3b2" stroke-width="1.5"/>
     <rect x="${x - w / 2 + 1}" y="${8 + len * 0.40}" width="${w - 2}" height="4" rx="2" fill="#3a4558" opacity=".55"/><rect x="${x - w / 2 + 1.5}" y="${8 + len * 0.72}" width="${w - 3}" height="3.5" rx="1.75" fill="#3a4558" opacity=".5"/></g>`;
  const palm = `<rect x="-38" y="-6" width="76" height="70" rx="30" fill="url(#${p}shellG)" stroke="#9aa3b2" stroke-width="2"/>`;
  const relaxed = `<g class="pose relaxed">${palm}
      <g transform="translate(0 52)">${finger(-26, 50, 17, 4 * s)}${finger(-8, 58, 18, 1 * s)}${finger(10, 56, 18, -1 * s)}${finger(27, 46, 16, -4 * s)}</g>
      <g transform="translate(${-36 * s} 18) rotate(${28 * s})">${finger(0, 40, 17, 0)}</g></g>`;
  const open = `<g class="pose open" opacity="0">${palm}
      <g transform="translate(0 52)">${finger(-30, 52, 17, 16 * s)}${finger(-10, 60, 18, 6 * s)}${finger(10, 58, 18, -4 * s)}${finger(29, 48, 16, -14 * s)}</g>
      <g transform="translate(${-40 * s} 14) rotate(${62 * s})">${finger(0, 42, 17, 0)}</g></g>`;
  const stop = `<g class="pose stop" opacity="0">${palm}
      <g transform="translate(0 52)">${finger(-27, 54, 18, 3 * s)}${finger(-9, 62, 19, 1 * s)}${finger(9, 60, 19, -1 * s)}${finger(27, 50, 17, -3 * s)}</g>
      <g transform="translate(${-40 * s} 10) rotate(${48 * s})">${finger(0, 42, 18, 0)}</g></g>`;
  const point = `<g class="pose point" opacity="0">${palm}
      <g transform="translate(0 52)">${finger(-10, 70, 18, 2 * s)}</g>
      <g transform="translate(0 46)"><rect x="2" y="0" width="44" height="30" rx="15" fill="url(#${p}shellG)" stroke="#9aa3b2" stroke-width="1.5"/></g>
      <g transform="translate(${-36 * s} 18) rotate(${40 * s})">${finger(0, 34, 17, 0)}</g></g>`;
  return relaxed + open + stop + point;
}

function arm(p: string, side: number): string {
  const x = side > 0 ? 222 : 778;
  return `<g data-arm="${side > 0 ? 'L' : 'R'}" class="arm">
    <g class="upper">
      <rect x="${x - 46}" y="700" width="92" height="190" rx="46" fill="url(#${p}shellG)" stroke="#a3acba" stroke-width="2"/>
      <rect x="${x - 34}" y="760" width="9" height="90" rx="4" fill="#4FB2FF" filter="url(#${p}glowS)" opacity=".9" transform="translate(${side > 0 ? 0 : 59} 0)"/>
      <ellipse cx="${x}" cy="895" rx="50" ry="14" fill="url(#${p}goldG)"/>
      <circle cx="${x}" cy="910" r="40" fill="url(#${p}jointG)"/>
      <g class="fore">
        <rect x="${x - 42}" y="912" width="84" height="178" rx="42" fill="url(#${p}shellG)" stroke="#a3acba" stroke-width="2"/>
        <rect x="${x - 3}" y="960" width="8" height="80" rx="4" fill="#4FB2FF" filter="url(#${p}glowS)" opacity=".85"/>
        <ellipse cx="${x}" cy="1092" rx="46" ry="13" fill="url(#${p}goldG)"/>
        <rect x="${x - 30}" y="1094" width="60" height="26" rx="10" fill="#141b27"/>
        <g class="hand" transform="translate(${x} 1118) scale(1.55)"><g class="handrot">${hand(p, side)}</g></g>
      </g>
    </g>
    <g class="pad">
      <ellipse cx="${x + 6 * side}" cy="690" rx="84" ry="72" fill="url(#${p}shellG)" stroke="#a3acba" stroke-width="2"/>
      <path d="M ${x - 70} 722 Q ${x} 760 ${x + 70} 722" fill="none" stroke="url(#${p}goldG)" stroke-width="7"/>
      <path d="M ${x - 60} 704 Q ${x} 738 ${x + 60} 704" fill="none" stroke="#4FB2FF" stroke-width="5" filter="url(#${p}glowS)" opacity=".9"/>
    </g>
  </g>`;
}

/** Visible framing. `head` is for chat avatars; `bust` for panels; `full` for hero use. */
export type HomiCrop = 'head' | 'bust' | 'full';
export const HOMI_VIEWBOX: Record<HomiCrop, string> = {
  head: '170 60 660 540',
  bust: '-60 -40 1120 1120',
  full: '-40 0 1080 1420',
};

/** The rig's SVG markup. `p` must be unique per instance on the page. */
export function homiSvg(p: string, crop: HomiCrop, glowFilters = true): string {
  const markup = fullSvg(p, crop);
  /* Small avatars drop the blur filters: at 32px they cannot be seen and they
     are the expensive part of repainting an SVG every frame. The references
     are removed, not pointed at empty filters — an empty filter renders its
     element as nothing at all. */
  return glowFilters ? markup : markup.replace(/ filter="url\(#[^)]+\)"/g, '');
}

function fullSvg(p: string, crop: HomiCrop): string {
  const glow = '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${HOMI_VIEWBOX[crop]}" width="100%" height="100%" overflow="${crop === 'head' ? 'hidden' : 'visible'}" aria-hidden="true" focusable="false"${glow}>
  <defs>
    <radialGradient id="${p}shellG" cx="35%" cy="25%" r="85%"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#eef1f5"/><stop offset="1" stop-color="#c3c9d4"/></radialGradient>
    <linearGradient id="${p}goldG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe0a0"/><stop offset=".45" stop-color="#e2a43a"/><stop offset=".7" stop-color="#b9781e"/><stop offset="1" stop-color="#f6c76c"/></linearGradient>
    <radialGradient id="${p}visorG" cx="40%" cy="30%" r="90%"><stop offset="0" stop-color="#1c2738"/><stop offset=".6" stop-color="#090e16"/><stop offset="1" stop-color="#03060a"/></radialGradient>
    <radialGradient id="${p}chestG" cx="45%" cy="25%" r="90%"><stop offset="0" stop-color="#1b2535"/><stop offset="1" stop-color="#05080d"/></radialGradient>
    <radialGradient id="${p}jointG" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#3a4558"/><stop offset="1" stop-color="#0b1018"/></radialGradient>
    <radialGradient id="${p}irisG" cx="45%" cy="40%" r="60%"><stop offset="0" stop-color="#d9f0ff"/><stop offset=".35" stop-color="#6cc2ff"/><stop offset=".8" stop-color="#2373e0"/><stop offset="1" stop-color="#123c8c"/></radialGradient>
    <linearGradient id="${p}shineG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <filter id="${p}glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="${p}glowS" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="${p}shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000" flood-opacity=".45"/></filter>
    <clipPath id="${p}visorClip"><rect x="272" y="206" width="456" height="250" rx="112"/></clipPath>
  </defs>
  <g class="all" filter="url(#${p}shadow)">
  <g class="body">
    <path d="M 352 1150 Q 500 1120 648 1150 L 630 1330 Q 500 1380 370 1330 Z" fill="url(#${p}shellG)" stroke="#a3acba" stroke-width="2"/>
    <rect x="350" y="1092" width="300" height="62" rx="26" fill="#121925"/>
    <rect x="352" y="1100" width="296" height="10" rx="5" fill="url(#${p}goldG)"/>
    <path d="M 300 650 Q 500 600 700 650 Q 742 820 668 1000 Q 640 1080 560 1098 L 440 1098 Q 360 1080 332 1000 Q 258 820 300 650 Z" fill="url(#${p}shellG)" stroke="#a3acba" stroke-width="2"/>
    <path d="M 372 700 Q 500 668 628 700 Q 652 840 590 980 Q 548 1052 500 1062 Q 452 1052 410 980 Q 348 840 372 700 Z" fill="url(#${p}chestG)"/>
    <path d="M 372 700 Q 500 668 628 700 Q 652 840 590 980 Q 548 1052 500 1062 Q 452 1052 410 980 Q 348 840 372 700 Z" fill="none" stroke="url(#${p}goldG)" stroke-width="7"/>
    <path d="M 382 712 Q 372 840 418 966" fill="none" stroke="#4FB2FF" stroke-width="5" filter="url(#${p}glowS)" opacity=".85"/>
    <path d="M 618 712 Q 628 840 582 966" fill="none" stroke="#4FB2FF" stroke-width="5" filter="url(#${p}glowS)" opacity=".85"/>
    <g class="logo" transform="translate(500 800)">
      <g class="logoGlow" opacity="0" filter="url(#${p}glow)"><path d="M -46 22 L -46 -14 L 0 -48 L 46 -14 L 46 22" fill="none" stroke="#ffcf7a" stroke-width="12"/></g>
      <path d="M -46 22 L -46 -14 L 0 -48 L 46 -14 L 46 22" fill="none" stroke="url(#${p}goldG)" stroke-width="9" stroke-linejoin="round"/>
      <path d="M -26 22 L -26 -2 L 0 -22 L 26 -2 L 26 22" fill="none" stroke="url(#${p}goldG)" stroke-width="8" stroke-linejoin="round"/>
      <path d="M -8 22 L -8 6 L 8 6 L 8 22" fill="none" stroke="url(#${p}goldG)" stroke-width="7"/>
    </g>
    <text x="500" y="890" text-anchor="middle" font-family="'Noto Sans', Inter, system-ui, sans-serif" font-weight="700" font-size="38" letter-spacing="3" fill="#f3f5f8">HOMATCH</text>
    <rect x="450" y="548" width="100" height="92" rx="30" fill="url(#${p}jointG)"/>
    <ellipse cx="500" cy="632" rx="78" ry="16" fill="url(#${p}goldG)"/>
  </g>
  ${arm(p, 1)}${arm(p, -1)}
  <g class="head">
    <g class="earL"><circle cx="214" cy="332" r="46" fill="url(#${p}jointG)"/><circle cx="214" cy="332" r="39" fill="none" stroke="url(#${p}goldG)" stroke-width="6"/>
      <circle cx="214" cy="332" r="24" fill="none" stroke="#4FB2FF" stroke-width="7" filter="url(#${p}glowS)"/></g>
    <g class="earR"><circle cx="786" cy="332" r="46" fill="url(#${p}jointG)"/><circle cx="786" cy="332" r="39" fill="none" stroke="url(#${p}goldG)" stroke-width="6"/>
      <circle cx="786" cy="332" r="24" fill="none" stroke="#4FB2FF" stroke-width="7" filter="url(#${p}glowS)"/></g>
    <path d="M 500 82 C 760 82 800 210 800 330 C 800 470 720 560 500 560 C 280 560 200 470 200 330 C 200 210 240 82 500 82 Z" fill="url(#${p}shellG)" stroke="#a3acba" stroke-width="2"/>
    <path d="M 438 96 Q 500 84 562 96 L 552 138 Q 500 128 448 138 Z" fill="#0d131d" stroke="url(#${p}goldG)" stroke-width="5"/>
    <rect x="262" y="196" width="476" height="270" rx="122" fill="none" stroke="url(#${p}goldG)" stroke-width="7"/>
    <rect x="272" y="206" width="456" height="250" rx="112" fill="url(#${p}visorG)"/>
    <g clip-path="url(#${p}visorClip)">
      <g class="face">
        <g class="brows">
          <path class="browL" d="M 357 254 Q 395 238 433 248" fill="none" stroke="#7cc8ff" stroke-width="7" stroke-linecap="round" filter="url(#${p}glowS)"/>
          <path class="browR" d="M 567 248 Q 605 238 643 254" fill="none" stroke="#7cc8ff" stroke-width="7" stroke-linecap="round" filter="url(#${p}glowS)"/>
        </g>
        <g class="eyeL"><circle cx="395" cy="318" r="50" fill="none" stroke="#4FB2FF" stroke-width="8" filter="url(#${p}glow)"/>
          <g class="look"><circle cx="395" cy="318" r="39" fill="url(#${p}irisG)"/><circle cx="395" cy="320" r="19" fill="#0a1a3a"/>
            <circle cx="383" cy="304" r="9" fill="#fff"/><circle cx="407" cy="331" r="4" fill="#fff" opacity=".85"/></g></g>
        <g class="eyeR"><circle cx="605" cy="318" r="50" fill="none" stroke="#4FB2FF" stroke-width="8" filter="url(#${p}glow)"/>
          <g class="look"><circle cx="605" cy="318" r="39" fill="url(#${p}irisG)"/><circle cx="605" cy="320" r="19" fill="#0a1a3a"/>
            <circle cx="593" cy="304" r="9" fill="#fff"/><circle cx="617" cy="331" r="4" fill="#fff" opacity=".85"/></g></g>
        <path class="mouth" d="" fill="#6cc2ff" stroke="#6cc2ff" stroke-width="7" stroke-linejoin="round" stroke-linecap="round" filter="url(#${p}glow)"/>
      </g>
      <path d="M 312 230 Q 420 200 560 206 Q 450 230 330 300 Z" fill="url(#${p}shineG)"/>
    </g>
    <path d="M 300 150 Q 360 110 430 104" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".55"/>
  </g>
  </g></svg>`;
}

/** One smooth LED contour: closed = smile arc, open = rounded D, round = oval. */
export function mouthPath(o: number, w: number, r: number): string {
  const cx = 500, cy = 396;
  const a = (38 + 26 * w) * (1 - 0.42 * r);
  const H = 2.5 + 34 * o;
  const top = (0.15 + 0.65 * r) * H;
  const smile = 9 * (1 - r) * (1 - 0.5 * o);
  let d = '';
  for (let i = 0; i <= 36; i++) {
    const th = (i / 36) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
    const y = cy + (sn >= 0 ? H * sn : top * sn) - smile * c * c + smile * 0.35;
    d += `${i ? 'L' : 'M'} ${(cx + a * c).toFixed(1)} ${y.toFixed(1)} `;
  }
  return `${d}Z`;
}

export interface HomiRig { set(pose: HomiPoseValues): void }

/** Binds the rig to an element that already holds homiSvg() markup. */
export function bindHomiRig(el: Element): HomiRig {
  const q = (s: string) => el.querySelector(s) as SVGGraphicsElement | null;
  const parts = {
    all: q('.all'), head: q('.head'), face: q('.face'), earL: q('.earL'), earR: q('.earR'),
    eyeL: q('.eyeL'), eyeR: q('.eyeR'), lookL: q('.eyeL .look'), lookR: q('.eyeR .look'),
    browL: q('.browL'), browR: q('.browR'), mouth: q('.mouth'), logoGlow: q('.logoGlow'),
  };
  const armParts = (['L', 'R'] as const).map((k) => {
    const a = el.querySelector(`[data-arm="${k}"]`);
    return {
      k,
      upper: a?.querySelector('.upper') ?? null,
      fore: a?.querySelector('.fore') ?? null,
      handrot: a?.querySelector('.handrot') ?? null,
      poses: Object.fromEntries([...(a?.querySelectorAll('.pose') ?? [])].map((g) => [g.classList[1], g])) as Record<string, Element>,
    };
  });
  const t = (n: Element | null, v: string) => { if (n) n.setAttribute('transform', v); };
  return {
    set(s) {
      t(parts.all, `translate(0 ${s.bob ?? 0}) rotate(${s.lean ?? 0} 500 1300)`);
      const yaw = s.headYaw ?? 0;
      t(parts.head, `rotate(${s.headTilt ?? 0} 500 600) translate(${yaw * 10} 0)`);
      t(parts.face, `translate(${yaw * 34} ${(s.gazeY ?? 0) * 2})`);
      const sl = 1 - Math.max(0, yaw) * 0.25, sr = 1 + Math.min(0, yaw) * 0.25;
      t(parts.earL, `translate(${yaw * 12 + 214} 332) scale(${sl} 1) translate(-214 -332)`);
      t(parts.earR, `translate(${yaw * 12 + 786} 332) scale(${sr} 1) translate(-786 -332)`);
      const bl = Math.max(0.06, 1 - (s.blink ?? 0));
      t(parts.eyeL, `translate(0 ${318 * (1 - bl)}) scale(1 ${bl})`);
      t(parts.eyeR, `translate(0 ${318 * (1 - bl)}) scale(1 ${bl})`);
      const gx = (s.gazeX ?? 0) * 11, gy = (s.gazeY ?? 0) * 8;
      t(parts.lookL, `translate(${gx} ${gy})`); t(parts.lookR, `translate(${gx} ${gy})`);
      const b = s.brow ?? 0;
      t(parts.browL, `translate(0 ${-12 * b}) rotate(${-7 * b} 395 246)`);
      t(parts.browR, `translate(0 ${-12 * b}) rotate(${7 * b} 605 246)`);
      const m = s.mouth ?? [0, 0.55, 0];
      parts.mouth?.setAttribute('d', mouthPath(m[0], m[1], m[2]));
      parts.logoGlow?.setAttribute('opacity', (s.glow ?? 0).toFixed(3));
      for (const ap of armParts) {
        const side = ap.k === 'L' ? 1 : -1;
        const a = (ap.k === 'L' ? s.armL : s.armR) ?? {};
        const x = side > 0 ? 222 : 778;
        t(ap.upper, `rotate(${(a.sh ?? 6) * side} ${x} 690)`);
        t(ap.fore, `rotate(${(a.el ?? 4) * side} ${x} 910)`);
        t(ap.handrot, `rotate(${(a.hand ?? 0) * side})`);
        const pose = a.pose ?? 'relaxed';
        for (const [name, g] of Object.entries(ap.poses)) g.setAttribute('opacity', name === pose ? '1' : '0');
      }
    },
  };
}

const TAU = Math.PI * 2;
const wave = (t: number, period: number, phase = 0) => Math.sin((t / period) * TAU + phase);

/** A natural blink every ~4.2 s, 140 ms long. Deterministic. */
export function blinkAt(t: number): number {
  const cycle = 4.2, x = t % cycle;
  return x < 0.14 ? Math.sin((x / 0.14) * Math.PI) : 0;
}

/**
 * State → pose at time t (seconds). Pure. `still` returns the resting pose of
 * the state with every periodic motion removed — the reduced-motion frame.
 */
export function homiPose(state: HomiState, t: number, still = false): HomiPoseValues {
  const k = still ? 0 : 1;
  const breathe = wave(t, 3.6) * 6 * k;
  const blink = still ? 0 : blinkAt(t);
  const base: HomiPoseValues = {
    bob: breathe, blink, gazeX: wave(t, 7.3) * 0.25 * k, gazeY: 0, brow: 0,
    mouth: [0.05, 0.55, 0], glow: 0.15, headTilt: wave(t, 6.1) * 1.5 * k,
    armL: { sh: 6, el: 4 }, armR: { sh: 6, el: 4 },
  };
  switch (state) {
    case 'greeting':
    case 'goodbye':
      return { ...base, brow: 0.35, mouth: [0.35, 0.75, 0], glow: 0.35, headTilt: 4,
        armR: { sh: 150, el: 18 + wave(t, 0.7) * 18 * k, hand: wave(t, 0.7) * 10 * k, pose: 'open' } };
    case 'listening':
      return { ...base, headTilt: 5, brow: 0.3, gazeX: 0, mouth: [0.02, 0.5, 0] };
    case 'thinking':
      return { ...base, headTilt: -4, brow: 0.45, gazeX: -0.55, gazeY: -0.6, mouth: [0.02, 0.3, 0.2],
        armL: { sh: 40, el: 120, pose: 'relaxed' } };
    case 'searching':
      return { ...base, gazeX: wave(t, 1.6) * 0.9 * k, gazeY: -0.15, brow: 0.25, headTilt: wave(t, 1.6) * 3 * k };
    case 'explaining':
      return { ...base, brow: 0.2, mouth: [0.18 + Math.abs(wave(t, 0.36)) * 0.35 * k, 0.6, 0.1], glow: 0.25,
        armL: { sh: 34 + wave(t, 2.4) * 6 * k, el: 70, pose: 'open' } };
    case 'happy':
      return { ...base, bob: breathe * 1.6, brow: 0.4, mouth: [0.3, 0.95, 0], glow: 0.55 };
    case 'surprised':
      return { ...base, brow: 1, mouth: [0.55, 0.4, 0.9], gazeY: -0.2, headTilt: -2 };
    case 'encouraging':
      return { ...base, brow: 0.3, mouth: [0.22, 0.85, 0], glow: 0.4, headTilt: 3 + wave(t, 1.2) * 2 * k,
        armR: { sh: 70, el: 95, pose: 'open' } };
    case 'success':
      return { ...base, bob: breathe * 1.4, brow: 0.5, mouth: [0.32, 1, 0], glow: 1,
        armL: { sh: 130, el: 20, pose: 'open' }, armR: { sh: 130, el: 20, pose: 'open' } };
    case 'error':
      return { ...base, brow: -0.35, headTilt: -6, mouth: [0.02, 0.45, 0.15], gazeY: 0.3, glow: 0.05,
        armR: { sh: 26, el: 60, pose: 'stop' } };
    case 'pointing':
      return { ...base, gazeX: 0.8, headYaw: 0.25, brow: 0.25, mouth: [0.15, 0.7, 0],
        armR: { sh: 95, el: 8, hand: -80, pose: 'point' } };
    case 'idle':
    default:
      return base;
  }
}

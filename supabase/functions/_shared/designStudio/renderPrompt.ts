// HOMATCH DESIGN STUDIO — what an image model is told, and what a view may be.
//
// A finish prompt is built ONLY from the design's look words (PropertyDesignDNA
// .look, lighting) and the room's kind, wrapped in fixed instructions to keep
// the camera, the layout and every object exactly where Blender drew them.
// The customer's free-text brief is never forwarded, and any look word that
// talks about geometry (walls, windows, moving, adding, bigger…) is dropped:
// the picture may change how the home LOOKS, never what or where it is.
//
// Pure: no I/O.

import type { PropertyDesignDNA, RenderEdit, SpecView } from '../../../../src/lib/designStudio/renders/contract.ts';

/** Words that would invite a change of structure; a look word containing one is dropped. */
export const GEOMETRY_WORDS = /\b(wall|walls|window|windows|door|doors|stair|stairs|ceiling|room|rooms|layout|plan|move|moved|moving|add|added|adding|remove|removed|removing|delete|bigger|smaller|larger|wider|taller|extend|extension|open[- ]?plan|camera|angle|view|zoom|crop|reframe|perspective|lens|furniture|sofa|table|bed|chair|metre|meter|meters|metres|cm|feet|foot|\d)\b/i;
const SAFE = /^[\p{L}][\p{L}\p{M} '-]{0,38}$/u;

/** The DNA's look words, cleaned: letters only, short, no geometry, at most 12. */
export function lookWords(dna: PropertyDesignDNA | null): string[] {
  const out: string[] = [];
  for (const raw of Array.isArray(dna?.look) ? dna!.look : []) {
    if (typeof raw !== 'string') continue;
    const w = raw.trim().replace(/\s+/g, ' ');
    if (!SAFE.test(w) || GEOMETRY_WORDS.test(w)) continue;
    if (!out.includes(w.toLowerCase())) out.push(w.toLowerCase());
    if (out.length >= 12) break;
  }
  return out;
}

const ROOM_WORDS: Record<string, string> = {
  LIVING: 'living room', KITCHEN: 'kitchen', BEDROOM: 'bedroom', BATHROOM: 'bathroom', WC: 'toilet', DINING: 'dining room',
  HALL: 'hallway', CORRIDOR: 'hallway', ENTRANCE: 'entrance hall', STUDY: 'study', OFFICE: 'home office', BALCONY: 'balcony',
  TERRACE: 'terrace', LAUNDRY: 'laundry', STORAGE: 'storage room', CLOSET: 'walk-in closet', KIDS: "children's room",
};
/** A room kind as plain words; unknown kinds read as "interior" (nothing invented). */
export function roomWords(kind: string | null | undefined): string {
  if (typeof kind !== 'string' || !/^[A-Z_]{1,30}$/.test(kind)) return 'interior';
  return ROOM_WORDS[kind] ?? 'interior';
}

const LIGHT: Record<string, string> = { DAY: 'soft natural daylight', EVENING: 'warm evening light with lamps on', NIGHT: 'night-time interior lighting' };
const TEMP: Record<string, string> = { WARM: 'warm colour temperature', NEUTRAL: 'neutral colour temperature', COOL: 'cool colour temperature' };

export const KEEP_STRUCTURE = [
  'Keep EXACTLY the same camera position, lens, framing and perspective.',
  'Keep every wall, floor edge, door, window, opening and stair exactly where it is, with the same shape.',
  'Keep every piece of furniture and every object exactly where it is, with the same size, shape and orientation.',
  'Do not add, remove, move, resize or replace anything. Do not add people, text, logos or watermarks.',
].join(' ');

/** The finish prompt: fixed structure instructions + look words + lighting + room kind. Nothing else. */
export function finishPrompt(input: { dna: PropertyDesignDNA | null; viewKind: 'MASTER' | 'ROOM'; roomKind: string | null }): string {
  const subject = input.viewKind === 'MASTER'
    ? 'a cut-away dollhouse view of a whole furnished home seen from above (the walls stay cut at the same height and the ceilings stay removed)'
    : `a ${roomWords(input.roomKind)} photographed at eye level`;
  const words = lookWords(input.dna);
  const l = input.dna?.lighting;
  const light = [l && LIGHT[l.timeOfDay], l && TEMP[l.temperature]].filter(Boolean).join(', ');
  return [
    `This is a 3D rendering of ${subject}. Make it look like a professional architectural photograph of the same scene.`,
    KEEP_STRUCTURE,
    'Change only realism: lighting, soft shadows, reflections, material and texture detail, colour grading.',
    words.length ? `Look and character: ${words.join(', ')}.` : '',
    light ? `Lighting: ${light}.` : '',
  ].filter(Boolean).join('\n');
}

const SAFE_LABEL = /[^\p{L}\p{M}0-9 '&-]/gu;
/** The edit prompt: only the masked target's colour/material changes. */
export function editPrompt(edit: Extract<RenderEdit, { type: 'APPEARANCE' }>): string {
  const label = String(edit.label ?? '').replace(SAFE_LABEL, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  const kind = edit.targetKind === 'OBJECT' ? 'object' : edit.targetKind.toLowerCase();
  const colour = edit.color && /^#[0-9a-f]{6}$/i.test(edit.color) ? ` in the colour ${edit.color.toLowerCase()}` : '';
  const material = label ? ` as ${label}` : '';
  return [
    `Inside the masked area only, repaint the ${kind}${material}${colour}.`,
    'Keep its exact outline, edges, shading, shadows, reflections and perspective; it must sit in the scene exactly as before.',
    'Everything outside the masked area must stay exactly as it is, pixel for pixel.',
    KEEP_STRUCTURE,
  ].join('\n');
}

// ── Views ─────────────────────────────────────────────────────────────────

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
const PURPOSES = ['DOLLHOUSE', 'MAIN', 'REVERSE', 'FUNCTION', 'DETAIL', 'CONNECTION'] as const;
const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isXyz = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((n) => isNum(n, -2000, 2000));

/** A SpecView, bounded and type-exact, or null. Unknown fields are dropped. */
export function validateSpecView(raw: unknown): SpecView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== 'string' || !ID.test(v.id)) return null;
  if (v.kind !== 'MASTER' && v.kind !== 'ROOM') return null;
  if (!(PURPOSES as readonly unknown[]).includes(v.purpose)) return null;
  if (v.roomId !== null && !(typeof v.roomId === 'string' && ID.test(v.roomId))) return null;
  if (v.kind === 'ROOM' && v.roomId === null) return null;
  if (!isXyz(v.position) || !isXyz(v.target)) return null;
  const persp = isNum(v.fovDeg, 5, 120); const ortho = isNum(v.orthoScale, 0.5, 500);
  if (persp === ortho) return null; // exactly one projection
  if (!isNum(v.aspect, 0.2, 5) || !Number.isInteger(v.width) || !Number.isInteger(v.height) || !isNum(v.width, 64, 4096) || !isNum(v.height, 64, 4096)) return null;
  if (!Number.isInteger(v.samples) || !isNum(v.samples, 1, 4096)) return null;
  let cut: SpecView['cut'] = null;
  if (v.cut != null) {
    const c = v.cut as Record<string, unknown>;
    if (!isNum(c?.exteriorM, 0.2, 20) || !isNum(c?.interiorM, 0.2, 20)) return null;
    cut = { exteriorM: c.exteriorM as number, interiorM: c.interiorM as number };
  }
  if (typeof v.hideCeilings !== 'boolean' || typeof v.objectMap !== 'boolean') return null;
  return {
    id: v.id, kind: v.kind, purpose: v.purpose as SpecView['purpose'], roomId: (v.roomId as string | null) ?? null,
    position: v.position as [number, number, number], target: v.target as [number, number, number],
    fovDeg: persp ? v.fovDeg as number : null, orthoScale: ortho ? v.orthoScale as number : null,
    aspect: v.aspect as number, width: v.width as number, height: v.height as number, samples: v.samples as number,
    cut, hideCeilings: v.hideCeilings, objectMap: v.objectMap,
  };
}

/** A legend (ObjectMap) read back from the factory, bounded; entries that are not well formed are dropped. */
export function validateLegend(raw: unknown): { width: number; height: number; entries: Array<{ color: string; kind: string; id: string; roomId: string | null; coverage: number; box: [number, number, number, number] }> } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Number.isInteger(r.width) || !Number.isInteger(r.height) || !Array.isArray(r.entries)) return null;
  const KINDS = ['OBJECT', 'FLOOR', 'WALL', 'CEILING', 'STAIRS', 'DOOR', 'WINDOW', 'OTHER'];
  const entries = (r.entries as unknown[]).slice(0, 2000).flatMap((e) => {
    const x = e as Record<string, unknown>;
    if (!x || typeof x.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(x.color) || !KINDS.includes(String(x.kind))) return [];
    if (typeof x.id !== 'string' || x.id.length < 1 || x.id.length > 160) return [];
    const box = Array.isArray(x.box) && x.box.length === 4 && x.box.every((n) => isNum(n, 0, 1)) ? x.box as [number, number, number, number] : [0, 0, 1, 1] as [number, number, number, number];
    return [{ color: x.color.toLowerCase(), kind: String(x.kind), id: x.id, roomId: typeof x.roomId === 'string' ? x.roomId : null, coverage: isNum(x.coverage, 0, 1) ? x.coverage : 0, box }];
  });
  return { width: r.width as number, height: r.height as number, entries };
}

// HOMATCH AI TALK — what the conversation already knows.
//
// WHY A STATE AND NOT JUST THE TRANSCRIPT
//
// The assistant was re-reading the whole conversation every turn and asking
// for things it had already been told. A visitor who opens with "კრწანისში
// მინდა ორ საძინებლიანი ბინა 160 ათასამდე" has given a district, a room count
// and a ceiling in one breath, and being asked "რომელ უბანში ეძებთ?" makes the
// product look like it was not listening.
//
// So facts are accumulated here instead. Each turn contributes what it
// contains; nothing is forgotten because it was not repeated; and the prompt
// carries a short list of what is known and what is still missing rather than
// a growing pile of raw text.
//
// That fixes two things at once. The assistant stops re-asking, and the
// prompt stops growing with the conversation — which is latency, because
// every token in the prompt is time before the first word comes back.
//
// WHAT THIS FILE WILL NOT DO
//
// It does not guess. A budget with no currency stays a number with no
// currency; a district heard once is not upgraded to "confirmed". §42's rule
// holds: a later low-confidence reading never overwrites an earlier explicit
// one unless the visitor actually said something new.

import { extractDeterministic } from './extraction.ts';

export interface TalkState {
  /** BUY / SELL / RENT / INVEST, once they have said. */
  transactionType: string | null;
  propertyType: string | null;
  /** District or city ids, most recently mentioned first. */
  locations: string[];
  budgetMin: number | null;
  budgetMax: number | null;
  /** USD / GEL / EUR, only when actually said. Never assumed. */
  currency: string | null;
  bedrooms: number | null;
  rooms: number | null;
  areaMin: number | null;
  areaMax: number | null;
  floor: number | null;
  parking: boolean | null;
  /** Shell state: მწვანე / თეთრი / შავი კარკასი, new build, finished. */
  condition: string | null;
  investmentGoal: string | null;
  mortgageNeeded: boolean | null;
  /** The language they are speaking, as the transcript settles it. */
  language: string | null;
  /** Short notes the assistant should not lose, oldest first, bounded. */
  notes: string[];
}

export function emptyTalkState(): TalkState {
  return {
    transactionType: null, propertyType: null, locations: [],
    budgetMin: null, budgetMax: null, currency: null,
    bedrooms: null, rooms: null, areaMin: null, areaMax: null,
    floor: null, parking: null, condition: null,
    investmentGoal: null, mortgageNeeded: null, language: null, notes: [],
  };
}

/** Shell states, in the three languages a Tbilisi buyer uses for them. */
const CONDITION_PATTERNS: Array<[RegExp, string]> = [
  [/მწვანე\s*კარკას|green\s*frame/iu, 'GREEN_FRAME'],
  [/თეთრი\s*კარკას|white\s*frame/iu, 'WHITE_FRAME'],
  [/შავი\s*კარკას|black\s*frame|черн\w*\s*карка/iu, 'BLACK_FRAME'],
  [/ახალაშენებ|ახალი\s*(პროექტ|კორპუს|მშენებლ)|new\s*build|новостройк/iu, 'NEW_BUILD'],
  [/მშენებარ|under\s*construction|строящ/iu, 'UNDER_CONSTRUCTION'],
  [/ძველი\s*აშენებ|ძველ\s*ფონდ|old\s*build|старый\s*фонд/iu, 'OLD_BUILD'],
  [/რემონტ\w*\s*(გაკეთებ|დასრულებ)|დასრულებული\s*ბინა|renovated|с\s*ремонтом/iu, 'RENOVATED'],
];

const INVEST_PATTERNS = /ინვესტიცი|investment|invest\b|инвестиц|доходност|ქირის\s*შემოსავ|rental\s*income|roi\b/iu;
const MORTGAGE_PATTERNS = /იპოთეკ|განვადებ|mortgage|ипотек|рассрочк|kredi/iu;
const PARKING_PATTERNS = /პარკინგ|ავტოსადგომ|parking|парковк|otopark/iu;

/**
 * Fold one thing the visitor said into what is already known.
 *
 * `said` is their words, not the assistant's. Feeding the assistant's own
 * questions back in here is how a state ends up "knowing" a district that was
 * only ever offered as an example.
 */
export function updateTalkState(prev: TalkState, said: string, language?: string | null): TalkState {
  const text = String(said ?? '');
  if (!text.trim()) return prev;

  const next: TalkState = { ...prev, locations: [...prev.locations], notes: [...prev.notes] };
  const found = extractDeterministic(text);

  if (found.transactionType && found.transactionType !== 'UNKNOWN') {
    next.transactionType = found.transactionType;
  }
  // Investment is a goal, not a different transaction: somebody buying to let
  // is still buying.
  if (INVEST_PATTERNS.test(text)) {
    next.investmentGoal = 'RENTAL_YIELD';
    if (!next.transactionType) next.transactionType = 'INVEST';
  }

  for (const id of found.locations ?? []) {
    // Most recent first, so a change of mind reads as a change of mind.
    next.locations = [id, ...next.locations.filter((l) => l !== id)].slice(0, 4);
  }

  if (found.budgetMax != null) next.budgetMax = found.budgetMax;
  if (found.budgetMin != null) next.budgetMin = found.budgetMin;
  if (found.currency) next.currency = found.currency;
  if (found.bedrooms != null) next.bedrooms = found.bedrooms;

  const rooms = text.match(/(\d+)\s*(?:ოთახ|комнат|room)/iu);
  if (rooms) {
    const n = Number(rooms[1]);
    if (Number.isFinite(n) && n > 0 && n <= 20) next.rooms = n;
  }

  const area = text.match(/(\d{2,4})\s*(?:კვადრატ|კვ\.?\s*მ|m2|м2|кв\.?\s*м|square\s*met)/iu);
  if (area) {
    const n = Number(area[1]);
    if (Number.isFinite(n) && n >= 15 && n <= 2000) next.areaMin = n;
  }

  const floor = text.match(/(\d{1,2})[\s-]*(?:სართულ|этаж|floor)/iu);
  if (floor) {
    const n = Number(floor[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 60) next.floor = n;
  }

  for (const [re, value] of CONDITION_PATTERNS) {
    if (re.test(text)) { next.condition = value; break; }
  }

  if (MORTGAGE_PATTERNS.test(text)) next.mortgageNeeded = true;
  if (PARKING_PATTERNS.test(text)) next.parking = true;

  if (language) next.language = language;
  return next;
}

/** The order in which missing facts are actually worth asking about. */
const GAP_ORDER: Array<[keyof TalkState | 'budget', string]> = [
  ['transactionType', 'whether they want to buy, rent, sell or invest'],
  ['locations', 'roughly which district or city'],
  ['budget', 'roughly what budget'],
  ['bedrooms', 'how many bedrooms'],
  ['condition', 'a new build or something already finished'],
];

/** What is still unknown, most useful first. Empty when nothing is missing. */
export function stateGaps(state: TalkState): string[] {
  const out: string[] = [];
  for (const [key, label] of GAP_ORDER) {
    if (key === 'budget') {
      if (state.budgetMax == null && state.budgetMin == null) out.push(label);
    } else if (key === 'locations') {
      if (!state.locations.length) out.push(label);
    } else if (state[key as keyof TalkState] == null) {
      out.push(label);
    }
  }
  return out;
}

/**
 * The state as a short line for the prompt.
 *
 * Deliberately terse. This is prepended to every turn, so every word in it is
 * paid for twice: once in money and once in the time before the first word
 * comes back.
 */
export function describeState(state: TalkState): string {
  const bits: string[] = [];
  if (state.transactionType) bits.push(`intent=${state.transactionType}`);
  if (state.investmentGoal) bits.push(`goal=${state.investmentGoal}`);
  if (state.propertyType) bits.push(`type=${state.propertyType}`);
  if (state.locations.length) bits.push(`where=${state.locations.join('/')}`);
  if (state.budgetMin != null || state.budgetMax != null) {
    const cur = state.currency ?? 'currency-not-stated';
    const range = state.budgetMin != null && state.budgetMax != null
      ? `${state.budgetMin}-${state.budgetMax}`
      : state.budgetMax != null ? `up to ${state.budgetMax}` : `from ${state.budgetMin}`;
    bits.push(`budget=${range} ${cur}`);
  }
  if (state.bedrooms != null) bits.push(`bedrooms=${state.bedrooms}`);
  if (state.rooms != null) bits.push(`rooms=${state.rooms}`);
  if (state.areaMin != null) bits.push(`area>=${state.areaMin}m2`);
  if (state.floor != null) bits.push(`floor=${state.floor}`);
  if (state.condition) bits.push(`condition=${state.condition}`);
  if (state.mortgageNeeded) bits.push('mortgage=yes');
  if (state.parking) bits.push('parking=yes');
  for (const note of state.notes.slice(-3)) bits.push(`note=${note}`);
  return bits.join('; ');
}

/** True when enough is known that the assistant should stop interrogating. */
export function stateIsRich(state: TalkState): boolean {
  const known = [
    state.transactionType, state.locations.length ? 'x' : null,
    state.budgetMax ?? state.budgetMin, state.bedrooms ?? state.rooms,
  ].filter((v) => v != null).length;
  return known >= 3;
}

/** Trim anything a browser could have inflated before it reaches a prompt. */
export function sanitiseTalkState(raw: unknown): TalkState {
  const base = emptyTalkState();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;

  const str = (v: unknown, max = 40) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
  const num = (v: unknown, lo: number, hi: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
  };
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);

  return {
    transactionType: str(r.transactionType, 12),
    propertyType: str(r.propertyType, 24),
    locations: Array.isArray(r.locations)
      ? r.locations.map((l) => str(l, 40)).filter((l): l is string => !!l).slice(0, 4)
      : [],
    budgetMin: num(r.budgetMin, 0, 100_000_000),
    budgetMax: num(r.budgetMax, 0, 100_000_000),
    currency: str(r.currency, 3),
    bedrooms: num(r.bedrooms, 0, 20),
    rooms: num(r.rooms, 0, 20),
    areaMin: num(r.areaMin, 0, 5000),
    areaMax: num(r.areaMax, 0, 5000),
    floor: num(r.floor, 0, 60),
    parking: bool(r.parking),
    condition: str(r.condition, 24),
    investmentGoal: str(r.investmentGoal, 24),
    mortgageNeeded: bool(r.mortgageNeeded),
    language: str(r.language, 5),
    notes: Array.isArray(r.notes)
      ? r.notes.map((n) => str(n, 80)).filter((n): n is string => !!n).slice(0, 5)
      : [],
  };
}

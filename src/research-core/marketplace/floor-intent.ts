// HOMATCH FIND PROPERTY — the floors a customer asked for, read from their own words.
//
// The brief's model call is the primary reader, but a floor requirement the model
// drops is silently lost (production search d3d859cc, 2026-10-22: "სართულები კიდე
// 2-დან 8-მდე" became floorPreferences LOW/MIDDLE/HIGH and a first-floor flat was
// ranked first). This is the deterministic backstop: explicit phrases only, in
// Georgian, Russian and English. A phrase it does not recognise yields nothing;
// it never guesses. The number of floors in a BUILDING ("9 სართულიანი", "9-этажный",
// "9-storey") is not a floor range and is never read as one.

import type { NumericRange } from './brief.ts';

export interface FloorIntent {
  range: NumericRange | null;
  notFirst: boolean;
  /** The phrase each bound was read from (audit trail). */
  evidence: string[];
}

const KA_ORDINALS: Array<[RegExp, number]> = [
  [/^პირველ/u, 1], [/^მეორ/u, 2], [/^მესამ/u, 3], [/^მეოთხ/u, 4], [/^მეხუთ/u, 5], [/^მეექვს/u, 6],
  [/^მეშვიდ/u, 7], [/^მერვ/u, 8], [/^მეცხრ/u, 9], [/^მეათ/u, 10],
];
const RU_ORDINALS: Array<[RegExp, number]> = [
  [/^перв/iu, 1], [/^втор/iu, 2], [/^трет/iu, 3], [/^четв[её]рт/iu, 4], [/^пят/iu, 5], [/^шест/iu, 6],
  [/^седьм/iu, 7], [/^восьм/iu, 8], [/^девят/iu, 9], [/^десят/iu, 10],
];
const EN_ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

/** "2", "მე-2", "2-ე", "მეორე", "второго", "2nd", "second" → 2. */
function floorValue(token: string): number | null {
  const t = token.trim().toLowerCase();
  /* A minus is a sign only when no letter precedes it: "მე-2" is the 2nd floor, "-1" a basement. */
  const digits = t.match(/(?<![\p{L}\d])-?\d{1,3}|\d{1,3}/u);
  if (digits) {
    const v = Number(digits[0]);
    return Number.isInteger(v) && v >= -5 && v <= 200 ? v : null;
  }
  for (const [re, v] of KA_ORDINALS) if (re.test(t)) return v;
  for (const [re, v] of RU_ORDINALS) if (re.test(t)) return v;
  return EN_ORDINALS[t] ?? null;
}

// One floor number as people write it.
const KA_N = '(მე-?\\d{1,3}(?:-?ე)?|\\d{1,3}(?:-?ე)?|პირველ\\S*|მეორ\\S*|მესამ\\S*|მეოთხ\\S*|მეხუთ\\S*|მეექვს\\S*|მეშვიდ\\S*|მერვ\\S*|მეცხრ\\S*|მეათ\\S*)';
const RU_N = '(\\d{1,3}(?:-?(?:го|ого|й|ой|м))?|перв\\S*|втор\\S*|трет\\S*|четв[её]рт\\S*|пят\\S*|шест\\S*|седьм\\S*|восьм\\S*|девят\\S*|десят\\S*)';
const EN_N = '(\\d{1,3}(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)';

/** "dan/idan" (from) and "mde" (up to) attach to the number in Georgian, with or without a hyphen. */
const KA_FROM = `${KA_N}\\s*-?\\s*(?:დან|იდან)`;
const KA_TO = `${KA_N}\\s*-?\\s*მდე`;

interface Rule { re: RegExp; read: (m: RegExpMatchArray) => Partial<NumericRange> | 'NOT_FIRST' | null }

const RULES: Rule[] = [
  // Georgian: "სართულები 2-დან 8-მდე", "2-დან 8-მდე სართული", "მე-2-დან მე-8 სართულამდე"
  { re: new RegExp(`სართულ(?!იან)\\S*\\s+(?:\\S+\\s+){0,3}?${KA_FROM}\\s+${KA_TO}`, 'u'), read: (m) => ({ min: floorValue(m[1]), max: floorValue(m[2]) }) },
  { re: new RegExp(`${KA_FROM}\\s+${KA_N}\\s*-?\\s*(?:მდე\\s+სართულ(?!იან)|სართულამდე)`, 'u'), read: (m) => ({ min: floorValue(m[1]), max: floorValue(m[2]) }) },
  // "მეორე სართულიდან (ზემოთ)", "2 სართულიდან", "მე-2 სართულიდან"
  { re: new RegExp(`${KA_N}\\s*-?\\s*სართულიდან`, 'u'), read: (m) => ({ min: floorValue(m[1]) }) },
  // "მე-8 სართულამდე"
  { re: new RegExp(`${KA_N}\\s*-?\\s*სართულამდე`, 'u'), read: (m) => ({ max: floorValue(m[1]) }) },
  // "არა პირველ სართულზე", "პირველი სართული არ (მინდა|მაწყობს)", "პირველის გარდა"
  { re: /(?:არა|არ\s+(?:იყოს|მინდა|მაწყობს))\s+პირველ\S*\s+სართულ|პირველი\s+სართული\s+არ\s|პირველი?\s+სართულის\s+გარდა/u, read: () => 'NOT_FIRST' },

  // Russian: "с 2 по 8 этаж", "от 2 до 8 этажа", "этаж с 2 по 8"
  { re: new RegExp(`(?:с|от)\\s+${RU_N}\\s+(?:по|до)\\s+${RU_N}\\s+этаж(?!н)`, 'iu'), read: (m) => ({ min: floorValue(m[1]), max: floorValue(m[2]) }) },
  { re: new RegExp(`этаж\\S*\\s+(?:с|от)\\s+${RU_N}\\s+(?:по|до)\\s+${RU_N}`, 'iu'), read: (m) => ({ min: floorValue(m[1]), max: floorValue(m[2]) }) },
  // "не ниже 2 этажа", "с 2 этажа (и выше)", "2 этаж и выше"
  { re: new RegExp(`не\\s+ниже\\s+${RU_N}\\s+этаж(?!н)`, 'iu'), read: (m) => ({ min: floorValue(m[1]) }) },
  { re: new RegExp(`(?:^|\\s)(?:с|от)\\s+${RU_N}\\s+этаж(?!н)`, 'iu'), read: (m) => ({ min: floorValue(m[1]) }) },
  { re: new RegExp(`${RU_N}\\s+этаж\\S*\\s+и\\s+выше`, 'iu'), read: (m) => ({ min: floorValue(m[1]) }) },
  { re: new RegExp(`не\\s+выше\\s+${RU_N}\\s+этаж(?!н)`, 'iu'), read: (m) => ({ max: floorValue(m[1]) }) },
  { re: /не\s+(?:на\s+)?перв\S*\s+этаж|кроме\s+перв\S*\s+этаж/iu, read: () => 'NOT_FIRST' },

  // English: "floors 2-8", "2nd to 8th floor", "between the 2nd and 8th floor"
  { re: new RegExp(`floors?\\s+${EN_N}\\s*(?:-|–|to)\\s*${EN_N}\\b`, 'i'), read: (m) => ({ min: floorValue(m[1]), max: floorValue(m[2]) }) },
  { re: new RegExp(`${EN_N}\\s*(?:-|–|to)\\s*${EN_N}\\s+floors?\\b`, 'i'), read: (m) => ({ min: floorValue(m[1]), max: floorValue(m[2]) }) },
  { re: new RegExp(`between\\s+(?:the\\s+)?${EN_N}\\s+and\\s+(?:the\\s+)?${EN_N}\\s+floors?\\b`, 'i'), read: (m) => ({ min: floorValue(m[1]), max: floorValue(m[2]) }) },
  // "from the 2nd floor (up)", "2nd floor and above", "not below the 2nd floor"
  { re: new RegExp(`(?:from|starting (?:from|at)|not below)\\s+(?:the\\s+)?${EN_N}\\s+floor\\b`, 'i'), read: (m) => ({ min: floorValue(m[1]) }) },
  { re: new RegExp(`${EN_N}\\s+floor\\s+(?:and|or)\\s+(?:above|up|higher)\\b`, 'i'), read: (m) => ({ min: floorValue(m[1]) }) },
  { re: new RegExp(`(?:up to|no higher than|not above)\\s+(?:the\\s+)?${EN_N}\\s+floor\\b`, 'i'), read: (m) => ({ max: floorValue(m[1]) }) },
  { re: /\bnot\s+(?:on\s+)?(?:the\s+)?(?:first|ground)\s+floor\b/i, read: () => 'NOT_FIRST' },
];

export function statedFloorIntent(text: string | null | undefined): FloorIntent {
  const source = String(text ?? '').replace(/\s+/g, ' ');
  let min: number | null = null;
  let max: number | null = null;
  let notFirst = false;
  const evidence: string[] = [];
  for (const rule of RULES) {
    const m = source.match(rule.re);
    if (!m) continue;
    const read = rule.read(m);
    if (read === 'NOT_FIRST') { notFirst = true; evidence.push(m[0].trim()); continue; }
    if (!read) continue;
    let used = false;
    if (read.min != null && min === null) { min = read.min; used = true; }
    if (read.max != null && max === null) { max = read.max; used = true; }
    if (used) evidence.push(m[0].trim());
  }
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  return { range: min === null && max === null ? null : { min, max }, notFirst, evidence };
}

/** Is a floor bound one the customer actually said (a digit or an ordinal word in their text)? */
export function floorTraceable(value: number | null, text: string): boolean {
  if (value === null) return true;
  const source = String(text ?? '');
  if (new RegExp(`(?<!\\d)${Math.abs(value)}(?!\\d)`).test(source)) return true;
  return [...source.matchAll(/[\p{L}]+/gu)].some((w) => floorValue(w[0]) === value
    && !/^\d/.test(w[0]));
}

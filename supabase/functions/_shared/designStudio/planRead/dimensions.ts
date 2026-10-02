// HOMATCH DESIGN STUDIO — a printed dimension, read as numbers.
//
// The model copies the text exactly as printed ("10'X14'", "6'-4\"X4'-3\"",
// "3,20×4,10", "320x410 cm"); this turns it into metres deterministically,
// so arithmetic is never the model's job. Feet-and-inches, metric with or
// without a unit, unicode primes, decimal commas (ka/ru/tr usage), Cyrillic
// "х" and "×" as the multiplication sign. When the unit is not printed it is
// inferred from the shape of the numbers and the confidence says so.
//
// Pure and dependency-free (Deno + Node + browser).

export type DimensionUnit = 'ft' | 'm' | 'cm' | 'mm' | 'unknown';

export interface ParsedDimension {
  /** Metres, in printed order. One value ("20'-0\"") or two ("10'X14'"). */
  values: number[];
  unit: DimensionUnit;
  /** 0–1: how sure the reading of the TEXT is (not whether the drawing is right). */
  confidence: number;
}

const FT = 0.3048;
const IN = 0.0254;

/** Normalise the many ways a plan prints the same thing. */
function normalise(text: string): string {
  let s = ` ${text} `;
  s = s.replace(/[′’‘´`]/g, "'"); // ′ ’ ‘ ´ ` → '
  s = s.replace(/[″”“]/g, '"'); // ″ ” “ → "
  s = s.replace(/''/g, '"');
  s = s.replace(/[×✕✖хХ*]/g, ' x '); // × ✕ ✖ х Х *
  s = s.replace(/(\d)\s*[xX]\s*(?=[\d.,])/g, '$1 x ');
  s = s.replace(/\s(by|на)\s/gi, ' x ');
  // Units in other scripts.
  s = s.replace(/(\d)\s*(мм)/g, '$1 mm').replace(/(\d)\s*(см)/g, '$1 cm').replace(/(\d)\s*(м|მ|מ'|م)(?![a-zа-я])/gi, '$1 m');
  s = s.replace(/\b(feet|foot)\b/gi, 'ft').replace(/\b(inches|inch)\b/gi, 'in');
  s = s.replace(/\b(metres|meters|metre|meter)\b/gi, 'm');
  return s;
}

interface Part { metres: number; unit: DimensionUnit | null; feet: boolean; inchesOnly: boolean; decimal: boolean; raw: number }

/** One length, or null. `unit` is null when nothing in the token states it. */
function parsePart(token: string): Part | null {
  const t = token.trim();
  if (!t) return null;
  // Feet and/or inches: 20' · 20'-0" · 3'6" · 4' 3" · 3'6 · 10ft 6in · 6"
  const imp = t.match(/^(?:(\d+(?:\.\d+)?)\s*(?:'|ft\.?))?\s*-?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in\.?)?)?$/i);
  if (imp && (imp[1] != null || (imp[2] != null && /("|in)/i.test(t)))) {
    const feet = imp[1] != null ? Number(imp[1]) : 0;
    const inches = imp[2] != null ? Number(imp[2]) : 0;
    if (imp[1] != null && imp[2] != null && inches >= 12) return null;
    return {
      metres: feet * FT + inches * IN, unit: 'ft', feet: imp[1] != null, inchesOnly: imp[1] == null,
      decimal: false, raw: feet + inches / 12,
    };
  }
  const met = t.match(/^(\d+(?:\.\d+)?)\s*(mm|cm|m)?\.?$/i);
  if (met) {
    const v = Number(met[1]);
    const unit = met[2] ? (met[2].toLowerCase() as DimensionUnit) : null;
    return { metres: v, unit, feet: false, inchesOnly: false, decimal: met[1].includes('.'), raw: v };
  }
  return null;
}

const plausibleRoom = (m: number) => m >= 0.25 && m <= 120;

/**
 * Parse a printed dimension. Returns null when the text holds no dimension
 * (a room name alone, an area such as "12.5 m²").
 */
export function parseDimension(text: string | null | undefined): ParsedDimension | null {
  if (typeof text !== 'string' || !text.trim() || text.length > 120) return null;
  if (/(m²|m2\b|sq\.?\s*(ft|m)|кв\.?\s*м|მ²|㎡|ft²)/i.test(text)) return null;
  let s = normalise(text);
  // A decimal comma between digits ("3,20") is a decimal point; a comma
  // before exactly three digits with an mm/cm unit is a thousands separator.
  s = s.replace(/(\d),(\d{3})(?=\s*(mm|cm))/gi, '$1$2');
  s = s.replace(/(\d) (\d{3})(?=\s*(mm|cm))/gi, '$1$2');
  s = s.replace(/(\d),(\d)/g, '$1.$2');
  // Keep only what can be part of a dimension: numbers, units, primes and
  // the multiplication sign. Room names and other words fall away.
  const tokens = s.match(/\d+(?:\.\d+)?|(?<![a-z])(?:mm|cm|ft|in|m)(?![a-z])|['"]|(?<![a-z])x(?![a-z])/gi) ?? [];
  const chunks: string[][] = [[]];
  for (const tok of tokens) {
    if (/^x$/i.test(tok)) chunks.push([]);
    else chunks[chunks.length - 1].push(tok.toLowerCase());
  }
  const texts = chunks.filter((c) => c.some((t) => /\d/.test(t))).map((c) => c.join(' '));
  if (texts.length === 0 || texts.length > 3) return null;

  // A unit printed once at the end ("320x410 cm") applies to every part.
  const parts: Part[] = [];
  for (const c of texts) {
    const p = parsePart(c);
    if (!p) return null;
    parts.push(p);
  }

  let confidence = 0.95;
  let unit: DimensionUnit;
  const anyFeet = parts.some((p) => p.unit === 'ft');
  if (anyFeet) {
    unit = 'ft';
    // "10''X14'": a room 10 INCHES wide is not a room; when the other side
    // is in feet, an inches-only part under a foot is a mistyped foot mark.
    for (const p of parts) {
      if (p.unit === 'ft' && p.inchesOnly && p.metres < 0.3 && parts.some((q) => q.feet)) {
        p.metres = p.raw * 12 * FT; // it was read as raw/12 feet; the printed number is feet
        confidence = Math.min(confidence, 0.6);
      }
    }
    for (const p of parts) {
      if (p.unit !== 'ft') { p.metres *= FT; confidence = Math.min(confidence, 0.7); }
    }
  } else {
    const stated = parts.find((p) => p.unit)?.unit ?? null;
    if (stated) {
      unit = stated;
      for (const p of parts) {
        const u = p.unit ?? stated;
        p.metres = u === 'mm' ? p.metres / 1000 : u === 'cm' ? p.metres / 100 : p.metres;
      }
    } else {
      // No unit anywhere: infer from the numbers' shape.
      const max = Math.max(...parts.map((p) => p.raw));
      const anyDecimal = parts.some((p) => p.decimal);
      if (anyDecimal && max <= 60) { unit = 'm'; confidence = 0.8; }
      else if (!anyDecimal && max >= 1000 && max <= 60000) { unit = 'mm'; confidence = 0.75; for (const p of parts) p.metres /= 1000; }
      else if (!anyDecimal && max >= 100 && max < 1000) { unit = 'cm'; confidence = 0.7; for (const p of parts) p.metres /= 100; }
      else { unit = 'unknown'; confidence = 0.3; }
    }
  }
  const values = parts.map((p) => Math.round(p.metres * 10000) / 10000);
  if (values.some((v) => !plausibleRoom(v))) return null;
  return { values, unit, confidence };
}

/** Metres formatted for a stored, re-parseable dimension text ("3.050 x 4.270 m"). */
export function formatMetres(v: number[] | number): string {
  const list = Array.isArray(v) ? v : [v];
  return `${list.map((n) => n.toFixed(3)).join(' x ')} m`;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  hellip: '...',
  laquo: '"',
  raquo: '"',
  ldquo: '"',
  rdquo: '"',
  lsquo: "'",
  rsquo: "'",
  euro: '€',
  pound: '£',
  yen: '¥',
  copy: '©',
  reg: '®',
  deg: '°',
  sup2: '²',
  middot: '·',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

export function collapseWhitespace(input: string): string {
  return input.replace(/[  \t\r\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function truncate(input: string, maxLength: number, suffix = '...'): string {
  if (input.length <= maxLength) return input;
  return input.slice(0, Math.max(0, maxLength - suffix.length)).trimEnd() + suffix;
}

/** Extract a readable excerpt around the first match of any keyword. */
export function excerptAround(text: string, keywords: readonly string[], radius = 120): string | null {
  const lower = text.toLowerCase();
  for (const keyword of keywords) {
    const index = lower.indexOf(keyword.toLowerCase());
    if (index === -1) continue;
    const start = Math.max(0, index - radius);
    const end = Math.min(text.length, index + keyword.length + radius);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';
    // Single line: an excerpt is for display next to a finding, and embedded
    // newlines from a key/value projection make it unreadable there.
    const body = collapseWhitespace(text.slice(start, end)).split('\n').join(' | ');
    return `${prefix}${body}${suffix}`;
  }
  return null;
}

export function normalizeForCompare(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token-set Jaccard similarity. Order-insensitive, 0..1. */
export function tokenSimilarity(a: string, b: string): number {
  const setA = new Set(normalizeForCompare(a).split(' ').filter(Boolean));
  const setB = new Set(normalizeForCompare(b).split(' ').filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection += 1;
  return intersection / (setA.size + setB.size - intersection);
}

export function containsAny(text: string, needles: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((needle) => lower.includes(needle.toLowerCase()));
}

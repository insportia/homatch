/*
 * HOMI writes without em and en dashes (owner instruction, 2026-10-24): they
 * read as machine-written. The prompt says so; this is the safety net for the
 * turns where a model does it anyway. Ordinary hyphens inside words
 * (HOMATCH-ის, HOMI-ს, ნაბიჯ-ნაბიჯ) are never touched.
 *
 *   "6–12 months"      → "6-12 months"      (a range keeps a plain hyphen)
 *   "a — b", "a—b"     → "a, b"             (a clause break becomes a comma)
 *   "— a" at line start→ "a"                (a dash used as a bullet goes)
 *
 * Runtime-neutral; safe on partial streamed text because a dash is one
 * character and is replaced where it stands.
 */
export function stripAiDashes(text: string): string {
  return text
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2')
    .replace(/(^|\n)[ \t]*[–—][ \t]*/g, '$1')
    .replace(/[ \t]*[–—][ \t]*/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*([.!?:;])/g, '$1');
}

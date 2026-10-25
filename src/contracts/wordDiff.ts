// CONTRACT INTELLIGENCE — what exactly a proposed wording changes, word by word.
//
// The review used to show the contract's words and the proposed words as two
// separate paragraphs and leave the reader to find the difference. On a
// 400-character clause where four words change, that is a puzzle, and the
// owner's complaint was exactly that: "show what changed, what did not".
//
// This is a plain word-level diff (longest common subsequence over tokens):
//
//   · tokens are runs of letters/digits, single punctuation marks, and runs of
//     whitespace, so "30 days," → "45 days," marks only the number;
//   · whitespace matches any whitespace: PDF extraction wraps lines where the
//     model does not, and a line break is not a change in meaning;
//   · above a size cap (two very long texts) it does not attempt the table and
//     reports the whole passage as replaced, which is honest and cheap.
//
// Pure: no React, no DOM. The review card renders the segments.

export type DiffKind = 'same' | 'del' | 'ins';
export interface DiffSegment { kind: DiffKind; text: string }

/** Beyond this many table cells the diff is not computed (about 600 × 600 tokens). */
const MAX_CELLS = 360_000;

const TOKEN = /[\p{L}\p{N}\p{M}]+|\s+|[^\p{L}\p{N}\p{M}\s]/gu;

export function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

const isSpace = (t: string) => /^\s+$/.test(t);
const same = (a: string, b: string) => a === b || (isSpace(a) && isSpace(b));

function push(out: DiffSegment[], kind: DiffKind, text: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.kind === kind) last.text += text;
  else out.push({ kind, text });
}

/**
 * Word-level diff from `before` to `after`. Concatenating the `same` and `del`
 * segments gives `before` back; `same` and `ins` give `after` (whitespace in
 * `same` segments is taken from `after`, the text that will be written).
 */
export function wordDiff(before: string, after: string): DiffSegment[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const out: DiffSegment[] = [];
  if (!a.length && !b.length) return out;
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    push(out, 'del', before);
    push(out, 'ins', after);
    return out;
  }

  // lcs[i][j] = LCS length of a[i..] and b[j..], in one flat typed array.
  const w = b.length + 1;
  const lcs = new Uint16Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * w + j] = same(a[i], b[j])
        ? lcs[(i + 1) * w + j + 1] + 1
        : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (same(a[i], b[j])) { push(out, 'same', b[j]); i++; j++; }
    else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) { push(out, 'del', a[i]); i++; }
    else { push(out, 'ins', b[j]); j++; }
  }
  while (i < a.length) push(out, 'del', a[i++]);
  while (j < b.length) push(out, 'ins', b[j++]);
  return tidy(out);
}

/**
 * A lone space kept as "same" between two changes reads as noise
 * ("~~a~~ __b__ ~~c~~ __d__"). Fold it into the changes on both sides so
 * the reader sees one removed phrase and one added phrase.
 */
function tidy(segs: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  let block: { del: string; ins: string } | null = null;
  const close = () => {
    if (!block) return;
    push(out, 'del', block.del);
    push(out, 'ins', block.ins);
    block = null;
  };
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k];
    if (s.kind !== 'same') {
      block ??= { del: '', ins: '' };
      block[s.kind] += s.text;
      continue;
    }
    const next = segs[k + 1];
    if (block && isSpace(s.text) && next && next.kind !== 'same') {
      // The space belonged to both texts: it stays in both runs.
      block.del += s.text;
      block.ins += s.text;
      continue;
    }
    close();
    push(out, 'same', s.text);
  }
  close();
  return out;
}

const words = (s: string) => (s.match(/[\p{L}\p{N}\p{M}]+/gu) ?? []).length;

/** How much the proposal changes: words removed, words added, words kept. */
export function diffStats(segs: DiffSegment[]): { removed: number; added: number; kept: number } {
  let removed = 0, added = 0, kept = 0;
  for (const s of segs) {
    if (s.kind === 'del') removed += words(s.text);
    else if (s.kind === 'ins') added += words(s.text);
    else kept += words(s.text);
  }
  return { removed, added, kept };
}

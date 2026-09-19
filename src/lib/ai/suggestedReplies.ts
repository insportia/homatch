// WHAT COMES BACK FROM THE MODEL, AND WHAT IS ALLOWED ON A SCREEN.
//
// A suggested reply is one thing the PERSON might say next, rendered as
// a button. Clicking it sends that text as their turn. That is the
// entire contract, and the narrowness is the point: a chip cannot open
// a page, call a function, change a setting or spend money, because
// nothing downstream of it does anything except send text.
//
// WHY THE VALIDATION LIVES HERE AND RUNS ON THE SERVER
//
// The list is produced by a language model, which means it is
// untrusted input that happens to arrive from our own provider. It can
// be the wrong shape, too long, empty, duplicated, or carry text that
// is trying to be an instruction rather than a reply. None of that is
// the browser's problem to notice. The edge function runs this before
// the payload is sent, so the UI only ever receives a list that is
// already valid — and the same module is imported by the tests, so
// "already valid" has one definition.
//
// No React, no Deno, no Supabase: importable from the browser bundle,
// from an edge function by relative path, and from node:test directly.

/** One thing the person might say next. */
export interface SuggestedReply {
  /** Stable within a response. Used as a React key and in analytics. */
  id: string;
  /** What the button shows. */
  label: string;
  /** What is sent as the user's message. Usually the same as the label. */
  value: string;
}

/**
 * Four.
 *
 * Not a style preference: five chips wrap to three rows on a 320px
 * screen, and a person scanning a list of five is choosing rather than
 * answering. The model is asked for "up to four" and this is the hard
 * ceiling behind that request.
 */
export const MAX_SUGGESTED_REPLIES = 4;

/** A chip has to fit on a phone without becoming a paragraph. */
export const MAX_SUGGESTED_LABEL_LENGTH = 48;

/** The sent message may be a little longer than the label, but not much. */
export const MAX_SUGGESTED_VALUE_LENGTH = 120;

/**
 * Text that is trying to be an instruction rather than an answer.
 *
 * Two different risks share this list. One is prompt injection arriving
 * through a compromised or confused model — a "reply" that is really a
 * directive aimed at the next turn. The other is a suggestion that
 * pretends to be an application action ("Open Verify"), which would
 * teach people that chips navigate, and then the one that does not
 * reads as broken. Neither belongs in something whose whole meaning is
 * "the user said this".
 */
const REJECT_PATTERNS: RegExp[] = [
  /^\s*(?:https?:)?\/\//i,
  /\b(?:javascript|data|vbscript):/i,
  /<\s*\/?\s*[a-z][\s\S]*>/i,
  /\{\{|\}\}/,
  /\[\[|\]\]/,
  /```/,
  /\bignore (?:all |any |the )?(?:previous|prior|above)\b/i,
  /\byou are now\b/i,
  /\bsystem prompt\b/i,
  /^\s*\/[a-z]/i,
];

function normalise(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Collapse every run of whitespace, including the newlines a model
  // sometimes puts inside a "short" label.
  return value.replace(/[\s ]+/g, ' ').trim();
}

function unsafe(text: string): boolean {
  return REJECT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Turn whatever the model returned into a list that is safe to render.
 *
 * Never throws and never returns anything but a valid array: a
 * malformed block means no chips, which is a slightly poorer answer
 * rather than a broken one. Order is preserved — the model puts the
 * most likely reply first and that is worth keeping.
 */
export function parseSuggestedReplies(raw: unknown): SuggestedReply[] {
  if (!Array.isArray(raw)) return [];

  const out: SuggestedReply[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (out.length >= MAX_SUGGESTED_REPLIES) break;

    // A bare string is a reasonable thing for a model to produce, and
    // refusing it would throw away a usable suggestion on a technicality.
    const label = normalise(typeof entry === 'string' ? entry : (entry as { label?: unknown })?.label);
    if (!label) continue;

    const rawValue = typeof entry === 'string' ? entry : (entry as { value?: unknown })?.value;
    const value = normalise(rawValue) || label;

    if (label.length > MAX_SUGGESTED_LABEL_LENGTH) continue;
    if (value.length > MAX_SUGGESTED_VALUE_LENGTH) continue;
    if (unsafe(label) || unsafe(value)) continue;

    // Two chips that send the same thing are one chip and one wasted
    // slot. Compared case-insensitively because a model will happily
    // offer "Tbilisi" and "tbilisi".
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ id: `s${out.length + 1}`, label, value });
  }

  // One chip is not a choice, it is a nudge — and a single "Yes" under
  // an answer reads as the product having run out of ideas. Two is the
  // floor for offering a decision.
  return out.length >= 2 ? out : [];
}

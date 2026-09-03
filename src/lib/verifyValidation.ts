// Verification Center — shared per-mode input validation.
//
// IMPORTANT: this exact logic is duplicated (not imported — Edge Functions are
// a separate Deno deployment and cannot import from src/) inside
// supabase/functions/homatch-research/index.ts as `validateVerifyQuery`.
// Any change here MUST be mirrored there, and vice versa, so the frontend
// can never be more permissive than the backend (or a direct API call could
// bypass the UI's guardrails).
//
// Exactly two modes:
//  - cadastral: an official Georgian cadastral code lookup (strict format gate).
//  - property: everything else — a specific listing, a developer/company name,
//    a project/building name, a street address, a URL, or free-text
//    description. Company/developer/project checks used to be separate modes;
//    they are all "identify and research this entity" and are handled by the
//    same entity-resolution pipeline server-side, so the input gate is shared.

export type VerifyMode = 'property' | 'cadastral';

export type VerifyReasonCode =
  | 'EMPTY'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'INVALID_FORMAT'
  | 'LOOKS_LIKE_QUESTION';

export interface VerifyValidationResult {
  valid: boolean;
  reasonCode?: VerifyReasonCode;
  normalized?: string;
}

// Georgian cadastral codes ("საკადასტრო კოდი") are dot-separated numeric
// segments whose count varies by what they identify: a land parcel is
// typically 4-5 segments (e.g. 01.10.09.001), a building/apartment adds one
// or two more (01.10.09.001.001), and a sub-unit (parking space, storage,
// individual apartment within a building) can add a further segment
// (01.10.09.001.001.501). We deliberately do not assume a fixed segment
// count — 4 to 12 segments of 1-6 digits each covers every real-world
// cadastral code shape without accepting arbitrary dotted numbers.
const CADASTRAL_RE = /^\d{1,6}(\.\d{1,6}){3,11}$/;

// A bare URL (property listing page, developer/project site, news article,
// social profile) is always a valid "property" query regardless of its
// content — it isn't natural language, so the question/noise heuristics
// below don't apply to it.
const URL_RE = /^https?:\/\/\S+$/i;

// Conversational / instruction-style phrasing that should never reach the
// research provider as an entity name or description — this is a heuristic
// guard against random unrelated questions and prompt-injection attempts,
// not a full intent classifier. Deliberately multilingual (en/ka/ru/tr/ar/
// he) since Homatch is used in all six.
const QUESTION_WORDS =
  /\b(who is|what is|why|explain|tell me|write me|generate|translate|joke|poem|story|ignore (all|previous)|system prompt|jailbreak|ვინ არის|რა არის|რატომ|ახსენი|მომიყევი|дней|кто такой|что такое|почему|расскажи|напиши|объясни|kimdir|nedir|neden|açıkla|anlat|yazı|من هو|ما هو|لماذا|اشرح|أخبرني|اكتب|מי זה|מה זה|למה|הסבר|ספר לי|כתוב)\b/iu;

function normalizeWhitespace(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function validateVerifyQuery(mode: VerifyMode, rawInput: string): VerifyValidationResult {
  const raw = typeof rawInput === 'string' ? rawInput : '';
  const value = normalizeWhitespace(raw);

  if (!value) return { valid: false, reasonCode: 'EMPTY' };

  if (mode === 'cadastral') {
    // Cadastral codes carry no internal spaces — collapse harmless whitespace
    // around the dots but never rewrite free text into a fake cadastral query.
    const compact = value.replace(/\s+/g, '');
    if (compact.length < 6 || compact.length > 60) return { valid: false, reasonCode: 'INVALID_FORMAT' };
    if (!CADASTRAL_RE.test(compact)) return { valid: false, reasonCode: 'INVALID_FORMAT' };
    return { valid: true, normalized: compact };
  }

  // mode === 'property' — flexible entity/URL/address/description input.
  if (value.length < 2) return { valid: false, reasonCode: 'TOO_SHORT' };

  // Long enough for a full listing title, an address, a short developer
  // profile blurb, or a paragraph of context pasted in by the user — but
  // still bounded so this can't become a prompt-injection payload.
  const maxLen = 500;
  if (value.length > maxLen) return { valid: false, reasonCode: 'TOO_LONG' };

  const isUrl = URL_RE.test(value);

  if (!isUrl) {
    if (/[?？]/.test(value)) return { valid: false, reasonCode: 'LOOKS_LIKE_QUESTION' };
    if (QUESTION_WORDS.test(value)) return { valid: false, reasonCode: 'LOOKS_LIKE_QUESTION' };
    if (!/\p{L}/u.test(value)) return { valid: false, reasonCode: 'INVALID_FORMAT' };
    // Noise filter: reject input that's mostly punctuation/symbols rather
    // than actual name/address/description text (e.g. keyboard-mash or
    // stray formatting). Addresses and descriptions carry commas/periods, so
    // the threshold is deliberately lenient.
    const letterDigitCount = (value.match(/[\p{L}\p{N}]/gu) ?? []).length;
    if (letterDigitCount < value.length * 0.4) return { valid: false, reasonCode: 'INVALID_FORMAT' };
  }

  return { valid: true, normalized: value };
}

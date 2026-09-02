// Verification Center — shared per-mode input validation.
//
// IMPORTANT: this exact logic is duplicated (not imported — Edge Functions are
// a separate Deno deployment and cannot import from src/) inside
// supabase/functions/homatch-research/index.ts as `validateVerifyQuery`.
// Any change here MUST be mirrored there, and vice versa, so the frontend
// can never be more permissive than the backend (or a direct API call could
// bypass the UI's guardrails).
//
// Four modes only: property (verify a specific property/listing), cadastral
// (official cadastral code lookup), developer (company/legal-entity
// background check), project (a specific development/building).

export type VerifyMode = 'property' | 'cadastral' | 'developer' | 'project';

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

const CADASTRAL_RE = /^\d{1,4}(\.\d{1,4}){3,9}$/;

// Conversational / instruction-style phrasing that should never reach the
// research provider as a "company", "project" or "developer" name — this is
// a heuristic guard against random unrelated questions and prompt-injection
// attempts, not a full intent classifier. Deliberately multilingual (en/ka/
// ru/tr/ar/he) since Homatch is used in all six.
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

  if (value.length < 2) return { valid: false, reasonCode: 'TOO_SHORT' };

  // "property" covers full listing titles/addresses (e.g. passed in from a
  // property detail page), so it gets a longer ceiling than a bare name.
  const maxLen = mode === 'property' ? 300 : 150;
  if (value.length > maxLen) return { valid: false, reasonCode: 'TOO_LONG' };

  if (/[?？]/.test(value)) return { valid: false, reasonCode: 'LOOKS_LIKE_QUESTION' };
  if (QUESTION_WORDS.test(value)) return { valid: false, reasonCode: 'LOOKS_LIKE_QUESTION' };

  if (mode === 'developer' || mode === 'project') {
    const words = value.split(' ').filter(Boolean);
    if (words.length > 12) return { valid: false, reasonCode: 'INVALID_FORMAT' };
    const letterDigitCount = (value.match(/[\p{L}\p{N}]/gu) ?? []).length;
    if (letterDigitCount < value.length * 0.5) return { valid: false, reasonCode: 'INVALID_FORMAT' };
    if (!/\p{L}/u.test(value)) return { valid: false, reasonCode: 'INVALID_FORMAT' };
  }

  return { valid: true, normalized: value };
}

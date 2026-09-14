// HOMATCH — choosing what to tell the transcriber about, before a word is said.
//
// THE MISTAKE THIS FILE EXISTS TO PREVENT
//
// Homatch's domain corpus is over a thousand terms: Georgian cadastral
// vocabulary, district and developer names, property attributes, the
// real-estate English and Russian a bilingual market actually speaks. The
// obvious thing to do with it is send it to the realtime transcriber. That is
// wrong twice over — the provider caps how many terms a session may carry,
// and even without a cap, a thousand biases is not a bias, it is noise.
//
// So the corpus lives in the database as domain intelligence, and this
// chooses the handful that matter for THIS session: the brand, the language
// actually being spoken, the district this property is in, the developer just
// mentioned, the tenant's own words. Everything else stays in the database
// where it is useful for intent and entity work.
//
// WHY THE LIMITS ARE ARGUMENTS AND NOT CONSTANTS
//
// The handoff pack states fifty terms at twenty characters. That was true
// when it was written and the provider has since raised keyterm capacity.
// Baking either number in would waste the allowance today and break the day
// it moves again, so both arrive as configuration and nothing below assumes
// a particular value.
//
// WHY IT IS DETERMINISTIC
//
// The same context must produce the same terms, or a transcription problem
// cannot be reproduced — and an admin asking "what would you send for this
// agent in Georgian?" must get the answer that would actually be sent.

export type VocabularyScope = 'GLOBAL' | 'TENANT' | 'AGENT' | 'PROPERTY' | 'PROJECT';

export interface VocabularyTerm {
  id: string;
  term: string;
  /** Case- and punctuation-folded, for deduplication. */
  normalized?: string;
  /** ISO-639-1, or null when the term is language-neutral. */
  languageHint?: string | null;
  category: string;
  scope?: VocabularyScope;
  /** 0-100. Editable per term; the seed import sets it per category. */
  priority?: number;
  /** False for anything that must never be sent to a realtime transcriber. */
  providerEligible?: boolean;
  enabled?: boolean;
  tenantId?: string | null;
  agentId?: string | null;
}

export interface KeytermContext {
  /** The language actually being spoken, when it has settled. */
  language?: string | null;
  /** Which Homatch surface this session belongs to. */
  feature?: string | null;
  /** The agent's purpose text, for matching its own vocabulary. */
  agentPurpose?: string | null;
  agentId?: string | null;
  tenantId?: string | null;
  /** Places, developers, projects and proper nouns already in play. */
  locations?: string[];
  developers?: string[];
  projects?: string[];
  /** Proper nouns detected in the conversation so far. */
  entities?: string[];
  /**
   * Whether this session has already shown abusive language.
   *
   * Abuse vocabulary is NEVER sent by default: biasing a transcriber toward
   * profanity makes it hear profanity. It becomes eligible only once a
   * session has demonstrably contained some, where recognising it correctly
   * is the difference between answering the real question and mishearing it.
   */
  abusiveContext?: boolean;
}

export interface KeytermLimits {
  maxTerms: number;
  maxCharsPerTerm: number;
}

export interface SelectedKeyterm {
  id: string;
  term: string;
  category: string;
  score: number;
  /** Why it made the cut, for the Admin preview. */
  reasons: string[];
}

export interface DroppedKeyterm {
  id: string;
  term: string;
  reason: 'TOO_LONG' | 'DUPLICATE' | 'NOT_ELIGIBLE' | 'DISABLED' | 'WRONG_SCOPE'
        | 'ABUSE_WITHHELD' | 'BELOW_CUTOFF' | 'EMPTY';
}

export interface KeytermSelection {
  selected: SelectedKeyterm[];
  dropped: DroppedKeyterm[];
  limits: KeytermLimits;
  /** Total eligible candidates considered, for the Admin preview. */
  considered: number;
}

/** Categories whose terms are recognition aids, never spoken-word bias. */
const ABUSE_CATEGORIES = new Set(['abuse_georgian', 'abuse_ru_en', 'abuse']);

/**
 * Categories that are always worth a slot.
 *
 * The brand is the clearest case: a transcriber that writes "Ho match" or
 * "HOMATCG" has failed at the one word the whole product is named after, and
 * no amount of context ranking should be able to push it out.
 */
const ALWAYS_CATEGORIES = new Set(['brand_product']);

/**
 * Fold a term for comparison.
 *
 * Case, surrounding punctuation and repeated whitespace are noise; the script
 * is not. Georgian has no case, so lowercasing is harmless there and
 * necessary for the Latin and Cyrillic halves of the same corpus.
 */
export function normalizeTerm(term: string): string {
  return String(term ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^\p{L}\p{N}'\- ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** How many characters the provider will count. */
export function keytermLength(term: string): number {
  return [...String(term ?? '').normalize('NFC')].length;
}

function contextMatches(term: string, pool: string[] | undefined): boolean {
  if (!pool?.length) return false;
  const needle = normalizeTerm(term);
  if (!needle) return false;
  return pool.some((value) => {
    const hay = normalizeTerm(value);
    return hay === needle || (needle.length >= 4 && hay.includes(needle));
  });
}

/**
 * Rank the corpus for one session and take the top slice.
 *
 * Scores are additive and every contribution is named, because the Admin
 * "what would you send?" screen shows them — a ranking nobody can read is a
 * ranking nobody can fix.
 */
export function selectKeyterms(
  terms: VocabularyTerm[],
  context: KeytermContext,
  limits: KeytermLimits,
): KeytermSelection {
  const maxTerms = Math.max(0, Math.floor(limits.maxTerms));
  const maxChars = Math.max(1, Math.floor(limits.maxCharsPerTerm));

  const dropped: DroppedKeyterm[] = [];
  const scored: SelectedKeyterm[] = [];
  const seen = new Map<string, number>();
  let considered = 0;

  for (const raw of terms) {
    const term = String(raw.term ?? '').trim();
    if (!term) { dropped.push({ id: raw.id, term, reason: 'EMPTY' }); continue; }
    if (raw.enabled === false) { dropped.push({ id: raw.id, term, reason: 'DISABLED' }); continue; }
    if (raw.providerEligible === false) { dropped.push({ id: raw.id, term, reason: 'NOT_ELIGIBLE' }); continue; }

    if (ABUSE_CATEGORIES.has(raw.category) && !context.abusiveContext) {
      dropped.push({ id: raw.id, term, reason: 'ABUSE_WITHHELD' });
      continue;
    }

    // A term belonging to another tenant or another agent is not merely
    // lower-ranked, it must not be considered at all.
    if (raw.scope === 'TENANT' && raw.tenantId && context.tenantId && raw.tenantId !== context.tenantId) {
      dropped.push({ id: raw.id, term, reason: 'WRONG_SCOPE' });
      continue;
    }
    if (raw.scope === 'AGENT' && raw.agentId && context.agentId && raw.agentId !== context.agentId) {
      dropped.push({ id: raw.id, term, reason: 'WRONG_SCOPE' });
      continue;
    }

    /*
     * A term longer than the provider accepts is DROPPED, never shortened.
     *
     * "საჯარო რეესტრის ეროვნული სააგენტო" cut to twenty characters is a
     * different string that means nothing, and biasing a transcriber toward a
     * fragment is worse than not biasing it at all.
     */
    if (keytermLength(term) > maxChars) {
      dropped.push({ id: raw.id, term, reason: 'TOO_LONG' });
      continue;
    }

    considered += 1;

    const reasons: string[] = [];
    let score = 0;

    if (ALWAYS_CATEGORIES.has(raw.category)) { score += 100; reasons.push('brand'); }

    const hint = raw.languageHint ?? null;
    if (context.language && hint === context.language) { score += 30; reasons.push('language'); }
    else if (!hint) { score += 12; reasons.push('language-neutral'); }
    else if (context.language && hint !== context.language) { score -= 25; reasons.push('other-language'); }

    if (contextMatches(term, context.locations)) { score += 70; reasons.push('location'); }
    if (contextMatches(term, context.developers)) { score += 70; reasons.push('developer'); }
    if (contextMatches(term, context.projects)) { score += 70; reasons.push('project'); }
    if (contextMatches(term, context.entities)) { score += 55; reasons.push('mentioned'); }
    if (context.agentPurpose && contextMatches(term, [context.agentPurpose])) {
      score += 25; reasons.push('agent-purpose');
    }

    if (raw.scope === 'AGENT') { score += 60; reasons.push('agent'); }
    else if (raw.scope === 'PROPERTY' || raw.scope === 'PROJECT') { score += 50; reasons.push('property'); }
    else if (raw.scope === 'TENANT') { score += 40; reasons.push('tenant'); }

    score += Math.max(0, Math.min(100, raw.priority ?? 50)) / 4;

    // A shorter term is a cheaper slot and a safer bias; between two equally
    // relevant candidates the compact one wins.
    score += Math.max(0, (maxChars - keytermLength(term))) * 0.15;

    const key = normalizeTerm(term);
    const already = seen.get(key);
    if (already !== undefined) {
      // Keep the better-scoring spelling of the same word rather than both.
      if (score > scored[already].score) {
        dropped.push({ id: scored[already].id, term: scored[already].term, reason: 'DUPLICATE' });
        scored[already] = { id: raw.id, term, category: raw.category, score, reasons };
      } else {
        dropped.push({ id: raw.id, term, reason: 'DUPLICATE' });
      }
      continue;
    }

    seen.set(key, scored.length);
    scored.push({ id: raw.id, term, category: raw.category, score, reasons });
  }

  scored.sort((a, b) =>
    b.score - a.score
    || a.term.length - b.term.length
    || a.term.localeCompare(b.term)
    || a.id.localeCompare(b.id));

  const selected = scored.slice(0, maxTerms);
  for (const cut of scored.slice(maxTerms)) {
    dropped.push({ id: cut.id, term: cut.term, reason: 'BELOW_CUTOFF' });
  }

  return { selected, dropped, limits: { maxTerms, maxCharsPerTerm: maxChars }, considered };
}

/** Just the strings, in rank order, ready for the socket. */
export function keytermStrings(selection: KeytermSelection): string[] {
  return selection.selected.map((s) => s.term);
}

/**
 * Common Georgian words long enough to look like names, and are not.
 *
 * Georgian has no capitalisation, so length is the only cheap signal a proper
 * noun leaves behind — and the commonest verbs and greetings are long enough
 * to pass it. Each of these would otherwise spend a context slot on a word
 * that tells the ranker nothing.
 */
const GEORGIAN_STOPWORDS = new Set([
  'გამარჯობა', 'ინფორმაცია', 'მაინტერესებს', 'მადლობა', 'გთხოვთ',
  'შესაძლებელია', 'შეგიძლიათ', 'მინდოდა', 'დაახლოებით', 'შემიძლია',
]);

/**
 * Proper nouns worth remembering from something that was just said.
 *
 * Deliberately conservative: a capitalised Latin word, or a Georgian word
 * long enough to be a place or a project rather than a verb. This feeds the
 * next selection round, so a district named in turn one is recognised better
 * in turn two — and a wrong guess only costs a boost that was not deserved,
 * never a wrong transcript.
 */
export function detectEntities(text: string, limit = 12): string[] {
  const out: string[] = [];
  const push = (value: string) => {
    const v = value.trim();
    if (v.length < 3 || v.length > 40) return;
    if (out.some((x) => normalizeTerm(x) === normalizeTerm(v))) return;
    out.push(v);
  };

  for (const match of String(text ?? '').matchAll(/\b[A-Z][\p{Ll}]{2,}(?:\s+[A-Z][\p{Ll}]{2,}){0,2}/gu)) {
    push(match[0]);
  }
  for (const match of String(text ?? '').matchAll(/[\p{Script=Georgian}]{7,}/gu)) {
    if (GEORGIAN_STOPWORDS.has(match[0])) continue;
    push(match[0]);
  }
  return out.slice(0, limit);
}

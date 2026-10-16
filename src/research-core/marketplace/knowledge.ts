/*
 * Property Knowledge Engine — the deterministic-first, cache-first front door
 * for listing-description understanding.
 *
 * Order of resolution for one description:
 *   1. Exact cache: sha256(normalized text) + schema version → stored, validated
 *      extraction. Zero model calls, for every later search that sees the text.
 *   2. Deterministic: multilingual patterns with negation (description-signals).
 *      If they settle every requested field without contradiction, zero calls.
 *   3. Model: only the unsettled fields, only within budget, and only output
 *      that survives validation is ever stored.
 *
 * A listing description is untrusted data. It is never an instruction: it is
 * fenced, length-capped and stripped of control characters before any prompt,
 * and model output may only cite evidence that literally occurs in it.
 */
import { sha256Hex } from '../core/sha256.ts';
import { type DescriptionSignal, type DescriptionSignalCode, descriptionSignals } from './description-signals.ts';

/** Bump to invalidate every stored extraction (rollback = bump or invalidate rows). */
export const KNOWLEDGE_SCHEMA_VERSION = 1;
export const MAX_DESCRIPTION_CHARS = 6000;

export type FactValue = 'YES' | 'NO';
export type FactBasis = 'EXPLICIT' | 'INFERRED';
export interface KnowledgeFact {
  code: DescriptionSignalCode;
  value: FactValue;
  basis: FactBasis;
  /** Verbatim span of the description. Provenance, not paraphrase. */
  evidence: string;
  confidence: number;
}
export interface KnowledgeExtraction {
  schemaVersion: number;
  facts: KnowledgeFact[];
  /** Codes the text both asserts and denies, or seller claims that conflict. */
  contradictions: DescriptionSignalCode[];
  needsVerification: DescriptionSignalCode[];
  source: 'DETERMINISTIC' | 'MODEL';
}

export function normalizeDescription(text: string | null | undefined): string {
  return (text ?? '').normalize('NFC').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION_CHARS);
}

/** Same text in any whitespace or markup → same key. Different schema → different key. */
export function knowledgeKey(text: string | null | undefined): { contentHash: string; schemaVersion: number } | null {
  const normalized = normalizeDescription(text);
  if (normalized.length < 12) return null;
  return { contentHash: sha256Hex(normalized), schemaVersion: KNOWLEDGE_SCHEMA_VERSION };
}

export const MAX_EVIDENCE_CHARS = 200;
/** Stored evidence never carries a phone number: listing contact phones are private. */
export const redactEvidence = (span: string) => span.replace(/\+?\d[\d\s().-]{6,}\d/g, '•••').slice(0, MAX_EVIDENCE_CHARS);

const SELLER_CODES = new Set<DescriptionSignalCode>(['OWNER_CLAIM', 'AGENCY_LANGUAGE']);

export function deterministicExtraction(text: string | null | undefined): KnowledgeExtraction {
  const signals = descriptionSignals(normalizeDescription(text));
  const facts: KnowledgeFact[] = signals.map((s: DescriptionSignal) => ({
    code: s.code,
    value: s.polarity === 'NEGATED' ? 'NO' : 'YES',
    basis: 'EXPLICIT',
    evidence: redactEvidence(s.evidence),
    // A negation or a self-declared seller claim is weaker than a plain mention.
    confidence: SELLER_CODES.has(s.code) ? 0.6 : s.polarity === 'NEGATED' ? 0.75 : 0.85,
  }));
  const contradictions: DescriptionSignalCode[] = [];
  const has = (c: DescriptionSignalCode) => facts.some((f) => f.code === c && f.value === 'YES');
  if (has('OWNER_CLAIM') && has('AGENCY_LANGUAGE')) contradictions.push('OWNER_CLAIM', 'AGENCY_LANGUAGE');
  // Self-declared seller type is a claim until a document or registry confirms it.
  const needsVerification = facts.filter((f) => SELLER_CODES.has(f.code) && f.value === 'YES').map((f) => f.code);
  return { schemaVersion: KNOWLEDGE_SCHEMA_VERSION, facts, contradictions, needsVerification, source: 'DETERMINISTIC' };
}

export type Route =
  | { route: 'CACHE'; extraction: KnowledgeExtraction; modelCalls: 0 }
  | { route: 'DETERMINISTIC'; extraction: KnowledgeExtraction; modelCalls: 0 }
  | { route: 'MODEL'; extraction: KnowledgeExtraction; fields: DescriptionSignalCode[]; modelCalls: 1 }
  | { route: 'SKIPPED'; extraction: KnowledgeExtraction; reason: 'BUDGET' | 'KILL_SWITCH' | 'NO_TEXT'; modelCalls: 0 };

/**
 * Decide how one description is understood. `wanted` are the facts the
 * customer's search actually depends on; nothing else is worth a model call.
 */
export function routeExtraction(input: {
  text: string | null | undefined;
  wanted: DescriptionSignalCode[];
  cached?: KnowledgeExtraction | null;
  modelAllowed: boolean;
  killSwitch?: boolean;
}): Route {
  const deterministic = deterministicExtraction(input.text);
  if (!knowledgeKey(input.text)) return { route: 'SKIPPED', extraction: deterministic, reason: 'NO_TEXT', modelCalls: 0 };
  if (input.cached && input.cached.schemaVersion === KNOWLEDGE_SCHEMA_VERSION) return { route: 'CACHE', extraction: input.cached, modelCalls: 0 };
  const settled = new Set(deterministic.facts.filter((f) => f.confidence >= 0.75).map((f) => f.code));
  // Unmentioned is a settled "unknown": a model cannot invent a fact the text never states.
  const mentioned = new Set(deterministic.facts.map((f) => f.code));
  const open = input.wanted.filter((c) => mentioned.has(c) && !settled.has(c) || deterministic.contradictions.includes(c));
  if (!open.length) return { route: 'DETERMINISTIC', extraction: deterministic, modelCalls: 0 };
  if (input.killSwitch) return { route: 'SKIPPED', extraction: deterministic, reason: 'KILL_SWITCH', modelCalls: 0 };
  if (!input.modelAllowed) return { route: 'SKIPPED', extraction: deterministic, reason: 'BUDGET', modelCalls: 0 };
  return { route: 'MODEL', extraction: deterministic, fields: [...new Set(open)], modelCalls: 1 };
}

/** The description as inert, fenced data for a prompt. */
export function fenceUntrusted(text: string | null | undefined): string {
  const clean = normalizeDescription(text).replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/<\/?listing_description>/gi, ' ');
  return `<listing_description>\n${clean}\n</listing_description>`;
}

const CODES = new Set<DescriptionSignalCode>(['RENOVATED', 'NEW_BUILD', 'UNDER_CONSTRUCTION', 'PARKING', 'FURNISHED', 'APPLIANCES', 'BALCONY', 'VIEW', 'CENTRAL_HEATING', 'ELEVATOR', 'OWNER_CLAIM', 'AGENCY_LANGUAGE', 'URGENT', 'NEGOTIABLE']);

/**
 * Model output is accepted fact by fact. A fact without a verbatim citation,
 * an unknown code, or an out-of-range confidence is dropped, never coerced.
 * Seller facts always stay "needs verification": a model reading a claim does
 * not verify it.
 */
export function validateModelFacts(text: string | null | undefined, raw: unknown, base: KnowledgeExtraction): KnowledgeExtraction {
  const normalized = normalizeDescription(text).toLowerCase();
  const accepted: KnowledgeFact[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;
    if (typeof f.code !== 'string' || !CODES.has(f.code as DescriptionSignalCode)) continue;
    if (f.value !== 'YES' && f.value !== 'NO') continue;
    if (typeof f.evidence !== 'string' || f.evidence.trim().length < 3 || f.evidence.length > MAX_EVIDENCE_CHARS || !normalized.includes(f.evidence.trim().toLowerCase())) continue;
    if (typeof f.confidence !== 'number' || !(f.confidence >= 0 && f.confidence <= 1)) continue;
    accepted.push({ code: f.code as DescriptionSignalCode, value: f.value, basis: f.basis === 'EXPLICIT' ? 'EXPLICIT' : 'INFERRED', evidence: redactEvidence(f.evidence.trim()), confidence: Math.min(f.confidence, f.basis === 'EXPLICIT' ? 0.95 : 0.7) });
  }
  const byCode = new Map(base.facts.map((f) => [f.code, f]));
  for (const f of accepted) {
    const prior = byCode.get(f.code);
    // A deterministic explicit reading is never overwritten by a weaker one.
    if (!prior || f.confidence > prior.confidence) byCode.set(f.code, f);
  }
  const facts = [...byCode.values()];
  const needsVerification = [...new Set([...base.needsVerification, ...facts.filter((f) => SELLER_CODES.has(f.code) && f.value === 'YES').map((f) => f.code)])];
  return { schemaVersion: KNOWLEDGE_SCHEMA_VERSION, facts, contradictions: base.contradictions, needsVerification, source: accepted.length ? 'MODEL' : base.source };
}

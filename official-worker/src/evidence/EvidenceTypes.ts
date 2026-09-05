// EvidenceTypes.ts — the normalized evidence model (mandate Section 17).
// This is the authoritative vocabulary the rest of the system (official
// workflows, open-web research, cross-source analysis, synthesis) must
// express every finding in. "NO EVIDENCE = NO FACT": nothing may reach the
// customer report unless it exists here, with a real source and a real
// retrieval timestamp.

export type EvidenceType =
  | 'PROPERTY_FACT'
  | 'COMPANY_FACT'
  | 'PERMIT_EVENT'
  | 'REGISTRY_EVENT'
  | 'DOCUMENT_FACT'
  | 'WEB_CLAIM'
  | 'MARKET_COMPARABLE'
  | 'PUBLIC_DISCUSSION'
  | 'RISK_CANDIDATE'
  | 'CONTRADICTION';

export type SourceClass =
  | 'OFFICIAL'
  | 'COMPANY_PUBLISHED'
  | 'REPUTABLE_MEDIA'
  | 'OTHER_PUBLIC_SOURCE'
  | 'SOCIAL_USER_GENERATED'
  | 'UNVERIFIED_CLAIM';

/** Coarse verification state of a single evidence item, independent of
 * source class — e.g. an OFFICIAL item can still be UNVERIFIED if a
 * document was discovered but not yet fully read (mandate Section 7: a
 * document is not "complete" until pagesRead === pageCount). */
export type VerificationState = 'VERIFIED' | 'UNVERIFIED' | 'DISPUTED';

/** mandate Section 20: "Create CONTRADICTION objects where needed." A
 * contradiction references the two (or more) evidence items that disagree,
 * plus a plain-language description of the disagreement — it is itself
 * stored as an ordinary evidence item of type CONTRADICTION so it flows
 * through the same ledger/report pipeline as everything else. */
export interface ContradictionRefs {
  evidenceIds: string[];
  description: string;
}

export interface EvidenceItem {
  id: string;
  type: EvidenceType;
  /** The factual claim/value itself, e.g. "registered land parcel",
   * "developer: შპს Example Development", "listing price: $145,000". */
  claim: string;
  /** Human-readable name of the concrete source, e.g. "TAS.GE", "MS.GOV.GE
   * Cadastral Map", "myhome.ge listing #12345". */
  source: string;
  sourceClass: SourceClass;
  sourceUrl: string | null;
  sourceDocumentId?: string | null;
  /** The date the underlying fact/event pertains to (e.g. a document's own
   * printed date), NOT the retrieval date — never invented, null when the
   * source itself states no date. */
  date?: string | null;
  /** When THIS worker/session actually retrieved the evidence. */
  retrievedAt: string;
  relatedPropertyId?: string | null;
  relatedEntityId?: string | null;
  /** 0..1 confidence — deterministic evidence (an official structured field
   * read directly off a government page) should be 1; an AI-extracted claim
   * from unstructured text should be lower and never silently rounded up. */
  confidence: number;
  verificationState: VerificationState;
  /** The literal supporting text/reference this claim was extracted from —
   * required for anything above UNVERIFIED, so a human can always trace a
   * claim back to its exact source text. */
  supportingText?: string | null;
  /** true = this describes a past/superseded state (an older document, an
   * earlier registry entry); false/undefined = current. Historical
   * information must never silently become a CURRENT_FACT (mandate
   * Section 15). */
  historical?: boolean;
  contradiction?: ContradictionRefs;
}

export function isOfficial(item: Pick<EvidenceItem, 'sourceClass'>): boolean {
  return item.sourceClass === 'OFFICIAL';
}

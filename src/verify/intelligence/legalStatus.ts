/*
 * LEGAL STATUS — what the records actually establish, claim by claim.
 *
 * Distinct legal states are never inferred from one another, from a document
 * title, a decision number, a date or another building's papers:
 *
 *   PERMIT_ISSUED            a construction permit was issued
 *   CONSTRUCTION_STARTED     works began (a notice / inspection says so)
 *   CONSTRUCTION_COMPLETED   works completed (an act or inspection says so)
 *   COMMISSIONING_APPLIED    an application for acceptance into operation was filed
 *   COMMISSIONING_APPROVED   the building was accepted into operation
 *
 * Each claim carries a status:
 *   CONFIRMED            an authoritative record for THIS building establishes it
 *   PARTIALLY_CONFIRMED  a record establishes part of it (e.g. another block)
 *   CONFLICTING          records disagree
 *   NOT_VERIFIED         nothing read establishes it — which is NOT the same as
 *                        "it did not happen"
 *   NOT_APPLICABLE       the state cannot apply (e.g. no permit stage yet)
 *
 * The narrative layer may only phrase what these claims allow; it never
 * upgrades a NOT_VERIFIED claim (owner live run, 2026-10-10: a project that had
 * not even applied for commissioning was reported "accepted into operation"
 * nine times — from a cited law and a banner rule).
 */

export type LegalClaimKey =
  | 'PERMIT_ISSUED'
  | 'CONSTRUCTION_STARTED'
  | 'CONSTRUCTION_COMPLETED'
  | 'COMMISSIONING_APPLIED'
  | 'COMMISSIONING_APPROVED';

export type LegalClaimStatus = 'CONFIRMED' | 'PARTIALLY_CONFIRMED' | 'CONFLICTING' | 'NOT_VERIFIED' | 'NOT_APPLICABLE';

export interface LegalClaim {
  key: LegalClaimKey;
  status: LegalClaimStatus;
  /** The decision(s) that establish it: case reference, number, date. */
  basis: Array<{ caseRef: string | null; decisionNumber: string | null; date: string | null; block: string | null }>;
}

/**
 * Acceptance into operation as an OPERATIVE act. Kept identical to the
 * worker's COMMISSIONED rule (official-worker/src/workflows/tas/api/decisions.ts);
 * a test holds the two together.
 */
export const COMMISSIONING_OPERATIVE = /(მიღებულ\s+(?:იქნეს|იქნა)\s+ექსპლუატაციაში|ექსპლუატაციაში\s+მიღებულ\s+(?:იქნეს|იქნა)|ექსპლუატაციაში\s+(?:შეყვანილ|შესულ)\s+(?:იქნეს|იქნა)|ექსპლუატაციაში\s+მიღების\s+(?:შესახებ\s+)?აქტ(?:ი|ის)?\s+(?:დამტკიცდ|გაიცეს|გაცემულ)|(?:is|be|was)\s+(?:hereby\s+)?(?:accepted|put)\s+into\s+operation|принять\s+в\s+эксплуатацию|принят\S*\s+в\s+эксплуатацию)/iu;

/** A TAS case whose OWN service is acceptance into operation (the application, not its outcome). */
const COMMISSIONING_SERVICE = /(?:ნომენკლატურა|მომსახურება|სახეობა)\s*:?\s*[^\n]{0,80}ექსპლუატაციაში\s+მიღება/iu;

/** The document's own result line, when it states one. */
const RESULT_LINE = /შედეგი\s*:\s*(შუალედური|დადებითი|უარყოფითი)/iu;

const POSITIVE = new Set(['PERMIT_ISSUED', 'APPROVED', 'AMENDMENT_APPROVED', 'DEADLINE_EXTENDED', 'COMMISSIONED']);

/**
 * Re-check a decision read by an older worker. Results stored before the
 * operative-only rule must not keep their "accepted into operation": the
 * stored evidence window must itself carry the operative wording, and a
 * document whose own result line says "intermediate" decided nothing final.
 */
export function revalidateDecision<T extends { outcome?: unknown; evidence?: unknown } | null | undefined>(d: T): T {
  if (!d || typeof d !== 'object') return d;
  const outcome = String((d as any).outcome ?? '');
  const evidence = String((d as any).evidence ?? '');
  if (outcome === 'COMMISSIONED' && !COMMISSIONING_OPERATIVE.test(evidence)) {
    return { ...(d as any), outcome: 'UNDETERMINED', revalidated: 'COMMISSIONING_NOT_OPERATIVE' };
  }
  if (POSITIVE.has(outcome) && /შუალედური/iu.test(RESULT_LINE.exec(evidence)?.[1] ?? '')) {
    return { ...(d as any), outcome: 'INTERMEDIATE', revalidated: 'RESULT_LINE_INTERMEDIATE' };
  }
  return d;
}

export interface LegalStatusEvent {
  date: string | null;
  caseRef: string | null;
  block: string | null;
  decision: { number: string | null; outcome: string; evidence: string | null } | null;
  /** The case's own service / nomenclature text, when read. */
  serviceText?: string | null;
}

/**
 * The claim set for one building, from its timeline. Events belonging to a
 * different block than the target (when both are known) count only as
 * PARTIALLY_CONFIRMED — never as this building's own status.
 */
export function legalClaims(events: LegalStatusEvent[], target: { block: string | null } = { block: null }): LegalClaim[] {
  const sameBuilding = (e: LegalStatusEvent) => !target.block || !e.block || e.block === target.block;
  const basisOf = (e: LegalStatusEvent) => ({ caseRef: e.caseRef, decisionNumber: e.decision?.number ?? null, date: e.date, block: e.block });
  const claim = (key: LegalClaimKey, hits: LegalStatusEvent[], negatives: LegalStatusEvent[] = []): LegalClaim => {
    const own = hits.filter(sameBuilding);
    const other = hits.filter((e) => !sameBuilding(e));
    let status: LegalClaimStatus = 'NOT_VERIFIED';
    if (own.length && negatives.filter(sameBuilding).some((n) => (n.date ?? '') > (own[own.length - 1].date ?? ''))) status = 'CONFLICTING';
    else if (own.length) status = 'CONFIRMED';
    else if (other.length) status = 'PARTIALLY_CONFIRMED';
    return { key, status, basis: (own.length ? own : other).map(basisOf) };
  };
  const by = (pred: (e: LegalStatusEvent) => boolean) => events.filter(pred).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const outcome = (e: LegalStatusEvent) => e.decision?.outcome ?? '';
  const permits = by((e) => outcome(e) === 'PERMIT_ISSUED' || outcome(e) === 'AMENDMENT_APPROVED');
  const revoked = by((e) => outcome(e) === 'CANCELLED' || outcome(e) === 'SUSPENDED');
  const commissioned = by((e) => outcome(e) === 'COMMISSIONED' && COMMISSIONING_OPERATIVE.test(String(e.decision?.evidence ?? '')));
  const applied = by((e) => COMMISSIONING_SERVICE.test(String(e.serviceText ?? '')));
  return [
    claim('PERMIT_ISSUED', permits, revoked),
    // Works starting / finishing are facts no decision outcome establishes on its own.
    { key: 'CONSTRUCTION_STARTED', status: 'NOT_VERIFIED', basis: [] },
    { key: 'CONSTRUCTION_COMPLETED', status: commissioned.some(sameBuilding) ? 'CONFIRMED' : 'NOT_VERIFIED', basis: commissioned.filter(sameBuilding).map(basisOf) },
    claim('COMMISSIONING_APPLIED', [...applied, ...commissioned]),
    claim('COMMISSIONING_APPROVED', commissioned),
  ];
}

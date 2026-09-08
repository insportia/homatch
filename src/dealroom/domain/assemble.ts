// HOMATCH — the one place a Verify result becomes a Deal Room.
//
// Every product surface downstream of Verify (the new result UX, the Deal
// Room, the Buyer Action Plan, Ask Homatch AI, the final synthesis) reads
// THIS projection, never `result_json` directly. That is what makes them one
// coherent product instead of five separate readers that drift apart the
// first time the pipeline changes a field name.
//
// The projection is pure and deterministic: same report in, same projection
// out, no clock, no network, no database. It is therefore fully testable, and
// the AI layer can be handed a projection rather than a database dump.

import { extractClaims, technicalOutcomes, checkedOutcomes, buildVerifySnapshot } from './verifyExtract.ts';
import type { VerifyReportLike, TechnicalOutcome, CheckedOutcome, VerifySnapshot } from './verifyExtract.ts';
import { normalizeEvidence, toFindings, presentationOrder } from '../planning/evidence.ts';
import type { CanonicalFact } from '../planning/evidence.ts';
import { inferPropertyType, buildBuyerPlan } from '../planning/buyerPlan.ts';
import type { PropertyType, PlanItem, QuestionItem, DocumentItem } from '../planning/buyerPlan.ts';
import { buildSynthesisPlan, computeVerdict } from '../planning/synthesis.ts';
import type { SynthesisPlan } from '../planning/synthesis.ts';

export interface DealRoomProjection {
  jobId: string;
  /** All normalized evidence, strongest first, conflicts leading. */
  facts: CanonicalFact[];
  /** Only the facts a customer should be told about, already ordered. */
  presented: CanonicalFact[];
  conflicts: CanonicalFact[];
  propertyType: PropertyType;
  propertyTypeState: string;
  verdict: SynthesisPlan['verdict'];
  verdictReasons: string[];
  synthesis: SynthesisPlan;
  plan: PlanItem[];
  questions: QuestionItem[];
  documents: DocumentItem[];
  /** Sources that finished. */
  checked: CheckedOutcome[];
  /** Sources that did NOT finish, for infrastructure reasons only. */
  incomplete: TechnicalOutcome[];
  snapshot: VerifySnapshot;
}

/**
 * Builds the whole projection.
 *
 * `capturedAt` is injected rather than read from the clock so the result is
 * reproducible in tests and so a re-projection of an old job can be stamped
 * with the time the evidence was actually captured.
 */
export function projectVerify(args: {
  jobId: string;
  report: VerifyReportLike | null | undefined;
  capturedAt?: string;
}): DealRoomProjection {
  const { jobId, report } = args;

  const facts = normalizeEvidence(extractClaims(report));
  const presented = presentationOrder(facts);
  const conflicts = facts.filter((f) => f.state === 'CONFLICTING');

  const ctx = { cadastralCode: cadastralOf(facts), findings: toFindings(facts) };
  const inferred = inferPropertyType(ctx);
  const { verdict, reasons } = computeVerdict(facts);
  const synthesis = buildSynthesisPlan(facts, inferred.type);
  const buyer = buildBuyerPlan(ctx);

  return {
    jobId,
    facts,
    presented,
    conflicts,
    propertyType: inferred.type,
    propertyTypeState: inferred.state,
    verdict,
    verdictReasons: reasons,
    synthesis,
    plan: buyer.actions,
    questions: buyer.questions,
    documents: buyer.documents,
    checked: checkedOutcomes(report),
    incomplete: technicalOutcomes(report),
    snapshot: buildVerifySnapshot({
      jobId,
      report,
      propertyType: inferred.type,
      verdict,
      verdictReasons: reasons,
      factCount: facts.length,
      conflictCount: conflicts.length,
      capturedAt: args.capturedAt,
    }),
  };
}

const cadastralOf = (facts: CanonicalFact[]): string | null => {
  const f = facts.find((x) => x.type === 'property.cadastralCode');
  return f && typeof f.value === 'string' ? f.value : null;
};

/* ------------------------------------------------------------------ *
 * Persistence shapes                                                  *
 * ------------------------------------------------------------------ */

/**
 * The rows a projection turns into. Returned as plain data rather than
 * written here, so the domain layer stays free of Supabase and the service
 * layer stays free of business rules.
 *
 * Note what is NOT persisted: the raw facts. They are re-derivable from
 * research_jobs at any time via projectVerify(), and storing a second copy
 * would create exactly the drift the snapshot design avoids. What IS
 * persisted is the customer's own work — which actions they completed, which
 * questions they answered — because that cannot be re-derived.
 */
export interface DealRoomWriteModel {
  room: {
    cadastral_code: string | null;
    title: string | null;
    address: string | null;
    verify_job_id: string;
    verify_snapshot: VerifySnapshot;
    property_type: PropertyType;
  };
  actionItems: {
    action_key: string;
    title: string;
    why: string;
    category: string;
    priority: number;
    grounded_in: string[];
  }[];
  questions: {
    question_key: string;
    question: string;
    why: string;
    audience: string;
    category: string;
    grounded_in: string[];
  }[];
  documents: {
    doc_key: string;
    label: string;
    state: string;
    notes: string;
    evidence_ref: string | null;
  }[];
}

export function toWriteModel(p: DealRoomProjection): DealRoomWriteModel {
  return {
    room: {
      cadastral_code: p.snapshot.cadastralCode,
      title: p.snapshot.entityName ?? p.snapshot.address ?? p.snapshot.cadastralCode,
      address: p.snapshot.address,
      verify_job_id: p.jobId,
      verify_snapshot: p.snapshot,
      property_type: p.propertyType,
    },
    actionItems: p.plan.map((i) => ({
      action_key: i.key,
      title: i.title,
      why: i.why,
      category: i.category,
      priority: i.priority,
      grounded_in: i.groundedIn,
    })),
    questions: p.questions.map((q) => ({
      question_key: q.key,
      question: q.question,
      why: q.why,
      audience: q.audience,
      category: q.category,
      grounded_in: q.groundedIn,
    })),
    documents: p.documents.map((d) => ({
      doc_key: d.key,
      label: d.label,
      // The engine's VERIFIED_BY_VERIFY maps onto the migration's enum of the
      // same name; RECOMMENDED is the default lifecycle entry point.
      state: d.state,
      notes: d.why,
      evidence_ref: d.groundedIn[0] ?? null,
    })),
  };
}

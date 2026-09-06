// WorkflowResult.ts — mandate Section 4's conceptual per-source result
// shape, plus the LEGACY per-source result shape the frontend and
// research-agent already consume (mandate Section 27: preserve production
// API compatibility). Every *Workflow.ts produces one LegacySourceResult;
// its `workflowResult` field carries the new, honest FSM-derived summary
// for anyone auditing exactly what happened (this is the ADMIN/DEBUG view
// — Section 22 forbids showing FSM state names to the customer, so the
// customer-facing report generator must never read `workflowResult` or
// `state`/`traversal` directly).

export interface WorkflowResult {
  source: string;
  state: string;
  completed: boolean;
  skipped: boolean;
  discoveredItems: number | null;
  visitedItems: number;
  discoveredDocuments: number;
  readDocuments: number;
  unvisitedRelevantItems: number | null;
  evidenceIds: string[];
  trace: any[];
}

/** The pre-refactor `collect()` output shape — kept field-for-field so the
 * existing frontend (VerifyPage.tsx) and research-agent (Supabase) contract
 * does not break. New code should treat this as a read/write boundary, not
 * a type to extend casually. */
export interface LegacySourceResult {
  source: string;
  sourceName: string;
  sourceClass: string;
  sourceUrl: string;
  startUrl: string;
  finalUrl: string | null;
  frameUrls: string[];
  adapter?: string | null;
  frameUrl?: string | null;
  searchControlUsed: string | null;
  queryEntered: string | null;
  submitAction: string | null;
  fillVerified?: boolean;
  resultChanged?: boolean;
  interactionTrace?: any[];
  candidateInputs?: any[] | null;
  contextConfidence?: string | null;
  wrongSearchContext?: boolean;
  resultContext: string | null;
  retrievalMethod?: string;
  searchControlFound?: boolean;
  submitted?: boolean;
  submissionConfirmed?: boolean;
  resultConfirmed: boolean;
  noResultConfirmed: boolean;
  authRequired?: boolean;
  blocked?: boolean;
  searched?: boolean;
  resultValidated: boolean;
  status: string;
  traversal: Record<string, unknown> | null;
  captcha?: boolean;
  retrievedAt: string;
  pageText?: string;
  links?: any[];
  documents: any[];
  documentsDiscovered?: number;
  documentsExtracted?: number;
  documentLinks?: any[];
  discoveredEntities: any[];
  forEntity?: { name: string; idCode: string | null } | null;
  originalCadastralCode?: string | null;
  resolvedSearchCadastralCode?: string | null;
  cadastralFallbackAttempts?: any[] | null;
  error: string | null;
  skippedHumanVerification?: boolean;
  /** NEW — the honest, FSM-derived summary (admin/debug only, mandate
   * Section 22/25). Never shown to the customer report generator. */
  workflowResult?: WorkflowResult;
  /** NEW (2026-09-06 "final alignment pass", RS Taxpayers Registry) —
   * structured public fields parsed from the result page, rather than only
   * the raw resultContext text. Optional/nullable: a field this run could
   * not confidently parse is left null/empty, never guessed. */
  taxpayerData?: RsTaxpayerPublicData | null;
  /** NEW (2026-09-06 "final alignment pass", MyGov Debtor Registry) —
   * explicit, code-computed interpretation of the debtor-registry result,
   * never left for the customer report generator to infer from the raw
   * status string alone. */
  registryInterpretation?: 'POSITIVE_WITHIN_DEBTOR_REGISTRY_SCOPE' | 'ATTENTION_REQUIRED' | null;
  debtorRecordFound?: boolean;
}

/** RS Taxpayers Registry's own structured public-record shape (mandate
 * Section 12): parsed best-effort from the result page's visible text —
 * every field is nullable, and anything recognized but not one of the
 * named fields below is kept in otherPublicFields rather than dropped. */
export interface RsTaxpayerPublicData {
  identificationCode: string | null;
  taxpayerName: string | null;
  legalForm: string | null;
  status: string | null;
  registrationDate: string | null;
  vatStatus: string | null;
  address: string | null;
  otherPublicFields: Record<string, string>;
}

// HOMATCH — CRM / transaction-case data access (post-due-diligence tracking:
// offer -> contract -> closing). All queries go through Supabase RLS
// (tc_*/tcv_*/tce_* policies in 20260905222923_transaction_case_crm.sql) —
// there is no service-role bypass here, matching the rest of api.ts.
//
// Versioning is NOT something this file writes: current_version and the
// transaction_case_versions rows are computed entirely by database triggers
// (transaction_case_before_write / transaction_case_version_snapshot) on
// every insert/update. This file only ever writes the case's own editable
// columns; the version ledger is read-only from the client by design.

import { supabase } from '@/db/supabase';
import type {
  TransactionCase,
  TransactionCaseChecklistItem,
  TransactionCaseEvent,
  TransactionCaseStage,
  TransactionCaseVersion,
} from '@/types/types';
import { linkResearchJobToCase } from '@/services/researchJobs';

export async function listTransactionCases(userId: string): Promise<TransactionCase[]> {
  const { data, error } = await supabase
    .from('transaction_cases')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as TransactionCase[];
}

export async function getTransactionCase(caseId: string): Promise<TransactionCase | null> {
  const { data, error } = await supabase
    .from('transaction_cases')
    .select('*')
    .eq('id', caseId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as TransactionCase | null;
}

export interface CreateTransactionCaseInput {
  user_id: string;
  title: string;
  property_id?: string | null;
  research_job_id?: string | null;
  stage?: TransactionCaseStage;
  counterparty_name?: string | null;
  counterparty_contact?: string | null;
  offer_amount?: number | null;
  offer_currency?: string | null;
  target_closing_date?: string | null;
  notes?: string | null;
  checklist?: TransactionCaseChecklistItem[];
  dedupe_key?: string | null;
}

export async function createTransactionCase(input: CreateTransactionCaseInput): Promise<TransactionCase> {
  const { data, error } = await supabase
    .from('transaction_cases')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data as TransactionCase;
}

// Deliberately excludes id/user_id/current_version/created_at/updated_at/
// closed_at — those are either immutable identity columns or exclusively
// database-computed (see the module comment above).
export type TransactionCaseUpdatableFields = Partial<
  Pick<
    TransactionCase,
    | 'title'
    | 'stage'
    | 'property_id'
    | 'research_job_id'
    | 'counterparty_name'
    | 'counterparty_contact'
    | 'offer_amount'
    | 'offer_currency'
    | 'target_closing_date'
    | 'notes'
    | 'checklist'
    | 'dedupe_key'
  >
>;

export async function updateTransactionCase(
  caseId: string,
  patch: TransactionCaseUpdatableFields
): Promise<TransactionCase> {
  const { data, error } = await supabase
    .from('transaction_cases')
    .update(patch)
    .eq('id', caseId)
    .select('*')
    .single();
  if (error) throw error;
  return data as TransactionCase;
}

export async function deleteTransactionCase(caseId: string): Promise<void> {
  const { error } = await supabase.from('transaction_cases').delete().eq('id', caseId);
  if (error) throw error;
}

// Convenience wrapper: advancing the stage is the most common update, and
// the CLOSED/closed_at bookkeeping is handled entirely by the DB trigger —
// this just makes the call site read as what it means.
export async function setTransactionCaseStage(
  caseId: string,
  stage: TransactionCaseStage
): Promise<TransactionCase> {
  return updateTransactionCase(caseId, { stage });
}

export async function listTransactionCaseVersions(caseId: string): Promise<TransactionCaseVersion[]> {
  const { data, error } = await supabase
    .from('transaction_case_versions')
    .select('*')
    .eq('case_id', caseId)
    .order('version', { ascending: false });
  if (error) throw error;
  return (data ?? []) as TransactionCaseVersion[];
}

export async function listTransactionCaseEvents(caseId: string): Promise<TransactionCaseEvent[]> {
  const { data, error } = await supabase
    .from('transaction_case_events')
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as TransactionCaseEvent[];
}

export async function addTransactionCaseEvent(
  caseId: string,
  eventType: string,
  payload: Record<string, unknown> = {}
): Promise<TransactionCaseEvent> {
  const { data, error } = await supabase
    .from('transaction_case_events')
    .insert({ case_id: caseId, event_type: eventType, payload })
    .select('*')
    .single();
  if (error) throw error;
  return data as TransactionCaseEvent;
}

// ── research <-> case persistence ──────────────────────────────────────────
//
// Everything below is what makes a Verify research report "stick": found by
// VerifyPage.tsx right after a research-agent job reaches COMPLETE, so the
// report is saved into exactly one Transaction Case per property per user,
// visible under /cases, reopenable without a rerun, and versioned (old
// report kept, new report chained on top) on every "Refresh Research".

// Derives a stable identity for the property/entity a completed report is
// about, from data research-agent already puts on the report — never from
// the free-text search query the user typed (which can vary run to run for
// the same property). Prefers the cadastral code (digits+dots only, so
// "01.18.06.019.055.03.01.603" and a copy-pasted version with stray spaces
// dedupe to the same key); falls back to a normalized entity name+type when
// no cadastral code was identified (e.g. a company-only lookup).
export function computeResearchDedupeKey(report: {
  identifiedParent?: { code?: string | null } | null;
  entityName?: string | null;
  entityType?: string | null;
}): string {
  const code = (report.identifiedParent?.code || '').trim();
  if (code) return `cad:${code.replace(/[^0-9.]/g, '')}`;
  const name = (report.entityName || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!name) return '';
  const type = (report.entityType || 'entity').trim().toLowerCase();
  return `name:${type}:${name}`;
}

export async function findTransactionCaseByDedupeKey(
  userId: string,
  dedupeKey: string
): Promise<TransactionCase | null> {
  if (!dedupeKey) return null;
  const { data, error } = await supabase
    .from('transaction_cases')
    .select('*')
    .eq('user_id', userId)
    .eq('dedupe_key', dedupeKey)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as TransactionCase | null;
}

export interface AttachResearchToCaseInput {
  userId: string;
  dedupeKey: string;
  title: string;
  jobId: string;
  propertyId?: string | null;
  // Set only when this run is a "Refresh Research" of an existing case's
  // report — the job it replaces. Left undefined/null for a first-time run.
  supersedesJobId?: string | null;
}

// Find-or-create the ONE case for this property/entity for this user, then
// point both sides of the link at the newest research run:
//   - transaction_cases.research_job_id -> the new job (so /cases and
//     "reopen without rerun" always resolve to the latest report), which
//     also bumps the case's own current_version via the existing
//     transaction_case_before_write/version_snapshot triggers.
//   - research_jobs.case_id -> this case, so every run ever attached
//     (this one and every prior one) can be listed by case_id.
// The old job row is never touched — it keeps existing, in full, exactly
// as research-agent left it, openable by its own id at any time.
export async function attachResearchToCase(input: AttachResearchToCaseInput): Promise<TransactionCase> {
  const { userId, dedupeKey, title, jobId, propertyId, supersedesJobId } = input;
  const existing = dedupeKey ? await findTransactionCaseByDedupeKey(userId, dedupeKey) : null;
  const kase = existing
    ? await updateTransactionCase(existing.id, { research_job_id: jobId })
    : await createTransactionCase({
        user_id: userId,
        title,
        property_id: propertyId ?? null,
        research_job_id: jobId,
        dedupe_key: dedupeKey || null,
      });
  await linkResearchJobToCase(jobId, kase.id, supersedesJobId ?? null);
  return kase;
}

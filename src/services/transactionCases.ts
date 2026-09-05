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

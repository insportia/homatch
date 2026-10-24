// ADMIN — External Leads Database manager (migration 20261129090000_curated_leads_marketplace.sql).
// Every call is is_admin()-checked on the server; writes and exports are audited there.
import { supabase } from '@/db/supabase';
import type { CuratedPrice, MatchingFilters, WorkspaceState } from './matchingWorkspace';
import { filterPayload, normalizeState, serverCode } from './matchingWorkspace';

export class AdminLeadsError extends Error {
  constructor(public code: string) { super(code); }
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const m = String(error.message ?? '');
    const known = ['REASON_REQUIRED', 'BATCH_NOT_STAGING', 'INVALID_ARGUMENT', 'EMAIL_DUPLICATE', 'EXPORT_RATE_LIMITED', 'EXPORT_TOO_LARGE'].find((k) => m.includes(k));
    throw new AdminLeadsError(known ?? serverCode(error));
  }
  return data as T;
}

/* ── overview + controls ─────────────────────────────────────────────────── */

export type SourceClass = 'PARTNER' | 'EVENT' | 'WEB_FORM' | 'REFERRAL' | 'DIRECTORY' | 'OTHER';
export type LegalBasis = 'CONSENT_PARTNER_OFFERS' | 'CONSENT_HOMATCH_ONLY' | 'LEGITIMATE_INTEREST' | 'UNVERIFIED';
export const SOURCE_CLASSES: SourceClass[] = ['PARTNER', 'EVENT', 'WEB_FORM', 'REFERRAL', 'DIRECTORY', 'OTHER'];
export const LEGAL_BASES: LegalBasis[] = ['CONSENT_PARTNER_OFFERS', 'CONSENT_HOMATCH_ONLY', 'LEGITIMATE_INTEREST', 'UNVERIFIED'];

export interface BatchSummary {
  id: string;
  name: string;
  file_name: string | null;
  status: 'STAGING' | 'COMMITTED' | 'ARCHIVED';
  source_class: SourceClass;
  source_description?: string | null;
  acquired_at?: string | null;
  legal_basis: LegalBasis;
  rights_verified: boolean;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  imported_rows: number;
  notes?: string | null;
  created_at: string;
  committed_at: string | null;
  /** admin_curated_batches only */
  published?: number;
  leads?: number;
  createdByEmail?: string | null;
}

export interface AdminOverview {
  total: number;
  published: number;
  hidden: number;
  unverifiedRights: number;
  countries: number;
  languages: number;
  unlocks: number;
  buyers: number;
  revenueCredits: number;
  revenueUsd: number;
  price: CuratedPrice | null;
  maintenance: boolean;
  controls: Record<string, { frontend: boolean; backend: boolean; version: number }>;
  recentBatches: BatchSummary[];
}

export async function getOverview(): Promise<AdminOverview> {
  const d = await rpc<Record<string, unknown>>('admin_curated_overview');
  return {
    total: Number(d.total ?? 0), published: Number(d.published ?? 0), hidden: Number(d.hidden ?? 0),
    unverifiedRights: Number(d.unverifiedRights ?? 0), countries: Number(d.countries ?? 0), languages: Number(d.languages ?? 0),
    unlocks: Number(d.unlocks ?? 0), buyers: Number(d.buyers ?? 0), revenueCredits: Number(d.revenueCredits ?? 0),
    revenueUsd: Number(d.revenueUsd ?? 0), price: (d.price ?? null) as CuratedPrice | null, maintenance: d.maintenance === true,
    controls: (d.controls ?? {}) as AdminOverview['controls'], recentBatches: (d.recentBatches ?? []) as BatchSummary[],
  };
}

/** The four independent switches. Each change is audited server-side and live without a deploy. */
export type MatchingControl = 'INTERNAL' | 'CURATED' | 'UNLOCKED_LIBRARY' | 'MAINTENANCE';

export async function setMatchingControl(control: MatchingControl, on: boolean, reason?: string): Promise<WorkspaceState> {
  return normalizeState(await rpc('admin_matching_control_set', { p_control: control, p_on: on, p_reason: reason ?? null }));
}

/** Price per lead in US cents (final, VAT-inclusive): $0.10 = 10. */
export async function setCuratedPrice(cents: number, reason?: string): Promise<CuratedPrice> {
  return rpc<CuratedPrice>('admin_curated_set_price', { p_cents: Math.round(cents), p_reason: reason ?? null });
}

/* ── batches + import ────────────────────────────────────────────────────── */

export async function listBatches(offset = 0, limit = 50): Promise<{ total: number; items: BatchSummary[] }> {
  const d = await rpc<{ total: number; items: BatchSummary[] }>('admin_curated_batches', { p: { offset, limit } });
  return { total: Number(d.total ?? 0), items: d.items ?? [] };
}

export interface BatchInput {
  id?: string;
  name?: string;
  fileName?: string | null;
  sourceClass?: SourceClass;
  sourceDescription?: string | null;
  acquiredAt?: string | null;
  legalBasis?: LegalBasis;
  rightsVerified?: boolean;
  notes?: string | null;
  status?: 'ARCHIVED';
}

export async function saveBatch(input: BatchInput): Promise<BatchSummary> {
  return rpc<BatchSummary>('admin_curated_batch_save', { p: input });
}

/** One canonical row: the column names the server normalises (curated_normalise_row). */
export type CanonicalRow = Partial<Record<CanonicalField, string>>;
export const CANONICAL_FIELDS = [
  'first_name', 'last_name', 'email', 'interests', 'country', 'languages', 'category',
  'phone', 'whatsapp', 'telegram', 'facebook', 'linkedin', 'other_social',
  'city', 'region', 'preferred_location', 'budget_min', 'budget_max', 'currency', 'property_type',
  'area_min', 'area_max', 'rooms_min', 'rooms_max', 'investment_prefs', 'description', 'source_description',
  'collected_at', 'last_verified_at', 'tags', 'admin_notes',
] as const;
export type CanonicalField = typeof CANONICAL_FIELDS[number];
export const REQUIRED_FIELDS: CanonicalField[] = ['first_name', 'last_name', 'email', 'interests', 'country'];

export const STAGE_CHUNK = 1000;

export interface StageCounts { staged: number; total: number; valid: number; invalid: number; duplicate: number }

/** Stage rows in chunks (row numbers are the file's, so a retried chunk replaces itself). */
export async function stageRows(batchId: string, rows: Array<{ rowNo: number; data: CanonicalRow; raw?: Record<string, unknown> }>,
  onProgress?: (done: number, total: number) => void): Promise<StageCounts> {
  let last: StageCounts = { staged: 0, total: 0, valid: 0, invalid: 0, duplicate: 0 };
  for (let i = 0; i < rows.length; i += STAGE_CHUNK) {
    const chunk = rows.slice(i, i + STAGE_CHUNK).map((r) => ({ row_no: r.rowNo, data: r.data, raw: r.raw ?? r.data }));
    const d = await rpc<Record<string, unknown>>('admin_curated_stage_rows', { p_batch: batchId, p_rows: chunk });
    last = { staged: i + chunk.length, total: Number(d.total ?? 0), valid: Number(d.valid ?? 0), invalid: Number(d.invalid ?? 0), duplicate: Number(d.duplicate ?? 0) };
    onProgress?.(Math.min(i + STAGE_CHUNK, rows.length), rows.length);
  }
  return last;
}

export type StagedStatus = 'VALID' | 'INVALID' | 'DUPLICATE' | 'IMPORTED' | 'SKIPPED';
export interface StagedRow {
  id: string;
  rowNo: number;
  data: CanonicalRow & { interests?: string[] | string; languages?: string[] | string; tags?: string[] | string };
  errors: string[];
  warnings: string[];
  status: StagedStatus;
  duplicateOf: string | null;
  duplicateRow: number | null;
}

export async function batchRows(batchId: string, opts: { status?: StagedStatus | null; offset?: number; limit?: number } = {}) {
  return rpc<{ batch: BatchSummary; total: number; errorSummary: Record<string, number>; items: StagedRow[] }>(
    'admin_curated_batch_rows', { p_batch: batchId, p: { status: opts.status ?? null, offset: opts.offset ?? 0, limit: opts.limit ?? 100 } });
}

export async function fixRow(rowId: string, data: CanonicalRow): Promise<StagedRow> {
  return rpc<StagedRow>('admin_curated_row_fix', { p_row_id: rowId, p_data: data });
}

export async function commitBatch(batchId: string, updateDuplicates: boolean): Promise<{ created: number; updated: number }> {
  return rpc('admin_curated_batch_commit', { p_batch: batchId, p_update_duplicates: updateDuplicates });
}

/* ── catalog management ──────────────────────────────────────────────────── */

export interface AdminLead {
  id: string;
  batch_id: string | null;
  batchName: string | null;
  first_name: string;
  last_name: string;
  email: string;
  interests: string[];
  country: string;
  languages: string[];
  category: string | null;
  phone: string | null;
  whatsapp: string | null;
  telegram: string | null;
  facebook: string | null;
  linkedin: string | null;
  other_social: string | null;
  city: string | null;
  region: string | null;
  preferred_location: string | null;
  budget_min: number | null;
  budget_max: number | null;
  currency: string | null;
  property_type: string | null;
  description: string | null;
  last_verified_at: string | null;
  tags: string[];
  admin_notes: string | null;
  status: 'HIDDEN' | 'PUBLISHED';
  published_at: string | null;
  created_at: string;
  unlocks: number;
}

export interface AdminLeadQuery {
  status?: 'HIDDEN' | 'PUBLISHED' | null;
  batchId?: string | null;
  q?: string;
  filters?: MatchingFilters;
  page?: number;
  pageSize?: number;
}

export async function listLeads(q: AdminLeadQuery): Promise<{ total: number; page: number; pageSize: number; items: AdminLead[] }> {
  return rpc('admin_curated_leads', { p: {
    status: q.status ?? null, batchId: q.batchId ?? null, q: q.q ?? '', page: q.page ?? 1, pageSize: q.pageSize ?? 100,
    filters: q.filters ? filterPayload(q.filters) : {},
  } });
}

export async function updateLead(id: string, data: CanonicalRow): Promise<{ ok: boolean; errors?: string[] }> {
  return rpc('admin_curated_lead_update', { p_id: id, p_data: data });
}

/** Publish requires verified disclosure rights on the batch; the answer says how many were blocked. */
export async function setPublished(target: { ids?: string[]; batchId?: string }, publish: boolean): Promise<{ changed: number; blockedUnverified?: number }> {
  return rpc('admin_curated_publish', { p: target, p_publish: publish });
}

/** Authorised records only (verified rights), with a stated reason (≥ 10 characters). Audited. */
export async function exportLeads(p: { filters?: MatchingFilters; status?: string | null; batchId?: string | null }, reason: string) {
  return rpc<{ rows: Array<Record<string, unknown>>; count: number }>('admin_curated_export', {
    p: { filters: p.filters ? filterPayload(p.filters) : {}, status: p.status ?? null, batchId: p.batchId ?? null }, p_reason: reason,
  });
}

/* ── user-uploaded lists (oversight; contents only via an audited export) ── */

export interface UserList {
  id: string;
  name: string;
  ownerEmail: string | null;
  ownerName: string | null;
  sourceKind: string | null;
  sourceFormat: string | null;
  sourceFilename: string | null;
  importStatus: string | null;
  totalRows: number | null;
  validRows: number | null;
  contacts: number;
  createdAt: string;
  updatedAt: string;
}

export async function listUserLists(p: { q?: string; offset?: number; limit?: number } = {}): Promise<{ total: number; items: UserList[] }> {
  return rpc('admin_outreach_lists', { p: { q: p.q ?? '', offset: p.offset ?? 0, limit: p.limit ?? 50 } });
}

export async function exportUserList(listId: string, reason: string) {
  return rpc<{ rows: Array<Record<string, unknown>>; count: number }>('admin_outreach_list_export', { p_list_id: listId, p_reason: reason });
}

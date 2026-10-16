/*
 * LEADS CRM — the owner's relationships with contacts they unlocked.
 *
 * Every call is a SECURITY DEFINER function (migration 20261028090000) that resolves the
 * caller from their own session and only ever returns the caller's own entries. Nothing
 * here carries a phone number or an email address: the list and the detail are built
 * without them, and the browser never asks for one.
 *
 * Status changes are the owner's (crm_update). Message activity may move an entry
 * forward to CONTACTED / DELIVERED / REPLIED on the server; interest is never inferred.
 */

import { supabase } from '@/db/supabase';
import type { CrmStatus } from '@/crm/nextStep';
import { CRM_STATUSES, isCrmStatus } from '@/crm/model';

export interface CrmListItem {
  entryId: string;
  displayName: string | null;
  language: string | null;
  status: CrmStatus;
  propertyId: string | null;
  propertyTitle: string | null;
  homatchId: number | null;
  conversationId: string | null;
  followUpAt: string | null;
  followUpNote: string | null;
  noteCount: number;
  lastActivityAt: string;
  createdAt: string;
}

export interface CrmList {
  total: number;
  counts: Record<CrmStatus, number>;
  dueFollowUps: number;
  items: CrmListItem[];
}

export interface CrmNote { id: string; body: string; createdAt: string }
export interface CrmEvent { kind: string; detail: Record<string, unknown>; createdAt: string }
export interface CrmMessage { id: string; mine: boolean; body: string; status: string | null; createdAt: string }

export interface CrmEntryDetail {
  entryId: string;
  status: CrmStatus;
  followUpAt: string | null;
  followUpNote: string | null;
  propertyId: string | null;
  conversationId: string | null;
  notes: CrmNote[];
  events: CrmEvent[];
  messages: CrmMessage[];
}

export interface CrmUpdate {
  status?: CrmStatus;
  note?: string;
  /** ISO timestamp to schedule, or null to clear. Omit to leave unchanged. */
  followUpAt?: string | null;
  followUpNote?: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const status = (v: unknown): CrmStatus => (isCrmStatus(v) ? v : 'UNLOCKED');
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : [];

function normalizeItem(r: Record<string, unknown>): CrmListItem {
  return {
    entryId: String(r.entryId ?? ''),
    displayName: str(r.displayName),
    language: str(r.language),
    status: status(r.status),
    propertyId: str(r.propertyId),
    propertyTitle: str(r.propertyTitle),
    homatchId: num(r.homatchId),
    conversationId: str(r.conversationId),
    followUpAt: str(r.followUpAt),
    followUpNote: str(r.followUpNote),
    noteCount: num(r.noteCount) ?? 0,
    lastActivityAt: String(r.lastActivityAt ?? r.createdAt ?? ''),
    createdAt: String(r.createdAt ?? ''),
  };
}

function normalizeDetail(raw: unknown): CrmEntryDetail {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    entryId: String(r.entryId ?? ''),
    status: status(r.status),
    followUpAt: str(r.followUpAt),
    followUpNote: str(r.followUpNote),
    propertyId: str(r.propertyId),
    conversationId: str(r.conversationId),
    notes: arr(r.notes).map((n) => ({ id: String(n.id ?? ''), body: String(n.body ?? ''), createdAt: String(n.createdAt ?? '') })),
    events: arr(r.events).map((e) => ({
      kind: String(e.kind ?? ''),
      detail: (e.detail && typeof e.detail === 'object' ? e.detail : {}) as Record<string, unknown>,
      createdAt: String(e.createdAt ?? ''),
    })),
    messages: arr(r.messages).map((m) => ({
      id: String(m.id ?? ''),
      mine: m.mine === true,
      body: String(m.body ?? ''),
      status: str(m.status),
      createdAt: String(m.createdAt ?? ''),
    })),
  };
}

export async function crmList(params: {
  status?: CrmStatus | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}): Promise<CrmList> {
  const { data, error } = await supabase.rpc('crm_list', {
    p_status: params.status ?? null,
    p_search: params.search?.trim() ? params.search.trim() : null,
    p_limit: params.limit ?? 25,
    p_offset: params.offset ?? 0,
  });
  if (error) throw error;
  const r = (data ?? {}) as Record<string, unknown>;
  const countsRaw = (r.counts && typeof r.counts === 'object' ? r.counts : {}) as Record<string, unknown>;
  const counts = Object.fromEntries(CRM_STATUSES.map((s) => [s, num(countsRaw[s]) ?? 0])) as Record<CrmStatus, number>;
  return {
    total: num(r.total) ?? 0,
    counts,
    dueFollowUps: num(r.dueFollowUps) ?? 0,
    items: arr(r.items).map(normalizeItem).filter((i) => i.entryId),
  };
}

/** Every entry matching the filter, page by page (server caps a page at 100). */
export async function crmListAll(params: { status?: CrmStatus | null; search?: string | null }, cap = 2000): Promise<CrmListItem[]> {
  const out: CrmListItem[] = [];
  for (let offset = 0; offset < cap; offset += 100) {
    const page = await crmList({ ...params, limit: 100, offset });
    out.push(...page.items);
    if (page.items.length < 100 || out.length >= page.total) break;
  }
  return out.slice(0, cap);
}

export async function crmEntryDetail(entryId: string): Promise<CrmEntryDetail> {
  const { data, error } = await supabase.rpc('crm_entry_detail', { p_entry_id: entryId });
  if (error) throw error;
  return normalizeDetail(data);
}

export async function crmUpdate(entryId: string, patch: CrmUpdate): Promise<CrmEntryDetail> {
  const p: Record<string, unknown> = {};
  if (patch.status) p.status = patch.status;
  if (patch.note && patch.note.trim()) p.note = patch.note.trim();
  if (patch.followUpAt !== undefined) {
    p.followUpAt = patch.followUpAt ?? '';
    p.followUpNote = patch.followUpNote ?? '';
  }
  const { data, error } = await supabase.rpc('crm_update', { p_entry_id: entryId, p });
  if (error) throw error;
  return normalizeDetail(data);
}

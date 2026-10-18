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
import { CRM_STATUSES, isCrmStatus, type ContactChannel } from '@/crm/model';

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
  /** The owner states they contacted the member on this channel (never inferred). */
  logContact?: ContactChannel;
  outcome?: string;
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
  if (patch.logContact) { p.logContact = patch.logContact; if (patch.outcome?.trim()) p.outcome = patch.outcome.trim(); }
  if (patch.followUpAt !== undefined) {
    p.followUpAt = patch.followUpAt ?? '';
    p.followUpNote = patch.followUpNote ?? '';
  }
  const { data, error } = await supabase.rpc('crm_update', { p_entry_id: entryId, p });
  if (error) throw error;
  return normalizeDetail(data);
}

/* ── Find Buyers 2.0: the lead's profile and AI outreach drafts ─────────────── */

export interface CrmProfile {
  entryId: string;
  source: string;
  segment: 'STANDARD' | 'PREMIUM' | null;
  unlockedAt: string | null;
  creditsCharged: number | null;
  match: { matchId: string; propertyId: string | null; score: number; agreed: string[]; conflicted: string[]; unknown: string[]; matchedAt: string | null } | null;
  demand: Record<string, unknown> | null;
  drafts: Array<{ createdAt: string; detail: Record<string, unknown> }>;
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export async function crmEntryProfile(entryId: string): Promise<CrmProfile | null> {
  const { data, error } = await supabase.rpc('crm_entry_profile', { p_entry_id: entryId });
  if (error) {
    if (error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '')) return null;
    throw error;
  }
  const r = (data ?? {}) as Record<string, unknown>;
  const m = (r.match && typeof r.match === 'object' ? r.match : null) as Record<string, unknown> | null;
  return {
    entryId: String(r.entryId ?? entryId),
    source: String(r.source ?? 'HOMATCH_MEMBER_SEARCH'),
    segment: r.segment === 'PREMIUM' || r.segment === 'STANDARD' ? r.segment : null,
    unlockedAt: str(r.unlockedAt),
    creditsCharged: num(r.creditsCharged),
    match: m ? {
      matchId: String(m.matchId ?? ''), propertyId: str(m.propertyId), score: num(m.score) ?? 0,
      agreed: strs(m.agreed), conflicted: strs(m.conflicted), unknown: strs(m.unknown), matchedAt: str(m.matchedAt),
    } : null,
    demand: r.demand && typeof r.demand === 'object' ? r.demand as Record<string, unknown> : null,
    drafts: arr(r.drafts).map((d) => ({ createdAt: String(d.createdAt ?? ''), detail: (d.detail && typeof d.detail === 'object' ? d.detail : {}) as Record<string, unknown> })),
  };
}

export interface LeadDraftRequest {
  entryId: string;
  propertyId?: string | null;
  channel: 'EMAIL' | 'HOMATCH_CHAT' | 'WHATSAPP' | 'TELEGRAM' | 'SMS';
  tone: 'PROFESSIONAL' | 'FRIENDLY' | 'PREMIUM' | 'CONCISE' | 'FORMAL';
  purpose: 'INTRODUCTION' | 'RECOMMENDATION' | 'FOLLOW_UP' | 'VIEWING_INVITATION' | 'FINAL_FOLLOW_UP';
  language: string;
}

export class LeadDraftError extends Error {
  constructor(public code: string) { super(code); }
}

/** An AI draft for one unlocked lead. Never sends anything; the owner edits and sends it. */
export async function generateLeadDraft(req: LeadDraftRequest): Promise<{ subject: string | null; body: string }> {
  const { data, error } = await supabase.functions.invoke('outreach-send', { body: { action: 'studio_lead_draft', ...req } });
  if (error) {
    let code = 'AI_FAILED';
    try {
      const b = await (error as { context?: Response }).context?.json?.();
      if (b && typeof b.error === 'string') code = b.error;
    } catch { /* keep AI_FAILED */ }
    throw new LeadDraftError(code);
  }
  const d = (data ?? {}) as { ok?: boolean; draft?: { subject?: string | null; body?: string }; error?: string };
  if (!d.ok || !d.draft?.body) throw new LeadDraftError(d.error ?? 'AI_FAILED');
  return { subject: d.draft.subject ?? null, body: d.draft.body };
}

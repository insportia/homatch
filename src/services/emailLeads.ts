// EMAIL STUDIO — Leads. The browser's side of the Leads workspace (UX pass §3).
//
// Leads are outreach_contacts rows, read and written under the owner's own RLS, exactly as the
// rest of Communications does — no parallel contact store. Three rules this file keeps:
//   · a lead added or edited here is NEVER marked consented. Consent is recorded only through
//     my_outreach_contact_set_email_consent, with a lawful basis, one lead at a time on the server;
//   · one email address is one lead per owner: adding an address that exists returns DUPLICATE
//     with the existing lead, instead of a second row (imports keep their own duplicate flags);
//   · deleting a lead that was already contacted is refused by the server (its history references
//     it) and reported back, so the screen can offer "unsubscribe" instead.

import { supabase } from '@/db/supabase';
import { type LawfulBasis, setContactEmailConsent } from '@/services/emailMarketing';

export class LeadsError extends Error {
  constructor(public code: string) { super(code); }
}

export const EMAIL_RE = /^[^\s@<>"'(),;:]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}$/i;
export const normalizeEmail = (v: string) => v.trim().toLowerCase();
export const isValidEmail = (v: string) => EMAIL_RE.test(normalizeEmail(v)) && normalizeEmail(v).length <= 254 && !normalizeEmail(v).includes('..');

export interface Lead {
  id: string; list_id: string | null; email: string | null; full_name: string | null; first_name: string | null; last_name: string | null;
  phone: string | null; company: string | null; country: string | null; language: string | null; tags: string[] | null; notes: string | null;
  custom_fields: Record<string, string> | null; source_kind: string | null; source_platform: string | null; consent_status: string | null;
  consent_lawful_basis: string | null; consent_recorded_at: string | null; email_valid: boolean | null; unsubscribed: boolean | null;
  unsubscribed_at: string | null; suppressed: boolean | null; suppressed_reason: string | null; do_not_contact: boolean | null;
  is_duplicate: boolean | null; created_at: string; updated_at: string | null; last_contacted_at: string | null;
}

const COLS = 'id, list_id, email, full_name, first_name, last_name, phone, company, country, language, tags, notes, custom_fields, source_kind, source_platform, consent_status, consent_lawful_basis, consent_recorded_at, email_valid, unsubscribed, unsubscribed_at, suppressed, suppressed_reason, do_not_contact, is_duplicate, created_at, updated_at, last_contacted_at';

export type LeadStatus = 'CAN_RECEIVE' | 'CONSENT_MISSING' | 'UNSUBSCRIBED' | 'SUPPRESSED' | 'NO_EMAIL';

/** The one question the screen answers for each lead: can this person receive a campaign email? */
export function leadStatus(l: Pick<Lead, 'email' | 'email_valid' | 'unsubscribed' | 'suppressed' | 'do_not_contact' | 'consent_status'>): LeadStatus {
  if (!l.email || l.email_valid === false) return 'NO_EMAIL';
  if (l.unsubscribed) return 'UNSUBSCRIBED';
  if (l.suppressed || l.do_not_contact) return 'SUPPRESSED';
  return l.consent_status === 'CONSENTED' ? 'CAN_RECEIVE' : 'CONSENT_MISSING';
}

async function uid(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new LeadsError('NOT_SIGNED_IN');
  return user.id;
}

export interface LeadsOverview {
  total: number; withEmail: number; invalidEmail: number; canReceive: number; consentMissing: number; unsubscribed: number; suppressed: number;
  lists: Array<{ id: string; name: string; createdAt: string; sourceKind: string | null; total: number; canReceive: number }>;
}

export async function leadsOverview(): Promise<LeadsOverview> {
  const { data, error } = await supabase.rpc('my_email_contacts_overview');
  if (error) throw new LeadsError('LOAD_FAILED');
  return data as LeadsOverview;
}

export interface LeadQuery { search?: string; listId?: string | null; status?: LeadStatus | 'ALL'; page?: number; pageSize?: number }

export async function listLeads(q: LeadQuery = {}): Promise<{ rows: Lead[]; total: number }> {
  const owner = await uid();
  const size = Math.min(200, q.pageSize ?? 50);
  const from = (q.page ?? 0) * size;
  let r = supabase.from('outreach_contacts').select(COLS, { count: 'exact' }).eq('owner_id', owner)
    .order('created_at', { ascending: false }).range(from, from + size - 1);
  if (q.listId) r = r.eq('list_id', q.listId);
  switch (q.status) {
    case 'CAN_RECEIVE': r = r.not('email', 'is', null).neq('email_valid', false).eq('consent_status', 'CONSENTED').eq('unsubscribed', false).eq('suppressed', false).eq('do_not_contact', false); break;
    case 'CONSENT_MISSING': r = r.not('email', 'is', null).neq('email_valid', false).neq('consent_status', 'CONSENTED').eq('unsubscribed', false).eq('suppressed', false).eq('do_not_contact', false); break;
    case 'UNSUBSCRIBED': r = r.eq('unsubscribed', true); break;
    case 'SUPPRESSED': r = r.eq('unsubscribed', false).or('suppressed.eq.true,do_not_contact.eq.true'); break;
    case 'NO_EMAIL': r = r.or('email.is.null,email_valid.eq.false'); break;
    default: break;
  }
  const s = (q.search ?? '').trim().replace(/[%,()*]/g, ' ').slice(0, 80);
  if (s) r = r.or(`full_name.ilike.%${s}%,email.ilike.%${s}%,company.ilike.%${s}%,phone.ilike.%${s}%`);
  const { data, count, error } = await r;
  if (error) throw new LeadsError('LOAD_FAILED');
  return { rows: (data ?? []) as Lead[], total: count ?? 0 };
}

export async function getLead(id: string): Promise<Lead | null> {
  const { data } = await supabase.from('outreach_contacts').select(COLS).eq('id', id).maybeSingle();
  return (data as Lead | null) ?? null;
}

export interface LeadInput {
  first_name: string; last_name: string; email: string; phone?: string; company?: string; country?: string; language?: string;
  source?: string; tags?: string[]; notes?: string; custom_fields?: Record<string, string>; listId?: string | null;
}

const clean = (v: string | undefined, max: number) => (v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) || null;

function row(input: LeadInput) {
  const first = clean(input.first_name, 80), last = clean(input.last_name, 80);
  const custom = Object.fromEntries(Object.entries(input.custom_fields ?? {})
    .map(([k, v]) => [k.trim().slice(0, 40), String(v ?? '').trim().slice(0, 300)]).filter(([k, v]) => k && v).slice(0, 20));
  return {
    first_name: first, last_name: last, full_name: [first, last].filter(Boolean).join(' ') || null,
    email: normalizeEmail(input.email), email_valid: isValidEmail(input.email),
    phone: clean(input.phone, 40), company: clean(input.company, 160),
    country: input.country && /^[a-z]{2}$/i.test(input.country.trim()) ? input.country.trim().toUpperCase() : null,
    language: input.language && /^[a-z]{2}$/i.test(input.language) ? input.language.toLowerCase() : null,
    source_platform: clean(input.source, 80), notes: clean(input.notes, 2000),
    tags: [...new Set((input.tags ?? []).map((t) => t.trim().slice(0, 40)).filter(Boolean))].slice(0, 20),
    custom_fields: Object.keys(custom).length ? custom : null,
  };
}

/** One address = one lead per owner. Returns the existing lead's id when it is already there. */
export async function findByEmail(email: string, exceptId?: string): Promise<{ id: string; full_name: string | null } | null> {
  const owner = await uid();
  let r = supabase.from('outreach_contacts').select('id, full_name').eq('owner_id', owner).ilike('email', normalizeEmail(email).replace(/[%_\\]/g, (c) => `\\${c}`)).limit(1);
  if (exceptId) r = r.neq('id', exceptId);
  const { data } = await r.maybeSingle();
  return (data as { id: string; full_name: string | null } | null) ?? null;
}

const MANUAL_LIST = 'Added manually';

async function manualList(owner: string): Promise<string> {
  const { data: found } = await supabase.from('outreach_contact_lists').select('id').eq('owner_id', owner).eq('name', MANUAL_LIST).limit(1).maybeSingle();
  if (found?.id) return found.id as string;
  return createList(MANUAL_LIST).then((l) => l.id);
}

export async function createList(name: string): Promise<{ id: string; name: string }> {
  const owner = await uid();
  const n = name.trim().slice(0, 120);
  if (!n) throw new LeadsError('LIST_NAME_REQUIRED');
  /* READY: a hand-made list has nothing to analyse, and READY is what audiences select on. */
  const { data, error } = await supabase.from('outreach_contact_lists')
    .insert({ owner_id: owner, name: n, source_format: 'MANUAL', source_kind: 'MANUAL', import_status: 'READY', total_rows: 0, valid_rows: 0 })
    .select('id, name').single();
  if (error || !data) throw new LeadsError('LIST_CREATE_FAILED');
  return data as { id: string; name: string };
}

export async function renameList(id: string, name: string): Promise<void> {
  const n = name.trim().slice(0, 120);
  if (!n) throw new LeadsError('LIST_NAME_REQUIRED');
  const { error } = await supabase.from('outreach_contact_lists').update({ name: n, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new LeadsError('LIST_UPDATE_FAILED');
}

async function recount(listIds: Array<string | null | undefined>): Promise<void> {
  for (const id of [...new Set(listIds.filter((x): x is string => Boolean(x)))]) {
    const { count } = await supabase.from('outreach_contacts').select('id', { count: 'exact', head: true }).eq('list_id', id);
    await supabase.from('outreach_contact_lists').update({ total_rows: count ?? 0, updated_at: new Date().toISOString() }).eq('id', id);
  }
}

export async function createLead(input: LeadInput): Promise<Lead> {
  if (!clean(input.first_name, 80) || !clean(input.last_name, 80)) throw new LeadsError('NAME_REQUIRED');
  if (!isValidEmail(input.email)) throw new LeadsError('INVALID_EMAIL');
  const owner = await uid();
  const dupe = await findByEmail(input.email);
  if (dupe) { const e = new LeadsError('DUPLICATE'); (e as LeadsError & { existingId?: string }).existingId = dupe.id; throw e; }
  const listId = input.listId || await manualList(owner);
  const { data, error } = await supabase.from('outreach_contacts').insert({
    ...row(input), owner_id: owner, list_id: listId,
    /* Typed in by the owner: recorded as such, never as a purchased or discovered lead, and NOT consented. */
    source_kind: 'MANUAL', contact_detail_origin: 'OWNER_ENTERED', consent_status: 'UNKNOWN', validation_status: 'VALID',
  }).select(COLS).single();
  if (error || !data) throw new LeadsError('SAVE_FAILED');
  await recount([listId]);
  return data as Lead;
}

export async function updateLead(id: string, input: LeadInput): Promise<Lead> {
  if (!clean(input.first_name, 80) || !clean(input.last_name, 80)) throw new LeadsError('NAME_REQUIRED');
  if (!isValidEmail(input.email)) throw new LeadsError('INVALID_EMAIL');
  const before = await getLead(id);
  if (!before) throw new LeadsError('NOT_FOUND');
  const dupe = await findByEmail(input.email, id);
  if (dupe) { const e = new LeadsError('DUPLICATE'); (e as LeadsError & { existingId?: string }).existingId = dupe.id; throw e; }
  const patch: Record<string, unknown> = { ...row(input), updated_at: new Date().toISOString() };
  /* A changed address is a different person's inbox: the consent recorded for the old one does not carry over. */
  if (normalizeEmail(before.email ?? '') !== normalizeEmail(input.email) && before.consent_status === 'CONSENTED') {
    patch.consent_status = 'UNKNOWN'; patch.consent_lawful_basis = null; patch.consent_recorded_at = null;
  }
  if (input.listId && input.listId !== before.list_id) patch.list_id = input.listId;
  const { data, error } = await supabase.from('outreach_contacts').update(patch).eq('id', id).select(COLS).single();
  if (error || !data) throw new LeadsError('SAVE_FAILED');
  if (patch.list_id) await recount([before.list_id, String(patch.list_id)]);
  return data as Lead;
}

export async function deleteLeads(ids: string[]): Promise<{ deleted: number; kept: string[] }> {
  const { data, error } = await supabase.rpc('my_outreach_contacts_delete', { p_ids: ids.slice(0, 1000) });
  if (error) throw new LeadsError('DELETE_FAILED');
  return data as { deleted: number; kept: string[] };
}

/** Copy leads into a list (a lead row belongs to one list; addresses already there are skipped). */
export async function addLeadsToList(ids: string[], listId: string): Promise<{ added: number; skipped: number }> {
  const owner = await uid();
  const { data: rows } = await supabase.from('outreach_contacts').select('*').in('id', ids.slice(0, 1000)).eq('owner_id', owner);
  const { data: there } = await supabase.from('outreach_contacts').select('email').eq('list_id', listId).not('email', 'is', null);
  const have = new Set(((there ?? []) as Array<{ email: string }>).map((r) => normalizeEmail(r.email)));
  const copies = ((rows ?? []) as Array<Record<string, unknown>>)
    .filter((r) => r.list_id !== listId && !(typeof r.email === 'string' && have.has(normalizeEmail(r.email))))
    .map(({ id: _id, created_at: _c, updated_at: _u, ...r }) => ({ ...r, list_id: listId }));
  if (copies.length) {
    const { error } = await supabase.from('outreach_contacts').insert(copies);
    if (error) throw new LeadsError('SAVE_FAILED');
    await recount([listId]);
  }
  return { added: copies.length, skipped: (rows ?? []).length - copies.length };
}

/** Record consent for many leads: one server call each, every one with the same stated basis. */
export async function recordConsent(ids: string[], basis: LawfulBasis): Promise<{ ok: number; failed: Array<{ id: string; code: string }> }> {
  let ok = 0;
  const failed: Array<{ id: string; code: string }> = [];
  for (const id of ids.slice(0, 500)) {
    try { await setContactEmailConsent(id, true, basis); ok++; } catch (e) { failed.push({ id, code: (e as { code?: string }).code ?? 'FAILED' }); }
  }
  return { ok, failed };
}

export async function withdrawConsent(ids: string[]): Promise<number> {
  let ok = 0;
  for (const id of ids.slice(0, 500)) { try { await setContactEmailConsent(id, false, null); ok++; } catch { /* reported by count */ } }
  return ok;
}

/** The person asked not to be emailed: unsubscribed everywhere this owner sends from. */
export async function unsubscribeLeads(ids: string[]): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from('outreach_contacts')
    .update({ unsubscribed: true, unsubscribed_at: now, consent_status: 'UNSUBSCRIBED', updated_at: now }).in('id', ids.slice(0, 1000));
  if (error) throw new LeadsError('SAVE_FAILED');
}

/** Leads → a new campaign with these leads selected (sessionStorage, so ids never sit in a URL). */
export const PRESELECT_KEY = 'ems-preselect-leads';

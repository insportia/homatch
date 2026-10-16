/*
 * OWNER DEMO LEAD — the pure rules behind Demo Mode in HOMATCH Leads.
 *
 * The server (20261029090000_owner_demo_lead.sql) holds the fictional buyer and every
 * simulated action; this file turns its payload into what the page shows: the lead card,
 * the eleven guided steps and whether each is done, and the activity / notification feed.
 * No React and no Supabase (one type-only import), so src/leads/__tests__ load it directly.
 *
 * Everything here is labelled simulated. Nothing computes a real score, a real price or a
 * real charge: the 92% and the 2.5 credits are fixed demo values from the server row.
 */

import type { LeadItem } from '@/services/homatchLeads';

export type DemoSender = 'OWNER' | 'DEMO_BUYER';

export interface OwnerDemoMessage {
  id: string;
  seq: number;
  sender: DemoSender;
  body: string;
  is_simulated: boolean;
  language: string | null;
  sent_at: string;
  delivered_at: string | null;
  seen_at: string | null;
  created_at: string;
}

export interface OwnerDemoEvent {
  kind: string;
  detail: Record<string, unknown>;
  at: string;
  simulated: true;
}

export interface OwnerDemoNote { id: string; body: string; at: string }

export interface OwnerDemoState {
  details_viewed_at?: string;
  saved?: boolean;
  crm_saved_at?: string;
  crm_stage?: string;
  notes?: OwnerDemoNote[];
  chat_opened_at?: string;
  offer_attached_at?: string;
  email_draft?: { subject: string; template_id: string; language: string; saved_at: string };
  notifications_read_at?: string;
  walkthrough_done_at?: string;
}

export interface OwnerDemoHistoryItem { kind: string; days_ago: number }

export interface OwnerDemoPayload {
  is_demo: true;
  conversation_id: string;
  property: { id: string; homatch_id: number | null; title: string | null };
  facts: {
    city: string | null; district: string | null; total_price: number | string | null; currency: string | null;
    area: number | string | null; rooms: number | null; bedrooms: number | null;
  } | null;
  profile: {
    id: string;
    display_label: string;
    display_name: string | null;
    transaction_type: string | null;
    property_types: string[] | null;
    city: string | null;
    districts: string[] | null;
    budget_min: number | null;
    budget_max: number | null;
    currency: string | null;
    bedrooms_min: number | null;
    bedrooms_max: number | null;
    timeline_months: number | null;
    search_criteria: { parking?: boolean } | null;
    details: {
      simulated?: boolean;
      match_score?: number;
      band?: string;
      segment?: string;
      source?: string;
      unlock_credits?: number;
      language?: string;
      agreed?: string[];
      conflicted?: string[];
      request_days_ago?: number;
      history?: OwnerDemoHistoryItem[];
    } | null;
  };
  contact: { email?: string; phone?: string; preferred_channel?: string; fictional?: boolean } | null;
  unlocked_at: string | null;
  state: OwnerDemoState;
  events: OwnerDemoEvent[];
  messages: OwnerDemoMessage[];
  opened_at: string;
}

const DAY = 86_400_000;

/** The demo buyer as the real lead card expects a lead — fixed, simulated values. */
export function toDemoLeadItem(p: OwnerDemoPayload, now: number = Date.now()): LeadItem {
  const d = p.profile.details ?? {};
  const unlocked = p.unlocked_at != null;
  const districts = p.profile.districts ?? [];
  const requestAt = new Date(now - (d.request_days_ago ?? 12) * DAY).toISOString();
  const ownerMessages = p.messages.filter((m) => m.sender === 'OWNER').length;
  return {
    matchId: `demo-${p.conversation_id}`,
    score: d.match_score ?? 92,
    band: d.band === 'POTENTIAL' ? 'POTENTIAL' : 'STRONG',
    segment: d.segment === 'PREMIUM' ? 'PREMIUM' : 'STANDARD',
    priceCredits: d.unlock_credits ?? 2.5,
    unlocked,
    contacted: ownerMessages > 0,
    crmStatus: p.state.crm_stage ?? (unlocked ? 'UNLOCKED' : null),
    crmEntryId: null,
    saved: p.state.saved === true,
    fresh: !unlocked,
    transaction: p.profile.transaction_type === 'RENT' ? 'RENT' : 'SALE',
    intentType: 'BUY',
    propertyTypes: p.profile.property_types ?? ['APARTMENT'],
    locations: { city: p.profile.city, district: districts[0] ?? null, neighborhoods: districts.slice(1) },
    budget: { min: p.profile.budget_min, max: p.profile.budget_max, currency: p.profile.currency },
    requirements: {
      ...(p.profile.bedrooms_min != null ? { bedroomsMin: p.profile.bedrooms_min } : {}),
      ...(p.profile.bedrooms_max != null ? { bedroomsMax: p.profile.bedrooms_max } : {}),
    },
    /* The card's shared criteria list knows the engine's dimensions; parking is shown by the demo panel. */
    agreed: (d.agreed ?? []).filter((x) => x !== 'PARKING'),
    conflicted: d.conflicted ?? [],
    unknown: [],
    demandAt: requestAt,
    matchedAt: p.opened_at,
    updatedAt: new Date(now - DAY).toISOString(),
    contactOptions: { message: true, phone: true, email: true },
    displayName: unlocked ? p.profile.display_name : null,
    language: d.language ?? 'en',
  };
}

/* ── the guided journey ─────────────────────────────────────────────────── */

export const DEMO_STEPS = [
  'campaign', 'lead', 'unlock', 'contact', 'crm_save', 'crm_manage',
  'chat_open', 'chat_exchange', 'offer', 'email', 'activity',
] as const;
export type DemoStep = typeof DEMO_STEPS[number];

/** The page section each step points at (element ids in OwnerDemoJourney). */
export const DEMO_STEP_SECTION: Record<DemoStep, string> = {
  campaign: 'demo-campaign',
  lead: 'demo-lead',
  unlock: 'demo-lead',
  contact: 'demo-contact',
  crm_save: 'demo-crm',
  crm_manage: 'demo-crm',
  chat_open: 'demo-chat',
  chat_exchange: 'demo-chat',
  offer: 'demo-offer',
  email: 'demo-email',
  activity: 'demo-activity',
};

export function demoStepDone(p: OwnerDemoPayload): Record<DemoStep, boolean> {
  const s = p.state;
  const unlocked = p.unlocked_at != null;
  const typed = p.messages.some((m) => m.sender === 'OWNER');
  return {
    campaign: true,
    lead: Boolean(s.details_viewed_at) || unlocked,
    unlock: unlocked,
    contact: unlocked,
    crm_save: Boolean(s.crm_saved_at),
    crm_manage: (s.crm_stage != null && s.crm_stage !== 'UNLOCKED') || (s.notes?.length ?? 0) > 0,
    chat_open: Boolean(s.chat_opened_at),
    chat_exchange: typed,
    offer: Boolean(s.offer_attached_at),
    email: Boolean(s.email_draft),
    activity: Boolean(s.notifications_read_at),
  };
}

/** The first step not yet done, or null when the whole journey is complete. */
export function nextDemoStep(p: OwnerDemoPayload): DemoStep | null {
  const done = demoStepDone(p);
  return DEMO_STEPS.find((s) => !done[s]) ?? null;
}

export function demoProgress(p: OwnerDemoPayload): { done: number; total: number } {
  const done = demoStepDone(p);
  return { done: DEMO_STEPS.filter((s) => done[s]).length, total: DEMO_STEPS.length };
}

/* ── activity and notifications ─────────────────────────────────────────── */

export interface DemoActivityRow {
  key: string;
  kind: string;
  at: string;
  /** A simulated notification the owner would have received (never sent). */
  notification: boolean;
  detail: Record<string, unknown>;
}

const NOTIFYING = new Set(['MATCH_DISCOVERED', 'UNLOCKED', 'BUYER_REPLIED']);

/**
 * The owner's activity, newest first: the server's simulated events plus one row per
 * simulated buyer reply (each would have been a notification). Owner messages are not
 * repeated here — the thread shows them.
 */
export function demoActivity(p: OwnerDemoPayload): DemoActivityRow[] {
  const rows: DemoActivityRow[] = p.events.map((e, i) => ({
    key: `e-${i}-${e.kind}`,
    kind: e.kind,
    at: e.at,
    notification: NOTIFYING.has(e.kind),
    detail: e.detail ?? {},
  }));
  for (const m of p.messages) {
    if (m.sender === 'DEMO_BUYER') {
      rows.push({ key: `m-${m.id}`, kind: 'BUYER_REPLIED', at: m.created_at, notification: true, detail: {} });
    }
  }
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.key.localeCompare(a.key));
}

export function unreadDemoNotifications(p: OwnerDemoPayload): number {
  const since = p.state.notifications_read_at ? Date.parse(p.state.notifications_read_at) : -Infinity;
  return demoActivity(p).filter((r) => r.notification && Date.parse(r.at) > since).length;
}

/** The fictional buyer's own history (the request), oldest first, as dates. */
export function demoBuyerHistory(p: OwnerDemoPayload, now: number = Date.now()): Array<{ kind: string; at: string }> {
  return [...(p.profile.details?.history ?? [])]
    .sort((a, b) => b.days_ago - a.days_ago)
    .map((h) => ({ kind: h.kind, at: new Date(now - h.days_ago * DAY).toISOString() }));
}

export const DEMO_EVENT_KINDS = [
  'MATCH_DISCOVERED', 'UNLOCKED', 'CRM_SAVED', 'CRM_STAGE', 'CRM_NOTE', 'CHAT_OPENED',
  'OFFER_SENT', 'EMAIL_DRAFT', 'BUYER_REPLIED',
] as const;

export function demoEventKey(kind: string): string {
  return (DEMO_EVENT_KINDS as readonly string[]).includes(kind) ? `demo_event_${kind.toLowerCase()}` : 'demo_event_other';
}

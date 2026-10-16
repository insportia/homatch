/*
 * FROM SOMETHING A PERSON SAID TO SOMETHING THE MATCHER CAN USE.
 *
 * Every surface that can carry a requirement — the common room, a private message, an AI
 * conversation — goes through the same four steps here, so there is one pipeline and not
 * one per page:
 *
 *   1. READ     readConstraints() — deterministic, six languages, no model
 *   2. GATE     normalisePlan()   — the same validity rules a confirmed plan passes
 *   3. RECORD   recordIntent()    — canonical signal, referencing the source, never its text
 *   4. PROJECT  resolveEffectiveIntent() → intent_profiles + active_search_subscriptions,
 *               the entity the universal matcher already reads
 *
 * and then the matcher is asked to look at what changed. Nothing here charges, reserves,
 * acquires or starts discovery: understanding what somebody said in a conversation is not
 * a billable act, and a requirement stated in chat is matched against what Homatch already
 * holds and nothing else.
 */

import { recordIntent } from './intent.ts';
import { readConstraints } from '../../../src/research-core/intent/constraints.ts';
import { normalisePlan } from '../../../src/research-core/discovery/search-plan.ts';
import { attributionOf, readingsOf } from '../../../src/research-core/intent/interpret.ts';
import {
  resolveEffectiveIntent,
  type SignalRow,
} from '../../../src/research-core/intent/effective.ts';

/** What marks a demand row as one this pipeline projected. Find Property owns its own. */
export const PROJECTION_MARKER = 'native-intent-1.0.0';
const OWN_MARKERS = new Set([PROJECTION_MARKER, 'live-chat-1.0.0']);

// deno-lint-ignore no-explicit-any
type Db = any;

export type Surface = 'LIVE_CHAT' | 'PRIVATE_MESSAGE' | 'AI_CHAT';

/* ────────────────────────────────────────────────────────────────────────
 * Reading
 * ──────────────────────────────────────────────────────────────────────── */

export interface DemandReading {
  constraints: Record<string, unknown>;
  strength: Record<string, string>;
  /** How many constraints were read — refinements carry one or two. */
  found: number;
}

/**
 * The requirement a sentence states, or null when it states none.
 *
 * Only the dimensions the sentence NAMED are present, so the effective-state resolver can
 * refine per dimension: "actually I can go to $180k" carries a budget and a transaction and
 * leaves the city where the person put it.
 */
export function demandFromText(text: string): DemandReading | null {
  const reading = readConstraints(text);
  const { plan } = normalisePlan(reading);
  if (!plan) return null;

  const constraints: Record<string, unknown> = {
    transactionType: plan.deal === 'INVESTMENT' ? 'SALE' : plan.deal,
  };
  const strength: Record<string, string> = {};
  if (plan.city) { constraints.city = plan.city.value; strength.CITY = plan.city.strength; }
  if (plan.districts) { constraints.districts = plan.districts.value; strength.DISTRICT = plan.districts.strength; }
  if (plan.propertyTypes) {
    constraints.propertyTypes = plan.propertyTypes.value;
    strength.PROPERTY_TYPE = plan.propertyTypes.strength;
  }
  if (plan.budget) {
    constraints.budgetMin = plan.budget.value.min;
    constraints.budgetMax = plan.budget.value.max;
    constraints.currency = plan.budget.value.currency;
    strength.PRICE = plan.budget.strength;
  }
  if (plan.bedrooms) {
    constraints.bedroomsMin = plan.bedrooms.value.min;
    constraints.bedroomsMax = plan.bedrooms.value.max;
    strength.BEDROOMS = plan.bedrooms.strength;
  }
  if (typeof reading.roomsMin === 'number') {
    constraints.roomsMin = reading.roomsMin;
    constraints.roomsMax = reading.roomsMax ?? reading.roomsMin;
  }
  if (plan.areaSqm) {
    constraints.areaMin = plan.areaSqm.value.min;
    constraints.areaMax = plan.areaSqm.value.max;
    strength.AREA = plan.areaSqm.strength;
  }
  for (const key of Object.keys(constraints)) if (constraints[key] === null) delete constraints[key];
  return { constraints, strength, found: reading.found };
}

/**
 * "აღარ ვეძებ" — I am not looking any more.
 *
 * A first-person withdrawal that names no place, price or size. A sentence that DOES name
 * one ("not in Gldani") is a constraint, not the end of a search, and is not read as this.
 */
export function withdrawsSearch(text: string): { transactionType: string | null } | null {
  if (attributionOf(text) !== 'SELF') return null;
  if (!readingsOf(text).some((reading) => reading.act === 'REJECTION')) return null;
  const reading = readConstraints(text);
  if (reading.city || reading.budgetMax || reading.budgetMin || reading.bedroomsMin
    || reading.roomsMin || reading.areaMin) return null;
  const goal = String(reading.goal ?? '');
  return { transactionType: goal === 'RENT' || goal === 'SHORT_STAY' ? 'RENT' : goal ? 'SALE' : null };
}

/* ────────────────────────────────────────────────────────────────────────
 * Recording
 * ──────────────────────────────────────────────────────────────────────── */

export interface SourceEvent {
  surface: Surface;
  eventId: string;
  revision: string;
  actorUserId: string;
  sourceAt: string;
  text: string;
  /** Structural quote marker (reply_to_id). The sentence still decides SELF. */
  isReply?: boolean;
  conversationId?: string | null;
}

export interface RecordOutcome {
  demand: 'RECORDED' | 'WITHDRAWN_SEARCH' | 'NOT_SELF' | 'NO_REQUIREMENT' | 'REFUSED';
  refused: string[];
}

/**
 * Record what a message said about what its author is looking for.
 *
 * The author's OWN words only. A third-party, quoted or unattributed requirement is real
 * market intelligence and is never this person's search; validate() refuses it anyway,
 * and checking first saves the read.
 */
export async function recordDemandFrom(db: Db, event: SourceEvent): Promise<RecordOutcome> {
  const attribution = attributionOf(event.text);
  const effective = event.isReply && attribution === 'UNKNOWN' ? 'QUOTED' : attribution;
  if (effective !== 'SELF') return { demand: 'NOT_SELF', refused: [] };

  const withdrawal = withdrawsSearch(event.text);
  if (withdrawal) {
    const { id, rejected } = await recordIntent(db, {
      actorUserId: event.actorUserId,
      sourceSurface: event.surface,
      sourceEventId: event.eventId,
      sourceAt: event.sourceAt,
      side: 'DEMAND',
      act: 'REJECTION',
      dimension: null,
      polarity: 'NEGATIVE',
      attribution: 'SELF',
      explicit: true,
      confidence: 0.75,
      scope: 'GENERAL',
      conversationId: event.conversationId ?? null,
      constraints: withdrawal.transactionType ? { transactionType: withdrawal.transactionType } : {},
      strength: {},
    }, event.revision);
    return id ? { demand: 'WITHDRAWN_SEARCH', refused: [] } : { demand: 'REFUSED', refused: rejected };
  }

  const demand = demandFromText(event.text);
  if (!demand || demand.found < 2) return { demand: 'NO_REQUIREMENT', refused: [] };

  const { id, rejected } = await recordIntent(db, {
    actorUserId: event.actorUserId,
    sourceSurface: event.surface,
    sourceEventId: event.eventId,
    sourceAt: event.sourceAt,
    side: 'DEMAND',
    act: 'REQUIREMENT',
    dimension: null,
    polarity: 'POSITIVE',
    attribution: 'SELF',
    explicit: true,
    /* A deterministic reading of free prose: certain about what it read, and still lower
       than a plan somebody confirmed on a screen. */
    confidence: 0.75,
    scope: 'GENERAL',
    conversationId: event.conversationId ?? null,
    constraints: demand.constraints,
    strength: demand.strength,
  }, event.revision);
  return id ? { demand: 'RECORDED', refused: [] } : { demand: 'REFUSED', refused: rejected };
}

/* ────────────────────────────────────────────────────────────────────────
 * Projection
 * ──────────────────────────────────────────────────────────────────────── */

const SIGNAL_COLUMNS = 'id,actor_user_id,side,act,dimension,polarity,attribution,scope,explicit,'
  + 'confidence,source_at,property_id,intent_profile_id,constraints,strength,superseded_by,withdrawn_at';

function toSignal(row: Record<string, unknown>): SignalRow {
  return {
    id: String(row.id),
    actorUserId: String(row.actor_user_id),
    side: row.side as SignalRow['side'],
    act: row.act as SignalRow['act'],
    dimension: (row.dimension ?? null) as SignalRow['dimension'],
    polarity: row.polarity as SignalRow['polarity'],
    attribution: row.attribution as SignalRow['attribution'],
    scope: row.scope as SignalRow['scope'],
    explicit: row.explicit === true,
    confidence: Number(row.confidence ?? 0),
    sourceAt: String(row.source_at),
    propertyId: (row.property_id as string | null) ?? null,
    intentProfileId: (row.intent_profile_id as string | null) ?? null,
    constraints: (row.constraints ?? {}) as Record<string, unknown>,
    strength: (row.strength ?? {}) as SignalRow['strength'],
    supersededBy: null,
    withdrawnAt: null,
  };
}

export interface Projection {
  /** Demands now active, by intent profile id — what the matcher should look at. */
  active: string[];
  /** Demands this person no longer states, deactivated. */
  retired: string[];
}

/**
 * What this person currently wants, written where the matcher reads demand.
 *
 * One row per (person, transaction), reused across messages, surfaces and days. A demand
 * that names no city is not written — the matcher filters on a stated place, and a row
 * without one would be a search that silently matches nothing while the person believes
 * it is running. A demand the person withdrew is deactivated, and the native matches it
 * produced stop being shown.
 */
export async function projectActor(db: Db, actorUserId: string): Promise<Projection> {
  const { data: rows } = await db
    .from('intent_signals')
    .select(SIGNAL_COLUMNS)
    .eq('actor_user_id', actorUserId)
    .in('side', ['DEMAND', 'SUPPLY'])
    .is('superseded_by', null)
    .is('withdrawn_at', null)
    .order('source_at', { ascending: true })
    .limit(500);

  const { demands } = resolveEffectiveIntent(((rows ?? []) as Record<string, unknown>[]).map(toSignal));

  /*
   * Two reads, not an embed: active_search_subscriptions.intent_id carries no
   * foreign key, so a PostgREST embed through it fails (PGRST200) — and with the
   * error ignored, `existing` came back null, nothing was recognised as this
   * person's, and every statement created a fresh demand instead of refining one.
   */
  const { data: existing } = await db
    .from('active_search_subscriptions')
    .select('id,intent_id,is_active')
    .eq('user_id', actorUserId)
    .limit(100);
  const existingRows = (existing ?? []) as Record<string, unknown>[];
  const intentIds = existingRows.map((row) => row.intent_id).filter(Boolean).map(String);
  const { data: intentRows } = intentIds.length
    ? await db.from('intent_profiles').select('id,transaction_type,classifier_version').in('id', intentIds)
    : { data: [] };
  const intentById = new Map(((intentRows ?? []) as Record<string, unknown>[]).map((r) => [String(r.id), r]));

  const mine = existingRows.map((row) => {
    const intent = intentById.get(String(row.intent_id)) ?? null;
    return { row, intent };
  }).filter(({ intent }) => intent && OWN_MARKERS.has(String(intent.classifier_version)));

  const active: string[] = [];
  const keep = new Set<string>();

  for (const demand of demands) {
    if (demand.intentProfileId) continue;
    const c = demand.constraints;
    const city = (c.city as string | null) ?? null;
    if (!city) continue;
    const kind = String(c.transactionType ?? 'SALE').toUpperCase();
    const transaction = kind === 'RENT' || kind === 'SHORT_STAY' ? 'RENT' : 'SALE';
    const districts = (c.districts as string[] | null) ?? null;
    const profile = {
      intent_type: transaction === 'RENT' ? 'RENT' : 'BUY',
      country: 'GE',
      city,
      district: districts?.[0] ?? null,
      neighborhoods: districts,
      transaction_type: transaction,
      property_types: (c.propertyTypes as string[] | null) ?? null,
      bedrooms_min: (c.bedroomsMin as number | null) ?? null,
      bedrooms_max: (c.bedroomsMax as number | null) ?? null,
      rooms_min: (c.roomsMin as number | null) ?? null,
      rooms_max: (c.roomsMax as number | null) ?? null,
      area_min: (c.areaMin as number | null) ?? null,
      area_max: (c.areaMax as number | null) ?? null,
      budget_min: (c.budgetMin as number | null) ?? null,
      budget_max: (c.budgetMax as number | null) ?? null,
      currency: (c.currency as string | null) ?? null,
      intent_confidence: demand.confidence,
      classifier_version: PROJECTION_MARKER,
    };
    /* The firmness the person stated travels with the demand, where the matcher reads it. */
    const criteria = { ...c, strength: demand.strength, evidence: demand.evidence.slice(0, 20) };

    const found = mine.find(({ intent }) => String(intent!.transaction_type) === transaction);
    if (found) {
      const intentId = String(found.row.intent_id);
      await db.from('intent_profiles').update(profile).eq('id', intentId);
      await db.from('active_search_subscriptions')
        .update({ is_active: true, search_criteria: criteria })
        .eq('id', String(found.row.id));
      active.push(intentId);
      keep.add(String(found.row.id));
      continue;
    }

    const { data: created } = await db.from('intent_profiles').insert(profile).select('id').maybeSingle();
    const intentId = (created as { id?: string } | null)?.id;
    if (!intentId) continue;
    const { data: subscription } = await db.from('active_search_subscriptions').insert({
      user_id: actorUserId,
      intent_id: intentId,
      /* Watching for LISTINGS, which is what somebody looking for a flat is doing. */
      side: 'SUPPLY',
      is_active: true,
      search_criteria: criteria,
    }).select('id').maybeSingle();
    if (subscription?.id) keep.add(String(subscription.id));
    active.push(intentId);
  }

  const retired: string[] = [];
  for (const { row } of mine) {
    if (keep.has(String(row.id)) || row.is_active !== true) continue;
    await db.from('active_search_subscriptions').update({ is_active: false }).eq('id', String(row.id));
    await db.rpc('retire_native_matches', { p_intent_profile_id: String(row.intent_id), p_keep: [] });
    retired.push(String(row.intent_id));
  }
  return { active, retired };
}

/* ────────────────────────────────────────────────────────────────────────
 * One property
 * ──────────────────────────────────────────────────────────────────────── */

const LIVE_VIEWING = ['PENDING', 'ACCEPTED', 'RESCHEDULE_PROPOSED', 'COMPLETED'];

/**
 * How this person now stands towards this property, written as a native relationship.
 *
 * INTERESTED, ENQUIRED or REJECTED from what they said, plus whether a live viewing
 * request exists. A viewing request is the strongest structured evidence there is — a
 * person asked to stand in the flat — and it makes the relationship real on its own.
 */
export async function projectPropertyInterest(
  db: Db,
  actorUserId: string,
  propertyId: string,
  conversationId: string | null = null,
): Promise<string | null> {
  const { data: rows } = await db
    .from('intent_signals')
    .select(SIGNAL_COLUMNS + ',source_surface')
    .eq('actor_user_id', actorUserId)
    .eq('property_id', propertyId)
    .is('superseded_by', null)
    .is('withdrawn_at', null)
    .order('source_at', { ascending: true })
    .limit(200);
  const signals = (rows ?? []) as Record<string, unknown>[];
  const { properties } = resolveEffectiveIntent(signals.map(toSignal));
  const interest = properties.find((p) => p.propertyId === propertyId) ?? null;

  const { data: viewings } = await db
    .from('viewing_requests')
    .select('id,status')
    .eq('requester_id', actorUserId)
    .eq('property_id', propertyId)
    .limit(20);
  const viewing = ((viewings ?? []) as Record<string, unknown>[])
    .some((row) => LIVE_VIEWING.includes(String(row.status)));

  if (!interest && !viewing) {
    /* Nothing stands any more — an existing row is marked, a missing one is not created. */
    const { data: existing } = await db.from('native_property_relationships')
      .select('id').eq('demand_user_id', actorUserId).eq('property_id', propertyId).maybeSingle();
    if (!existing) return null;
  }

  const state = interest?.state === 'REJECTED' && !viewing
    ? 'REJECTED'
    : viewing || interest?.state === 'INTERESTED' ? 'INTERESTED'
      : interest?.state ?? 'ENQUIRED';
  const surfaces = [...new Set(signals.map((s) => String(s.source_surface)))];
  if (viewing && !surfaces.includes('VIEWING_REQUEST')) surfaces.push('VIEWING_REQUEST');

  const { data: id } = await db.rpc('upsert_property_relationship', {
    p: {
      property_id: propertyId,
      demand_user_id: actorUserId,
      state,
      viewing_requested: viewing,
      objections: interest?.objections ?? [],
      surfaces,
      evidence: (interest?.evidence ?? []).slice(0, 50),
      conversation_id: conversationId,
      last_event_at: interest?.lastStatedAt ?? new Date().toISOString(),
    },
  });
  return (id as string | null) ?? null;
}

/* ────────────────────────────────────────────────────────────────────────
 * Asking the matcher
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Match these demands against Homatch properties now.
 *
 * nativeOnly: a requirement stated in a conversation is matched against the native network
 * and nothing else. It does not start external discovery, reserve credits or cost anything.
 */
export async function requestNativeMatching(intentProfileIds: string[]): Promise<unknown> {
  if (!intentProfileIds.length) return null;
  const baseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!baseUrl || !serviceKey) return null;
  try {
    const response = await fetch(`${baseUrl}/functions/v1/supply-matching`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ intentProfileIds: intentProfileIds.slice(0, 25), nativeOnly: true }),
    });
    return await response.json().catch(() => null);
  } catch {
    return null;
  }
}

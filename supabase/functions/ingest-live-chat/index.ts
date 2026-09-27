// THE COMMON ROOM, READ ONCE.
//
// Somebody writing "ვეძებ 2 საძინებლიან ბინას ვაკეში $220,000-მდე" in the general chat has
// stated a requirement. Making them retype it into Find Property because that is where
// the form lives is asking a person to repeat themselves to a system that already heard.
//
// WHAT IS DETERMINISTIC AND WHAT IS NOT
//
// Almost all of it is deterministic, and that is the point:
//
//   WHO is speaking        live_chat_messages.user_id
//   WHETHER THEY QUOTED    reply_to_id
//   WHOSE INTENT IT IS     the sentence's own markers — Georgian conjugates the first
//                          person, so "ვეძებ" is the whole of "I am looking"
//   WHAT WAS SAID          interest, withdrawal, complaint, question, requirement
//   WHICH PROPERTY         a six-digit reference, VERIFIED against the registry
//
// The only thing a model is asked is what the CONSTRAINTS are — the city, the budget, the
// bedrooms inside a free sentence — and that question already has an implementation:
// find-property-plan in draft mode, the same reader the customer's own Search Plan uses.
// A second extractor here would be a second answer to one question.
//
// INCREMENTAL, BECAUSE A ROOM IS APPEND-ONLY
//
// `seq` is monotonic, so a cursor is one number. Re-reading the room on every message
// would be quadratic in a chat that gets popular, and it would send the same sentence to
// a model once per subsequent message.
//
// EDITS AND DELETIONS ARE NOT REPROCESSING
//
// A message whose text moved no longer says what was derived from it, and a deleted one
// says nothing at all. Both WITHDRAW the derived signals rather than removing them: the
// evidence that somebody once said something is not made false by their changing it, and
// an operator asked "why was I matched with this" needs the row that explains it.
//
// NOTHING HERE IS CHARGED. Reading the room and understanding it is not an acquisition.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { recordIntent, withdrawIntentFor } from '../_shared/intent.ts';
import {
  attributionOf,
  firmnessOf,
  propertyReferenceCandidates,
  readingsOf,
} from '../../../src/research-core/intent/interpret.ts';
import { resolveEffectiveIntent } from '../../../src/research-core/intent/effective.ts';

/**
 * What marks a demand row as one this worker wrote.
 *
 * Find Property stamps its own rows 'search-plan-1.0.0' and owns them; this never
 * touches one. The marker is how the projection finds the row it made last time instead
 * of creating a second search for the same person.
 */
const PROJECTION_MARKER = 'live-chat-1.0.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' },
});

/** How many messages one tick reads. A room, not a history. */
const BATCH = 200;

/** Where the cursor lives, beside every other worker's. */
const CURSOR_KEY = 'ingest_live_chat_seq';

/**
 * Does this sentence state requirements at all?
 *
 * The gate before the expensive step. Most of a chat room is not a property requirement,
 * and sending "good morning" to a language model to be told so is the cost this avoids.
 * A message reaches the planner only if it carries a first-person looking-for marker.
 */
const DEMAND_MARKERS: readonly string[] = [
  'ვეძებ', 'მინდა', 'მჭირდება', 'ვიყიდი', 'ვიქირავებ',
  'ищу', 'хочу', 'куплю', 'сниму', 'нужна', 'нужен',
  'looking for', 'i want', 'i need', 'i am looking',
  'arıyorum', 'istiyorum',
];

function statesRequirements(text: string): boolean {
  const body = String(text ?? '').toLowerCase();
  return DEMAND_MARKERS.some((marker) => body.includes(marker.toLowerCase()));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const baseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!baseUrl || !serviceKey) return json({ error: 'not configured' }, 500);

  const db = createClient(baseUrl, serviceKey, { auth: { persistSession: false } });

  /* A worker tick: no customer, no user JWT, authenticated on a private token. */
  const presented = req.headers.get('x-cron-token') || '';
  const authorization = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (authorization !== serviceKey) {
    const { data: tokenRow } = await db
      .from('admin_settings').select('value').eq('key', 'ingest_live_chat_token').maybeSingle();
    const expected = String(tokenRow?.value ?? '').replace(/^"|"$/g, '');
    if (!expected || presented !== expected) return json({ error: 'Forbidden' }, 403);
  }

  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun === true;

    const { data: cursorRow } = await db
      .from('admin_settings').select('value').eq('key', CURSOR_KEY).maybeSingle();
    const cursor = Number(String(cursorRow?.value ?? '0').replace(/^"|"$/g, '')) || 0;

    /*
     * EVERYTHING SINCE THE CURSOR, plus anything whose text has moved.
     *
     * Two reads rather than one, because an edit does not advance `seq` — a message
     * edited an hour after it was written keeps its place in the room and would never be
     * seen again by a cursor that only moves forwards.
     */
    const { data: fresh, error: freshError } = await db
      .from('live_chat_messages')
      .select('id,seq,user_id,body,reply_to_id,edited_at,deleted_at,created_at')
      .gt('seq', cursor)
      .order('seq', { ascending: true })
      .limit(BATCH);
    if (freshError) throw freshError;

    const { data: changed } = await db
      .from('live_chat_messages')
      .select('id,seq,user_id,body,reply_to_id,edited_at,deleted_at,created_at')
      .lte('seq', cursor)
      .or('edited_at.not.is.null,deleted_at.not.is.null')
      .order('seq', { ascending: false })
      .limit(BATCH);

    const totals = {
      read: (fresh ?? []).length,
      revisited: (changed ?? []).length,
      withdrawn: 0,
      quoted: 0,
      thirdParty: 0,
      propertySignals: 0,
      demandSignals: 0,
      interpreted: 0,
      refused: 0,
      demandsProjected: 0,
    };
    /* Whose effective state has to be recomputed at the end of the tick. A person who
       sent four messages is resolved once, not four times. */
    const actorsTouched = new Set<string>();
    const refusals: Array<{ messageId: string; rejected: string[] }> = [];

    /* ── messages whose text moved or vanished ────────────────────────── */
    for (const row of changed ?? []) {
      const message = row as Record<string, unknown>;
      if (!message.edited_at && !message.deleted_at) continue;
      if (!dryRun) {
        await withdrawIntentFor(
          db, 'LIVE_CHAT', String(message.id),
          message.deleted_at ? 'SOURCE_DELETED' : 'SOURCE_EDITED',
        );
      }
      totals.withdrawn += 1;
    }

    /* ── new messages ─────────────────────────────────────────────────── */
    let highest = cursor;
    for (const row of fresh ?? []) {
      const message = row as Record<string, unknown>;
      highest = Math.max(highest, Number(message.seq) || 0);

      /* A deleted message says nothing, and an unauthenticated one has no actor. */
      if (message.deleted_at) continue;
      const actorUserId = String(message.user_id ?? '');
      if (!actorUserId) continue;

      const text = String(message.body ?? '');
      if (!text.trim()) continue;

      /*
       * WHETHER THEY WERE QUOTING IS A COLUMN.
       *
       * reply_to_id does not by itself make a message a quotation — "me too", in reply to
       * somebody's search, is that person speaking for themselves. So the reply is
       * context and the sentence still decides: a reply carrying its own first-person
       * marker is SELF, and one that carries none is not promoted to it.
       */
      const isReply = Boolean(message.reply_to_id);
      const attribution = attributionOf(text);
      const effective = isReply && attribution === 'UNKNOWN' ? 'QUOTED' : attribution;
      if (effective === 'QUOTED') totals.quoted += 1;
      if (effective === 'THIRD_PARTY') totals.thirdParty += 1;

      const readings = readingsOf(text);
      const sourceAt = String(message.created_at ?? new Date().toISOString());

      /*
       * A SIX-DIGIT NUMBER IS A CANDIDATE, NEVER A RESOLUTION.
       *
       * Verified against the registry before it becomes a property reference. Without
       * this, "I can go up to 220000" opens somebody else's listing.
       */
      const candidates = propertyReferenceCandidates(text);
      let referenced: string | null = null;
      if (candidates.length > 0) {
        const { data: resolved } = await db
          .from('properties')
          .select('id,homatch_id')
          .in('homatch_id', candidates)
          .eq('is_deleted', false)
          .limit(1);
        referenced = (resolved?.[0] as { id?: string } | undefined)?.id ?? null;
      }

      /* ── what was said about one property ───────────────────────────── */
      if (referenced) {
        for (const reading of readings) {
          if (reading.act === 'REQUIREMENT') continue;
          if (dryRun) { totals.propertySignals += 1; continue; }
          const { id, rejected } = await recordIntent(db, {
            actorUserId,
            sourceSurface: 'LIVE_CHAT',
            sourceEventId: String(message.id),
            sourceAt,
            side: 'PROPERTY_INTEREST',
            act: reading.act,
            dimension: reading.dimension,
            polarity: reading.polarity,
            attribution: effective,
            explicit: true,
            confidence: 0.8,
            scope: 'PROPERTY',
            propertyId: referenced,
            constraints: {},
            strength: {},
          });
          if (id) totals.propertySignals += 1;
          else { totals.refused += 1; refusals.push({ messageId: String(message.id), rejected }); }
        }
      }

      /* ── what they are looking for, in general ──────────────────────── */
      /*
       * ONLY THE AUTHOR'S OWN WORDS, and only when they state requirements. A
       * third-party sentence is real intelligence about the market and is never this
       * person's search; validate() refuses it, and checking here saves the model call.
       */
      if (effective !== 'SELF' || !statesRequirements(text)) continue;

      /*
       * THE ONE PLACE A MODEL IS ASKED ANYTHING.
       *
       * What the city, the budget and the bedrooms are inside a free sentence is a real
       * semantic question, and it already has an implementation — the same draft reader
       * the customer's own Search Plan uses. A second extractor here would be a second
       * answer to one question, and the two would drift.
       */
      const { data: draft } = await db.functions.invoke('find-property-plan', {
        body: { mode: 'draft', text },
      });
      const plan = (draft as { plan?: Record<string, unknown> | null } | null)?.plan ?? null;
      const interpreted = (draft as { interpreted?: boolean } | null)?.interpreted === true;
      if (!plan || !interpreted) continue;
      totals.interpreted += 1;

      const constraintOf = (key: string) =>
        (plan[key] as { value?: unknown } | null | undefined)?.value ?? null;
      const strengthOf = (key: string) => {
        const value = (plan[key] as { strength?: string } | null | undefined)?.strength;
        return value && value !== 'UNKNOWN' ? value : null;
      };
      const budget = (plan.budget as { value?: { min?: number | null; max?: number | null; currency?: string } } | null)?.value;
      const bedrooms = (plan.bedrooms as { value?: { min?: number | null; max?: number | null } } | null)?.value;

      /*
       * THE FIRMNESS THE SENTENCE ITSELF CARRIES.
       *
       * The planner's defaults are a product judgement about a typed description; a chat
       * sentence often says which way it meant something — "აუცილებლად" is a rule,
       * "მირჩევნია" is a preference — and the sentence outranks the default when it
       * speaks. Confidence stays separate: we can be sure somebody said "I'd prefer",
       * and it is still a preference.
       */
      const stated = firmnessOf(text);

      if (dryRun) { totals.demandSignals += 1; continue; }
      const { id, rejected } = await recordIntent(db, {
        actorUserId,
        sourceSurface: 'LIVE_CHAT',
        sourceEventId: String(message.id),
        sourceAt,
        side: 'DEMAND',
        act: 'REQUIREMENT',
        dimension: null,
        polarity: 'POSITIVE',
        attribution: 'SELF',
        explicit: true,
        /* A reading of free prose. Lower than a confirmed plan, and honestly so. */
        confidence: 0.7,
        scope: 'GENERAL',
        constraints: {
          transactionType: plan.deal === 'INVESTMENT' ? 'SALE' : (plan.deal ?? null),
          city: constraintOf('city'),
          districts: constraintOf('districts'),
          propertyTypes: constraintOf('propertyTypes'),
          budgetMin: budget?.min ?? null,
          budgetMax: budget?.max ?? null,
          currency: budget?.currency ?? null,
          bedroomsMin: bedrooms?.min ?? null,
          bedroomsMax: bedrooms?.max ?? null,
        },
        strength: {
          ...(strengthOf('city') ? { CITY: strengthOf('city') } : {}),
          ...(strengthOf('districts') ? { DISTRICT: strengthOf('districts') } : {}),
          ...(strengthOf('propertyTypes') ? { PROPERTY_TYPE: strengthOf('propertyTypes') } : {}),
          ...(strengthOf('budget') ? { PRICE: strengthOf('budget') } : {}),
          ...(strengthOf('bedrooms') ? { BEDROOMS: stated } : {}),
        },
      });
      if (id) { totals.demandSignals += 1; actorsTouched.add(actorUserId); }
      else { totals.refused += 1; refusals.push({ messageId: String(message.id), rejected }); }
    }

    /* ── what those people now want, as the matcher will read it ─────── */
    /*
     * PROJECTED, NOT POINTED AT.
     *
     * The matcher reads intent_profiles joined to active_search_subscriptions, because
     * that is where a demand lives and who owns it. Signals are evidence and accumulate
     * contradictions; a matcher reading them directly would honour a customer's Monday
     * budget and their Thursday budget at the same time and satisfy neither.
     *
     * So the resolved state is written onto the entity the product already has. One
     * demand is one row whatever surface produced it, and Find Property's own rows are
     * untouched — this only ever writes the ones it made.
     */
    for (const actorUserId of actorsTouched) {
      if (dryRun) break;

      const { data: rows } = await db
        .from('intent_signals')
        .select('id,actor_user_id,side,act,dimension,polarity,attribution,scope,explicit,'
          + 'confidence,source_at,property_id,intent_profile_id,constraints,strength,'
          + 'superseded_by,withdrawn_at')
        .eq('actor_user_id', actorUserId)
        .is('superseded_by', null)
        .is('withdrawn_at', null)
        .limit(500);

      const { demands } = resolveEffectiveIntent((rows ?? []).map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: String(r.id),
          actorUserId: String(r.actor_user_id),
          side: r.side as 'DEMAND' | 'SUPPLY' | 'PROPERTY_INTEREST',
          act: r.act as 'REQUIREMENT',
          dimension: (r.dimension ?? null) as null,
          polarity: r.polarity as 'POSITIVE',
          attribution: r.attribution as 'SELF',
          scope: r.scope as 'GENERAL',
          explicit: r.explicit === true,
          confidence: Number(r.confidence ?? 0),
          sourceAt: String(r.source_at),
          propertyId: (r.property_id as string | null) ?? null,
          intentProfileId: (r.intent_profile_id as string | null) ?? null,
          constraints: (r.constraints ?? {}) as Record<string, unknown>,
          strength: (r.strength ?? {}) as Record<string, never>,
          supersededBy: null,
          withdrawnAt: null,
        };
      }));

      for (const demand of demands) {
        /*
         * A REQUIREMENT THAT NAMES NO PLACE IS NOT SEARCHABLE. supply-matching filters
         * demand on a stated city, and writing a row without one would create a search
         * that silently matches nothing — worse than not creating it, because the
         * customer would believe it was running.
         */
        const city = demand.constraints.city as string | null;
        if (!city) continue;
        /* Find Property owns its own rows. This only ever updates the ones it wrote. */
        if (demand.intentProfileId) continue;

        const transaction = String(demand.constraints.transactionType ?? 'SALE').toUpperCase();
        const profile = {
          intent_type: transaction === 'RENT' ? 'RENT' : 'BUY',
          country: 'GE',
          city,
          district: ((demand.constraints.districts as string[] | null) ?? [])[0] ?? null,
          neighborhoods: (demand.constraints.districts as string[] | null) ?? null,
          transaction_type: transaction === 'RENT' ? 'RENT' : 'SALE',
          property_types: (demand.constraints.propertyTypes as string[] | null) ?? null,
          bedrooms_min: (demand.constraints.bedroomsMin as number | null) ?? null,
          bedrooms_max: (demand.constraints.bedroomsMax as number | null) ?? null,
          budget_min: (demand.constraints.budgetMin as number | null) ?? null,
          budget_max: (demand.constraints.budgetMax as number | null) ?? null,
          currency: (demand.constraints.currency as string | null) ?? null,
          /* The resolved state's own confidence, which is the least certain thing still
             holding it up — never 1, because nobody confirmed this on a screen. */
          intent_confidence: demand.confidence,
          classifier_version: PROJECTION_MARKER,
        };

        /*
         * REUSED, NOT RE-CREATED. Somebody refining their budget across three messages
         * has one search. The marker is what makes the row findable next time, and
         * keying on the transaction as well keeps a buyer's search apart from the same
         * person's rental search.
         */
        const { data: existing } = await db
          .from('active_search_subscriptions')
          .select('id,intent_id,intent:intent_profiles!intent_id(id,transaction_type,classifier_version)')
          .eq('user_id', actorUserId)
          .eq('is_active', true)
          .limit(50);

        const mine = (existing ?? []).find((row) => {
          const joined = (row as Record<string, unknown>).intent as Record<string, unknown> | null;
          const intent = Array.isArray(joined) ? joined[0] : joined;
          return intent
            && intent.classifier_version === PROJECTION_MARKER
            && String(intent.transaction_type) === profile.transaction_type;
        }) as Record<string, unknown> | undefined;

        if (mine) {
          await db.from('intent_profiles').update(profile).eq('id', String(mine.intent_id));
          totals.demandsProjected += 1;
          continue;
        }

        const { data: created } = await db
          .from('intent_profiles').insert(profile).select('id').maybeSingle();
        const intentId = (created as { id?: string } | null)?.id;
        if (!intentId) continue;
        await db.from('active_search_subscriptions').insert({
          user_id: actorUserId,
          intent_id: intentId,
          /* Watching for LISTINGS, which is what somebody looking for a flat is doing. */
          side: 'SUPPLY',
          is_active: true,
          search_criteria: demand.constraints as unknown as Record<string, unknown>,
        });
        totals.demandsProjected += 1;
      }
    }

    if (!dryRun && highest > cursor) {
      await db.from('admin_settings')
        .upsert({ key: CURSOR_KEY, value: String(highest) }, { onConflict: 'key' });
    }

    return json({
      success: true,
      cursor,
      advancedTo: highest,
      ...totals,
      /*
       * REFUSALS ARE REPORTED WITH IDS AND REASONS AND NEVER WITH TEXT.
       *
       * An operator debugging a false positive needs to know which message and why; they
       * do not need the sentence, and a log that carried it would be a second copy of
       * somebody's words with different access rules.
       */
      refusals: refusals.slice(0, 20),
      elapsedMs: Date.now() - started,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

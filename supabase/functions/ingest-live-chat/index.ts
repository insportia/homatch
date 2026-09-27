// THE NATIVE INTENT READER — the common room, and the AI conversation, read once.
//
// Somebody writing "ვეძებ 2 საძინებლიან ბინას ვაკეში $220,000-მდე" in the general chat has
// stated a requirement. Making them retype it into Find Property because that is where
// the form lives is asking a person to repeat themselves to a system that already heard.
// The same is true of a customer describing what they want to the AI assistant.
//
// Named for the surface it was first written for; it now reads two:
//
//   LIVE_CHAT   live_chat_messages        actor: user_id, quote: reply_to_id,
//                                          edits: edited_at, deletions: deleted_at
//   AI_CHAT     ai_messages (role='user') actor: ai_conversations.user_id → users.auth_id
//
// Legacy ai_chat_leads rows are NOT read: they never recorded who was speaking about whom,
// and assuming SELF for a row whose speaker nobody captured is how an owner is told that
// somebody is interested who was talking about their brother. NEW AI conversation messages
// carry an authenticated actor, an id, a timestamp and the author's own words, which is
// everything a canonical reading needs — so they are read, going forward, like any other.
//
// DETERMINISTIC, END TO END
//
//   WHO is speaking        the row's actor column
//   WHETHER THEY QUOTED    reply_to_id (live chat)
//   WHOSE INTENT IT IS     the sentence's own first-person markers, six languages
//   WHAT WAS SAID          interest, withdrawal, complaint, question, requirement
//   WHICH PROPERTY         a six-digit reference, VERIFIED against the registry
//   WHAT IS REQUIRED       readConstraints() — places, types, counts, money, six languages
//
// No model is called. Every reading here is reproducible, testable in every language the
// product speaks, and explainable to the person it describes.
//
// INCREMENTAL. Three cursors in admin_settings: the live chat's `seq`, the latest edit or
// deletion already handled, and the latest AI message read. A wake-up (the trigger on
// insert) is a hint, not a payload; this reads from its cursors whatever woke it.
//
// NOTHING IS CHARGED. Reading a conversation and understanding it is not an acquisition,
// and a requirement stated in chat is matched against the Homatch network only.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { recordIntent, withdrawIntentFor } from '../_shared/intent.ts';
import {
  projectActor,
  projectPropertyInterest,
  recordDemandFrom,
  requestNativeMatching,
  type Surface,
} from '../_shared/nativeDemand.ts';
import {
  attributionOf,
  propertyReferenceCandidates,
  readingsOf,
} from '../../../src/research-core/intent/interpret.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' },
});

/** How many messages one tick reads per source. A room, not a history. */
const BATCH = 200;

const SEQ_CURSOR = 'ingest_live_chat_seq';
const CHANGED_CURSOR = 'ingest_live_chat_changed_at';
const AI_CURSOR = 'ingest_ai_chat_cursor';

// deno-lint-ignore no-explicit-any
type Db = any;

async function readSetting(db: Db, key: string): Promise<string> {
  const { data } = await db.from('admin_settings').select('value').eq('key', key).maybeSingle();
  const raw = data?.value;
  if (raw === null || raw === undefined) return '';
  return typeof raw === 'string' ? raw.replace(/^"|"$/g, '') : String(raw).replace(/^"|"$/g, '');
}

async function writeSetting(db: Db, key: string, value: string): Promise<void> {
  await db.from('admin_settings').upsert({ key, value }, { onConflict: 'key' });
}

interface Totals {
  liveRead: number;
  liveRevisited: number;
  aiRead: number;
  withdrawn: number;
  quoted: number;
  thirdParty: number;
  propertySignals: number;
  demandSignals: number;
  searchesWithdrawn: number;
  refused: number;
  demandsProjected: number;
  demandsRetired: number;
  relationships: number;
}

/**
 * Everything one message said, recorded.
 *
 * A property named by a verified six-digit reference gets property-scoped readings; the
 * author's own requirements, if any, become a DEMAND. The two are independent: "I like
 * 482913 but I'm really after a 2-bedroom in Vake" is both.
 */
async function readMessage(
  db: Db,
  totals: Totals,
  refusals: Array<{ surface: string; messageId: string; rejected: string[] }>,
  actorsTouched: Set<string>,
  propertyTouches: Array<[string, string]>,
  message: {
    surface: Surface;
    id: string;
    revision: string;
    actorUserId: string;
    text: string;
    sourceAt: string;
    isReply: boolean;
  },
  dryRun: boolean,
) {
  const attribution = attributionOf(message.text);
  const effective = message.isReply && attribution === 'UNKNOWN' ? 'QUOTED' : attribution;
  if (effective === 'QUOTED') totals.quoted += 1;
  if (effective === 'THIRD_PARTY') totals.thirdParty += 1;

  /* A SIX-DIGIT NUMBER IS A CANDIDATE, NEVER A RESOLUTION. Verified against the registry
     before it becomes a property reference; "I can go up to 220000" opens nothing. */
  const candidates = propertyReferenceCandidates(message.text);
  let referenced: string | null = null;
  if (candidates.length > 0) {
    const { data: resolved } = await db
      .from('properties')
      .select('id,homatch_id,user_id')
      .in('homatch_id', candidates)
      .eq('is_deleted', false)
      .limit(1);
    const row = resolved?.[0] as { id?: string; user_id?: string } | undefined;
    /* Somebody talking about their own listing is not interested in it. */
    referenced = row?.id && row.user_id !== message.actorUserId ? row.id : null;
  }

  if (referenced) {
    for (const reading of readingsOf(message.text)) {
      if (reading.act === 'REQUIREMENT') continue;
      if (dryRun) { totals.propertySignals += 1; continue; }
      const { id, rejected } = await recordIntent(db, {
        actorUserId: message.actorUserId,
        sourceSurface: message.surface,
        sourceEventId: message.id,
        sourceAt: message.sourceAt,
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
      }, message.revision);
      if (id) {
        totals.propertySignals += 1;
        if (effective === 'SELF' || effective === 'UNKNOWN') {
          propertyTouches.push([message.actorUserId, referenced]);
        }
      } else {
        totals.refused += 1;
        refusals.push({ surface: message.surface, messageId: message.id, rejected });
      }
    }
  }

  if (dryRun) return;
  const outcome = await recordDemandFrom(db, {
    surface: message.surface,
    eventId: message.id,
    revision: message.revision,
    actorUserId: message.actorUserId,
    sourceAt: message.sourceAt,
    text: message.text,
    isReply: message.isReply,
  });
  if (outcome.demand === 'RECORDED') { totals.demandSignals += 1; actorsTouched.add(message.actorUserId); }
  if (outcome.demand === 'WITHDRAWN_SEARCH') { totals.searchesWithdrawn += 1; actorsTouched.add(message.actorUserId); }
  if (outcome.demand === 'REFUSED') {
    totals.refused += 1;
    refusals.push({ surface: message.surface, messageId: message.id, rejected: outcome.refused });
  }
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
    const expected = await readSetting(db, 'ingest_live_chat_token');
    if (!expected || presented !== expected) return json({ error: 'Forbidden' }, 403);
  }

  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun === true;

    const totals: Totals = {
      liveRead: 0, liveRevisited: 0, aiRead: 0, withdrawn: 0, quoted: 0, thirdParty: 0,
      propertySignals: 0, demandSignals: 0, searchesWithdrawn: 0, refused: 0,
      demandsProjected: 0, demandsRetired: 0, relationships: 0,
    };
    const actorsTouched = new Set<string>();
    const propertyTouches: Array<[string, string]> = [];
    const refusals: Array<{ surface: string; messageId: string; rejected: string[] }> = [];

    /* ── LIVE CHAT: new messages since the cursor ─────────────────────── */
    const seqCursor = Number(await readSetting(db, SEQ_CURSOR)) || 0;
    const { data: fresh, error: freshError } = await db
      .from('live_chat_messages')
      .select('id,seq,user_id,body,reply_to_id,edited_at,deleted_at,hidden_by_admin,created_at')
      .gt('seq', seqCursor)
      .order('seq', { ascending: true })
      .limit(BATCH);
    if (freshError) throw freshError;
    totals.liveRead = (fresh ?? []).length;

    let highestSeq = seqCursor;
    for (const row of (fresh ?? []) as Record<string, unknown>[]) {
      highestSeq = Math.max(highestSeq, Number(row.seq) || 0);
      if (row.deleted_at || row.hidden_by_admin) continue;
      const actorUserId = String(row.user_id ?? '');
      const text = String(row.body ?? '');
      if (!actorUserId || !text.trim()) continue;
      await readMessage(db, totals, refusals, actorsTouched, propertyTouches, {
        surface: 'LIVE_CHAT',
        id: String(row.id),
        /* A message first read after an edit is read AS edited, under that revision. */
        revision: row.edited_at ? String(row.edited_at) : '',
        actorUserId,
        text,
        sourceAt: String(row.edited_at ?? row.created_at ?? new Date().toISOString()),
        isReply: Boolean(row.reply_to_id),
      }, dryRun);
    }

    /* ── LIVE CHAT: edits and deletions of messages already read ──────── */
    /*
     * An edit does not advance `seq`, so it needs its own cursor. The old readings are
     * WITHDRAWN (kept, for the "why was I matched" question), and an edited message is
     * READ AGAIN under its new revision — the new reading stands on its own rather than
     * mutating the old one into something nobody wrote.
     */
    const changedCursor = await readSetting(db, CHANGED_CURSOR) || '1970-01-01T00:00:00Z';
    const { data: changed } = await db
      .from('live_chat_messages')
      .select('id,seq,user_id,body,reply_to_id,edited_at,deleted_at,hidden_by_admin,created_at')
      .lte('seq', seqCursor)
      .or(`edited_at.gt."${changedCursor}",deleted_at.gt."${changedCursor}"`)
      .order('seq', { ascending: true })
      .limit(BATCH);
    totals.liveRevisited = (changed ?? []).length;

    let latestChange = changedCursor;
    for (const row of (changed ?? []) as Record<string, unknown>[]) {
      const changedAt = [row.edited_at, row.deleted_at].filter(Boolean).map(String).sort().pop() ?? changedCursor;
      if (changedAt > latestChange) latestChange = changedAt;
      const actorUserId = String(row.user_id ?? '');
      if (!actorUserId) continue;
      if (dryRun) { totals.withdrawn += 1; continue; }

      if (row.deleted_at || row.hidden_by_admin) {
        await withdrawIntentFor(db, 'LIVE_CHAT', String(row.id), 'SOURCE_DELETED');
        totals.withdrawn += 1;
        actorsTouched.add(actorUserId);
        continue;
      }
      const revision = String(row.edited_at);
      await withdrawIntentFor(db, 'LIVE_CHAT', String(row.id), 'SOURCE_EDITED', revision);
      totals.withdrawn += 1;
      actorsTouched.add(actorUserId);
      await readMessage(db, totals, refusals, actorsTouched, propertyTouches, {
        surface: 'LIVE_CHAT',
        id: String(row.id),
        revision,
        actorUserId,
        text: String(row.body ?? ''),
        sourceAt: revision,
        isReply: Boolean(row.reply_to_id),
      }, dryRun);
    }

    /* ── AI CHAT: new messages the customer wrote ─────────────────────── */
    /*
     * The customer's own turns only (role = 'user'); what the assistant said is not
     * anybody's requirement. Anonymous conversations have no account and are skipped:
     * there is nobody to match and nobody to tell.
     */
    const aiCursorRaw = await readSetting(db, AI_CURSOR);
    const [aiAt, aiLastId] = aiCursorRaw ? aiCursorRaw.split('|') : [new Date().toISOString(), ''];
    const { data: aiRows } = await db
      .from('ai_messages')
      .select('id,conversation_id,role,content,created_at,'
        + 'conversation:ai_conversations!conversation_id(user_id)')
      .gte('created_at', aiAt)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(BATCH);

    let aiCursor = aiCursorRaw || `${aiAt}|`;
    const authToUser = new Map<string, string>();
    for (const row of (aiRows ?? []) as Record<string, unknown>[]) {
      const createdAt = String(row.created_at);
      if (createdAt === aiAt && aiLastId && String(row.id) <= aiLastId) continue;
      aiCursor = `${createdAt}|${row.id}`;
      if (String(row.role) !== 'user') continue;
      const joined = row.conversation as Record<string, unknown> | Record<string, unknown>[] | null;
      const conversation = Array.isArray(joined) ? joined[0] : joined;
      const authId = String(conversation?.user_id ?? '');
      if (!authId) continue;
      if (!authToUser.has(authId)) {
        const { data: user } = await db.from('users').select('id').eq('auth_id', authId).maybeSingle();
        authToUser.set(authId, String(user?.id ?? ''));
      }
      const actorUserId = authToUser.get(authId) ?? '';
      const text = String(row.content ?? '');
      if (!actorUserId || !text.trim()) continue;
      totals.aiRead += 1;
      await readMessage(db, totals, refusals, actorsTouched, propertyTouches, {
        surface: 'AI_CHAT',
        id: String(row.id),
        revision: '',
        actorUserId,
        text,
        sourceAt: createdAt,
        isReply: false,
      }, dryRun);
    }

    /* ── what those people now want, as the matcher will read it ─────── */
    const toMatch: string[] = [];
    if (!dryRun) {
      for (const actorUserId of actorsTouched) {
        const projection = await projectActor(db, actorUserId);
        totals.demandsProjected += projection.active.length;
        totals.demandsRetired += projection.retired.length;
        toMatch.push(...projection.active);
      }
      for (const [actorUserId, propertyId] of propertyTouches) {
        const id = await projectPropertyInterest(db, actorUserId, propertyId);
        if (id) totals.relationships += 1;
      }
    }

    if (!dryRun) {
      if (highestSeq > seqCursor) await writeSetting(db, SEQ_CURSOR, String(highestSeq));
      if (latestChange > changedCursor) await writeSetting(db, CHANGED_CURSOR, latestChange);
      if (aiCursor !== aiCursorRaw) await writeSetting(db, AI_CURSOR, aiCursor);
    }

    /* The Homatch network only. No external discovery, no reservation, no charge. */
    const matching = !dryRun && toMatch.length ? await requestNativeMatching(toMatch) : null;

    return json({
      success: true,
      dryRun,
      cursors: { seq: highestSeq, changedAt: latestChange, ai: aiCursor },
      ...totals,
      matchingRequested: toMatch.length,
      matching,
      charged: { credits: 0 },
      /*
       * REFUSALS ARE REPORTED WITH IDS AND REASONS AND NEVER WITH TEXT. An operator
       * debugging a false positive needs to know which message and why; a log carrying
       * the sentence would be a second copy of somebody's words with different access rules.
       */
      refusals: refusals.slice(0, 20),
      elapsedMs: Date.now() - started,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

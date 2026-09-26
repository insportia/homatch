// HOMATCH — ONE TARGET, SYNCED ONCE, REUSED BY EVERY CAMPAIGN.
//
// The architecture this exists to make real:
//
//   PUBLIC SOURCE / CONNECTED ACCOUNT
//     → TARGET SCHEDULER
//     → CONTROLLED INCREMENTAL SYNC
//     → GLOBAL INTELLIGENCE
//     → MANY CAMPAIGNS
//
// and never
//
//   CAMPAIGN → PLATFORM SCAN
//
// Two hundred campaigns interested in @tbilisikvartiri must not produce two
// hundred reads of @tbilisikvartiri. So no campaign calls this: a campaign queries
// the intelligence store, and this worker is what keeps the store current on its
// own tick.
//
// THE COALESCING LOCK, BUILT FROM COLUMNS THAT ALREADY EXIST
//
// `community_targets.last_checked_at` is claimed by a conditional UPDATE:
//
//   set last_checked_at = now() where id = ? and last_checked_at < now() - cooldown
//
// Postgres serialises that, so of N concurrent workers exactly one gets the row
// back and the rest see zero rows and move on. No advisory lock, no queue table,
// no `sync_in_progress` column to leak when a worker dies — a crashed run simply
// becomes eligible again when the cooldown lapses. Idempotent by construction.
//
// WHAT IS HONEST ABOUT THE NETWORK COST
//
// The Telegram preview page has no conditional-GET support: there is no ETag and
// no If-Modified-Since that Telegram honours on t.me/s/. So an incremental sync
// STILL DOWNLOADS THE PAGE. The saving is not in bytes; it is in everything after
// parsing — a message whose fingerprint has not changed triggers no
// classification, no entity work, no persistence mutation beyond a last_seen
// touch, and no matching. The counters below report those separately precisely so
// nobody can read a network saving that does not exist.
//
// Where the cursor DOES save work is depth: `last_seen_external_id` stops the
// walk backwards through older pages once we reach what we already hold, instead
// of paging to the beginning of the channel every tick.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PublicPreviewTelegramClient } from '../../../src/research-core/adapters/telegram/preview-client.ts';
import { TelegramError } from '../../../src/research-core/adapters/telegram/client.ts';
import {
  asCommunityEvidence,
  planObservation,
  type StoredEvidence,
} from '../../../src/research-core/signals/community-evidence.ts';
import { classifyDirection } from '../../../src/research-core/signals/direction.ts';
import { contentHash } from '../../../src/research-core/normalize/hash.ts';
import { detectLanguage } from '../../../src/research-core/normalize/language.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

/**
 * How long a target rests between syncs.
 *
 * Also the coalescing window: a target claimed within this period is not claimed
 * again, so a burst of worker ticks reads it once. Fifteen minutes is frequent
 * enough that "found today" is true and infrequent enough to be a courtesy to a
 * page Telegram serves us for nothing.
 */
const COOLDOWN_MINUTES = 15;

/** Pages walked backwards in one tick. The cursor makes this rarely needed. */
const MAX_PAGES = 3;
const PAGE_SIZE = 20;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const baseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!baseUrl || !serviceKey) return json({ error: 'Server configuration missing' }, 500);
  const db = createClient(baseUrl, serviceKey);

  const presented = req.headers.get('x-cron-token') || '';
  const authorization = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (authorization !== serviceKey) {
    const { data: tokenRow } = await db
      .from('admin_settings').select('value').eq('key', 'community_sync_token').maybeSingle();
    const expected = String(tokenRow?.value ?? '').replace(/^"|"$/g, '');
    if (!expected || presented !== expected) return json({ error: 'Forbidden' }, 403);
  }

  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(10, Number(body.maxTargets) || 5));
    /** Ignore the cooldown. For an operator proving behaviour, never a schedule. */
    const force = body.force === true;
    const onlyTarget = body.target ? String(body.target) : null;

    /*
     * Candidates: enabled Telegram targets that are not rate-limited. UNVERIFIED
     * is included deliberately — a target's readability is EARNED by a read, and
     * refusing to read anything unverified would mean nothing ever became
     * READABLE.
     */
    let query = db
      .from('community_targets')
      .select('id,external_id,name,readability,cursor,last_seen_external_id,'
        + 'last_checked_at,items_read,demand_found,supply_found,duplicates_seen,source_id')
      .eq('platform', 'TELEGRAM')
      .eq('discovery_enabled', true)
      .in('readability', ['READABLE', 'UNVERIFIED'])
      .or(`rate_limited_until.is.null,rate_limited_until.lt.${new Date().toISOString()}`)
      .order('last_checked_at', { ascending: true, nullsFirst: true })
      .limit(limit);
    if (onlyTarget) query = query.eq('external_id', onlyTarget);

    const { data: candidates, error } = await query;
    if (error) throw error;

    if (!candidates?.length) {
      return json({
        success: true, targetsConsidered: 0, synced: 0,
        note: 'no enabled Telegram target is eligible right now',
        elapsedMs: Date.now() - started,
      });
    }

    const client = new PublicPreviewTelegramClient();
    const results: Array<Record<string, unknown>> = [];

    /* Counters kept per tick and reported separately, because "we wrote nothing"
       and "we fetched nothing" are different savings and only one of them is real
       on this surface. */
    const totals = {
      networkFetches: 0,
      messagesParsed: 0,
      newMessages: 0,
      changedMessages: 0,
      unchangedMessages: 0,
      classificationsRun: 0,
      persistenceWrites: 0,
      /*
       * Writes the database REFUSED. Reported next to persistenceWrites because
       * the two together are the only way to tell "nothing needed writing" from
       * "nothing could be written", and those look identical from a counter that
       * only ever increments on success.
       */
      persistenceFailures: 0,
      /*
       * Messages we had stored that are no longer on the channel. Counted because
       * it was structurally always zero before -- planObservation() produced
       * MARK_UNAVAILABLE and nothing consumed it, so became_unavailable_at was
       * never written by anything and every report of "no longer there" was a zero
       * presented as a measurement.
       */
      markedUnavailable: 0,
      skippedByCooldown: 0,
    };

    for (const target of candidates) {
      /*
       * THE LOCK. One conditional UPDATE, and Postgres decides the winner. A
       * worker that loses sees zero rows and leaves the target alone, which is
       * exactly what stops N campaigns becoming N reads.
       */
      const cutoff = new Date(Date.now() - COOLDOWN_MINUTES * 60_000).toISOString();
      let claim = db
        .from('community_targets')
        .update({ last_checked_at: new Date().toISOString() })
        .eq('id', target.id);
      if (!force) {
        claim = claim.or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`);
      }
      const { data: claimed } = await claim.select('id');

      if (!claimed?.length) {
        totals.skippedByCooldown += 1;
        results.push({
          target: target.external_id,
          outcome: 'SKIPPED_COOLDOWN',
          detail: `synced within the last ${COOLDOWN_MINUTES} minutes, or another worker holds it. `
            + 'This is the mechanism that stops many campaigns becoming many reads.',
        });
        continue;
      }

      const outcome = await syncTarget(db, client, target, totals);
      results.push(outcome);
    }

    return json({
      success: true,
      targetsConsidered: candidates.length,
      synced: results.filter((r) => r.outcome === 'OK').length,
      results,
      totals,
      note: 'Telegram\'s preview page supports no conditional GET, so an incremental sync still '
        + 'downloads the page: networkFetches is NOT reduced by the cursor. What the cursor and the '
        + 'fingerprint save is everything after parsing — classification, persistence mutation and '
        + 'matching — which is what unchangedMessages vs changedMessages reports.',
      elapsedMs: Date.now() - started,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

async function syncTarget(
  db: ReturnType<typeof createClient>,
  client: PublicPreviewTelegramClient,
  target: Record<string, unknown>,
  totals: Record<string, number>,
): Promise<Record<string, unknown>> {
  const channel = String(target.external_id);
  const knownNewest = target.last_seen_external_id ? Number(target.last_seen_external_id) : null;
  const now = new Date().toISOString();

  const collected: Array<{ message: Record<string, unknown>; channel: string }> = [];
  let cursor: string | null = null;
  let newestSeen = knownNewest;
  let reachedKnown = false;

  for (let page = 0; page < MAX_PAGES && !reachedKnown; page += 1) {
    let batch;
    try {
      totals.networkFetches += 1;
      batch = await client.readHistory(channel, { cursor, limit: PAGE_SIZE });
    } catch (error) {
      return await recordFailure(db, target, channel, error);
    }

    totals.messagesParsed += batch.items.length;

    for (const message of batch.items) {
      const id = Number(message.id);
      /*
       * THE CURSOR'S REAL SAVING: stop walking backwards once we reach what we
       * already hold. Without it every tick pages to the beginning of the
       * channel.
       */
      if (knownNewest !== null && Number.isFinite(id) && id <= knownNewest) {
        reachedKnown = true;
        break;
      }
      if (Number.isFinite(id) && (newestSeen === null || id > newestSeen)) newestSeen = id;
      collected.push({ message: message as unknown as Record<string, unknown>, channel });
    }

    if (!batch.hasMore || !batch.nextCursor) break;
    cursor = batch.nextCursor;
  }

  /*
   * A successful read is what EARNS readability. The target arrived UNVERIFIED and
   * becomes READABLE because a real fetch parsed, never because a URL looked
   * right.
   */
  let inserted = 0;
  let versioned = 0;
  let touched = 0;
  let demand = 0;
  let supply = 0;
  /* What the database refused, with its own words kept. A count alone would say
     that something is broken without saying what, and the message is the whole
     diagnosis -- a CHECK violation names the constraint. */
  const writeFailures: Array<{ action: string; externalId: string; message: string }> = [];

  for (const { message, channel: messageChannel } of collected) {
    const text = String(message.text ?? '');
    const fingerprint = contentHash(text);
    const externalId = String(message.id);

    /*
     * The existing row for this NATIVE identity. (platform, external_id) is
     * already UNIQUE on raw_signals, so this is the same key the database
     * enforces — the reason an edit can never become a second lead.
     */
    const { data: existing } = await db
      .from('raw_signals')
      .select('id,content_fingerprint,content_version,last_seen_at,became_unavailable_at')
      .eq('platform', 'TELEGRAM')
      .eq('external_id', `${messageChannel}/${externalId}`)
      .maybeSingle();

    const known: StoredEvidence | null = existing
      ? {
        id: String(existing.id),
        contentFingerprint: existing.content_fingerprint as string | null,
        contentVersion: Number(existing.content_version ?? 1),
        lastSeenAt: String(existing.last_seen_at ?? now),
        availability: 'AVAILABLE',
        becameUnavailableAt: (existing.became_unavailable_at as string | null) ?? null,
      }
      : null;

    const plan = planObservation(known, { contentFingerprint: fingerprint }, now);

    if (plan.action === 'TOUCH') {
      /*
       * The whole point of the fingerprint. Nothing is classified, no entity is
       * created, nothing is matched — only the timestamps that say we looked.
       */
      const { error: touchError } = await db.from('raw_signals').update({
        last_seen_at: now,
        /* A conclusive re-read of unchanged content IS a verification. */
        last_verified_at: now,
        /*
         * VALID, not 'FRESH'. FRESH is a DeliveryVerdict -- judgeDelivery()'s
         * answer to "may a customer see this" -- and this column holds a
         * ValidationState, the answer to "did we re-read it". Writing the first
         * vocabulary into the second violates raw_signals_validation_state_check
         * and the row is rejected outright.
         */
        validation_state: 'VALID',
        last_revalidation_outcome: 'UNCHANGED_VALID',
      }).eq('id', existing?.id as string);
      if (touchError) {
        writeFailures.push({
          action: 'TOUCH',
          externalId: `${messageChannel}/${externalId}`,
          message: touchError.message,
        });
        totals.persistenceFailures += 1;
      } else {
        touched += 1;
        totals.unchangedMessages += 1;
        totals.persistenceWrites += 1;
      }
      continue;
    }

    /* INSERT and VERSION both need an interpretation of the text. */
    totals.classificationsRun += 1;
    const verdict = classifyDirection(text, {
      languages: ['ka', 'ru', 'en', 'tr'],
      parentContext: null,
    });
    const language = detectLanguage(text)?.language ?? null;
    const publishedAt = Number(message.date)
      ? new Date(Number(message.date) * 1000).toISOString()
      : null;

    const evidence = asCommunityEvidence({
      id: 'REPLACED_BY_NATIVE_IDENTITY',
      platform: 'TELEGRAM',
      contentType: 'POST',
      sourceUrl: `https://t.me/s/${messageChannel}`,
      contentUrl: `https://t.me/${messageChannel}/${externalId}`,
      parentUrl: null,
      parentExcerpt: null,
      author: { publicName: (message.authorDisplayName as string | null) ?? null, publicUrl: null },
      originalText: text,
      translatedText: null,
      language,
      publishedAt,
      discoveredAt: now,
      lastSeenAt: now,
      contentFingerprint: fingerprint,
      direction: verdict.direction,
      directionConfidence: verdict.confidence,
      locationHints: { countryCode: null, city: null, district: null, mentions: [] },
      requirementHints: { bedrooms: null, areaSqm: null, budgetAmount: null, budgetCurrency: null },
      accessClass: 'PUBLIC',
    } as never, {
      identity: {
        platform: 'TELEGRAM',
        communityId: messageChannel,
        externalContentId: externalId,
        parentContentId: (message.replyToMessageId as string | null) ?? null,
      },
      acquisitionMode: 'PUBLIC_WEB',
      targetId: String(target.id),
      connectionId: null,
      contentVersion: plan.contentVersion,
    });

    if (verdict.direction === 'DEMAND') demand += 1;
    if (verdict.direction === 'SUPPLY') supply += 1;

    const row = {
      platform: 'TELEGRAM',
      /* Composite so the existing (platform, external_id) unique index is the
         per-channel identity: message 42 in two channels is two rows. */
      external_id: `${messageChannel}/${externalId}`,
      target_id: target.id,
      /*
       * THE ROW'S PATH BACK TO THE REGISTRY, and the reason it is not optional.
       *
       * revalidate-evidence resolves a signal's permission to be re-read through
       * source_registry!source_id. Without it every community signal reaching the
       * delivery window is queued, answered "source is unregistered and has never
       * been audited; not requested", and stays permanently UNKNOWN -- not because
       * the channel is unreadable, but because nothing connected the row to the
       * registry entry that already existed for it. Measured: 18 rows, 0 with a
       * source_id, 0 ever verified.
       *
       * Null when the target has no registry entry, which is a real state for a
       * community discovered on its own. What it must never be is null when the
       * entry exists.
       */
      source_id: (target as Record<string, unknown>).source_id ?? null,
      acquisition_mode: 'PUBLIC_WEB',
      parent_external_id: (message.replyToMessageId as string | null) ?? null,
      source_url: evidence.contentUrl,
      author_public_name: evidence.author.publicName,
      original_text: text,
      language,
      published_at: publishedAt,
      last_seen_at: now,
      last_verified_at: now,
      content_fingerprint: fingerprint,
      content_type: 'POST',
      access_class: 'PUBLIC',
      research_direction: verdict.direction,
      direction_confidence: verdict.confidence,
      /* HOMATCH, not a vendor: nothing was bought to obtain this. */
      provider: 'HOMATCH',
      /*
       * DELIBERATELY NOT SET HERE. An INSERT and a VERSION are in different
       * verification positions -- a first sighting has verified nothing, a
       * re-read has -- and raw_signals_verification_coherence_check enforces the
       * difference. One shared value would be wrong for one of them, so each
       * path states its own below.
       */
      content_version: plan.contentVersion,
      classification_status: 'PENDING',
    };

    if (plan.action === 'INSERT') {
      const { error: insertError } = await db.from('raw_signals').insert({
        ...row,
        discovered_at: now,
        /*
         * UNVERIFIED, and last_verified_at NULL. Seeing a post for the first time
         * is not verifying it -- we have one observation and nothing to compare it
         * against -- which is the rule firstSighting() states in the research core
         * and raw_signals_verification_coherence_check enforces in the database.
         * Stamping `now` here is how every row in a store ends up permanently
         * "verified" the moment it arrives.
         */
        validation_state: 'UNVERIFIED',
        last_verified_at: null,
      });
      if (insertError) {
        /*
         * NEVER SWALLOWED. This counter existed as `if (!insertError)` and
         * nothing else, so eighteen rejected inserts reported themselves as a
         * clean run with nothing new to write -- indistinguishable from a
         * perfectly deduplicated sync. A write that failed is the one thing this
         * worker must not report as a no-op.
         */
        writeFailures.push({
          action: 'INSERT',
          externalId: `${messageChannel}/${externalId}`,
          message: insertError.message,
        });
        totals.persistenceFailures += 1;
      } else {
        inserted += 1;
        totals.newMessages += 1;
        totals.persistenceWrites += 1;
      }
      continue;
    }

    /*
     * MARK_UNAVAILABLE, stated rather than reached by falling through.
     *
     * planObservation() has always been able to return this and nothing ever
     * handled it: the branches below were TOUCH, INSERT, then `else` -- so a
     * MARK_UNAVAILABLE would have been written as a VERSION, overwriting a row that
     * is GONE with a fresh copy of text we no longer have. It could not fire from
     * here yet, because this loop only ever sees messages that ARE present, but a
     * branch whose correctness depends on an unreachable input is a trap set for
     * whoever makes it reachable.
     *
     * Absence is detected after the loop, where the id range actually read is
     * known. This branch exists so the shape is honest.
     */
    if (plan.action === 'MARK_UNAVAILABLE') {
      const { error: goneError } = await db.from('raw_signals').update({
        became_unavailable_at: plan.becameUnavailableAt,
        last_seen_at: now,
        validation_state: 'REMOVED',
        last_revalidation_outcome: 'REMOVED',
      }).eq('id', existing?.id as string);
      if (goneError) {
        writeFailures.push({
          action: 'MARK_UNAVAILABLE',
          externalId: `${messageChannel}/${externalId}`,
          message: goneError.message,
        });
        totals.persistenceFailures += 1;
      } else {
        totals.persistenceWrites += 1;
      }
      continue;
    }

    /* VERSION: same identity, new text. discovered_at is NOT touched — first
       seen means first seen. */
    const { error: updateError } = await db.from('raw_signals').update({
      ...row,
      content_changed_at: now,
      /* A re-read that found new text IS a conclusive observation, so unlike the
         INSERT above this one really has verified something. */
      validation_state: 'VALID',
      last_verified_at: now,
      last_revalidation_outcome: 'CHANGED_VALID',
      /* Re-interpretation is wanted, and it reuses the SAME row, so no second
         lead can appear. */
      classification_status: 'PENDING',
    }).eq('id', existing?.id as string);
    if (updateError) {
      writeFailures.push({
        action: 'VERSION',
        externalId: `${messageChannel}/${externalId}`,
        message: updateError.message,
      });
      totals.persistenceFailures += 1;
    } else {
      versioned += 1;
      totals.changedMessages += 1;
      totals.persistenceWrites += 1;
    }
  }

  /*
   * WHAT WE HELD THAT IS NO LONGER THERE.
   *
   * THE RULE THAT KEEPS THIS HONEST: only a message inside the id range this read
   * ACTUALLY COVERED can be judged absent.
   *
   * Telegram's preview serves a window of recent posts. A stored message missing
   * from today's page is usually not deleted -- it is simply older than the window,
   * or beyond MAX_PAGES. Marking those unavailable would destroy good evidence
   * wholesale on the first sync of any channel with history, and it would look like
   * a working feature while doing it.
   *
   * So the range is bounded by what was seen: if this read returned ids 4..20 and
   * we hold 4, 5, 16, 18, 20 while the page showed everything but 18, then 18 was
   * deleted -- because 18 sits between two ids we DID see. Anything outside
   * [min, max] is not judged at all.
   *
   * Requires at least two messages: a single message establishes no interval, and
   * min === max would let one post's absence be inferred from its own presence.
   */
  if (collected.length >= 2) {
    const seenIds = collected
      .map(({ message }) => Number(message.id))
      .filter((id) => Number.isFinite(id));
    const lowest = Math.min(...seenIds);
    const highest = Math.max(...seenIds);
    const present = new Set(seenIds.map((id) => `${channel}/${id}`));

    const { data: storedRows } = await db
      .from('raw_signals')
      .select('id,external_id')
      .eq('platform', 'TELEGRAM')
      .is('became_unavailable_at', null)
      .like('external_id', `${channel}/%`);

    for (const row of storedRows ?? []) {
      const externalId = String(row.external_id ?? '');
      const numeric = Number(externalId.slice(channel.length + 1));
      /* Outside the covered interval, or present: no claim either way. */
      if (!Number.isFinite(numeric) || numeric < lowest || numeric > highest) continue;
      if (present.has(externalId)) continue;

      const plan = planObservation(
        {
          id: String(row.id),
          contentFingerprint: null,
          contentVersion: 1,
          lastSeenAt: now,
          availability: 'AVAILABLE',
          becameUnavailableAt: null,
        },
        { contentFingerprint: '', availability: 'REMOVED' },
        now,
      );

      const { error: goneError } = await db.from('raw_signals').update({
        became_unavailable_at: plan.becameUnavailableAt,
        last_seen_at: now,
        /*
         * REMOVED, and last_verified_at is NOT advanced. We verified that it is
         * gone, which is not a verification of the evidence -- treating it as one
         * would make a deleted post the freshest thing in the store.
         */
        validation_state: 'REMOVED',
        last_revalidation_outcome: 'REMOVED',
      }).eq('id', row.id as string);

      if (goneError) {
        writeFailures.push({
          action: 'MARK_UNAVAILABLE',
          externalId,
          message: goneError.message,
        });
        totals.persistenceFailures += 1;
      } else {
        totals.markedUnavailable += 1;
        totals.persistenceWrites += 1;
      }
    }
  }

  /*
   * THE CURSOR MOVES ONLY IF THE EVIDENCE LANDED.
   *
   * The cursor's meaning is "everything up to here is stored", so advancing it
   * past a message the database refused makes the next tick start above that
   * message and never look at it again. That is permanent, silent loss of real
   * evidence -- and it is exactly what the swallowed insert error caused: the read
   * succeeded, eighteen posts were rejected, and the cursor moved to 31 as though
   * they had been kept.
   *
   * The READ still succeeded, so readability is still earned: the channel is
   * public and reachable and that is a fact about the target. The failure is OURS,
   * so it is recorded as our error and the cursor stays where it was.
   */
  const persisted = writeFailures.length === 0;
  const nowIso = new Date().toISOString();

  await db.from('community_targets').update({
    readability: 'READABLE',
    membership_state: 'PUBLIC',
    acquisition_mode: 'PUBLIC_WEB',
    /* Earned by a real read. LOW_SIGNAL and PRODUCTIVE are decided by measured
       yield over time, not by one tick. */
    lifecycle: 'REACHABLE',
    /* A read we could not store is not a success. */
    ...(persisted
      ? { last_success_at: nowIso, last_error_at: null, last_error_code: null }
      : { last_error_at: nowIso, last_error_code: 'PERSISTENCE_REFUSED' }),
    ...(persisted
      ? {
        cursor: newestSeen !== null ? String(newestSeen) : target.cursor ?? null,
        last_seen_external_id: newestSeen !== null
          ? String(newestSeen)
          : target.last_seen_external_id ?? null,
      }
      : {}),
    /* Counted as read because we did read them. items_read measures acquisition,
       and inserted/versioned/touched measure what was kept. */
    items_read: Number(target.items_read ?? 0) + collected.length,
    demand_found: Number(target.demand_found ?? 0) + demand,
    supply_found: Number(target.supply_found ?? 0) + supply,
    duplicates_seen: Number(target.duplicates_seen ?? 0) + touched,
    updated_at: nowIso,
  }).eq('id', target.id);

  return {
    target: channel,
    /* Not 'OK' when nothing could be stored. An operator reading a list of OKs
       must not have to cross-check a counter to discover the sync kept nothing. */
    outcome: persisted ? 'OK' : 'PERSISTENCE_REFUSED',
    readability: 'READABLE',
    collected: collected.length,
    inserted,
    versioned,
    touched,
    demand,
    supply,
    newestSeenId: newestSeen,
    reachedKnownCursor: reachedKnown,
    markedUnavailable: totals.markedUnavailable,
    ...(persisted ? {} : {
      cursorHeldAt: target.cursor ?? null,
      /* Capped: the diagnosis is the constraint name, and it repeats. */
      writeFailures: writeFailures.slice(0, 3),
      writeFailureCount: writeFailures.length,
    }),
  };
}

/**
 * A refusal is a recorded fact about the target, never a silent zero.
 *
 * Each kind lands on a different readability, because each calls for a different
 * response: a rate limit is ours to wait out, a private channel is an access
 * control we do not work around, and unrecognised markup means OUR parser needs
 * looking at and the target is fine.
 */
async function recordFailure(
  db: ReturnType<typeof createClient>,
  target: Record<string, unknown>,
  channel: string,
  error: unknown,
): Promise<Record<string, unknown>> {
  const kind = error instanceof TelegramError ? error.kind : 'NETWORK_ERROR';
  const message = error instanceof Error ? error.message : String(error);

  const patch: Record<string, unknown> = {
    last_error_at: new Date().toISOString(),
    last_error_code: kind,
    updated_at: new Date().toISOString(),
  };

  if (kind === 'RATE_LIMITED') {
    const wait = (error instanceof TelegramError && error.retryAfterSeconds) || 300;
    patch.rate_limited_until = new Date(Date.now() + wait * 1000).toISOString();
    /* NOT a readability change: being asked to wait says nothing about whether the
       channel can be read. Turning a rate limit into UNPRODUCTIVE is the exact
       misreading the brief forbids. */
  } else if (kind === 'CHAT_PRIVATE') {
    patch.readability = 'API_UNAVAILABLE';
    patch.visibility = 'PRIVATE';
    patch.lifecycle = 'BLOCKED';
  } else if (kind === 'CHAT_NOT_FOUND') {
    patch.readability = 'API_UNAVAILABLE';
    patch.lifecycle = 'RETIRED';
  } else if (kind === 'CAPABILITY_NOT_SUPPORTED') {
    /* The contact page, or a channel with no preview. The target may be real; this
       MODE cannot read it. */
    patch.readability = 'API_UNAVAILABLE';
    patch.lifecycle = 'AUDITED';
  } else if (kind === 'MALFORMED_RESPONSE') {
    /* OUR problem. The target keeps its readability and is left alone, because
       retiring somebody's channel over our own parser would be a lie. */
    patch.lifecycle = 'DEGRADED';
  }

  await db.from('community_targets').update(patch).eq('id', target.id);

  return {
    target: channel,
    outcome: 'REFUSED',
    kind,
    detail: message.slice(0, 220),
    readabilityAfter: patch.readability ?? target.readability,
  };
}

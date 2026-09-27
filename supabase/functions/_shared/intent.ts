/*
 * THE ONE WAY A SURFACE SAYS "SOMEBODY MEANT SOMETHING".
 *
 * Five surfaces can produce intent and each knows different things about what it is
 * looking at. A viewing request knows the property and the actor and needs no reading at
 * all; a private message knows the property from a column and needs the sentence read for
 * what was said about it; the live chat knows neither and needs both. What none of them
 * should own is the DECISION about whether a reading is allowed to become trusted state.
 *
 * So this is the seam. A surface says what it saw; this validates it, refuses what does
 * not survive, and writes what does.
 *
 * WHY THE VALIDATION IS HERE AND NOT IN THE CALLER
 *
 * Downstream of a written signal, a row is trusted: it reaches the effective-state
 * resolver, it can produce a native match, and a native match can tell an owner that
 * somebody is interested in their property. Five callers each deciding what counts is
 * five chances to be generous, and the generous failure is a false claim about a person.
 *
 * WHAT IT WILL NOT WRITE
 *
 *   A body. `intent_signals` has no column for one and this never invents a place to put
 *   one — a match explanation assembled from somebody's private sentence is a leak with a
 *   rationale's manners. The row points at its source; whoever may read the source may
 *   read the source.
 *
 *   Somebody else's requirement. Third-party, quoted and unattributed statements are
 *   refused as DEMAND and SUPPLY by validate(), which is the one rule that cannot be
 *   relaxed per surface.
 *
 *   An actor a caller chose. Every call site resolves the actor from the row that owns
 *   the source event — messages.sender_id, viewing_requests.requester_id — under the
 *   service role. There is no path from a browser to this function.
 */

import { validate } from '../../../src/research-core/intent/interpret.ts';
import type { IntentCandidate } from '../../../src/research-core/intent/interpret.ts';

interface Client {
  from(table: string): {
    upsert(values: unknown, options: { onConflict: string }): {
      select(columns: string): { maybeSingle(): Promise<{ data: unknown; error: unknown }> };
    };
    update(values: unknown): {
      eq(column: string, value: unknown): {
        eq(column: string, value: unknown): Promise<{ error: unknown }>;
      };
    };
  };
}

export interface RecordResult {
  id: string | null;
  /** Why a candidate did not become a signal. Empty when one did. */
  rejected: string[];
}

/**
 * Record one thing a surface understood.
 *
 * Idempotent on (surface, event, side, act, dimension): reprocessing a message — a worker
 * retry, a realtime frame delivered twice, a backfill over a room — finds the row it
 * already wrote. The conflict target is the partial unique index, so this is a database
 * guarantee rather than a check somebody remembered to write.
 *
 * Failure is swallowed in the same way notify() swallows its own, and for the same
 * reason: the message was already sent, the viewing was already requested, the plan was
 * already confirmed. Failing the thing that happened because the interpretation of it
 * could not be stored would trade a real outcome for a derived one.
 */
export async function recordIntent(
  sb: Client,
  candidate: IntentCandidate,
): Promise<RecordResult> {
  const { intent, rejected } = validate(candidate);
  if (!intent) return { id: null, rejected };

  try {
    const { data, error } = await sb
      .from('intent_signals')
      .upsert({
        actor_user_id: intent.actorUserId,
        source_surface: intent.sourceSurface,
        source_event_id: intent.sourceEventId,
        source_at: intent.sourceAt,
        side: intent.side,
        act: intent.act,
        dimension: intent.dimension,
        polarity: intent.polarity,
        attribution: intent.attribution,
        explicit: intent.explicit,
        confidence: intent.confidence,
        scope: intent.scope,
        property_id: intent.propertyId,
        intent_profile_id: intent.intentProfileId,
        conversation_id: intent.conversationId,
        constraints: intent.constraints,
        strength: intent.strength,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'source_surface,source_event_id,side,act,dimension' })
      .select('id')
      .maybeSingle();

    if (error) return { id: null, rejected: [String((error as { message?: string }).message ?? error)] };
    return { id: String((data as { id?: string } | null)?.id ?? '') || null, rejected: [] };
  } catch (err) {
    return { id: null, rejected: [err instanceof Error ? err.message : String(err)] };
  }
}

/**
 * A source message changed, so what was derived from it stops counting.
 *
 * WITHDRAWN, NOT DELETED. The evidence that somebody once said something is not made
 * false by their editing it — it is made no longer current, which is a different fact and
 * the one an operator needs when a customer asks why they were matched with something.
 * The effective-state resolver skips a withdrawn row; the audit trail keeps it.
 *
 * An edit is not a deletion either. The text moved, so the old reading no longer
 * describes it; the surface re-reads and records a new signal, and the new one stands on
 * its own rather than mutating the old one into something nobody wrote.
 */
export async function withdrawIntentFor(
  sb: Client,
  sourceSurface: string,
  sourceEventId: string,
  reason: 'SOURCE_EDITED' | 'SOURCE_DELETED',
): Promise<void> {
  try {
    await sb
      .from('intent_signals')
      .update({
        withdrawn_at: new Date().toISOString(),
        withdrawn_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('source_surface', sourceSurface)
      .eq('source_event_id', sourceEventId);
  } catch {
    /* Same reasoning as above: the edit already happened. */
  }
}

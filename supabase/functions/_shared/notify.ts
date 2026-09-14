/*
 * THE ONE WAY A HOMATCH FEATURE TELLS SOMEBODY SOMETHING.
 *
 * WHAT THIS REPLACES
 *
 * Seventeen `sb.from('notifications').insert(...)` sites across thirteen
 * files. Every one of them chose its own title, none of them set a priority, a
 * deep link, a dedupe key or a group key — those columns did not exist until
 * this week — and every one of them was a place where "should this wake
 * somebody" could be decided differently.
 *
 * The result was predictable: ten matches produced ten rows, a retried webhook
 * produced two, and nothing was ever pushed because nothing asked.
 *
 * WHY THE PUSH CALL LIVES HERE AND NOT IN THE FEATURE
 *
 * Product code must not call `push-send`. It also must not have to know that
 * push exists. So this is the seam: a feature says what happened, and this
 * carries it through the whole pipeline —
 *
 *   notify_emit  dedupe on (user_id, dedupe_key), aggregate into an unread
 *                unpushed row sharing group_key, return the id either way
 *   push-send    preferences, category, quiet hours, priority, delivery
 *
 * Aggregation and push compose correctly because of the order: the second
 * through tenth match all return the SAME notification id, and push-send
 * stamps `pushed_at` the first time it delivers — so the burst produces one
 * interruption and the rest update a row nobody has been woken for yet.
 *
 * WHY A FAILURE HERE IS SWALLOWED
 *
 * A notification is a side effect of something that already happened. A
 * verification finished, a message was delivered, a call completed — those are
 * done, committed, and the customer's. Letting the telling-them step fail the
 * doing-it step would trade a real outcome for a missed message.
 */

interface Client {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  functions: {
    invoke(name: string, opts: { body: unknown }): Promise<{ data: unknown; error: unknown }>;
  };
}

export type Priority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

export interface NotifyInput {
  userId: string;
  /** A value of the notification_type enum. */
  type: string;
  title: string;
  body?: string | null;
  priority?: Priority;
  /** An app path. Never an absolute URL — the column refuses one. */
  deepLink?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /**
   * The natural key of the EVENT, where one exists.
   *
   * A webhook retried, a job re-run, a realtime message delivered twice: the
   * same key means one row. Absent means every call is its own row, which is
   * right for anything without a stable identity.
   */
  dedupeKey?: string | null;
  /**
   * The bucket a burst collapses into.
   *
   * Deliberately absent for direct human messages: four people writing to you
   * is four things to know about, and "4 new messages" hides all four.
   */
  groupKey?: string | null;
  /** How long that bucket stays open. Postgres interval syntax. */
  groupWindow?: string;
  /** Rewritten onto the aggregate row; `{n}` becomes the count. */
  groupTitle?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Emit a notification and let the delivery layer decide the rest.
 *
 * Returns the notification id, or null if it could not be written — callers
 * are not expected to check, and nothing downstream depends on it.
 */
export async function notify(sb: Client, input: NotifyInput): Promise<string | null> {
  try {
    const { data, error } = await sb.rpc('notify_emit', {
      p_user_id: input.userId,
      p_type: input.type,
      p_title: input.title,
      p_body: input.body ?? null,
      p_priority: input.priority ?? 'NORMAL',
      p_deep_link: input.deepLink ?? null,
      p_entity_type: input.entityType ?? null,
      p_entity_id: input.entityId ?? null,
      p_dedupe_key: input.dedupeKey ?? null,
      p_group_key: input.groupKey ?? null,
      p_group_window: input.groupWindow ?? '5 minutes',
      p_group_title_template: input.groupTitle ?? null,
      p_metadata: input.metadata ?? {},
    });

    if (error || typeof data !== 'string') {
      console.error('[notify] emit failed', error);
      return null;
    }

    /*
     * The push decision, not a push.
     *
     * push-send answers "does this earn an interruption, on this device, right
     * now" — and most of the time the answer is no: preferences, quiet hours,
     * LOW priority, or a row that has already been pushed because it is the
     * aggregate the last nine events also landed in.
     *
     * Not awaited for its result: a slow push service must not hold up the
     * request that produced the event.
     */
    void sb.functions.invoke('push-send', {
      body: { action: 'deliver', notificationId: data },
    }).catch(() => { /* delivery is best effort; the in-app row is the record */ });

    return data;
  } catch (err) {
    console.error('[notify] threw', err);
    return null;
  }
}

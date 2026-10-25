// HOMATCH — one popup per finished thing, however many ways the news arrives.
//
// A finished job reaches an open tab twice: the job centre sees background_jobs
// turn COMPLETED (JobIndicator), and the notification row the server wrote for
// it arrives over realtime (LiveNotifications). Verify even announces itself a
// little earlier than its job row turns over. Two cards for one verification
// is exactly the noise a popup must not be.
//
// So both surfaces name what a popup is ABOUT, as a small set of keys, and the
// first one to show it wins. In-tab memory only: another tab, or a reload,
// is allowed its own single card.

const TTL_MS = 10 * 60 * 1000;
const shown = new Map<string, number>();

function prune(now: number): void {
  for (const [k, at] of shown) if (now - at > TTL_MS) shown.delete(k);
}

/**
 * True when none of `keys` has been announced recently, and records them all.
 * False means another surface already showed this; stay quiet.
 */
export function claimAnnouncement(keys: Array<string | null | undefined>, now = Date.now()): boolean {
  const real = keys.filter((k): k is string => typeof k === 'string' && k.length > 0);
  if (real.length === 0) return true;
  prune(now);
  if (real.some((k) => shown.has(k))) {
    for (const k of real) shown.set(k, now);
    return false;
  }
  for (const k of real) shown.set(k, now);
  return true;
}

/** What a background job popup is about. */
export function jobAnnouncementKeys(job: { id: string; subjectId?: string | null }): string[] {
  return [`job:${job.id}`, job.subjectId ? `subject:${job.subjectId}` : ''].filter(Boolean);
}

const SUBJECT_ENTITY = new Set(['research_job', 'deal_room_document', 'matching_jobs']);

/** What a notification popup is about, when it is about a job or its subject. */
export function notificationAnnouncementKeys(notif: {
  id: string;
  entity_type?: string | null;
  entity_id?: string | null;
  metadata?: unknown;
}): string[] {
  const meta = (notif.metadata && typeof notif.metadata === 'object' ? notif.metadata : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const keys = [`notification:${notif.id}`];
  const job = str(meta.background_job_id) ?? (notif.entity_type === 'background_job' ? str(notif.entity_id) : null);
  if (job) keys.push(`job:${job}`);
  for (const subject of [
    str(meta.job_id), str(meta.document_id), str(meta.matching_job_id),
    notif.entity_type && SUBJECT_ENTITY.has(notif.entity_type) ? str(notif.entity_id) : null,
  ]) {
    if (subject) keys.push(`subject:${subject}`);
  }
  return [...new Set(keys)];
}

/** Tests only. */
export function resetAnnouncements(): void {
  shown.clear();
}

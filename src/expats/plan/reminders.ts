// HOMATCH FOR EXPATS — telling somebody in time, once.
//
// WHY THIS FILE COMPUTES REMINDERS INSTEAD OF STORING THEM
//
// The obvious design is a table of scheduled reminder rows. It goes wrong
// the first time a date moves: the person pushes their arrival back three
// weeks, and eleven already-scheduled rows are now pointing at the old
// timeline. You then need a reconciliation job whose only purpose is to
// repair state that should never have been written down.
//
// So a reminder is DERIVED. `dueReminders()` is a pure function of the
// tasks as they are right now, and moving a date moves every reminder for
// free because there was nothing to move. The only thing persisted is what
// has already been SENT, which is a fact about the past and cannot go
// stale.
//
// WHY THE DEDUPE KEY IS SHAPED THE WAY IT IS
//
// `notify_emit` collapses on (user_id, dedupe_key), so the key has to name
// the EVENT and nothing else: this task, this lead time, this due date. The
// due date is in the key on purpose — if the person moves a deadline, the
// 7-day warning for the new date is a genuinely new thing to say and should
// be said. If the key were just task-and-lead-time, moving a date would
// silence the warning that matters.
//
// WHY A SUGGESTED DATE NEVER SPEAKS LIKE A LEGAL ONE
//
// §45, and it is the most dangerous line in the product. Every reminder
// carries the `deadlineBasis` of the task it came from, and the two use
// different i18n keys: ours says we suggested this week, an official one
// says the authority set this date. A single shared string here would mean
// Homatch telling a foreigner they have a legal deadline that Homatch
// invented.

import type { DeadlineBasis } from './roadmap.ts';
import type { PlanTask } from './tasks.ts';
import { isBlocked, isSettled } from './tasks.ts';

/**
 * How far ahead a warning goes out.
 *
 * Descending, and the order matters: `dueReminders` takes the FIRST lead
 * time that has been reached and not yet sent, so a plan that has been
 * dormant for a month produces one message about the deadline in three
 * days rather than four about 30, 14, 7 and 3.
 */
export const LEAD_TIMES_DAYS = [30, 14, 7, 3, 1] as const;
export type LeadTime = (typeof LEAD_TIMES_DAYS)[number];

export const REMINDER_CHANNELS = ['IN_APP', 'PUSH', 'EMAIL'] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export interface ReminderPreferences {
  enabled: boolean;
  channels: readonly ReminderChannel[];
  /** Which lead times this person wants. Empty means the default set. */
  leadTimes: readonly number[];
  /**
   * Most reminders in one day. A plan whose dates all cluster — everybody's
   * does, around arrival — would otherwise produce nine notifications on
   * one morning and be turned off that afternoon.
   */
  maxPerDay: number;
}

export const DEFAULT_REMINDER_PREFERENCES: ReminderPreferences = {
  enabled: true,
  channels: ['IN_APP', 'PUSH'],
  leadTimes: [30, 7, 1],
  maxPerDay: 3,
};

export interface DueReminder {
  taskId: string;
  templateKey: string;
  titleKey: string;
  /** Days between today and the due date. Never negative here. */
  leadDays: number;
  dueDate: string;
  deadlineBasis: DeadlineBasis;
  /** The natural key of this event, for notify_emit's dedupe. */
  dedupeKey: string;
  /** Bucket a same-day burst collapses into. */
  groupKey: string;
  /** Whether the copy may speak of a legal deadline. Only OFFICIAL may. */
  isOfficialDeadline: boolean;
}

const dayDiff = (fromIso: string, toIso: string): number | null => {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
};

/** The key `notify_emit` dedupes on. Stable, and specific to one event. */
export function reminderDedupeKey(
  taskId: string,
  leadDays: number,
  dueDate: string,
): string {
  return `expat_task:${taskId}:${dueDate}:${leadDays}`;
}

/**
 * The reminders that should go out today.
 *
 * A task produces a reminder when all of these hold:
 *
 *   it is not settled            — nothing to remind about
 *   it is not blocked            — telling somebody to do a thing they
 *                                  cannot yet start is noise, and it is
 *                                  the prerequisite they need to hear about
 *   it has a due date            — no date, no lead time
 *   the date has not passed      — an overdue task is a different message,
 *                                  surfaced in the plan rather than pushed
 *   a lead time has been reached — and that exact one has not been sent
 *
 * `alreadySent` carries the dedupe keys of reminders already delivered.
 * notify_emit would collapse a duplicate anyway; filtering here means the
 * tick does not make the round trip at all, which matters when it runs
 * every thirty seconds.
 */
export function dueReminders(
  tasks: readonly PlanTask[],
  today: string,
  alreadySent: ReadonlySet<string>,
  prefs: ReminderPreferences = DEFAULT_REMINDER_PREFERENCES,
): DueReminder[] {
  if (!prefs.enabled) return [];
  const leads = (prefs.leadTimes.length > 0 ? [...prefs.leadTimes] : [...LEAD_TIMES_DAYS])
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => b - a);
  if (leads.length === 0) return [];

  const out: DueReminder[] = [];

  for (const task of tasks) {
    if (isSettled(task.status)) continue;
    if (!task.dueDate) continue;
    if (isBlocked(task, tasks)) continue;

    const remaining = dayDiff(today, task.dueDate);
    if (remaining === null || remaining < 0) continue;

    // The tightest lead time that has been reached: with 14 days left and
    // leads of 30/7/1, the 30 has been reached and is the one to send.
    const reached = leads.filter((l) => remaining <= l);
    if (reached.length === 0) continue;

    for (const lead of reached) {
      const dedupeKey = reminderDedupeKey(task.id, lead, task.dueDate);
      if (alreadySent.has(dedupeKey)) continue;
      out.push({
        taskId: task.id,
        templateKey: task.templateKey,
        titleKey: task.titleKey,
        leadDays: remaining,
        dueDate: task.dueDate,
        deadlineBasis: task.deadlineBasis,
        dedupeKey,
        groupKey: `expat_tasks_due:${today}`,
        isOfficialDeadline: task.deadlineBasis === 'OFFICIAL',
      });
      // One per task per day. The next lead time for the same task is a
      // later day's message.
      break;
    }
  }

  // Soonest first, so the cap keeps the urgent ones.
  out.sort((a, b) => a.leadDays - b.leadDays || a.templateKey.localeCompare(b.templateKey));
  return out.slice(0, Math.max(0, prefs.maxPerDay));
}

/**
 * Tasks whose date has passed and which are still open.
 *
 * Deliberately NOT pushed. A person who has missed a date knows; a
 * notification every morning about the same missed task is the behaviour
 * that gets an app's notifications disabled, and then the reminder that
 * actually matters never arrives. Overdue work belongs on the plan, where
 * they will see it when they look.
 */
export function overdue(tasks: readonly PlanTask[], today: string): PlanTask[] {
  return tasks
    .filter((t) => !isSettled(t.status) && t.dueDate !== null && t.dueDate < today)
    .sort((a, b) => (a.dueDate as string).localeCompare(b.dueDate as string));
}

/**
 * The weekly digest's contents (§76).
 *
 * Returns null when there is nothing worth an email. A digest that arrives
 * every week saying "nothing to report" trains people to delete it unread,
 * and the one week it matters it gets deleted too.
 */
export interface WeekAhead {
  dueThisWeek: PlanTask[];
  overdue: PlanTask[];
  newlyActionable: PlanTask[];
}

export function weekAhead(
  tasks: readonly PlanTask[],
  today: string,
  previouslyBlocked: ReadonlySet<string>,
): WeekAhead | null {
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const dueThisWeek = tasks.filter(
    (t) =>
      !isSettled(t.status) &&
      t.dueDate !== null &&
      t.dueDate >= today &&
      t.dueDate <= horizon &&
      !isBlocked(t, tasks),
  );
  const late = overdue(tasks, today);
  const newlyActionable = tasks.filter(
    (t) => previouslyBlocked.has(t.id) && !isSettled(t.status) && !isBlocked(t, tasks),
  );

  if (dueThisWeek.length === 0 && late.length === 0 && newlyActionable.length === 0) return null;
  return { dueThisWeek, overdue: late, newlyActionable };
}

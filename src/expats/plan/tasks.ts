// HOMATCH FOR EXPATS — what is actually doable right now.
//
// A plan with thirty items and no order is a list, and a list is what the
// spreadsheet the customer already has looks like. What makes this a plan is
// that it knows which four things can be started today and which twenty-six
// are waiting on them, and it can say what they are waiting for.
//
// WHY NOTHING HERE EVER MARKS A TASK DONE
//
// §44. Homatch does not know that somebody opened a bank account. It knows
// they clicked a button, which is a different fact. Every completion in this
// engine is a value the person set, carried through unchanged, reversible,
// and stamped with when they said so — never inferred from a handoff being
// opened, a page being visited, or a dependent task being started.
//
// The one apparent exception is not one: `NOT_APPLICABLE` cascades to
// dependents, because a task waiting for something that will never happen
// cannot itself happen. That is arithmetic on the person's own decision,
// not an assumption about the world.

import type { DeadlineBasis, GeneratedTask, PlanStage, TaskCategory } from './roadmap.ts';
import { PLAN_STAGES } from './roadmap.ts';

export const TASK_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  /** Submitted and now out of the person's hands. An authority is thinking. */
  'WAITING',
  'DONE',
  /** The person said it does not apply to them. Their call, always. */
  'NOT_APPLICABLE',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Statuses that mean the task will produce no further work. */
const SETTLED: ReadonlySet<TaskStatus> = new Set(['DONE', 'NOT_APPLICABLE']);

export function isSettled(s: TaskStatus): boolean {
  return SETTLED.has(s);
}

/**
 * A task as it exists for one person.
 *
 * `id` is the database row; `templateKey` is what the catalogue calls it.
 * Both are needed: the row is what gets updated, the key is what
 * dependencies are expressed in and what survives a template being
 * regenerated.
 */
export interface PlanTask {
  id: string;
  templateKey: string;
  category: TaskCategory;
  stage: PlanStage;
  titleKey: string;
  whyKey: string;
  topicKey: string | null;
  handoff: string | null;
  dependsOn: readonly string[];
  status: TaskStatus;
  /** The date shown. May be the person's own. */
  dueDate: string | null;
  deadlineBasis: DeadlineBasis;
  /** Set once, by the person, when they mark it done. Cleared on undo. */
  completedAt: string | null;
  notes: string | null;
  order: number;
  recursEveryMonths: number | null;
}

/** A generated task, made into a live one. Everything starts unstarted. */
export function materialise(g: GeneratedTask, id: string): PlanTask {
  return {
    id,
    templateKey: g.templateKey,
    category: g.category,
    stage: g.stage,
    titleKey: g.titleKey,
    whyKey: g.whyKey,
    topicKey: g.topicKey,
    handoff: g.handoff,
    dependsOn: g.dependsOn,
    status: 'NOT_STARTED',
    dueDate: g.recommendedDate,
    deadlineBasis: g.deadlineBasis,
    completedAt: null,
    notes: null,
    order: g.order,
    recursEveryMonths: g.recursEveryMonths,
  };
}

/* ── Blocking ─────────────────────────────────────────────────────────── */

export interface Blocker {
  /** The task that cannot start. */
  taskId: string;
  /** Template keys it is waiting on, in plan order. */
  waitingOn: string[];
}

/**
 * Which tasks are blocked, and by what.
 *
 * A dependency in any settled state — DONE or NOT_APPLICABLE — stops
 * blocking. A dependency that is merely IN_PROGRESS still blocks: a notary
 * will not certify a translation that is halfway done.
 *
 * A dependency key that is not in the list at all does NOT block. The
 * roadmap strips unmet dependencies before they get here, so the only way
 * to see one is a data error, and the safe failure is an actionable task
 * rather than one that is stuck for ever with no visible cause.
 */
export function blockers(tasks: readonly PlanTask[]): Blocker[] {
  const byKey = new Map(tasks.map((t) => [t.templateKey, t]));
  const out: Blocker[] = [];
  for (const task of tasks) {
    if (isSettled(task.status)) continue;
    const waitingOn = task.dependsOn.filter((key) => {
      const dep = byKey.get(key);
      return dep !== undefined && !isSettled(dep.status);
    });
    if (waitingOn.length > 0) out.push({ taskId: task.id, waitingOn });
  }
  return out;
}

export function isBlocked(task: PlanTask, tasks: readonly PlanTask[]): boolean {
  if (isSettled(task.status)) return false;
  const byKey = new Map(tasks.map((t) => [t.templateKey, t]));
  return task.dependsOn.some((k) => {
    const dep = byKey.get(k);
    return dep !== undefined && !isSettled(dep.status);
  });
}

/**
 * What the person can actually start today.
 *
 * Unsettled, unblocked, and due soonest first. Undated tasks come last
 * rather than first: a task with no date is one we could not place, and
 * putting it above a dated one would push a real deadline down the screen.
 */
export function actionable(tasks: readonly PlanTask[]): PlanTask[] {
  return tasks
    .filter((t) => !isSettled(t.status) && !isBlocked(t, tasks))
    .sort((a, b) => {
      if (a.dueDate && b.dueDate) {
        if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      } else if (a.dueDate) return -1;
      else if (b.dueDate) return 1;
      return a.order - b.order;
    });
}

/* ── Progress ─────────────────────────────────────────────────────────── */

export interface PlanProgress {
  total: number;
  done: number;
  notApplicable: number;
  /** Tasks that still represent work. The denominator that matters. */
  outstanding: number;
  blocked: number;
  actionable: number;
  overdue: number;
  /** Done over (done + outstanding). Null when there is nothing to do. */
  fraction: number | null;
  byStage: Record<PlanStage, { total: number; done: number }>;
}

/**
 * Where the plan stands.
 *
 * `fraction` deliberately excludes NOT_APPLICABLE from both halves. A person
 * who marks eight tasks as not applying to them has not completed eight
 * tasks, and a progress bar that jumps to 40% because somebody said "I have
 * no children" is congratulating them for nothing.
 */
export function progress(tasks: readonly PlanTask[], today: string = isoToday()): PlanProgress {
  const byStage = Object.fromEntries(
    PLAN_STAGES.map((s) => [s, { total: 0, done: 0 }]),
  ) as Record<PlanStage, { total: number; done: number }>;

  let done = 0;
  let notApplicable = 0;
  let overdue = 0;
  const blockedSet = new Set(blockers(tasks).map((b) => b.taskId));

  for (const t of tasks) {
    if (t.status === 'NOT_APPLICABLE') {
      notApplicable += 1;
      continue;
    }
    byStage[t.stage].total += 1;
    if (t.status === 'DONE') {
      done += 1;
      byStage[t.stage].done += 1;
      continue;
    }
    if (t.dueDate && t.dueDate < today) overdue += 1;
  }

  const total = tasks.length;
  const outstanding = total - done - notApplicable;
  return {
    total,
    done,
    notApplicable,
    outstanding,
    blocked: blockedSet.size,
    actionable: actionable(tasks).length,
    overdue,
    fraction: done + outstanding === 0 ? null : done / (done + outstanding),
    byStage,
  };
}

function isoToday(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/* ── Changing a task ──────────────────────────────────────────────────── */

export interface StatusChange {
  taskId: string;
  status: TaskStatus;
  completedAt: string | null;
}

/**
 * The full set of changes one status change implies.
 *
 * Marking a task DONE changes exactly that task. Marking it NOT_APPLICABLE
 * cascades: everything that depends on it, transitively, is also not
 * applicable, because it is waiting for something that will not happen.
 *
 * The cascade does NOT touch a dependent the person has already settled
 * themselves. Somebody who marked "open a bank account" as done and then
 * declared its prerequisite not applicable has told us two things, and
 * overwriting the first with a consequence of the second would be the
 * product silently editing an answer they gave (§46).
 *
 * Undo is the same function with a non-settled status: dependents are left
 * exactly as they are, because un-cancelling a prerequisite does not tell
 * us the person now intends to do everything downstream of it.
 */
export function applyStatus(
  tasks: readonly PlanTask[],
  taskId: string,
  status: TaskStatus,
  now: string = new Date().toISOString(),
): StatusChange[] {
  const target = tasks.find((t) => t.id === taskId);
  if (!target) return [];

  const head: StatusChange = {
    taskId,
    status,
    completedAt: status === 'DONE' ? now : null,
  };
  if (status !== 'NOT_APPLICABLE') return [head];

  const byKey = new Map(tasks.map((t) => [t.templateKey, t]));
  const dependents = new Map<string, string[]>();
  for (const t of tasks) {
    for (const d of t.dependsOn) {
      const list = dependents.get(d) ?? [];
      list.push(t.templateKey);
      dependents.set(d, list);
    }
  }

  const out: StatusChange[] = [head];
  const seen = new Set([target.templateKey]);
  const queue = [target.templateKey];
  while (queue.length > 0) {
    const key = queue.shift() as string;
    for (const childKey of dependents.get(key) ?? []) {
      if (seen.has(childKey)) continue;
      seen.add(childKey);
      const child = byKey.get(childKey);
      if (!child || isSettled(child.status)) continue;
      out.push({ taskId: child.id, status: 'NOT_APPLICABLE', completedAt: null });
      queue.push(childKey);
    }
  }
  return out;
}

/**
 * The next occurrence of a recurring task, once this one is done.
 *
 * Counted from the COMPLETION date, not the due date. A residence permit
 * renewed two months late still runs a year from the day it was renewed,
 * and counting from the date we suggested would put the next reminder two
 * months before it is needed, every year, compounding.
 */
export function nextOccurrence(task: PlanTask): string | null {
  if (!task.recursEveryMonths || task.status !== 'DONE' || !task.completedAt) return null;
  const from = new Date(task.completedAt);
  if (Number.isNaN(from.getTime())) return null;
  const next = new Date(from);
  next.setMonth(next.getMonth() + task.recursEveryMonths);
  return next.toISOString().slice(0, 10);
}

// The plan engine: what it promises a person who is moving country.
//
// The failures these guard against are all quiet ones. A plan that silently
// omits a task, a dependency that can never clear, a reminder that calls our
// own suggestion a legal deadline — none of them throws, none of them shows
// up in a build, and every one of them costs somebody something real.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EMPTY_PROFILE } from '../types.ts';
import {
  PLAN_STAGES,
  TASK_TEMPLATES,
  danglingDependencies,
  dependencyCycles,
  roadmapFor,
  templateByKey,
} from '../plan/roadmap.ts';
import {
  actionable,
  applyStatus,
  blockers,
  isBlocked,
  materialise,
  nextOccurrence,
  progress,
} from '../plan/tasks.ts';
import {
  DEFAULT_REMINDER_PREFERENCES,
  dueReminders,
  overdue,
  reminderDedupeKey,
  weekAhead,
} from '../plan/reminders.ts';

const profile = (over = {}) => ({ ...EMPTY_PROFILE, ...over });

/** A plan, materialised, with ids that are the template keys for legibility. */
const planFor = (p) => roadmapFor(p).map((g) => materialise(g, `id:${g.templateKey}`));

const setStatus = (tasks, key, status) =>
  tasks.map((t) => (t.templateKey === key ? { ...t, status, completedAt: status === 'DONE' ? '2026-09-20T00:00:00.000Z' : null } : t));

/* ── The catalogue itself ─────────────────────────────────────────────── */

test('no template depends on a key that does not exist', () => {
  const keys = new Set(TASK_TEMPLATES.map((t) => t.key));
  for (const t of TASK_TEMPLATES) {
    for (const d of t.dependsOn) {
      assert.ok(keys.has(d), `${t.key} depends on unknown template ${d}`);
    }
  }
});

test('no template key appears twice', () => {
  const keys = TASK_TEMPLATES.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('the dependency graph has no cycles', () => {
  assert.deepEqual(dependencyCycles(), []);
});

test('a dependency never points forward in time', () => {
  // A task cannot depend on something scheduled later than itself: that is
  // a plan that can never be worked through in order.
  for (const t of TASK_TEMPLATES) {
    for (const key of t.dependsOn) {
      const dep = templateByKey(key);
      assert.ok(dep, key);
      const a = PLAN_STAGES.indexOf(dep.stage);
      const b = PLAN_STAGES.indexOf(t.stage);
      assert.ok(a <= b, `${t.key} (${t.stage}) depends on later ${dep.key} (${dep.stage})`);
    }
  }
});

test('every template carries a title and a reason', () => {
  for (const t of TASK_TEMPLATES) {
    assert.match(t.titleKey, /^expat_task_/, t.key);
    assert.match(t.whyKey, /^expat_task_/, t.key);
  }
});

/* ── Generation ───────────────────────────────────────────────────────── */

test('a completely empty profile still produces a usable plan', () => {
  const plan = roadmapFor(EMPTY_PROFILE);
  assert.ok(plan.length >= 10, `only ${plan.length} tasks`);
  assert.deepEqual(danglingDependencies(plan), []);
  // No arrival date means no dates, and that is allowed.
  assert.ok(plan.every((t) => t.recommendedDate === null));
});

test('generation is deterministic', () => {
  const p = profile({ intents: ['MOVE'], arrivalDate: '2026-11-01', household: 'FAMILY', childrenCount: 2 });
  assert.deepEqual(roadmapFor(p), roadmapFor(p));
});

test('an investor is not given relocation chores', () => {
  const investor = profile({ intents: ['INVEST'], alreadyOwnsProperty: false });
  const keys = roadmapFor(investor).map((t) => t.templateKey);
  assert.ok(!keys.includes('get-sim'), 'a remote investor does not need a Georgian SIM');
  assert.ok(!keys.includes('book-temporary-housing'));
  assert.ok(!keys.includes('enrol-children'));
  assert.ok(keys.includes('analyse-investment'));
  assert.ok(keys.includes('verify-property'));
});

test('an existing foreign owner is not told to buy a property', () => {
  const owner = profile({ intents: ['INVEST'], alreadyOwnsProperty: true });
  const keys = roadmapFor(owner).map((t) => t.templateKey);
  assert.ok(!keys.includes('verify-property'));
  assert.ok(!keys.includes('arrange-financing'));
  assert.ok(!keys.includes('review-purchase-contract'));
  // But ownership tasks remain.
  assert.ok(keys.includes('insure-property'));
});

test('a relocating family gets the family tasks and a single person does not', () => {
  const family = roadmapFor(profile({ intents: ['MOVE'], household: 'FAMILY', childrenCount: 2 }));
  const alone = roadmapFor(profile({ intents: ['MOVE'], household: 'ALONE', childrenCount: 0 }));
  assert.ok(family.some((t) => t.templateKey === 'enrol-children'));
  assert.ok(!alone.some((t) => t.templateKey === 'enrol-children'));
});

test('dependencies on tasks the person will not do are dropped, not left dangling', () => {
  // An investor gets verify-property but never gets get-sim, and
  // arrange-financing depends on open-bank-account which they DO get.
  const investor = profile({ intents: ['INVEST'] });
  const plan = roadmapFor(investor);
  assert.deepEqual(danglingDependencies(plan), []);
  const bank = plan.find((t) => t.templateKey === 'open-bank-account');
  assert.ok(bank, 'an investor still needs an account');
  assert.deepEqual([...bank.dependsOn], [], 'its SIM dependency was dropped with the SIM task');
});

test('dates are placed relative to arrival, before and after', () => {
  const plan = roadmapFor(profile({ intents: ['MOVE'], arrivalDate: '2026-11-01' }));
  const prep = plan.find((t) => t.templateKey === 'check-entry-conditions');
  const later = plan.find((t) => t.templateKey === 'register-address');
  assert.ok(prep.recommendedDate < '2026-11-01', prep.recommendedDate);
  assert.ok(later.recommendedDate > '2026-11-01', later.recommendedDate);
});

test('every generated date is a suggestion, never an official deadline', () => {
  const plan = roadmapFor(profile({ intents: ['MOVE'], arrivalDate: '2026-11-01' }));
  assert.ok(plan.every((t) => t.deadlineBasis === 'SUGGESTED'));
});

/* ── Blocking ─────────────────────────────────────────────────────────── */

test('a task whose prerequisite is open is blocked and not actionable', () => {
  const tasks = planFor(profile({ intents: ['MOVE'] }));
  const apostille = tasks.find((t) => t.templateKey === 'apostille-documents');
  assert.ok(isBlocked(apostille, tasks), 'documents have not been gathered yet');
  assert.ok(!actionable(tasks).some((t) => t.templateKey === 'apostille-documents'));
});

test('finishing the prerequisite unblocks it', () => {
  let tasks = planFor(profile({ intents: ['MOVE'] }));
  tasks = setStatus(tasks, 'gather-personal-documents', 'DONE');
  const apostille = tasks.find((t) => t.templateKey === 'apostille-documents');
  assert.equal(isBlocked(apostille, tasks), false);
  assert.ok(actionable(tasks).some((t) => t.templateKey === 'apostille-documents'));
});

test('a prerequisite marked not applicable also unblocks', () => {
  let tasks = planFor(profile({ intents: ['MOVE'] }));
  tasks = setStatus(tasks, 'gather-personal-documents', 'NOT_APPLICABLE');
  const apostille = tasks.find((t) => t.templateKey === 'apostille-documents');
  assert.equal(isBlocked(apostille, tasks), false);
});

test('a prerequisite merely in progress still blocks', () => {
  let tasks = planFor(profile({ intents: ['MOVE'] }));
  tasks = setStatus(tasks, 'gather-personal-documents', 'IN_PROGRESS');
  const apostille = tasks.find((t) => t.templateKey === 'apostille-documents');
  assert.equal(isBlocked(apostille, tasks), true);
});

test('blockers name what is being waited for', () => {
  const tasks = planFor(profile({ intents: ['MOVE'] }));
  const b = blockers(tasks).find((x) => x.taskId === 'id:apostille-documents');
  assert.deepEqual(b.waitingOn, ['gather-personal-documents']);
});

/* ── Completion is the person's, always ───────────────────────────────── */

test('marking done changes exactly one task', () => {
  const tasks = planFor(profile({ intents: ['MOVE'] }));
  const changes = applyStatus(tasks, 'id:gather-personal-documents', 'DONE', '2026-09-20T10:00:00.000Z');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].completedAt, '2026-09-20T10:00:00.000Z');
});

test('undo clears the completion timestamp and nothing else', () => {
  const tasks = planFor(profile({ intents: ['MOVE'] }));
  const changes = applyStatus(tasks, 'id:gather-personal-documents', 'NOT_STARTED');
  assert.deepEqual(changes, [
    { taskId: 'id:gather-personal-documents', status: 'NOT_STARTED', completedAt: null },
  ]);
});

test('not-applicable cascades to everything downstream', () => {
  const tasks = planFor(profile({ intents: ['MOVE'] }));
  const changed = applyStatus(tasks, 'id:gather-personal-documents', 'NOT_APPLICABLE').map((c) => c.taskId);
  assert.ok(changed.includes('id:apostille-documents'));
  // And transitively, to what depends on the apostille.
  assert.ok(changed.includes('id:submit-residence-application'));
  assert.ok(changed.every((id) => id.startsWith('id:')));
});

test('the cascade does not overwrite an answer the person already gave', () => {
  let tasks = planFor(profile({ intents: ['MOVE'] }));
  tasks = setStatus(tasks, 'apostille-documents', 'DONE');
  const changed = applyStatus(tasks, 'id:gather-personal-documents', 'NOT_APPLICABLE').map((c) => c.taskId);
  assert.ok(!changed.includes('id:apostille-documents'), 'they said they did it');
});

test('a recurring task schedules from when it was done, not when it was due', () => {
  const tasks = planFor(profile({ intents: ['MOVE'], arrivalDate: '2026-01-01' }));
  const renewal = {
    ...tasks.find((t) => t.templateKey === 'renew-health-cover'),
    status: 'DONE',
    completedAt: '2026-09-20T00:00:00.000Z',
    dueDate: '2026-05-01',
  };
  assert.equal(nextOccurrence(renewal), '2027-09-20');
});

test('an unfinished recurring task has no next occurrence', () => {
  const tasks = planFor(profile({ intents: ['MOVE'] }));
  const renewal = tasks.find((t) => t.templateKey === 'renew-health-cover');
  assert.equal(nextOccurrence(renewal), null);
});

/* ── Progress ─────────────────────────────────────────────────────────── */

test('marking things not applicable does not count as progress', () => {
  let tasks = planFor(profile({ intents: ['MOVE'] }));
  const before = progress(tasks, '2026-09-20').fraction;
  tasks = setStatus(tasks, 'pet-import-paperwork', 'NOT_APPLICABLE');
  const after = progress(tasks, '2026-09-20');
  assert.equal(before, 0);
  assert.equal(after.fraction, 0, 'declaring something irrelevant is not an achievement');
  assert.equal(after.notApplicable, 1);
});

test('progress counts done over real work', () => {
  let tasks = planFor(profile({ intents: ['MOVE'] }));
  const total = tasks.length;
  tasks = setStatus(tasks, 'gather-personal-documents', 'DONE');
  const p = progress(tasks, '2026-09-20');
  assert.equal(p.done, 1);
  assert.equal(p.outstanding, total - 1);
  assert.ok(Math.abs(p.fraction - 1 / total) < 1e-9);
});

/* ── Reminders ────────────────────────────────────────────────────────── */

const withDue = (tasks, key, due) =>
  tasks.map((t) => (t.templateKey === key ? { ...t, dueDate: due } : t));

test('a reminder fires once a lead time is reached and not before', () => {
  let tasks = planFor(profile({ intents: ['MOVE'] })).slice(0, 1);
  tasks = withDue(tasks, tasks[0].templateKey, '2026-10-20');
  // 30 days out: the 30-day lead time has just been reached.
  assert.equal(dueReminders(tasks, '2026-09-20', new Set()).length, 1);
  // 31 days out: nothing yet.
  assert.equal(dueReminders(tasks, '2026-09-19', new Set()).length, 0);
});

test('the same reminder is never sent twice', () => {
  let tasks = planFor(profile({ intents: ['MOVE'] })).slice(0, 1);
  tasks = withDue(tasks, tasks[0].templateKey, '2026-10-20');
  const first = dueReminders(tasks, '2026-09-20', new Set());
  assert.equal(first.length, 1);
  const sent = new Set(first.map((r) => r.dedupeKey));
  assert.equal(dueReminders(tasks, '2026-09-20', sent).length, 0);
});

test('moving a deadline produces a genuinely new reminder', () => {
  let tasks = planFor(profile({ intents: ['MOVE'] })).slice(0, 1);
  const key = tasks[0].templateKey;
  const a = reminderDedupeKey(`id:${key}`, 30, '2026-10-20');
  const b = reminderDedupeKey(`id:${key}`, 30, '2026-11-20');
  assert.notEqual(a, b);
});

test('a dormant plan produces one message, not four', () => {
  let tasks = planFor(profile({ intents: ['MOVE'] })).slice(0, 1);
  tasks = withDue(tasks, tasks[0].templateKey, '2026-09-21');
  const out = dueReminders(tasks, '2026-09-20', new Set(), {
    ...DEFAULT_REMINDER_PREFERENCES,
    leadTimes: [30, 14, 7, 3, 1],
  });
  assert.equal(out.length, 1, 'one task, one message, however many lead times elapsed');
  assert.equal(out[0].leadDays, 1);
});

test('a blocked task is never the subject of a reminder', () => {
  let tasks = planFor(profile({ intents: ['MOVE'] }));
  tasks = tasks.map((t) =>
    t.templateKey === 'apostille-documents' ? { ...t, dueDate: '2026-09-21' } : { ...t, dueDate: null },
  );
  assert.deepEqual(dueReminders(tasks, '2026-09-20', new Set()), []);
});

test('an overdue task is surfaced in the plan and not pushed', () => {
  let tasks = planFor(profile({ intents: ['MOVE'] })).slice(0, 1);
  tasks = withDue(tasks, tasks[0].templateKey, '2026-09-01');
  assert.deepEqual(dueReminders(tasks, '2026-09-20', new Set()), []);
  assert.equal(overdue(tasks, '2026-09-20').length, 1);
});

test('a suggested date never claims to be an official deadline', () => {
  let tasks = planFor(profile({ intents: ['MOVE'] })).slice(0, 1);
  tasks = withDue(tasks, tasks[0].templateKey, '2026-09-21');
  const [r] = dueReminders(tasks, '2026-09-20', new Set());
  assert.equal(r.deadlineBasis, 'SUGGESTED');
  assert.equal(r.isOfficialDeadline, false);
});

test('an official deadline is allowed to say so', () => {
  let tasks = planFor(profile({ intents: ['MOVE'] })).slice(0, 1);
  tasks = withDue(tasks, tasks[0].templateKey, '2026-09-21').map((t) => ({
    ...t,
    deadlineBasis: 'OFFICIAL',
  }));
  const [r] = dueReminders(tasks, '2026-09-20', new Set());
  assert.equal(r.isOfficialDeadline, true);
});

test('the daily cap keeps the most urgent', () => {
  const base = planFor(profile({ intents: ['MOVE'] }));
  const tasks = base.slice(0, 5).map((t, i) => ({
    ...t,
    dependsOn: [],
    dueDate: `2026-09-${String(21 + i).padStart(2, '0')}`,
  }));
  const out = dueReminders(tasks, '2026-09-20', new Set(), {
    ...DEFAULT_REMINDER_PREFERENCES,
    maxPerDay: 2,
  });
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.leadDays), [1, 2]);
});

test('reminders switched off produce nothing at all', () => {
  let tasks = planFor(profile({ intents: ['MOVE'] })).slice(0, 1);
  tasks = withDue(tasks, tasks[0].templateKey, '2026-09-21');
  assert.deepEqual(
    dueReminders(tasks, '2026-09-20', new Set(), { ...DEFAULT_REMINDER_PREFERENCES, enabled: false }),
    [],
  );
});

test('a quiet week produces no digest rather than an empty one', () => {
  const tasks = planFor(profile({ intents: ['MOVE'] })).map((t) => ({ ...t, dueDate: null }));
  assert.equal(weekAhead(tasks, '2026-09-20', new Set()), null);
});

test('the digest reports what became actionable', () => {
  let tasks = planFor(profile({ intents: ['MOVE'] })).map((t) => ({ ...t, dueDate: null }));
  tasks = setStatus(tasks, 'gather-personal-documents', 'DONE');
  const digest = weekAhead(tasks, '2026-09-20', new Set(['id:apostille-documents']));
  assert.ok(digest);
  assert.ok(digest.newlyActionable.some((t) => t.templateKey === 'apostille-documents'));
});

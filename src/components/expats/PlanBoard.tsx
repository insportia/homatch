// HOMATCH FOR EXPATS — the plan, as something you can work through.
//
// Grouped by stage, because a plan for moving country is chronological and
// any other grouping — by category, by status — makes the reader assemble
// the timeline themselves.
//
// THE TWO THINGS THIS SCREEN HAS TO GET RIGHT
//
// A blocked task must say WHAT it is waiting for, by name. "Blocked" on
// its own is a dead end; "waiting on: gather your documents" is an
// instruction.
//
// A date must never be described in words that imply the law set it unless
// the law did. There are two different strings for a due date and the one
// that says "deadline" is reachable only when deadlineBasis is OFFICIAL.
// That is the §45 rule, and it is enforced here rather than left to
// whoever writes the copy next.

import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Lock, Undo2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { PLAN_STAGES, type PlanStage } from '@/expats/plan/roadmap';
import {
  applyStatus,
  blockers,
  isBlocked,
  isSettled,
  type PlanTask,
  type TaskStatus,
} from '@/expats/plan/tasks';
import { applyTaskStatuses } from '@/services/expats';

const HANDOFF_ROUTE: Record<string, string> = {
  VERIFY: '/verify',
  MORTGAGE: '/mortgage',
  INVESTMENT: '/investment',
  CONTRACTS: '/contracts',
  PROPERTY: '/ai',
};

export function PlanBoard({
  tasks,
  onChanged,
}: {
  tasks: readonly PlanTask[];
  onChanged: () => void | Promise<void>;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = React.useState<string | null>(null);

  const blockedBy = React.useMemo(() => {
    const map = new Map<string, string[]>();
    for (const b of blockers(tasks)) map.set(b.taskId, b.waitingOn);
    return map;
  }, [tasks]);

  const byStage = React.useMemo(() => {
    const map = new Map<PlanStage, PlanTask[]>();
    for (const task of tasks) {
      const list = map.get(task.stage) ?? [];
      list.push(task);
      map.set(task.stage, list);
    }
    return PLAN_STAGES.filter((s) => map.has(s)).map(
      (s) => [s, (map.get(s) as PlanTask[]).sort((a, b) => a.order - b.order)] as const,
    );
  }, [tasks]);

  const setStatus = async (task: PlanTask, status: TaskStatus) => {
    setBusy(task.id);
    const changes = applyStatus(tasks, task.id, status);
    await applyTaskStatuses(changes);
    await onChanged();
    setBusy(null);
  };

  const titleOf = (key: string): string => {
    const other = tasks.find((task) => task.templateKey === key);
    return other ? t(other.titleKey) : key;
  };

  return (
    <div className="mt-8 space-y-10" data-expat-plan-board>
      {byStage.map(([stage, list]) => (
        <section key={stage} data-expat-stage={stage}>
          <h2 className="mb-1 font-display text-lg font-semibold text-foreground">
            {t(`expat_stage_${stage.toLowerCase()}`)}
          </h2>
          <p className="mb-4 text-2xs text-muted-foreground">
            {t(`expat_stage_${stage.toLowerCase()}_note`)}
          </p>

          <ul className="overflow-hidden rounded-xl border border-border">
            {list.map((task, i) => {
              const waiting = blockedBy.get(task.id) ?? [];
              const blocked = isBlocked(task, tasks);
              const settled = isSettled(task.status);

              return (
                <li
                  key={task.id}
                  data-expat-task={task.templateKey}
                  data-expat-task-status={task.status}
                  className={cn(
                    'flex flex-wrap items-start gap-3 px-4 py-4 sm:gap-4',
                    i > 0 && 'border-t border-border',
                    settled && 'bg-muted/30',
                  )}
                >
                  <button
                    type="button"
                    disabled={blocked || busy === task.id}
                    aria-pressed={task.status === 'DONE'}
                    aria-label={t(
                      task.status === 'DONE' ? 'expat_task_undo_aria' : 'expat_task_done_aria',
                    )}
                    onClick={() =>
                      void setStatus(task, task.status === 'DONE' ? 'NOT_STARTED' : 'DONE')
                    }
                    className={cn(
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors',
                      task.status === 'DONE'
                        ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold))] text-[hsl(var(--primary-foreground))]'
                        : 'border-border hover:border-[hsl(var(--gold-border))]',
                      blocked && 'cursor-not-allowed opacity-40',
                    )}
                  >
                    {task.status === 'DONE' ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                    {blocked ? <Lock className="h-3 w-3 text-muted-foreground" aria-hidden="true" /> : null}
                  </button>

                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-sm font-medium',
                        settled ? 'text-muted-foreground line-through' : 'text-foreground',
                      )}
                    >
                      {task.titleKey ? t(task.titleKey) : task.templateKey}
                    </p>
                    <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
                      {task.whyKey ? t(task.whyKey) : null}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <DueDate task={task} />

                      {blocked ? (
                        <span
                          data-expat-task-blocked
                          className="rounded-full border border-border px-2 py-0.5 text-2xs text-muted-foreground"
                        >
                          {t('expat_task_waiting_on', {
                            what: waiting.map(titleOf).join(', '),
                          })}
                        </span>
                      ) : null}

                      {task.status === 'NOT_APPLICABLE' ? (
                        <span className="rounded-full border border-border px-2 py-0.5 text-2xs text-muted-foreground">
                          {t('expat_task_not_applicable')}
                        </span>
                      ) : null}

                      {task.topicKey ? (
                        <Link
                          to={`/for-expats/georgia/${task.topicKey}`}
                          className="text-2xs text-[hsl(var(--gold-ink))] underline underline-offset-2"
                        >
                          {t('expat_task_how_to')}
                        </Link>
                      ) : null}

                      {task.handoff && HANDOFF_ROUTE[task.handoff] ? (
                        <Link
                          to={HANDOFF_ROUTE[task.handoff]}
                          data-expat-handoff={task.handoff}
                          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-2xs text-foreground transition-colors hover:border-[hsl(var(--gold-border))]"
                        >
                          {t(`expat_handoff_${task.handoff.toLowerCase()}`)}
                          <ArrowRight className="h-3 w-3 rtl:rotate-180" aria-hidden="true" />
                        </Link>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {settled ? (
                      <button
                        type="button"
                        onClick={() => void setStatus(task, 'NOT_STARTED')}
                        aria-label={t('expat_task_undo_aria')}
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void setStatus(task, 'NOT_APPLICABLE')}
                        className="rounded-md px-2 py-1 text-2xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {t('expat_task_skip')}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * The date, described by where it came from.
 *
 * Three strings, and only one of them contains the word deadline. A task
 * whose `deadlineBasis` is SUGGESTED gets "we suggest"; one the person set
 * gets "you set"; only OFFICIAL — which requires a sourced fact behind it,
 * enforced by a CHECK constraint — is described as a deadline.
 */
function DueDate({ task }: { task: PlanTask }) {
  const { t } = useLanguage();
  if (!task.dueDate) return null;

  const key =
    task.deadlineBasis === 'OFFICIAL'
      ? 'expat_task_due_official'
      : task.deadlineBasis === 'USER'
        ? 'expat_task_due_user'
        : 'expat_task_due_suggested';

  return (
    <span
      data-expat-due-basis={task.deadlineBasis}
      className={cn(
        'rounded-full border px-2 py-0.5 text-2xs',
        task.deadlineBasis === 'OFFICIAL'
          ? 'border-[hsl(var(--gold-border))] text-[hsl(var(--gold-ink))]'
          : 'border-border text-muted-foreground',
      )}
    >
      {t(key, { date: task.dueDate })}
    </span>
  );
}

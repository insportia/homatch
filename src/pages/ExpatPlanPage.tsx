// HOMATCH FOR EXPATS — My Expat Plan.
//
// The part of the product somebody comes back to. Everything else answers
// a question once; this one holds state for a year and has to still be
// right when they open it in April having changed their arrival date twice.
//
// WHY THE PROFILE IS A STRIP AND NOT A FORM
//
// §40: do not ask everything upfront. The profile here is five controls in
// a row, each one optional, each one visibly changing the plan underneath
// when it is answered. That makes the connection between a question and
// its effect immediate, which is the only reason anybody answers the
// second question.
//
// WHY REGENERATION IS SAFE
//
// Changing the profile regenerates the plan on every keystroke's commit.
// That is only tolerable because `writePlan` upserts on
// (user_id, template_key) and never writes status, completion or notes —
// so a regeneration moves dates and dependencies and cannot touch what the
// person has actually done. If that guarantee ever broke, this screen
// would quietly delete somebody's progress every time they corrected a
// typo in their arrival date.

import React from 'react';
import { Navigate } from 'react-router-dom';
import PageMeta from '@/components/common/PageMeta';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { ProfileStrip } from '@/components/expats/ProfileStrip';
import { PlanBoard } from '@/components/expats/PlanBoard';
import { ReminderSettings } from '@/components/expats/ReminderSettings';
import { WhatChanged } from '@/components/expats/WhatChanged';
import { roadmapFor } from '@/expats/plan/roadmap';
import { progress } from '@/expats/plan/tasks';
import type { PlanTask } from '@/expats/plan/tasks';
import { EMPTY_PROFILE, type ExpatProfile } from '@/expats/types';
import {
  getProfile,
  getReminderPreferences,
  getTasks,
  getUpdates,
  saveProfile,
  writePlan,
  type ExpatUpdate,
  type ReminderPreferenceRow,
} from '@/services/expats';
import { PublicHeader, HeaderSpacer } from '@/components/home/PublicHeader';
import { usePublicNavLinks } from '@/site/publicNav';
import { SiteFooter } from '@/components/home/sections/SiteFooter';

export default function ExpatPlanPage() {
  const { t } = useLanguage();
  const { homatchUser, status } = useAuth();

  const [profile, setProfile] = React.useState<ExpatProfile>(EMPTY_PROFILE);
  const [tasks, setTasks] = React.useState<PlanTask[]>([]);
  const [prefs, setPrefs] = React.useState<ReminderPreferenceRow | null>(null);
  const [updates, setUpdates] = React.useState<ExpatUpdate[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const userId = homatchUser?.id ?? null;

  const reload = React.useCallback(async () => {
    if (!userId) return;
    const [p, ts, pr, up] = await Promise.all([
      getProfile(userId),
      getTasks(userId),
      getReminderPreferences(userId),
      getUpdates(5),
    ]);
    setProfile(p ?? EMPTY_PROFILE);
    setTasks(ts);
    setPrefs(pr);
    setUpdates(up);
    setLoading(false);
  }, [userId]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Persist the profile, regenerate, and reload.
   *
   * The regeneration is deliberately NOT optimistic. A plan is the one
   * screen where showing a predicted state and correcting it a moment
   * later would be actively confusing — a task appearing and then
   * vanishing reads as a bug.
   */
  const commitProfile = React.useCallback(
    async (next: ExpatProfile) => {
      if (!userId) return;
      setSaving(true);
      setProfile(next);
      await saveProfile(userId, next);
      await writePlan(userId, roadmapFor(next));
      await reload();
      setSaving(false);
    },
    [userId, reload],
  );

  /* UNAUTHENTICATED is established absence; UNKNOWN is restoration still
     in flight. Collapsing the two is the exact bug authStatus.ts was
     written to end — it shows a signed-in customer the login page on
     every refresh. */
  if (status === 'UNAUTHENTICATED') {
    return <Navigate to="/auth/login?next=/for-expats/plan" replace />;
  }
  /*
   * WHILE THE SESSION IS STILL RESOLVING, THE PAGE STILL SAYS WHAT IT IS.
   *
   * This used to be a bare pulsing rectangle, and the mobile sweep caught
   * it as "rendered nothing" at 320px — which is exactly what a person on
   * a slow connection saw: an untitled grey box with no indication of
   * where they were or that anything was coming. A skeleton is a promise
   * that content is arriving, and a skeleton with no heading does not
   * make that promise to anybody, including a screen reader.
   *
   * The header is bundle-only and needs no data, so it renders straight
   * away and only the plan itself waits.
   */
  if (status === 'UNKNOWN' || !userId) {
    return (
      <>
        <PageMeta title={t('expat_plan_meta_title')} description={t('expat_plan_meta_description')} />
        <div className="mx-auto w-full max-w-[64rem] px-5 py-12 sm:py-16">
          <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--gold-ink))]">
            {t('expat_plan_eyebrow')}
          </p>
          <h1 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">
            {t('expat_plan_title')}
          </h1>
          <p className="mt-3 max-w-[56ch] text-sm leading-relaxed text-muted-foreground">
            {t('expat_plan_loading')}
          </p>
          <div aria-hidden="true" className="mt-8 space-y-3">
            <div className="h-24 animate-pulse rounded-2xl bg-muted" />
            <div className="h-40 animate-pulse rounded-2xl bg-muted" />
          </div>
        </div>
      </>
    );
  }

  const stats = progress(tasks);
  const planKeys = tasks.map((task) => task.templateKey);

  const headerLinks = usePublicNavLinks();

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <PageMeta title={t('expat_plan_meta_title')} description={t('expat_plan_meta_description')} />

      {/* The plan is a signed-in page and still part of the product: it had
          no header, no footer and no way back out to Homatch. */}
      <PublicHeader links={headerLinks} solid />
      <HeaderSpacer />

      <div className="mx-auto w-full max-w-[64rem] px-5 py-12 sm:py-16">
        <header className="mb-8">
          <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--gold-ink))]">
            {t('expat_plan_eyebrow')}
          </p>
          <h1 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">
            {t('expat_plan_title')}
          </h1>
          <p className="mt-3 max-w-[56ch] text-sm leading-relaxed text-muted-foreground">
            {t('expat_plan_body')}
          </p>
        </header>

        <ProfileStrip profile={profile} saving={saving} onChange={commitProfile} />

        {tasks.length === 0 && !loading ? (
          <div className="mt-8 rounded-2xl border border-border p-6">
            <p className="text-sm text-muted-foreground">{t('expat_plan_empty')}</p>
            <button
              type="button"
              data-expat-plan-generate
              onClick={() => void commitProfile(profile)}
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              {t('expat_plan_generate')}
            </button>
          </div>
        ) : null}

        {tasks.length > 0 ? (
          <>
            <ProgressBar stats={stats} />
            <PlanBoard tasks={tasks} onChanged={reload} />
          </>
        ) : null}

        {prefs ? (
          <ReminderSettings userId={userId} preferences={prefs} onSaved={reload} />
        ) : null}

        {updates.length > 0 ? (
          <div className="mt-12">
            <WhatChanged updates={updates} planTemplateKeys={planKeys} />
          </div>
        ) : null}
      </div>

      <SiteFooter />
    </div>
  );
}

/**
 * How far through the plan somebody is.
 *
 * The denominator excludes tasks marked not applicable, so declaring
 * something irrelevant never registers as progress — see progress() for
 * why that matters.
 */
function ProgressBar({ stats }: { stats: ReturnType<typeof progress> }) {
  const { t } = useLanguage();
  const pct = stats.fraction === null ? 0 : Math.round(stats.fraction * 100);

  return (
    <section className="mt-8 rounded-2xl border border-border p-5" data-expat-plan-progress>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-display text-xl font-semibold text-foreground">
          {t('expat_plan_progress', { done: stats.done, total: stats.done + stats.outstanding })}
        </p>
        <p className="text-2xs text-muted-foreground">
          {t('expat_plan_actionable', { n: stats.actionable })}
          {stats.blocked > 0 ? ` · ${t('expat_plan_blocked', { n: stats.blocked })}` : ''}
          {stats.overdue > 0 ? ` · ${t('expat_plan_overdue', { n: stats.overdue })}` : ''}
        </p>
      </div>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('expat_plan_progress_aria')}
      >
        <div
          className="h-full rounded-full bg-[hsl(var(--gold))] transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </section>
  );
}

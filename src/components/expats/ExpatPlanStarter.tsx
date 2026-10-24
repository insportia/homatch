// HOMATCH FOR EXPATS — the page's front door: HOMI builds a plan with you,
// then answers your questions about it.
//
// Owner direction (2026-10-24): the For Expats page leads with something you
// do, not something you read. Five taps with HOMI give a real to-do plan from
// the same tested roadmap the signed-in plan page uses; the first steps show
// straight away, for anyone. Signed in, the plan is saved to the account.
// Signed out, it is kept on this device and saved the moment they create an
// account (ExpatPlanPage picks the draft up). The ask box under it carries a
// question to HOMI, through sign-in if needed, like the homepage's does.

import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { HomatchAsk } from '@/components/home/HomatchAsk';
import { ExpatJourney, ExpatNextStep, type Focus } from '@/components/expats/ExpatJourney';
import { roadmapFor } from '@/expats/plan/roadmap';
import { materialise, type PlanTask } from '@/expats/plan/tasks';
import { EMPTY_PROFILE, type ExpatProfile } from '@/expats/types';
import { saveProfile, writePlan } from '@/services/expats';
import { rememberPendingPath } from '@/services/returnTo';

const DRAFT_KEY = 'homatch.expat.draft.v1';

interface Draft {
  profile: ExpatProfile;
  focus: Focus;
}

export function loadPlanDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return d && d.profile && Array.isArray(d.profile.intents) ? d : null;
  } catch {
    return null;
  }
}

export function clearPlanDraft(): void {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
}

function storeDraft(d: Draft): void {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* storage unavailable */ }
}

/** The plan as live tasks, computed here, so nobody waits for an account to see it. */
function tasksFor(profile: ExpatProfile): PlanTask[] {
  return roadmapFor(profile).map((g) => materialise(g, `draft-${g.templateKey}`));
}

export function ExpatPlanStarter() {
  const { t } = useLanguage();
  const { homatchUser } = useAuth();
  const userId = homatchUser?.id ?? null;

  const [draft, setDraft] = React.useState<Draft | null>(loadPlanDraft);
  const [editing, setEditing] = React.useState(() => loadPlanDraft() === null);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  const tasks = React.useMemo(() => (draft ? tasksFor(draft.profile) : []), [draft]);

  const finish = async (next: ExpatProfile, focus: Focus) => {
    const d = { profile: next, focus };
    setDraft(d);
    setEditing(false);
    if (!userId) {
      storeDraft(d);
      return;
    }
    setSaving(true);
    await saveProfile(userId, next);
    await writePlan(userId, roadmapFor(next));
    clearPlanDraft();
    setSaving(false);
    setSaved(true);
  };

  return (
    <section aria-label={t('expat_journey_title')} className="space-y-6" data-expat-plan-starter>
      {editing || !draft ? (
        <ExpatJourney
          profile={draft?.profile ?? EMPTY_PROFILE}
          saving={saving}
          onDone={(next, focus) => { void finish(next, focus); }}
          onCancel={draft ? () => setEditing(false) : undefined}
        />
      ) : (
        <div>
          <ExpatNextStep tasks={tasks} focus={draft.focus} onEdit={() => setEditing(true)} />
          <div className="mt-4 rounded-2xl border border-border p-5">
            <p className="text-sm text-foreground">{t('expat_starter_count', { n: tasks.length })}</p>
            {userId ? (
              <Link
                to="/for-expats/plan"
                data-expat-starter-open
                className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
              >
                {saved ? t('expat_starter_open_saved') : t('expat_starter_open')}
                <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
              </Link>
            ) : (
              <>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t('expat_starter_save_body')}</p>
                <Link
                  to="/auth/signup"
                  onClick={() => rememberPendingPath('/for-expats/plan')}
                  data-expat-starter-save
                  className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
                >
                  {t('expat_journey_save')}
                  <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                </Link>
              </>
            )}
          </div>
        </div>
      )}

      <HomatchAsk
        variant="card"
        tone="light"
        heading={t('expat_ask_title')}
        placeholder={t('expat_ask_placeholder')}
        actions={[
          { key: 'stay', label: t('expat_ask_stay') },
          { key: 'bank', label: t('expat_ask_bank') },
          { key: 'buy', label: t('expat_ask_buy') },
        ]}
      />
    </section>
  );
}

export default ExpatPlanStarter;

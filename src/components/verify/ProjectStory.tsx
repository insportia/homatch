// HOMATCH Verify — the project's official life as a story.
//
// THE CENTRAL FEATURE (owner, 2026-10-11): how the project evolved, step by
// step, from the earliest concept through permits, amendments and corrected
// figures to the latest approved documentation (projectEvolution.ts). Each
// step says what happened, what was requested, the practical change, whether
// it is final, what it means for a buyer and what stays unverified. Case
// numbers, decision numbers and the files themselves sit in an expandable
// evidence list under each step, opened through the secure viewer.
//
// Visible by default: no accordion around the story. Then the pending
// changes (approved copy as the intro), then where the project stands today
// on four separate lines: construction activity, physical completion,
// official approval and commissioning. The five-stage circle widget that
// repeated "could not be confirmed" is gone (LegalReality.tsx).
//
// Without case records (older reports), the grouped events of
// projectStory.ts are shown as before.

import React from 'react';
import { HardHat, Building2, FileCheck2, KeyRound, ChevronDown, Hourglass, FileStack, BookOpen } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { ProjectStoryView, StoryStage, StoryTrack } from '@/verify/intelligence/projectStory';
import type { EvolutionStep, StepEvidence, StepStatus } from '@/verify/intelligence/projectEvolution';
import { OfficialLink } from './OfficialLink';

const dmy = (iso?: string | null): string | null => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
};
const isolate = (s: string): string => `⁦${s}⁩`;

const TRACK_ICON: Record<StoryTrack, React.ComponentType<{ className?: string }>> = {
  CONSTRUCTION: HardHat,
  COMPLETION: Building2,
  PERMIT: FileCheck2,
  COMMISSIONING: KeyRound,
};
const STAGE_TONE: Record<StoryStage, string> = {
  PROPOSED: 'bg-amber-50 text-amber-900 ring-amber-600/30 dark:bg-amber-950/30 dark:text-amber-100',
  APPROVED: 'bg-emerald-50 text-emerald-900 ring-emerald-700/25 dark:bg-emerald-950/30 dark:text-emerald-100',
  IMPLEMENTED: 'bg-[hsl(222_47%_11%)] text-[hsl(38_92%_62%)] ring-[hsl(38_92%_50%/0.35)]',
  DOCUMENTED: 'bg-muted text-foreground/80 ring-border',
};
const STEP_TONE: Record<StepStatus, string> = {
  APPROVED: 'bg-emerald-50 text-emerald-900 ring-emerald-700/25 dark:bg-emerald-950/30 dark:text-emerald-100',
  PERMIT: 'bg-emerald-50 text-emerald-900 ring-emerald-700/25 dark:bg-emerald-950/30 dark:text-emerald-100',
  CORRECTED: 'bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))] ring-[hsl(var(--gold-border))]',
  RETURNED: 'bg-muted text-foreground/80 ring-border',
  UNDER_REVIEW: 'bg-amber-50 text-amber-900 ring-amber-600/30 dark:bg-amber-950/30 dark:text-amber-100',
  RESPONSE_UNREAD: 'bg-amber-50 text-amber-900 ring-amber-600/30 dark:bg-amber-950/30 dark:text-amber-100',
  NO_DECISION_READ: 'bg-muted text-foreground/80 ring-border',
};
const TRACK_TONE: Record<string, string> = {
  STARTED_DOCUMENTED: 'border-[hsl(var(--gold-border))]',
  COMPLETION_CLAIMED: 'border-[hsl(var(--gold-border))]',
  PERMIT_IN_FORCE: 'border-emerald-600/40',
  COMMISSIONED: 'border-emerald-600/40',
  NO_ACT_SEEN: 'border-amber-500/50',
  NOT_DOCUMENTED: 'border-border',
  PERMIT_UNKNOWN: 'border-border',
};

/** The approved introduction, or the concrete discoveries that replace it. */
export const StoryIntro: React.FC<{ discoveries?: string | null; clean?: (s: string) => string }> = ({ discoveries, clean }) => {
  const { t } = useLanguage();
  const c = clean ?? ((s: string) => s);
  const body = discoveries ? c(discoveries) : t('verify_v6_intro_body');
  return (
    <div className="space-y-2" data-story-intro={discoveries ? 'discoveries' : 'copy'}>
      <h3 className="font-display text-xl font-semibold leading-snug tracking-tight break-words">{t('verify_v6_intro_title')}</h3>
      {body.split(/\n+/).map((p, i) => (
        <p key={i} className="max-w-[68ch] text-[15px] leading-7 text-foreground/90 break-words" dir="auto">{p}</p>
      ))}
    </div>
  );
};

const Evidence: React.FC<{ items: StepEvidence[] }> = ({ items }) => {
  const { t } = useLanguage();
  const rows = items.filter((x) => x.caseRef || x.decisions.length || x.files.length);
  if (!rows.length) return null;
  return (
    <details className="group mt-2" data-step-evidence>
      <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 rounded-lg text-xs font-semibold text-foreground/75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-ink))] [&::-webkit-details-marker]:hidden">
        <FileStack className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t('verify_v6_evidence')}
        <ChevronDown className="h-4 w-4 shrink-0 motion-safe:transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <ul className="mb-1 space-y-2.5 border-s border-dashed border-border ps-3">
        {rows.map((x, i) => (
          <li key={`${x.caseRef ?? 'case'}-${i}`} className="space-y-0.5 text-xs leading-5 text-muted-foreground">
            <p className="break-words">
              {[
                x.caseRef ? t('verify_v6_evidence_case', { ref: isolate(x.caseRef) }) : null,
                dmy(x.filedOn) ? t('verify_v6_evidence_filed', { date: isolate(dmy(x.filedOn)!) }) : null,
                ...x.decisions.map((d) => [t('verify_v6_evidence_decision', { number: isolate(d.number ?? '') }), dmy(d.date) ? isolate(dmy(d.date)!) : null].filter(Boolean).join(' · ')),
              ].filter(Boolean).join(' · ')}
            </p>
            <div className="flex flex-wrap items-center gap-x-3">
              {x.url ? <OfficialLink href={x.url} label={t('verify_v6_evidence_open_case')} /> : null}
              {x.files.map((f, n) => (f.url ? <OfficialLink key={`${f.name}-${n}`} href={f.url} label={f.name} /> : null))}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
};

const Row: React.FC<{ label: string; text: string | null; clean: (s: string) => string; muted?: boolean }> = ({ label, text, clean, muted }) => (text ? (
  <div className="space-y-0.5">
    <dt className="text-2xs font-semibold uppercase tracking-[0.06em] text-[hsl(var(--gold-ink))]">{label}</dt>
    <dd className={`text-sm leading-6 break-words ${muted ? 'text-muted-foreground' : 'text-foreground/90'}`} dir="auto">{clean(text)}</dd>
  </div>
) : null);

const Step: React.FC<{ s: EvolutionStep; clean: (s: string) => string }> = ({ s, clean }) => {
  const { t } = useLanguage();
  const filed = dmy(s.date);
  const decided = dmy(s.decidedOn);
  return (
    <li className="relative" data-evolution-step={s.kind} data-step-status={s.status}>
      <span className="absolute -start-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full bg-[hsl(var(--gold-border))] ring-4 ring-background" aria-hidden="true" />
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {decided || filed ? <bdi dir="ltr" className="text-xs font-medium tabular-nums text-[hsl(var(--gold-ink))]">{decided ?? filed}</bdi> : null}
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ${STEP_TONE[s.status]}`}>{t(`verify_v6_status_${s.status.toLowerCase()}`)}</span>
      </div>
      <h4 className="mt-1 text-base font-semibold leading-6 break-words" dir="auto">{clean(s.title)}</h4>
      <p className="mt-1 text-[15px] leading-7 text-foreground break-words" dir="auto">{clean(s.what)}</p>
      <dl className="mt-2 space-y-2">
        <Row label={t('verify_v6_step_requested')} text={s.requested} clean={clean} />
        <Row label={t('verify_v6_step_changed')} text={s.changed} clean={clean} />
        <Row label={t('verify_v6_step_final')} text={s.final} clean={clean} />
        <Row label={t('verify_v6_step_impact')} text={s.impact} clean={clean} />
        <Row label={t('verify_v6_step_unverified')} text={s.unverified} clean={clean} muted />
      </dl>
      <Evidence items={s.evidence} />
    </li>
  );
};

export const ProjectStory: React.FC<{ view: ProjectStoryView; clean?: (s: string) => string }> = ({ view, clean }) => {
  const { t } = useLanguage();
  const c = clean ?? ((s: string) => s);
  const evo = view.evolution;
  return (
    <div className="space-y-8" data-project-story>
      {evo && evo.steps.length ? (
        <ol className="relative space-y-7 border-s border-border ps-5" aria-label={t('verify_v6_steps_label')} data-evolution>
          {evo.steps.map((s) => <Step key={s.id} s={s} clean={c} />)}
        </ol>
      ) : (
        <ol className="relative space-y-5 border-s border-border ps-5" aria-label={t('verify_fn_story_events_label')}>
          {view.events.map((e) => {
            const from = dmy(e.date);
            const to = dmy(e.endDate);
            return (
              <li key={e.id} className="relative" data-story-event={e.stage}>
                <span className="absolute -start-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full bg-[hsl(var(--gold-border))] ring-4 ring-background" aria-hidden="true" />
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  {from ? <bdi dir="ltr" className="text-xs font-medium tabular-nums text-[hsl(var(--gold-ink))]">{to ? `${from} · ${to}` : from}</bdi> : null}
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ${STAGE_TONE[e.stage]}`}>{t(`verify_fn_stage_${e.stage.toLowerCase()}`)}</span>
                  {e.developerClaim ? <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">{t('verify_fn_story_public_claim')}</span> : null}
                  {e.count > 1 ? <span className="text-2xs text-muted-foreground">{t('verify_fn_story_grouped', { count: String(e.count) })}</span> : null}
                </div>
                <p className="mt-1.5 text-[15px] leading-7 text-foreground break-words" dir="auto">{c(e.what)}</p>
                {e.changed ? <p className="mt-1 text-sm leading-6 text-foreground/80 break-words" dir="auto"><span className="font-medium">{t('verify_fn_story_changed')}</span> {c(e.changed)}</p> : null}
                <p className="mt-1 text-sm leading-6 text-muted-foreground break-words" dir="auto"><span className="font-medium text-foreground/80">{t('verify_fn_story_why')}</span> {c(e.why)}</p>
                {e.evidence.length ? (
                  <details className="group mt-1.5">
                    <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 rounded-lg text-xs font-semibold text-foreground/75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-ink))] [&::-webkit-details-marker]:hidden">
                      {t('verify_fn_story_evidence', { count: String(e.evidence.length) })}
                      <ChevronDown className="h-4 w-4 shrink-0 motion-safe:transition-transform group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <ul className="mb-1 space-y-1 border-s border-dashed border-border ps-3">
                      {e.evidence.map((x, i) => (
                        <li key={i} className="text-xs leading-5 text-muted-foreground">
                          <bdi dir="ltr">{[x.caseRef ? t('verify_v3_case_ref', { ref: x.caseRef }) : null, x.decisionNumber ? t('verify_fn_story_decision', { number: x.decisionNumber }) : null, dmy(x.date)].filter(Boolean).join(' · ')}</bdi>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {/* The latest approved documentation, and exactly which drawings its file set lacks. */}
      {evo?.latest ? (
        <section aria-labelledby="vrx-latest" className="rounded-2xl border border-[hsl(var(--gold-border))] bg-card p-4 sm:p-5" data-latest-approved>
          <h3 id="vrx-latest" className="flex items-center gap-2 text-sm font-semibold break-words">
            <BookOpen className="h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
            {t('verify_v6_latest_title')}
          </h3>
          <p className="mt-1.5 text-sm leading-6 text-foreground/90 break-words" dir="auto">{c(evo.latest.text)}</p>
          {evo.latest.missing ? <p className="mt-1 text-sm leading-6 text-muted-foreground break-words" dir="auto">{c(evo.latest.missing)}</p> : null}
          {evo.latest.evidence ? <Evidence items={[evo.latest.evidence]} /> : null}
        </section>
      ) : null}

      {/* Changes still under consideration: the approved copy, then each application. */}
      {evo && (evo.pending.length || evo.resolved.length) ? (
        <section aria-labelledby="vrx-pending-changes" className="space-y-4" data-pending-changes>
          <h3 id="vrx-pending-changes" className="flex items-center gap-2 font-display text-lg font-semibold leading-snug tracking-tight break-words">
            <Hourglass className="h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
            {t(evo.pending.length ? 'verify_v6_pending_title' : 'verify_v6_resolved_title')}
          </h3>
          {evo.pending.length ? t('verify_v6_pending_body').split(/\n+/).map((p, i) => (
            <p key={i} className="max-w-[68ch] text-[15px] leading-7 text-foreground/90 break-words">{p}</p>
          )) : null}
          {evo.pending.length ? (
            <ol className="relative space-y-7 border-s border-amber-500/40 ps-5">
              {evo.pending.map((s) => <Step key={s.id} s={s} clean={c} />)}
            </ol>
          ) : null}
          {evo.resolved.length ? (
            <p className="text-sm leading-6 text-muted-foreground break-words" data-resolved-pending>
              {t('verify_v6_resolved_note', { count: String(evo.resolved.length), dates: evo.resolved.map((r) => dmy(r.decidedOn)).filter(Boolean).map((d) => isolate(d!)).join(', ') })}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Where it stands today: four things, never merged. */}
      <section aria-labelledby="vrx-today" className="space-y-3">
        <h3 id="vrx-today" className="text-sm font-semibold break-words">{t('verify_v6_status_title')}</h3>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label={t('verify_fn_story_tracks_label')}>
          {view.tracks.map((tr) => {
            const Icon = TRACK_ICON[tr.track];
            return (
              <li key={tr.track} className={`min-w-0 rounded-2xl border-2 bg-card p-4 ${TRACK_TONE[tr.state] ?? 'border-border'}`} data-track={tr.track} data-track-state={tr.state}>
                <p className="flex items-center gap-2 text-sm font-semibold break-words">
                  <Icon className="h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
                  {t(`verify_v6_track_${tr.track.toLowerCase()}`)}
                </p>
                <p className="mt-1.5 text-sm leading-6 text-foreground/85 break-words" dir="auto">{c(tr.text)}</p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
};

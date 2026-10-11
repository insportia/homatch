// HOMATCH Verify — the project's official life as a story.
//
// Three tracks first, never merged: construction on site, permit validity,
// and official commissioning. Then the events (projectStory.ts), duplicate
// administrative steps grouped, each telling what happened, what changed and
// why it matters, with a stage badge. Case and decision numbers sit in an
// expandable evidence list under each event, never in the sentence.

import React from 'react';
import { HardHat, FileCheck2, KeyRound, ChevronDown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { ProjectStoryView, StoryStage, StoryTrack } from '@/verify/intelligence/projectStory';

const dmy = (iso?: string | null): string | null => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
};

const TRACK_ICON: Record<StoryTrack, React.ComponentType<{ className?: string }>> = {
  CONSTRUCTION: HardHat,
  PERMIT: FileCheck2,
  COMMISSIONING: KeyRound,
};
const STAGE_TONE: Record<StoryStage, string> = {
  PROPOSED: 'bg-amber-50 text-amber-900 ring-amber-600/30 dark:bg-amber-950/30 dark:text-amber-100',
  APPROVED: 'bg-emerald-50 text-emerald-900 ring-emerald-700/25 dark:bg-emerald-950/30 dark:text-emerald-100',
  IMPLEMENTED: 'bg-[hsl(222_47%_11%)] text-[hsl(38_92%_62%)] ring-[hsl(38_92%_50%/0.35)]',
  DOCUMENTED: 'bg-muted text-foreground/80 ring-border',
};
const TRACK_TONE: Record<string, string> = {
  STARTED_DOCUMENTED: 'border-[hsl(var(--gold-border))]',
  PERMIT_IN_FORCE: 'border-emerald-600/40',
  COMMISSIONED: 'border-emerald-600/40',
  NO_ACT_SEEN: 'border-amber-500/50',
  NOT_DOCUMENTED: 'border-border',
  PERMIT_UNKNOWN: 'border-border',
};

export const ProjectStory: React.FC<{ view: ProjectStoryView; clean?: (s: string) => string }> = ({ view, clean }) => {
  const { t } = useLanguage();
  const c = clean ?? ((s: string) => s);
  return (
    <div className="space-y-6" data-project-story>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label={t('verify_fn_story_tracks_label')}>
        {view.tracks.map((tr) => {
          const Icon = TRACK_ICON[tr.track];
          return (
            <li key={tr.track} className={`min-w-0 rounded-2xl border-2 bg-card p-4 ${TRACK_TONE[tr.state] ?? 'border-border'}`} data-track={tr.track} data-track-state={tr.state}>
              <p className="flex items-center gap-2 text-sm font-semibold break-words">
                <Icon className="h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
                {t(`verify_fn_story_track_${tr.track.toLowerCase()}`)}
              </p>
              <p className="mt-1.5 text-sm leading-6 text-foreground/85 break-words" dir="auto">{c(tr.text)}</p>
            </li>
          );
        })}
      </ul>

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
    </div>
  );
};

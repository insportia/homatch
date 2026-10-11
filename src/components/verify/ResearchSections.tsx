// HOMATCH VERIFY — what is ready to read, while the rest is still running.
//
// The percentage and the elapsed clock say how the RUN is going. This says
// what has actually been FOUND, section by section, and it is the thing a
// customer waiting eleven minutes was really asking for.
//
// EVERY NUMBER HERE WAS COUNTED SERVER-SIDE
//
// The maturity states and the counters come from research-agent's `sections`
// block, derived from the persisted result. Nothing is inferred from render
// time, so two tabs and a reopened case show the same thing, and a section
// cannot appear ready here while the report disagrees.
//
// PRELIMINARY IS LABELLED PRELIMINARY
//
// That is the entire contract of showing a section early. A reader is told
// which state they are looking at, so "usable now" never quietly becomes
// "final". A section that could not be established says so rather than
// staying blank, because an empty row reads as "still loading" forever.

import './liveMotion.css';
import { useLanguage } from '@/contexts/LanguageContext';
import type { SectionId, SectionMaturity, SectionState, SectionsSnapshot } from '@/verify/sections';

/** Section title keys. Seven already exist as phase labels and are reused. */
const SECTION_LABEL: Record<SectionId, string> = {
  PROPERTY: 'verify_pstep_identity',
  LOCATION: 'verify_pstep_location',
  MARKET: 'verify_pstep_market',
  OFFICIAL: 'verify_pstep_official',
  DEVELOPER: 'verify_pstep_company',
  PARTICIPANTS: 'verify_pstep_participants',
  PUBLIC_CONTEXT: 'verify_section_public_context',
  RISKS: 'verify_section_risks',
  SYNTHESIS: 'verify_pstep_synthesis',
};

const MATURITY_LABEL: Record<SectionMaturity, string> = {
  PENDING: 'verify_maturity_pending',
  PRELIMINARY: 'verify_maturity_preliminary',
  ENRICHING: 'verify_maturity_enriching',
  VERIFIED: 'verify_maturity_verified',
  PARTIAL: 'verify_maturity_partial',
  UNAVAILABLE: 'verify_maturity_unavailable',
};

/**
 * Which counters are worth a customer's attention, and what to call them.
 *
 * Deliberately a subset. The server counts more than this — request counts,
 * cache hits, portal states — and those are operations data, not something a
 * buyer needs while deciding whether a price is fair.
 */
const METRIC_LABEL: Record<string, string> = {
  advertisements: 'verify_metric_advertisements',
  uniqueProperties: 'verify_metric_unique_properties',
  crossPosted: 'verify_metric_cross_posted',
  uncertainDuplicates: 'verify_metric_uncertain_duplicates',
  independentSources: 'verify_metric_independent_sources',
  priceConflicts: 'verify_metric_price_conflicts',
  sourcesChecked: 'verify_metric_sources_checked',
  sourcesConfirmed: 'verify_metric_sources_confirmed',
  sourcesBlocked: 'verify_metric_sources_blocked',
  documentsRetrieved: 'verify_metric_documents',
  nearbyPlaces: 'verify_metric_nearby_places',
  participants: 'verify_metric_participants',
  signals: 'verify_metric_signals',
  complaints: 'verify_metric_complaints',
  conflicts: 'verify_metric_conflicts',
  materialFindings: 'verify_metric_material_findings',
  riskFlags: 'verify_metric_risk_flags',
  directors: 'verify_metric_directors',
  relatedProjects: 'verify_metric_related_projects',
};

const NOTE_LABEL: Record<string, string> = {
  MARKET_ENVELOPE_WIDENED: 'verify_note_market_widened',
  MARKET_TIME_BUDGET_REACHED: 'verify_note_market_time_budget',
  OFFICIAL_SOURCE_NOT_READABLE: 'verify_note_official_not_readable',
  COMPANY_FROM_WEB_RESEARCH_ONLY: 'verify_note_company_web_only',
  UNIT_NOT_INDEPENDENTLY_CONFIRMED: 'verify_note_unit_not_confirmed',
  MARKET_SOURCE_BLOCKED: 'verify_note_market_source_blocked',
  MARKET_SOURCE_RATE_LIMITED: 'verify_note_market_source_blocked',
  MARKET_SOURCE_LOGIN_WALL: 'verify_note_market_source_blocked',
  MARKET_SOURCE_JOIN_REQUIRED: 'verify_note_market_source_blocked',
};

/*
 * PREMIUM, LIVE (owner live run 2026-10-11: "it lags behind what we already
 * found, and I do not like its design").
 *
 * The lag was server-side (the official results only landed when the whole
 * stage ended); the official section now carries each source's own state
 * while it runs. The panel itself is the Verify navy band: a segmented meter
 * of the nine sections, rows that settle in when their state changes, and a
 * gold sweep on whatever is being worked on right now. Reduced motion: still.
 */
const SETTLED: readonly SectionMaturity[] = ['VERIFIED', 'PARTIAL', 'UNAVAILABLE'];
const MOVING: readonly SectionMaturity[] = ['PRELIMINARY', 'ENRICHING'];

function StateIcon({ maturity }: { maturity: SectionMaturity }) {
  const base = 'relative grid h-7 w-7 shrink-0 place-items-center rounded-full';
  if (maturity === 'VERIFIED') {
    return (
      <span className={`${base} bg-[linear-gradient(145deg,#F6D27A,#D9A233)] text-[#14100A] shadow-[0_0_0_3px_rgba(233,185,73,0.15)]`} aria-hidden="true">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5"><path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
    );
  }
  if (maturity === 'PARTIAL') {
    return (
      <span className={`${base} border border-[hsl(38_92%_58%)]/70`} aria-hidden="true">
        <span className="h-3.5 w-3.5 rounded-full bg-[conic-gradient(hsl(38_92%_58%)_0_50%,transparent_50%_100%)]" />
      </span>
    );
  }
  if (maturity === 'UNAVAILABLE') {
    return <span className={`${base} border border-white/15 text-white/40`} aria-hidden="true"><span className="h-0.5 w-3 rounded bg-current" /></span>;
  }
  if (MOVING.includes(maturity)) {
    return (
      <span className={base} aria-hidden="true">
        <span className="absolute inset-0 rounded-full border-2 border-[hsl(38_92%_58%)]/20" />
        <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-[hsl(38_92%_58%)] motion-safe:animate-spin [animation-duration:1.4s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-[hsl(38_92%_58%)] motion-safe:animate-pulse" />
      </span>
    );
  }
  return <span className={`${base} border border-dashed border-white/20`} aria-hidden="true" />;
}

const STATE_TONE: Record<SectionMaturity, string> = {
  VERIFIED: 'border-[hsl(38_92%_58%)]/40 bg-[hsl(38_92%_58%)]/15 text-[hsl(38_92%_70%)]',
  PARTIAL: 'border-[hsl(38_92%_58%)]/30 bg-transparent text-[hsl(38_92%_66%)]',
  UNAVAILABLE: 'border-white/10 bg-transparent text-white/45',
  PENDING: 'border-white/10 bg-transparent text-white/45',
  PRELIMINARY: 'border-white/15 bg-white/5 text-white/80',
  ENRICHING: 'border-white/15 bg-white/5 text-white/80',
};

const SOURCE_DOT: Record<string, string> = {
  DONE: 'bg-[hsl(38_92%_58%)]',
  RUNNING: 'bg-[hsl(38_92%_58%)] motion-safe:animate-pulse',
  QUEUED: 'border border-white/30',
  UNAVAILABLE: 'border border-white/20',
};

function SectionRow({ section }: { section: SectionState }) {
  const { t } = useLanguage();
  const metrics = Object.entries(section.metrics).filter(
    ([key, value]) => typeof value === 'number' && value > 0 && METRIC_LABEL[key],
  ) as Array<[string, number]>;
  const moving = MOVING.includes(section.maturity);

  return (
    <li
      className={`hm-section-settle relative flex items-start gap-3 overflow-hidden rounded-xl border px-3 py-2.5 ${
        moving ? 'hm-live-sweep border-[hsl(38_92%_58%)]/25 bg-white/[0.03]' : 'border-white/[0.07] bg-white/[0.02]'
      }`}
    >
      <StateIcon maturity={section.maturity} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`text-sm font-medium break-words ${section.maturity === 'PENDING' ? 'text-white/55' : 'text-white'}`}>
            {t(SECTION_LABEL[section.id])}
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATE_TONE[section.maturity]}`}>
            {t(MATURITY_LABEL[section.maturity])}
          </span>
        </div>

        {Array.isArray(section.sources) && section.sources.length > 0 && (
          <ul className="space-y-1">
            {section.sources.map((src) => (
              <li key={src.source} className="flex min-w-0 items-center gap-2 text-2xs">
                <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${SOURCE_DOT[src.state] ?? SOURCE_DOT.QUEUED}`} />
                <span className="min-w-0 flex-1 break-words text-white/75">{t(`verify_live_src_${src.source}`)}</span>
                <span className={`shrink-0 ${src.state === 'DONE' ? 'text-[hsl(38_92%_66%)]' : 'text-white/45'}`}>
                  {t(`verify_live_state_${src.state.toLowerCase()}`)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {metrics.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {metrics.map(([key, value]) => (
              <li key={key} className="rounded-full bg-white/[0.06] px-2 py-0.5 text-2xs text-white/60">
                <span className="font-semibold text-white/90 [font-variant-numeric:tabular-nums]">{value}</span>{' '}
                {t(METRIC_LABEL[key])}
              </li>
            ))}
          </ul>
        )}

        {section.notes.map((note) =>
          NOTE_LABEL[note] ? (
            <p key={note} className="text-2xs text-white/50 break-words">
              {t(NOTE_LABEL[note])}
            </p>
          ) : null,
        )}
      </div>
    </li>
  );
}

export interface ResearchSectionsProps {
  sections?: SectionsSnapshot | null;
}

export function ResearchSections({ sections }: ResearchSectionsProps) {
  const { t } = useLanguage();
  if (!sections || !Array.isArray(sections.sections) || sections.sections.length === 0) return null;
  const list = sections.sections;
  const done = list.filter((s) => SETTLED.includes(s.maturity)).length;

  /*
   * Sections that have not started are shown, dimmed, rather than hidden.
   *
   * A list that grows as research proceeds makes the page jump and re-reads
   * badly; a stable list whose rows change state does not. The order is the
   * pipeline's own, so a reader can see what is still ahead.
   */
  return (
    <section
      aria-live="polite"
      aria-label={t('verify_sections_title')}
      className="relative isolate overflow-hidden rounded-2xl border border-white/10 bg-[#0C1119] p-4 text-white shadow-card sm:p-5"
    >
      <span aria-hidden="true" className="pointer-events-none absolute -top-20 start-[-10%] -z-10 h-48 w-72 rounded-full bg-[radial-gradient(closest-side,rgba(233,185,73,0.14),transparent)]" />
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(38_92%_62%)]">{t('verify_sections_title')}</p>
        <p className="text-2xs text-white/55 [font-variant-numeric:tabular-nums]">
          {t('verify_sections_progress', { done: String(done), total: String(list.length) })}
        </p>
      </div>
      {/* One segment per section, lit by its real state. */}
      <div className="mt-2.5 flex gap-1" role="presentation">
        {list.map((s) => (
          <span
            key={s.id}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-700 ${
              s.maturity === 'VERIFIED'
                ? 'bg-[hsl(38_92%_58%)] shadow-[0_0_8px_rgba(233,185,73,0.5)]'
                : s.maturity === 'PARTIAL'
                  ? 'bg-[hsl(38_92%_58%)]/60'
                  : MOVING.includes(s.maturity)
                    ? 'hm-live-sweep bg-[hsl(38_92%_58%)]/30'
                    : s.maturity === 'UNAVAILABLE'
                      ? 'bg-white/20'
                      : 'bg-white/10'
            }`}
          />
        ))}
      </div>
      <ul className="mt-3.5 space-y-2">
        {list.map((section) => (
          // Keyed by state as well: a change of state replays the settle-in.
          <SectionRow key={`${section.id}-${section.maturity}`} section={section} />
        ))}
      </ul>
    </section>
  );
}

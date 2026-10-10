// HOMATCH Verify — the official-history blocks of the report.
//
//   CurrentStatusBlock     the latest confirmed official position, with dates
//   PropertyStoryBlock     the documented history: story chapters as prose
//                          first, then an expandable timeline of grouped
//                          official steps, then what changed (from -> to).
//                          The official visuals moved to VisualExplorer.
//   ResearchTransparency   what was reviewed, in counts — never links
//
// Official TAS visuals are rendered by VisualExplorer.tsx, whose signed-URL
// guard lives in src/verify/visualCatalog.ts. Nothing here renders an image
// or links anywhere.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { ChevronDown } from 'lucide-react';
import { timelineGroups, yearSpan } from '@/verify/reportPresentation';

export interface CurrentStatusView {
  statement: string;
  items: Array<{ label: string; value: string; date?: string; cites?: string[] }>;
}
export interface StoryChapterView {
  key: string;
  title: string;
  period?: string;
  body: string;
  visualIds?: string[];
}
export interface VisualCaptionView {
  visualId: string;
  caption: string;
  explanation: string;
}
/**
 * An official visual as the customer payload carries it. Both shapes are
 * tolerated (see src/verify/visualCatalog.ts): the original
 * { id, role, kind, date, width, height, url } and the rebuilt one with
 * category / scope / block / page / mime / confidence.
 */
export interface OfficialVisualView {
  id: string;
  role?: 'LATEST_RENDER' | 'EARLIEST_RENDER' | 'SUPPORTING' | string;
  kind?: string;
  category?: string;
  scope?: string;
  block?: string | null;
  page?: number | null;
  mime?: string;
  confidence?: number;
  date?: string | null;
  width?: number | null;
  height?: number | null;
  url: string;
}
export interface OfficialHistoryClientView {
  status: {
    state: string;
    since: string | null;
    caseRef: string | null;
    decisionNumber: string | null;
    validUntil: string | null;
    conclusive: boolean;
    caveats: string[];
    pendingCount: number;
  };
  milestones: Array<{ date: string; kind: string; title: string; caseRef: string | null; decisionNumber: string | null; outcome: string | null }>;
  evolution: Array<{ key: string; label: string; block: string | null; from: string; fromDate: string | null; to: string; toDate: string | null }>;
  visuals?: Array<{ id: string; versionStatus: string }>;
  /** Related milestones as one step; the records stay in `milestones`. */
  milestoneGroups?: Array<{ kind: string; outcome: string | null; firstDate: string; lastDate: string; count: number; decisionNumbers: string[] }>;
  /** The professionals the municipal documents name. */
  team?: Array<{ name: string; kind: string; roles: string[]; lastSeen: string | null }>;
  /** Distinct legal states and what establishes each (legalStatus.ts). */
  legal?: Array<{ key: string; status: string; basis: Array<{ caseRef: string | null; decisionNumber: string | null; date: string | null; block: string | null }> }>;
}

const KNOWN_STATES = ['COMMISSIONED', 'PERMITTED', 'PROJECT_APPROVED', 'SUSPENDED', 'CANCELLED', 'APPLICATION_PENDING', 'APPLICATION_REFUSED', 'NOT_ESTABLISHED'];
const KNOWN_KINDS = ['APPLICATION', 'PERMIT', 'APPROVAL', 'AMENDMENT', 'EXTENSION', 'REFUSAL', 'SUSPENSION', 'INSPECTION', 'COMMISSIONING', 'DECISION', 'OTHER'];
const KNOWN_FACTS = ['floors', 'undergroundFloors', 'height', 'units', 'constructionDeadline', 'totalArea', 'landArea', 'buildingFunction', 'K1', 'K2', 'parking', 'buildingClass', 'foundationType', 'structuralScheme'];
const NEGATIVE_STATES = new Set(['SUSPENDED', 'CANCELLED', 'APPLICATION_REFUSED']);

export interface ResearchCoverageView {
  researchedAt?: string | null;
  latestOfficialDocumentDate?: string | null;
  earliestOfficialDocumentDate?: string | null;
  officialCasesReviewed?: number;
  officialStepsReviewed?: number;
  officialAttachmentsRead?: number;
  officialFactsConsolidated?: number;
  officialRecordsDiscovered?: number;
  officialAttachmentsDiscovered?: number;
  officialEvidenceSelectedForSynthesis?: number;
  officialMilestonesShown?: number;
  officialProcessingIncomplete?: boolean;
  marketListingsAnalyzed?: number;
  providers?: Array<{ provider: string; state: string }>;
}

/** Display caps: the server already selects; a stored or oversized payload never floods the page. */
const MAX_MILESTONES = 10;
const MAX_CHANGES = 8;
/** First-strong isolates keep a reference or date in reading order inside RTL text. */
const isolate = (s: string): string => `\u2066${s}\u2069`;

/** A date or range rendered left-to-right inside any locale (RTL safe). */
const Ltr: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <bdi dir="ltr" className={className}>{children}</bdi>
);

const day = (iso?: string | null): string | null => {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
};

const KNOWN_CAVEATS = new Set(['RESPONSES_UNREAD', 'LATER_UNDETERMINED_DECISION', 'PROCESSING_INCOMPLETE', 'PROCESSING_UNVERIFIED', 'CASES_DISAGREE', 'NO_DECISIONS_READ', 'VALIDITY_PASSED']);

const OfficialStateBadge: React.FC<{ h: OfficialHistoryClientView['status'] }> = ({ h }) => {
  const { t } = useLanguage();
  const state = KNOWN_STATES.includes(h.state) ? h.state : 'NOT_ESTABLISHED';
  // "We could not establish a status" is not a finding about the property.
  // The dated items below carry what IS known; no headline about our process.
  if (state === 'NOT_ESTABLISHED') return null;
  // A permit whose own validity date has passed is not "in force" — say so in the headline.
  const expired = state === 'PERMITTED' && h.caveats?.includes('VALIDITY_PASSED');
  // "Provisional: not every document could be read" is only true when a caveat other than an expired date applies.
  const unreadCaveats = (h.caveats ?? []).filter((c) => c !== 'VALIDITY_PASSED');
  const tone = NEGATIVE_STATES.has(state) || expired
    ? 'border-amber-500/50 bg-amber-500/10'
    : state === 'NOT_ESTABLISHED' ? 'border-border bg-card' : 'border-[hsl(38_92%_54%)]/40 bg-[hsl(38_92%_54%)]/10';
  const ref = [h.caseRef, h.decisionNumber ? `№ ${h.decisionNumber}` : null].filter(Boolean).join(' · ');
  return (
    <div className={`rounded-xl border px-4 py-3 space-y-1 ${tone}`}>
      <p className="text-sm font-semibold break-words">{t(expired ? 'verify_ox_state_permit_expired' : `verify_ox_state_${state.toLowerCase()}`)}</p>
      <p className="text-xs text-muted-foreground break-words">
        {[
          day(h.since) ? t('verify_ox_since_date', { date: isolate(day(h.since)!) }) : null,
          ref ? `${t('verify_ox_official_ref')} ${isolate(ref)}` : null,
          day(h.validUntil) ? t('verify_ox_valid_until_date', { date: isolate(day(h.validUntil)!) }) : null,
        ].filter(Boolean).join(' · ')}
      </p>
      {!h.conclusive && unreadCaveats.length ? <p className="text-xs leading-5 text-muted-foreground break-words">{t('verify_ox_not_conclusive')}</p> : null}
      {!h.conclusive && h.caveats?.length ? (
        <ul className="list-disc ps-4 space-y-0.5 text-xs leading-5 text-muted-foreground">
          {h.caveats.filter((c) => KNOWN_CAVEATS.has(c)).map((c) => <li key={c} className="break-words">{t(`verify_ox_caveat_${c.toLowerCase()}`)}</li>)}
        </ul>
      ) : null}
      {h.pendingCount > 0 ? <p className="text-xs leading-5 text-muted-foreground break-words">{t('verify_ox_pending', { count: String(h.pendingCount) })}</p> : null}
    </div>
  );
};

export const CurrentStatusBlock: React.FC<{ status?: CurrentStatusView | null; history?: OfficialHistoryClientView | null; clean: (s: string) => string }> = ({ status, history, clean }) => {
  const { t } = useLanguage();
  const hasHistory = !!history?.status;
  if (!hasHistory && (!status || (!clean(status.statement) && !status.items?.length))) return null;
  return (
    <section aria-labelledby="verify-current-status" className="rounded-2xl border border-border bg-card/50 p-5 sm:p-6 space-y-4">
      <div className="space-y-1">
        <p className="text-2xs uppercase tracking-wider text-[hsl(var(--gold-ink))]">{t('verify_ox_current_kicker')}</p>
        <h3 id="verify-current-status" className="text-base font-semibold tracking-tight break-words">
          {t('verify_ox_current_title')}
        </h3>
      </div>
      {hasHistory ? <OfficialStateBadge h={history!.status} /> : null}
      {status && clean(status.statement) ? <p className="text-[15px] leading-7 text-foreground/90 break-words">{clean(status.statement)}</p> : null}
      {status?.items?.length ? (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {status.items.map((i, n) => (
            <div key={`${i.label}-${n}`} className="min-w-0 rounded-xl border border-border bg-card px-4 py-3">
              <dt className="text-2xs uppercase tracking-wider text-muted-foreground break-words">{clean(i.label)}</dt>
              <dd className="mt-1 text-sm font-semibold break-words">{clean(i.value)}</dd>
              {day(i.date) ? (
                <dd className="mt-0.5 text-2xs text-muted-foreground tabular-nums">
                  {t('verify_ox_as_of_date', { date: day(i.date)! })}
                </dd>
              ) : null}
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
};

const OUTCOMES = ['PERMIT_ISSUED', 'APPROVED', 'AMENDMENT_APPROVED', 'DEADLINE_EXTENDED', 'COMMISSIONED', 'INTERMEDIATE', 'DEFICIENCY', 'REFUSED', 'SUSPENDED', 'CANCELLED'];
const kindKey = (k: string) => `verify_ox_kind_${(KNOWN_KINDS.includes(k) ? k : 'OTHER').toLowerCase()}`;
const refOf = (m: { caseRef?: string | null; decisionNumber?: string | null }) =>
  [m.caseRef, m.decisionNumber ? `№ ${m.decisionNumber}` : null].filter(Boolean).join(' · ');

/**
 * The official steps as a story line: related records told as one step
 * ("Approved change ×4 · 2022–2025"), each expandable to its own records.
 */
const Timeline: React.FC<{ history: OfficialHistoryClientView; clean: (s: string) => string }> = ({ history, clean }) => {
  const { t } = useLanguage();
  const groups = timelineGroups(history.milestones, history.milestoneGroups);
  const [open, setOpen] = React.useState<Set<number>>(() => new Set());
  const [showAll, setShowAll] = React.useState(false);
  if (!groups.length) return null;
  const visible = showAll ? groups : groups.slice(0, MAX_MILESTONES);
  const toggle = (i: number) => setOpen((o) => { const n = new Set(o); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  return (
    <div className="space-y-3">
      <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('verify_ox_milestones')}</p>
      <ol className="relative space-y-1 before:absolute before:inset-y-3 before:start-[7px] before:w-px before:bg-[hsl(38_92%_54%)]/35">
        {visible.map((g, i) => {
          const expandable = g.records.length > 1 || (g.records.length === 1 && !!(g.records[0].title || refOf(g.records[0])));
          const isOpen = open.has(i);
          const span = g.count > 1 ? yearSpan(g.firstDate, g.lastDate) : day(g.firstDate);
          const outcome = g.outcome && OUTCOMES.includes(g.outcome) ? t(`vrx_outcome_${g.outcome.toLowerCase()}`) : null;
          const head = (
            <>
              <span className="absolute start-0 top-[13px] h-[15px] w-[15px] rounded-full border-2 border-[hsl(38_92%_54%)] bg-background" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold leading-6 break-words">
                  {t(kindKey(g.kind))}
                  {g.count > 1 ? <span className="ms-1.5 rounded-full bg-[hsl(var(--gold-soft))] px-1.5 py-0.5 text-2xs font-semibold tabular-nums text-[hsl(var(--gold-ink))]">×{g.count}</span> : null}
                </span>
                <span className="block text-xs leading-5 text-muted-foreground">
                  {span ? <bdi dir="ltr" className="tabular-nums">{span}</bdi> : null}
                  {outcome ? <span>{span ? ' · ' : ''}{outcome}</span> : null}
                </span>
              </span>
            </>
          );
          return (
            <li key={`${g.kind}-${g.firstDate}-${i}`} className="relative">
              {expandable ? (
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggle(i)}
                  className="relative flex min-h-[44px] w-full items-start gap-3 rounded-xl py-1.5 ps-7 pe-2 text-start transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-ink))] motion-reduce:transition-none"
                >
                  {head}
                  <ChevronDown className={`mt-1.5 h-4 w-4 shrink-0 text-muted-foreground motion-safe:transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
              ) : (
                <div className="relative flex min-h-[44px] items-start gap-3 py-1.5 ps-7 pe-2">{head}</div>
              )}
              {expandable && isOpen ? (
                <ul className="mb-2 ms-7 space-y-2 border-s border-dashed border-border ps-4 pt-1">
                  {g.records.map((m, n) => (
                    <li key={`${m.date}-${n}`} className="text-sm">
                      <bdi dir="ltr" className="block text-2xs tabular-nums text-muted-foreground">{day(m.date)}</bdi>
                      {m.title ? <span className="block break-words text-foreground/85" dir="auto">{clean(m.title)}</span> : null}
                      {refOf(m) ? <bdi dir="ltr" className="block text-2xs text-muted-foreground">{refOf(m)}</bdi> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
      {groups.length > MAX_MILESTONES ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="min-h-[44px] rounded-full px-3 text-xs font-medium text-[hsl(var(--gold-ink))] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-ink))]"
        >
          {showAll ? t('vrx_timeline_fewer') : t('vrx_timeline_all', { count: String(groups.length) })}
        </button>
      ) : null}
    </div>
  );
};

/** What changed between versions of the design — only when there is a change. */
const EvolutionList: React.FC<{ items: OfficialHistoryClientView['evolution']; clean: (s: string) => string }> = ({ items, clean }) => {
  const { t } = useLanguage();
  const rows = (items ?? []).filter((e) => clean(e.from) && clean(e.to) && clean(e.from) !== clean(e.to));
  if (!rows.length) return null;
  return (
    <div className="space-y-3">
      <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('verify_ox_changed')}</p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rows.slice(0, MAX_CHANGES).map((e, i) => (
          <li key={`${e.key}-${i}`} className="min-w-0 rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-2xs uppercase tracking-wide text-muted-foreground break-words">
              {KNOWN_FACTS.includes(e.key) ? t(`verify_ox_fact_${e.key.toLowerCase()}`) : clean(e.label)}
              {e.block ? ` · ${clean(e.block)}` : ''}
            </p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="tabular-nums text-muted-foreground line-through decoration-muted-foreground/40" dir="auto">{clean(e.from)}</span>
              <span className="inline-block text-[hsl(var(--gold-ink))] rtl:rotate-180" role="img" aria-label={t('verify_ox_changed_to')}>→</span>
              <span className="font-semibold tabular-nums" dir="auto">{clean(e.to)}</span>
            </p>
            {day(e.toDate) ? <p className="mt-0.5 text-2xs text-muted-foreground"><Ltr>{day(e.toDate)}</Ltr></p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
};

export const PropertyStoryBlock: React.FC<{
  chapters?: StoryChapterView[] | null;
  history?: OfficialHistoryClientView | null;
  clean: (s: string) => string;
}> = ({ chapters, history, clean }) => {
  const story = (chapters ?? []).filter((c) => clean(c.body));
  const hasTimeline = !!(history?.milestones?.length || history?.milestoneGroups?.length);
  const hasEvolution = !!history?.evolution?.length;
  if (!story.length && !hasTimeline && !hasEvolution) return null;

  return (
    <div className="space-y-8">
      {story.length ? (
        <ol className="space-y-7">
          {story.map((c) => (
            <li key={c.key} className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="font-display text-lg font-semibold leading-snug break-words">{clean(c.title)}</h3>
                {c.period ? <Ltr className="text-2xs font-medium tabular-nums text-[hsl(var(--gold-ink))]">{c.period}</Ltr> : null}
              </div>
              {clean(c.body).split(/\n{2,}/).map((p, i) => (
                <p key={i} className="text-[15px] leading-7 text-foreground/90 break-words">{p}</p>
              ))}
            </li>
          ))}
        </ol>
      ) : null}
      {history && hasTimeline ? <Timeline history={history} clean={clean} /> : null}
      {history && hasEvolution ? <EvolutionList items={history.evolution} clean={clean} /> : null}
    </div>
  );
};

export const ResearchTransparency: React.FC<{
  coverage?: ResearchCoverageView | null;
  /** The unit's register coverage, which replaces the registry's raw state. */
  register?: { found: number; read: number } | null;
}> = ({ coverage, register }) => {
  const { t } = useLanguage();
  if (!coverage) return null;
  const chips: Array<{ label: string; value: string }> = [];
  const add = (label: string, n?: number) => {
    if (n) chips.push({ label: t(label), value: String(n) });
  };
  // Everything the run actually read, in one number first: case files,
  // their attachments, the unit's register extracts and market listings.
  const total = (coverage.officialCasesReviewed ?? 0) + (coverage.officialAttachmentsRead ?? 0) + (register?.read ?? 0) + (coverage.marketListingsAnalyzed ?? 0);
  if (total > 0) chips.push({ label: t('verify_ox_rx_total'), value: String(total) });
  if (day(coverage.researchedAt)) chips.push({ label: t('verify_ox_rx_date'), value: day(coverage.researchedAt)! });
  if (day(coverage.latestOfficialDocumentDate)) chips.push({ label: t('verify_ox_rx_latest_doc'), value: day(coverage.latestOfficialDocumentDate)! });
  // The funnel, in order: found → reviewed → read → weighed → shown.
  add('verify_ox_rx_records_found', coverage.officialRecordsDiscovered);
  add('verify_ox_rx_cases', coverage.officialCasesReviewed);
  add('verify_ox_rx_steps', coverage.officialStepsReviewed);
  add('verify_ox_rx_documents', coverage.officialAttachmentsRead);
  add('verify_ox_rx_selected', coverage.officialEvidenceSelectedForSynthesis);
  add('verify_ox_rx_milestones_shown', coverage.officialMilestonesShown);
  add('verify_ox_rx_listings', coverage.marketListingsAnalyzed);
  // The registry is described by what was read from it, when anything was.
  const registerRead = !!register && register.read > 0;
  // No "limits" list (owner, 2026-10-09): what was not read is not written.
  const official = !!coverage.officialCasesReviewed;
  const market = !!coverage.marketListingsAnalyzed;
  if (!official && !market && !chips.length) return null;
  // Describes what was done — never what was not.
  const sentence = official && market ? t('verify_ox_rx_both') : official ? t('verify_ox_rx_official') : market ? t('verify_ox_rx_market') : '';
  return (
    <section aria-labelledby="verify-transparency" className="rounded-2xl border border-border bg-card/40 p-5 space-y-3">
      <h2 id="verify-transparency" className="text-sm font-semibold tracking-tight">{t('verify_ox_rx_title')}</h2>
      {sentence ? <p className="text-sm leading-6 text-muted-foreground break-words">{sentence}</p> : null}
      {chips.length ? (
        <dl className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <div key={c.label} className="min-w-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
              <dt className="inline text-muted-foreground">{c.label}: </dt>
              <dd className="inline font-medium tabular-nums"><Ltr>{c.value}</Ltr></dd>
            </div>
          ))}
        </dl>
      ) : null}
      {registerRead ? (
        <p className="text-xs leading-5 text-muted-foreground break-words">
          {t('vbi_rx_registry', { found: String(register!.found), read: String(register!.read) })}
        </p>
      ) : null}
    </section>
  );
};

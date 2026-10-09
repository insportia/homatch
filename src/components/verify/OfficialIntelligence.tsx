// HOMATCH Verify — the official-history blocks of the report.
//
//   CurrentStatusBlock     the latest confirmed official position, with dates
//   PropertyStoryBlock     the documented history, oldest first, with the
//                          official TAS visuals placed beside the chapter they
//                          explain (never an unrelated gallery)
//   ResearchTransparency   what was reviewed, in counts — never links
//
// Every visual here is an official TAS attachment delivered as a short-lived
// signed URL. Marketplace photos never reach these components. A visual that
// fails to load is removed; the text stands on its own.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';

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
export interface OfficialVisualView {
  id: string;
  role: 'LATEST_RENDER' | 'EARLIEST_RENDER' | 'SUPPORTING' | string;
  kind: string;
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

/* Only signed storage URLs are rendered — a guard, not a style choice. */
const safeVisualUrl = (u: unknown): string | null =>
  typeof u === 'string' && /^https:\/\/[^/]+\/storage\/v1\/object\/sign\//.test(u) ? u : null;

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
        <h2 id="verify-current-status" className="text-base font-semibold tracking-tight break-words">
          {t('verify_ox_current_title')}
        </h2>
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

const VisualFigure: React.FC<{
  v: OfficialVisualView;
  caption?: VisualCaptionView;
  badge?: string;
  clean: (s: string) => string;
  onBroken: (id: string) => void;
}> = ({ v, caption, badge, clean, onBroken }) => {
  const { t } = useLanguage();
  const [open, setOpen] = React.useState(false);
  const url = safeVisualUrl(v.url);
  if (!url) return null;
  const ratio = v.width && v.height ? `${v.width} / ${v.height}` : '16 / 10';
  const label = caption ? clean(caption.caption) : t('verify_ox_visual_default');
  return (
    <figure className="min-w-0 space-y-2">
      {/* A real dialog trigger, so closing returns keyboard focus to this thumbnail. */}
      <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
      <button
        type="button"
        aria-label={t('verify_ox_visual_open', { title: label })}
        className="group relative block w-full overflow-hidden rounded-xl border border-border bg-[hsl(222_47%_11%)] transition-colors hover:border-[hsl(38_92%_54%)]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_54%)]"
        style={{ aspectRatio: ratio }}
      >
        <img
          src={url}
          alt={label}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-full w-full object-contain transition-transform duration-300 motion-safe:group-hover:scale-[1.02]"
          onError={() => onBroken(v.id)}
        />
        {badge ? (
          <span className="absolute start-3 top-3 rounded-full bg-[hsl(222_47%_11%)]/85 px-2.5 py-1 text-2xs font-medium text-[hsl(38_92%_64%)] ring-1 ring-[hsl(38_92%_54%)]/40">
            {badge}
          </span>
        ) : null}
      </button>
      </DialogTrigger>
        {/* Navy stage for the drawing: its own light text tokens, never the page theme's. */}
        <DialogContent className="max-w-[min(96vw,1200px)] border-[hsl(222_30%_22%)] bg-[hsl(222_47%_8%)] p-3 text-[hsl(0_0%_96%)] sm:p-4 [&>button]:text-[hsl(0_0%_96%)] [&>button]:opacity-90">
          <DialogTitle className="pe-8 text-sm font-medium text-[hsl(0_0%_96%)] break-words">{label}</DialogTitle>
          <DialogDescription className="text-xs text-[hsl(220_14%_76%)] break-words">{caption?.explanation ? clean(caption.explanation) : t('verify_ox_visual_note')}</DialogDescription>
          <img src={url} alt={label} referrerPolicy="no-referrer" className="max-h-[78vh] w-full rounded-lg object-contain" />
        </DialogContent>
      </Dialog>
      <figcaption className="space-y-0.5">
        <p className="text-sm font-medium break-words">
          {label}
          {day(v.date) ? <span className="text-2xs font-normal text-muted-foreground tabular-nums"> · <Ltr>{day(v.date)}</Ltr></span> : null}
        </p>
        {caption?.explanation ? <p className="text-xs leading-5 text-muted-foreground break-words">{clean(caption.explanation)}</p> : null}
      </figcaption>
    </figure>
  );
};

const MilestoneList: React.FC<{ items: OfficialHistoryClientView['milestones']; clean: (s: string) => string }> = ({ items, clean }) => {
  const { t } = useLanguage();
  if (!items.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-2xs uppercase tracking-wider text-muted-foreground">{t('verify_ox_milestones')}</p>
      <ol className="space-y-2">
        {items.slice(0, MAX_MILESTONES).map((m, i) => (
          <li key={`${m.date}-${i}`} className="grid grid-cols-[6.75rem_1fr] gap-3 text-sm">
            <Ltr className="whitespace-nowrap tabular-nums text-muted-foreground">{day(m.date)}</Ltr>
            <span className="min-w-0 break-words">
              <span className="font-medium">{t(`verify_ox_kind_${(KNOWN_KINDS.includes(m.kind) ? m.kind : 'OTHER').toLowerCase()}`)}</span>
              {m.title ? <span className="text-foreground/80"> — {clean(m.title)}</span> : null}
              {m.caseRef || m.decisionNumber ? (
                <Ltr className="block text-2xs text-muted-foreground">{[m.caseRef, m.decisionNumber ? `№ ${m.decisionNumber}` : null].filter(Boolean).join(' · ')}</Ltr>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
};

const EvolutionList: React.FC<{ items: OfficialHistoryClientView['evolution']; clean: (s: string) => string }> = ({ items, clean }) => {
  const { t } = useLanguage();
  if (!items.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-2xs uppercase tracking-wider text-muted-foreground">{t('verify_ox_changed')}</p>
      <ul className="space-y-1.5">
        {items.slice(0, MAX_CHANGES).map((e, i) => (
          <li key={`${e.key}-${i}`} className="text-sm break-words">
            <span className="font-medium">{KNOWN_FACTS.includes(e.key) ? t(`verify_ox_fact_${e.key.toLowerCase()}`) : clean(e.label)}</span>
            {e.block ? <span className="text-muted-foreground"> ({clean(e.block)})</span> : null}
            {': '}
            <span className="tabular-nums">{clean(e.from)}</span>
            <span aria-hidden="true"> → </span>
            <span className="sr-only"> {t('verify_ox_changed_to')} </span>
            <span className="tabular-nums font-medium">{clean(e.to)}</span>
            {day(e.toDate) ? <span className="text-2xs text-muted-foreground"> · <Ltr>{day(e.toDate)}</Ltr></span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
};

export const PropertyStoryBlock: React.FC<{
  chapters?: StoryChapterView[] | null;
  visuals?: OfficialVisualView[] | null;
  captions?: VisualCaptionView[] | null;
  history?: OfficialHistoryClientView | null;
  clean: (s: string) => string;
}> = ({ chapters, visuals, captions, history, clean }) => {
  const { t } = useLanguage();
  const [broken, setBroken] = React.useState<Set<string>>(() => new Set());
  const onBroken = React.useCallback((id: string) => setBroken((b) => new Set(b).add(id)), []);
  const story = (chapters ?? []).filter((c) => clean(c.body));
  const usable = (visuals ?? []).filter((v) => safeVisualUrl(v.url) && !broken.has(v.id)).slice(0, 6);
  const milestones = history?.milestones ?? [];
  const evolution = history?.evolution ?? [];
  if (!story.length && !usable.length && !milestones.length && !evolution.length) return null;
  // A render is "the latest APPROVED design" only when its own case carries
  // the latest approving decision; otherwise it is the latest submitted one.
  const versionOf = (id: string) => history?.visuals?.find((v) => v.id === id)?.versionStatus ?? 'UNDETERMINED';

  const captionFor = (id: string) => (captions ?? []).find((c) => c.visualId === id);
  const latest = usable.find((v) => v.role === 'LATEST_RENDER');
  const earliest = usable.find((v) => v.role === 'EARLIEST_RENDER');
  const comparison = latest && earliest ? { latest, earliest } : null;

  // Each visual appears ONCE: where the story placed it, else by its own
  // chapter hint, else after the last chapter. The two renders of a
  // comparison are shown together, in the chapter of the earlier one.
  const placed = new Map<string, string[]>();
  const used = new Set<string>();
  const place = (chapterKey: string, id: string) => {
    if (used.has(id)) return;
    used.add(id);
    placed.set(chapterKey, [...(placed.get(chapterKey) ?? []), id]);
  };
  if (comparison && story.length) {
    const host = story.find((c) => c.visualIds?.includes(comparison.earliest.id))?.key ?? story[0].key;
    used.add(comparison.latest.id);
    used.add(comparison.earliest.id);
    placed.set(host, ['__comparison__']);
  }
  for (const c of story) for (const id of c.visualIds ?? []) if (usable.some((v) => v.id === id)) place(c.key, id);
  const lastKey = story.length ? story[story.length - 1].key : '__none__';
  for (const v of usable) if (!used.has(v.id)) place(lastKey, v.id);

  const renderVisuals = (key: string) =>
    (placed.get(key) ?? []).map((id) =>
      id === '__comparison__' && comparison ? (
        <div key="cmp" className="space-y-2">
          <p className="text-2xs uppercase tracking-wider text-muted-foreground">{t('verify_ox_evolution_title')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <VisualFigure v={comparison.earliest} caption={captionFor(comparison.earliest.id)} badge={t('verify_ox_original')} clean={clean} onBroken={onBroken} />
            <VisualFigure
              v={comparison.latest}
              caption={captionFor(comparison.latest.id)}
              badge={t(versionOf(comparison.latest.id) === 'CURRENT_APPROVED' ? 'verify_ox_latest' : 'verify_ox_latest_submitted')}
              clean={clean}
              onBroken={onBroken}
            />
          </div>
        </div>
      ) : (
        (() => {
          const v = usable.find((x) => x.id === id);
          return v ? <VisualFigure key={id} v={v} caption={captionFor(id)} clean={clean} onBroken={onBroken} /> : null;
        })()
      ),
    );

  return (
    <section aria-labelledby="verify-story" className="space-y-5">
      <div className="space-y-1">
        <p className="text-2xs uppercase tracking-wider text-[hsl(var(--gold-ink))]">{t('verify_ox_story_kicker')}</p>
        <h2 id="verify-story" className="text-base font-semibold tracking-tight break-words">{t('verify_ox_story_title')}</h2>
      </div>
      <MilestoneList items={milestones} clean={clean} />
      <EvolutionList items={evolution} clean={clean} />
      {story.length ? (
        <ol className="relative space-y-6 border-s border-[hsl(38_92%_54%)]/30 ps-5">
          {story.map((c) => (
            <li key={c.key} className="relative space-y-3">
              <span aria-hidden="true" className="absolute -start-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-[hsl(38_92%_54%)] ring-4 ring-background" />
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-sm font-semibold break-words">{clean(c.title)}</h3>
                {c.period ? <Ltr className="text-2xs text-muted-foreground tabular-nums">{c.period}</Ltr> : null}
              </div>
              {clean(c.body).split(/\n{2,}/).map((p, i) => (
                <p key={i} className="text-[15px] leading-7 text-foreground/90 break-words">{p}</p>
              ))}
              {renderVisuals(c.key)}
            </li>
          ))}
        </ol>
      ) : (
        <div className="space-y-4">{renderVisuals('__none__')}</div>
      )}
      <p className="text-2xs leading-relaxed text-muted-foreground break-words">{t('verify_ox_visual_note')}</p>
    </section>
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

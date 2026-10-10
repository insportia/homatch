// HOMATCH — the customer's Buyer Intelligence Report.
//
// V3: THE LENGTH PROBLEM WAS A SHAPE PROBLEM
//
// The report was accurate and unreadable. Not because it held too much — the
// buyer wants that research — but because all of it was the same shape:
// paragraphs, in a column, with the decisive numbers buried mid-sentence. So
// this version gives the renderer more to do.
//
//   - A SUMMARY the customer reads in fifteen seconds: one overall view and
//     three to six highlights, each with its own dimension and sentiment.
//   - KEY FINDINGS as a shortlist, each carrying why it matters.
//   - METRIC CHIPS lifted out of prose as structured data. Not by regexing
//     model sentences — that emphasises the wrong half and breaks the moment
//     the wording changes — but because the model names them as metrics.
//   - A COMPANY block that DRAWS the relationship rather than describing it,
//     including ownership when the evidence supports it.
//
// And one deletion: the pre-purchase checklist is gone. Not renamed —
// removed. It had become a bin for every field the pipeline failed to fill,
// so a reader got six near-identical "confirm before signing" lines with no
// way to tell which mattered. Advice now sits in the section that gives it
// meaning.
//
// EARLIER, AND STILL TRUE
//
// The previous version already dropped the card grid for an editorial column.
// Reading real reports it produced showed the remaining problems were about
// what the page CHOSE to show, not how it was styled:
//
//   - a provenance chip under every paragraph ("საჯარო რეესტრი",
//     "დეველოპერი", "MyHome") which broke the reading rhythm and put portal
//     names in front of a buyer trying to read prose;
//   - a dedicated "what we could not confirm" block, which made our own
//     pipeline's gaps a headline section of the customer's report;
//   - buyer actions rendered as a bare "1 2 3" with no labels;
//   - every fact carried in prose, so the basics were buried.
//
// So: sources move ENTIRELY into the evidence drawer, the deficit block is
// gone (incomplete checks arrive as forward-looking actions instead), actions
// are titled, and the property's basics are a scannable snapshot at the top.
// Added below the narrative: a price-position bar, the people connected to
// the property, and the official checks the buyer can run themselves.
//
// Nothing here decides anything. Every sentence was produced and grounded
// server-side; this component only decides how it looks.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { BuyerChecklist } from './EvidenceSources';
import type { EvidenceGroup } from '@/verify/intelligence/evidenceGroups';
import type { ChecklistItem } from '@/verify/intelligence/buyerChecklist';
import { ContractUpload } from './ContractUpload';
import { VerifyLinkedContracts } from './VerifyLinkedContracts';
import { Button } from '@/components/ui/button';
import { FileText, Copy, Check, MapPin, Users } from 'lucide-react';
import {
  CurrentStatusBlock,
  PropertyStoryBlock,
  type CurrentStatusView,
  type StoryChapterView,
  type VisualCaptionView,
  type OfficialVisualView,
  type ResearchCoverageView,
  type OfficialHistoryClientView,
} from './OfficialIntelligence';
import { readable } from '@/verify/readableText';
import { buyerOpening } from '@/verify/intelligence/buyerSummary';
import { stripInternalTerms } from '@/verify/intelligence/marketNarrative';
import { scrubCoverageLanguage } from '@/verify/intelligence/coverageGap';
import { severitySignals, weighVerdict } from '@/verify/intelligence/severity';
import { CompanyIntelligenceCard, type CompanyProfileLike } from './CompanyIntelligenceCard';
import { UtilitiesCard, type UtilitiesLike } from './UtilitiesCard';
import { DeveloperAdvertising, type AdvertisingAssessmentView } from './DeveloperAdvertising';
import type { DeveloperAdsView } from '@/verify/developerAds';
import { BuyerBottomLine } from './BuyerBottomLine';
import { PropertyRegisterCard, CompanyFinanceCard, ReportNav, ResearchScaleBanner } from './BuyerIntelligenceCards';
import type { PropertyRegister } from '@/verify/intelligence/propertyRegister';
import type { PropertyIdentity } from '@/verify/intelligence/propertyIdentity';
import { Reveal } from '@/components/common/Reveal';
import { VisualExplorer } from './VisualExplorer';
import { LegalReality, IdentityNotice } from './LegalReality';
import { PeopleBehind } from './PeopleBehind';
import { MarketPosition } from './MarketPosition';
import { chapterOfSection, identityNotice, SECTION_HEADING_KEY, type ChapterId } from '@/verify/reportPresentation';
import type { CompanyFinanceView, MarketContextView, ProjectTeamMember } from '@/verify/intelligence/reportGaps';
import { splitCitations, hasDistance } from '@/verify/citations';

export type OverallLabel = 'POSITIVE' | 'BALANCED' | 'NEEDS_ATTENTION';
export type Sentiment = 'POSITIVE' | 'BALANCED' | 'ATTENTION';

export interface EvidenceRef {
  id: string;
  claim: string;
  provenance: string;
  certainty: string;
  source?: string;
  url?: string;
  date?: string;
}

export interface PropertySnapshot {
  cadastralCode?: string; propertyType?: string; project?: string; address?: string;
  district?: string; area?: string; floor?: string; rooms?: string; unitNumber?: string;
  condition?: string; owner?: string; developer?: string; constructionStatus?: string;
  parking?: string; amenities?: string[];
}

export interface MarketTier {
  tier: string; median: number; min: number; max: number; count: number;
  /** Too few listings to characterise this band on its own. */
  thin?: boolean;
}

export interface MarketBlock {
  currency: string; median: number; mean: number; min: number; max: number; count: number;
  basis: string; basisCount: number;
  subjectPricePerSqm?: number; deltaFromMedianPct?: number; positioning?: string;
  /** Same project / same street / district / peer projects, when researched. */
  tiers?: MarketTier[];
  /** Evidence-backed reasons a premium or discount may be rational. */
  qualityFactors?: { factor: string; direction: 'SUPPORTS_PREMIUM' | 'SUPPORTS_DISCOUNT' }[];
  /** The whole comparison rests on one or two asking prices, not a spread. */
  basisIsThin?: boolean;
}

export interface PersonBlock {
  name: string; role: string; entity?: string; representation: string;
  certainty: string; historical: boolean; asOf?: string;
  /** Every role held at this entity — a director is often also a partner. */
  roles?: string[];
  /** Only ever present when the register actually stated it. */
  ownershipPct?: number;
}

export interface SelfCheck {
  kind: 'PROPERTY_EXTRACT' | 'TAXPAYER_REGISTRY';
  url: string; copyValue: string; copyLabel: string; contextValue?: string;
}

export interface SummaryHighlight {
  dimension: string;
  sentiment: Sentiment;
  headline: string;
  detail: string;
  cites: string[];
}

export interface KeyFinding {
  finding: string;
  whyItMatters: string;
  sentiment: Sentiment;
  cites: string[];
}

export interface BuyerIntelligence {
  /** What the developer's advertising suggests — guarded against official claims. */
  advertisingAssessment?: AdvertisingAssessmentView;
  summary: { label: OverallLabel; statement: string; highlights: SummaryHighlight[] };
  /** Latest confirmed official position (present tense). */
  currentStatus?: CurrentStatusView;
  /** Documented history, oldest first. */
  propertyStory?: { chapters: StoryChapterView[] };
  /** One caption per official TAS visual (legacy; visualExplanations supersedes it). */
  visualCaptions?: VisualCaptionView[];
  /** Per-visual reading: what it shows, what is interesting, what it means, what is uncertain. */
  visualExplanations?: Array<{ id: string; what: string; interesting: string; buyerMeaning: string; uncertain: string }>;
  keyFindings: KeyFinding[];
  sections: {
    key: string; title: string; body: string;
    metrics?: { label: string; value: string }[];
    cites: string[];
  }[];
  attentionPoints: { point: string; why: string; cites: string[] }[];
  nextSteps?: { step: string; why: string; cites: string[] }[];
  finalView: string;
  contractUpload: { recommend: boolean; text: string };
}

/**
 * A place a source actually named near the property.
 *
 * There is no distance and no travel time, because this pipeline has a
 * geocoder at neither end. `note` carries whatever relative context a source
 * literally stated and nothing else, and `whyKey` is a translation key rather
 * than prose — the reason a pharmacy matters is the same sentence every time.
 */
export interface NearbyPlaceBlock {
  category: string;
  name: string;
  note?: string | null;
  whyKey: string;
}

export interface LocationBlock {
  city?: string;
  district?: string;
  street?: string;
  profile?: { district: string; character: string; likelyResidents: string[]; context: string[] };
  nearby: NearbyPlaceBlock[];
  minimal: boolean;
}

export interface VerifySynthesis {
  report: BuyerIntelligence | null;
  evidence?: EvidenceRef[];
  snapshot?: PropertySnapshot;
  market?: MarketBlock | null;
  /*
   * THE LAST BROKEN LINK IN LOCATION & LIVING.
   *
   * verify-synthesis has been sending this block for as long as it has
   * existed. It was absent from this type, so nothing downstream could read
   * it and no component ever rendered it — the whole feature reached the
   * browser and stopped there.
   */
  location?: LocationBlock | null;
  people?: { people?: PersonBlock[]; representationNote?: string };
  selfChecks?: SelfCheck[];
  /* Computed deterministically in the bundle — see evidenceGroups.ts and
     buyerChecklist.ts. Present whenever the underlying evidence is, whatever
     the model chose to cite. */
  evidenceGroups?: EvidenceGroup[];
  checklist?: ChecklistItem[];
  mode?: 'MODEL' | 'DETERMINISTIC';
  empty?: boolean;
  /** Official TAS visuals, as short-lived signed URLs (never marketplace photos). */
  officialVisuals?: OfficialVisualView[];
  /** What was reviewed, as counts — the report shows no source links. */
  research?: ResearchCoverageView;
  /** Deterministic official history: status, milestones, value changes. */
  officialHistory?: OfficialHistoryClientView | null;
  /** Developer advertising (Meta Ad Library), a marketing signal only. */
  developerAds?: DeveloperAdsView | null;
  /** The unit's own NAPR extract, parsed (see propertyRegister.ts). */
  propertyRegister?: PropertyRegister | null;
  /** The developer's financial position from what was actually checked. */
  companyFinance?: CompanyFinanceView | null;
  projectTeam?: ProjectTeamMember[] | null;
  /** A reused market snapshot, when the run gathered no comparables of its own. */
  marketContext?: MarketContextView | null;
  /** Which unit, building and parcel the records actually concern (propertyIdentity.ts). */
  identity?: PropertyIdentity | null;
}

/**
 * The order a buyer reads the report in.
 *
 * Deliberately a literal rather than an import from the synthesis module: it
 * is the ORDER that must stay stable here, and this list also has to name
 * keys that module no longer knows about.
 */
const READING_ORDER = ['SNAPSHOT', 'PROJECT', 'QUALITY', 'LOCATION', 'INFRASTRUCTURE', 'MARKET', 'PEOPLE'];

function orderForReading<T extends { key: string }>(sections: T[]): T[] {
  const rank = (k: string) => {
    const i = READING_ORDER.indexOf(k);
    return i === -1 ? READING_ORDER.length : i;
  };
  return [...sections].sort((a, b) => rank(a.key) - rank(b.key));
}

const OVERALL_KEY: Record<OverallLabel, string> = {
  POSITIVE: 'verify_ir_overall_positive',
  BALANCED: 'verify_ir_overall_balanced',
  NEEDS_ATTENTION: 'verify_ir_overall_attention',
};

/*
 * Restrained on purpose.
 *
 * A report that is mostly good should not be a wall of green, and ATTENTION
 * must not read as danger — it means "look at this", and most things worth
 * looking at are neither good nor bad. So the difference between the three
 * states is a border and a small dot, not a filled colour block.
 */
const SENTIMENT_STYLE: Record<Sentiment, { dot: string; edge: string }> = {
  POSITIVE: { dot: 'bg-emerald-500/80', edge: 'border-s-emerald-500/50' },
  BALANCED: { dot: 'bg-muted-foreground/50', edge: 'border-s-border' },
  ATTENTION: { dot: 'bg-amber-500/80', edge: 'border-s-amber-400/70' },
};

const sentimentOf = (v: unknown): Sentiment =>
  v === 'POSITIVE' || v === 'ATTENTION' ? v : 'BALANCED';

/*
 * Evidence ids belong in `cites`, never in a sentence. The prompt says so,
 * and a live report still came back with "(e7, e8)" in the body — so the
 * boundary strips them too. A model instruction is a request; this is the
 * control.
 */
const stripEvidenceIds = (text: string): string =>
  text
    .replace(/\s*[([]\s*e\d+(?:\s*,\s*e\d+)*\s*[)\]]/gi, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();

/*
 * THE ONE GATE EVERY CUSTOMER-FACING STRING PASSES THROUGH.
 *
 * Evidence ids are stripped here for exactly the reason internal vocabulary
 * now is: the prompt asks the model not to emit them, a live report emitted
 * them anyway, and a model instruction is a request while this is a control.
 *
 * „37 აქტიური განცხადების peer-project შედარებაში..." is in the stored Villion
 * report in production today. Scrubbing at render repairs every report already
 * in the database, which no prompt change can reach.
 */
const clean = (s: unknown): string =>
  scrubCoverageLanguage(
    stripInternalTerms(stripEvidenceIds(readable(splitCitations(typeof s === 'string' ? s : '').text)))
  );

const paragraphs = (text: string): string[] =>
  clean(text).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

const Prose: React.FC<{ text: string }> = ({ text }) => (
  <>
    {paragraphs(text).map((p, i) => (
      <p key={i} className="text-[15px] leading-7 text-foreground/90 break-words" dir="auto">{p}</p>
    ))}
  </>
);

export function VerifyReport({
  synthesis,
  evidence,
  contractCaseId,
  company,
  rights,
  utilities,
}: {
  synthesis: VerifySynthesis;
  /*
   * THE REGISTRY-GRADE BLOCKS, PASSED IN FROM THE RAW RESULT.
   *
   * companyProfile, rightsAndRestrictions and utilitiesMatrix are produced by
   * the research core and persisted in result_json. The synthesis carries no
   * `company` key at all, so for the stored Villion report every one of these
   * facts existed and none of them could reach the page. Taking them as props
   * means the improvement applies to reports stored months ago, which is the
   * requirement: the acceptance fixture is a report nobody may re-run.
   */
  company?: CompanyProfileLike | null;
  rights?: { status?: unknown; items?: unknown; statement?: unknown } | null;
  utilities?: UtilitiesLike | null;
  /** The full research detail, rendered inside the collapsed control. */
  evidence?: React.ReactNode;
  /*
   * The verification case a contract should be attached to, when one already
   * exists. Null is normal and correct: the uploader creates the case itself
   * on the first contract, which is why this replaced an `onUploadContract`
   * callback that only ever navigated somewhere else.
   */
  contractCaseId?: string | null;
}) {
  const { t } = useLanguage();
  const r = synthesis.report;

  if (!r) {
    return (
      <div className="mx-auto max-w-[68ch] space-y-4">
        <p className="text-sm text-muted-foreground break-words">{t('verify_ir_empty')}</p>
        {evidence ? <EvidenceDrawer>{evidence}</EvidenceDrawer> : null}
      </div>
    );
  }

  /* THE ORDER IS PART OF THE REPORT.
   *
   * report.ts sorts what it writes, but the database is full of reports
   * written before it did — and a section key it no longer emits at all, like
   * the old standalone LEGAL block. Those are still what their customers were
   * given, so they are shown rather than dropped: placed by chapterOfSection()
   * (LEGAL in Legal reality, anything unknown with the final perspective),
   * under the heading they had.
   *
   * The model's SNAPSHOT prose restates the structured snapshot, so it is
   * dropped when the snapshot is present; its METRICS are kept and move into
   * the building chapter where numbers belong.
   */
  const allSections = (r.sections ?? []).filter((s) => clean(s.body));
  const snapshotSection = allSections.find((s) => s.key === 'SNAPSHOT');
  const sections = orderForReading(
    synthesis.snapshot ? allSections.filter((s) => s.key !== 'SNAPSHOT') : allSections
  );
  const snapshotMetrics = synthesis.snapshot ? (snapshotSection?.metrics ?? []) : [];
  const inChapter = (c: ChapterId) => sections.filter((s) => chapterOfSection(s.key) === c);
  const people = (synthesis.people?.people ?? []).slice(0, 6);
  /* Which section the evidenced places belong under. LOCATION when the model
     wrote one, otherwise INFRASTRUCTURE, otherwise neither and the block
     stands on its own in the location chapter. */
  const locationHost =
    (['LOCATION', 'INFRASTRUCTURE'] as const).find((k) => sections.some((s) => s.key === k)) ?? null;
  const findings = (r.keyFindings ?? []).filter((f) => clean(f.finding));

  /*
   * THE VERDICT, WEIGHED RATHER THAN COUNTED.
   *
   * Driven by the structured evidence the research core persists, so the same
   * property scores the same twice and a thin crawl scores nothing at all.
   */
  const weighed = weighVerdict(severitySignals({
    rights: rights as never,
    company: company as never,
    snapshot: synthesis.snapshot as never,
    highlights: r.summary?.highlights ?? [],
  }));

  const history = synthesis.officialHistory ?? null;
  const identity = synthesis.identity ?? null;
  const identityUnresolved = identity?.status === 'UNRESOLVED_MISMATCH';
  const renderSection = (s: { key: string; title: string; body: string; metrics?: { label: string; value: string }[] }) => (
    <section key={s.key} className="space-y-3" data-section={s.key}>
      <h3 className="font-display text-lg font-semibold leading-snug tracking-tight break-words">
        {clean(s.title) || t(SECTION_HEADING_KEY[s.key] ?? 'vrx_section_more')}
      </h3>
      {/* Decision-relevant numbers, pulled out of the paragraph so a
          scanning reader meets them first. */}
      {s.metrics?.length ? <Metrics metrics={s.metrics} /> : null}
      <div className="max-w-[68ch] space-y-4"><Prose text={s.body} /></div>
      {/* Under whichever of the two location sections the model actually
          wrote, so the evidenced places sit with the prose about them. */}
      {s.key === locationHost && synthesis.location ? (
        <LocationLiving l={synthesis.location} />
      ) : null}
    </section>
  );

  /* What each chapter has to say. A chapter with nothing is not drawn. */
  const has = {
    explore: true,
    story: !!(r.propertyStory?.chapters?.some((c) => clean(c.body)) || history?.milestones?.length || history?.milestoneGroups?.length || history?.evolution?.length),
    people: !!(inChapter('people').length || people.length || history?.team?.length || synthesis.projectTeam?.length || synthesis.snapshot?.developer || synthesis.companyFinance?.financingPartner || (synthesis.developerAds && ['COMPLETE', 'CACHED'].includes(synthesis.developerAds.outcome))),
    building: true,
    legal: !!(history?.legal?.length || history?.status || r.currentStatus || synthesis.propertyRegister?.latest || company || rights || synthesis.companyFinance || r.attentionPoints?.length || inChapter('legal').length || !!identityNotice(identity)),
    location: !!(inChapter('location').length || synthesis.location),
    market: inChapter('market').length > 0,
    final: true,
  };
  const order: ChapterId[] = ['explore', 'story', 'people', 'building', 'legal', 'location', 'market', 'final'];
  const shown = order.filter((c) => has[c as keyof typeof has]);
  const num = (c: ChapterId) => shown.indexOf(c) + 1;

  /* The chapters this report actually has, for the jump links. */
  const nav = [
    { id: 'vbi-summary', labelKey: 'vbi_nav_summary' },
    ...shown.map((c) => ({ id: `vbi-${c}`, labelKey: `vrx_nav_${c}` })),
  ];

  return (
    <article className="vrx mx-auto w-full max-w-[56rem] space-y-12 sm:space-y-16">
      <ReportNav items={nav} />

      {/* ── FIRST IMPRESSION ── what this is, and what to know first. */}
      <div id="vbi-summary" className="scroll-mt-24 space-y-6">
        <SummaryHero summary={r.summary} weighed={weighed} snapshot={synthesis.snapshot} />
        {findings.length ? <KeyFindings findings={findings} /> : null}
        {/* How much was read — told once, compactly, under the verdict. */}
        <ResearchScaleBanner
          coverage={synthesis.research}
          register={synthesis.propertyRegister?.coverage ?? null}
          adsSeen={synthesis.developerAds ? (synthesis.developerAds.activeCount ?? 0) + (synthesis.developerAds.historicalCount ?? 0) : null}
          sources={(synthesis.evidenceGroups ?? []).reduce((n: number, g: any) => n + (Array.isArray(g?.items) ? g.items.length : 0), 0) || null}
        />
      </div>

      {/* ── EXPLORE THE PROPERTY ── the official visuals, labelled. */}
      <Chapter id="vbi-explore" n={num('explore')} kicker={t('vrx_explore_kicker')} title={t('vrx_explore_title')} lede={t('vrx_explore_lede')}>
        <VisualExplorer
          visuals={synthesis.officialVisuals as unknown[] | undefined}
          explanations={r.visualExplanations as unknown[] | undefined}
          captions={r.visualCaptions as unknown[] | undefined}
          identityUnresolved={identityUnresolved}
          history={history}
          clean={clean}
        />
      </Chapter>

      {/* ── THE STORY ── prose first, then the grouped official timeline. */}
      {has.story ? (
        <Chapter id="vbi-story" headingId="verify-story" n={num('story')} kicker={t('verify_ox_story_kicker')} title={t('verify_ox_story_title')}>
          <PropertyStoryBlock chapters={r.propertyStory?.chapters} history={history} clean={clean} />
        </Chapter>
      ) : null}

      {/* ── THE PEOPLE BEHIND IT ── */}
      {has.people ? (
        <Chapter id="vbi-people" n={num('people')} kicker={t('vrx_people_kicker')} title={t('vrx_people_title')}>
          <PeopleBehind
            team={history?.team}
            projectTeam={synthesis.projectTeam}
            developer={synthesis.snapshot?.developer ?? (company && typeof company.name === 'string' ? company.name : null)}
            financingPartner={synthesis.companyFinance?.financingPartner ?? null}
          />
          {inChapter('people').map(renderSection)}
          {/* The company the people belong to — participants are context and
              must not vanish just because the prose did not reach them. */}
          {people.length ? (
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold break-words">
                <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {t('verify_ir_people_title')}
              </h3>
              <CompanyGraph people={people} owner={synthesis.snapshot?.developer} />
              {synthesis.people?.representationNote ? (
                <p className="text-sm leading-6 text-muted-foreground break-words">
                  {readable(synthesis.people.representationNote)}
                </p>
              ) : null}
            </div>
          ) : null}
          {/* What the developer says about the project — labelled as a claim.
              Absent unless the stage completed. */}
          <DeveloperAdvertising view={synthesis.developerAds} assessment={r.advertisingAssessment} />
        </Chapter>
      ) : null}

      {/* ── THE BUILDING ── project and quality prose, the basics, utilities. */}
      <Chapter id="vbi-building" n={num('building')} kicker={t('vrx_building_kicker')} title={t('vrx_building_title')}>
        {inChapter('building').map(renderSection)}
        {synthesis.snapshot ? <Snapshot s={synthesis.snapshot} /> : null}
        {/* The dropped SNAPSHOT section's own figures, kept where figures belong. */}
        {snapshotMetrics.length ? <Metrics metrics={snapshotMetrics} /> : null}
        {/* Rendered even when the run established nothing: a missing section
            reads as "does not apply", a row saying "not yet verified" reads
            as the question it actually is. */}
        <UtilitiesCard utilities={utilities} />
      </Chapter>

      {/* ── LEGAL REALITY ── the five legal states, today's official position,
          the register, the company — and what deserves attention, once. */}
      {has.legal ? (
        <Chapter id="vbi-legal" n={num('legal')} kicker={t('vrx_legal_kicker')} title={t('vrx_legal_title')} lede={t('vrx_legal_lede')}>
          <IdentityNotice identity={identity} />
          <LegalReality legal={history?.legal} />
          <CurrentStatusBlock status={r.currentStatus} history={history} clean={clean} />
          <PropertyRegisterCard register={synthesis.propertyRegister} />
          <div id="vbi-company" className="scroll-mt-24">
            <CompanyIntelligenceCard company={company} rights={rights} />
          </div>
          <CompanyFinanceCard finance={synthesis.companyFinance} />
          {inChapter('legal').map(renderSection)}
          {r.attentionPoints?.length ? (
            <section className="space-y-3">
              <h3 className="font-display text-lg font-semibold leading-snug tracking-tight break-words">
                {t('verify_ir_attention_title')}
              </h3>
              <ul className="space-y-4">
                {r.attentionPoints.map((a, i) => (
                  <li key={i} className="border-s-2 border-amber-400/70 ps-4 space-y-1">
                    <p className="text-[15px] leading-7 font-medium break-words" dir="auto">{clean(a.point)}</p>
                    {a.why ? (
                      <p className="text-sm leading-6 text-muted-foreground break-words">{clean(a.why)}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </Chapter>
      ) : null}

      {/* ── LOCATION ── */}
      {has.location ? (
        <Chapter id="vbi-location" n={num('location')} kicker={t('vrx_location_kicker')} title={t('vrx_location_title')}>
          {inChapter('location').map(renderSection)}
          {/* And on its own when the model wrote neither section. Places a
              source named are evidence, and evidence must not vanish because
              the prose did not reach it. */}
          {synthesis.location && !locationHost ? <LocationLiving l={synthesis.location} /> : null}
        </Chapter>
      ) : null}

      {/* ── MARKET POSITION ── prose only; the numbers card mounts inside
          MarketPosition when the rebuilt market contract lands. */}
      {has.market ? (
        <Chapter id="vbi-market" n={num('market')} kicker={t('vrx_market_kicker')} title={t('vrx_market_title')}>
          <MarketPosition sections={inChapter('market')} market={synthesis.marketContext} renderSection={renderSection} />
        </Chapter>
      ) : null}

      {/* ── FINAL PERSPECTIVE ── what it means, what to do, what to check. */}
      <Chapter id="vbi-final" n={num('final')} kicker={t('vrx_final_kicker')} title={t('vrx_final_title')}>
        {inChapter('final').map(renderSection)}
        <BuyerBottomLine
          finalView={clean(r.finalView)}
          // The highlights already open the report; repeating them here was the
          // owner's "the same thing many times" (2026-10-10).
          highlights={[]}
          openQuestions={[]}
          clean={clean}
        />

        {/* WHAT TO DO NOW. Absent entirely when the report found nothing that
            needs acting on — an empty plan is how the checklist this replaced
            got filled with filler. */}
        {r.nextSteps?.length ? (
          <section className="space-y-3">
            <h3 className="font-display text-lg font-semibold leading-snug tracking-tight break-words">
              {t('verify_ir_next_steps_title')}
            </h3>
            <ol className="space-y-4">
              {r.nextSteps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[hsl(222_47%_11%)] text-xs font-semibold tabular-nums text-[hsl(38_92%_62%)]"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <div className="space-y-1 min-w-0">
                    <p className="text-[15px] leading-7 font-medium break-words">{stripLeadingOrdinal(clean(s.step))}</p>
                    {s.why ? (
                      <p className="text-sm leading-6 text-muted-foreground break-words">{clean(s.why)}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {synthesis.selfChecks?.length ? <SelfChecks checks={synthesis.selfChecks} /> : null}

        {/* The checklist is computed in the bundle and merely rendered here,
            so a quiet model cannot delete it. */}
        <div id="vbi-checklist" className="scroll-mt-24">
          <BuyerChecklist items={synthesis.checklist ?? []} />
        </div>

        {/* Evidence sources and the research-transparency counts are no
            longer part of the customer experience (owner, 2026-10-10). Their
            data is untouched: evidenceGroups and research still arrive. */}

        {r.contractUpload?.recommend !== false ? (
          <section className="rounded-2xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]/50 p-5 sm:p-6 space-y-3">
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 shrink-0 text-[hsl(var(--gold-ink))] mt-0.5" aria-hidden="true" />
              <p className="text-sm leading-6 break-words min-w-0">
                {clean(r.contractUpload?.text) || t('verify_ir_upload_body')}
              </p>
            </div>
            {/* What has already been read for this property, then the way to
                add one. The picker is right here: choosing the file is the
                whole interaction. */}
            <VerifyLinkedContracts
              roomId={contractCaseId ?? null}
              cadastralCode={synthesis.snapshot?.cadastralCode ?? null}
              address={synthesis.snapshot?.address ?? null}
            />
            <ContractUpload caseId={contractCaseId ?? null} variant="inline" />
          </section>
        ) : null}

        <p className="text-xs text-muted-foreground/80 leading-relaxed break-words">
          {t('verify_ir_disclaimer')}
        </p>
      </Chapter>
    </article>
  );
}

/* ------------------------------------------------------------------ *
 * Chapter                                                             *
 * ------------------------------------------------------------------ */

/**
 * One chapter of the report: a numbered editorial header (kicker, title,
 * optional lede, a gold rule) and its content, arriving as the reader
 * reaches it. Reveal renders plainly under reduced motion.
 */
const Chapter: React.FC<{
  id: string;
  headingId?: string;
  n: number;
  kicker: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}> = ({ id, headingId, n, kicker, title, lede, children }) => {
  const hid = headingId ?? `${id}-title`;
  return (
    <Reveal as="section" id={id} aria-labelledby={hid} className="scroll-mt-24 space-y-6">
      <header className="space-y-2.5">
        <p className="flex items-center gap-3 text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--gold-ink))]">
          <span className="tabular-nums">{String(n).padStart(2, '0')}</span>
          <span className="h-px w-8 bg-[hsl(var(--gold-border))]" aria-hidden="true" />
          <span className="min-w-0 break-words">{kicker}</span>
        </p>
        <h2 id={hid} className="font-display text-2xl font-semibold leading-tight tracking-tight break-words sm:text-[1.75rem]">
          {title}
        </h2>
        {lede ? <p className="max-w-[60ch] text-[15px] leading-7 text-muted-foreground break-words">{lede}</p> : null}
      </header>
      <div className="space-y-8">{children}</div>
    </Reveal>
  );
};

/* ------------------------------------------------------------------ *
 * Buyer Intelligence Summary                                          *
 * ------------------------------------------------------------------ */

/**
 * The first thing on the page, and for many readers the only thing.
 *
 * The old header was a label and a sentence, and everything that justified
 * them was hundreds of words further down. This carries the verdict, the
 * reason, and the three-to-six dimensions it rests on, in one screen.
 */
const SummaryHero: React.FC<{
  summary?: BuyerIntelligence['summary'];
  weighed?: { label: OverallLabel } | null;
  snapshot?: PropertySnapshot;
}> = ({ summary, weighed, snapshot }) => {
  const { t } = useLanguage();
  if (!summary) return null;
  const opening = buyerOpening(summary, weighed);
  const label = (['POSITIVE', 'BALANCED', 'NEEDS_ATTENTION'] as OverallLabel[]).includes(summary.label)
    ? summary.label
    : 'BALANCED';
  const identityLine = [snapshot?.project, snapshot?.address || snapshot?.district, snapshot?.area, snapshot?.cadastralCode]
    .map((v) => readable(String(v ?? '')).trim())
    .filter(Boolean);

  return (
    <header className="relative overflow-hidden rounded-3xl bg-[hsl(222_47%_11%)] px-5 py-7 text-white shadow-[0_24px_60px_-30px_hsl(222_47%_11%/0.7)] sm:px-9 sm:py-10">
      {/* One warm light source, top-end. Decorative. */}
      <span className="pointer-events-none absolute -end-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(closest-side,hsl(38_92%_56%/0.22),transparent)]" aria-hidden="true" />
      <div className="relative space-y-4">
        <p className="flex items-center gap-3 text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(38_92%_66%)]">
          <span className="h-px w-8 bg-[hsl(38_92%_56%)]" aria-hidden="true" />
          {t('verify_ir_summary_title')}
        </p>
        {/* What this property is, before what we think of it. */}
        {identityLine.length ? (
          <p className="text-sm leading-6 text-white/75 break-words" dir="auto">{identityLine.join(' · ')}</p>
        ) : null}
        <h2 className="font-display text-2xl font-semibold leading-tight !text-white break-words sm:text-[2rem]">
          {t(OVERALL_KEY[label])}
        </h2>
        {/*
          * THE FIRST SENTENCE, AND WHY IT IS NOT ALWAYS THE MODEL'S.
          *
          * Verify runs from a cadastral code, so it usually has no asking
          * price and no floor area — nobody gave it any. The stored Villion
          * report therefore opened with „ფასის შეფასება ჯერ ვერ კეთდება,
          * რადგან ბინის ფართობი და მოთხოვნილი ფასი... არ ჩანს", which
          * describes the INPUT rather than the property and buries the eight
          * things the run did establish.
          *
          * The verdict above is the model's and is never touched. Only the
          * sentence changes, and only when it is about a gap — the gap itself
          * reappears under „რა რჩება დასადასტურებელი" further down.
          */}
        <p className="max-w-[62ch] text-base leading-7 text-white/90 break-words sm:text-[17px] sm:leading-8">
          {opening.replaced ? t(opening.fallbackKey!) : clean(opening.statement)}
        </p>

        {/* A very short second line, built only from what the run actually
            evidenced. No positives found means no line at all. */}
        {opening.support.length ? (
          <p className="text-sm leading-6 text-white/70 break-words">
            {opening.support.map((h) => clean(h)).join(' · ')}
          </p>
        ) : null}
      </div>

      {/*
        * THE HIGHLIGHT GRID IS GONE, DELIBERATELY.
        *
        * It restated the key findings rendered immediately below it, so the
        * report opened twice before the reader reached a single detail: a
        * verdict with six highlight cards, then "რა აღმოაჩინა Homatch-მა"
        * with seven findings saying the same things in longer form. The
        * findings win because each one carries WHY it matters; the cards
        * carried only a label.
        */}
    </header>
  );
};

/* ------------------------------------------------------------------ *
 * Key findings                                                        *
 * ------------------------------------------------------------------ */

/** A shortlist. Every row answers "why does this matter to me". */
const KeyFindings: React.FC<{ findings: KeyFinding[] }> = ({ findings }) => {
  const { t } = useLanguage();
  return (
    /* No heading: this IS the introduction begun by SummaryHero above. A
       second title here is what made the report start for a second time. */
    <section className="space-y-3">
      <ul className="space-y-3">
        {findings.slice(0, 7).map((f, i) => {
          const st = SENTIMENT_STYLE[sentimentOf(f.sentiment)];
          return (
            <li key={i} className={`border-s-2 ${st.edge} ps-4 space-y-1`}>
              <p className="text-[15px] leading-7 font-medium break-words" dir="auto">{clean(f.finding)}</p>
              {f.whyItMatters ? (
                <p className="text-sm leading-6 text-muted-foreground break-words">
                  {clean(f.whyItMatters)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

/* ------------------------------------------------------------------ *
 * Metric chips                                                        *
 * ------------------------------------------------------------------ */

/**
 * Emphasis from structured data, never from pattern-matching prose.
 *
 * Highlighting phrases inside generated Georgian with regexes is brittle and
 * tends to emphasise the wrong half of a sentence. The model names the
 * numbers that matter; this renders exactly those.
 */
/*
 * A STEP THAT NUMBERS ITSELF, BESIDE A BADGE THAT ALSO NUMBERS IT.
 *
 * The list renders its own position in a circular badge, and the model
 * frequently writes "1." at the front of the step text as well — so the live
 * report showed "1. 1", "2. 2" down the whole checklist. Neither half is
 * wrong on its own; printing both is.
 *
 * The badge wins, because it is the one that stays correct when a step is
 * filtered out. Only a leading ordinal is removed — Arabic-Indic digits
 * included, since the same model writes those for ar — and a sentence that
 * merely begins with a number ("2 ბინა ერთ სართულზე") keeps it, because the
 * separator is what marks an enumeration.
 */
const stripLeadingOrdinal = (text: string): string =>
  text.replace(/^\s*[0-9٠-٩۰-۹]{1,2}\s*[.)؛:-]\s+/, '');

const Metrics: React.FC<{ metrics: { label: string; value: string }[] }> = ({ metrics }) => (
  <div className="flex flex-wrap gap-2">
    {metrics.slice(0, 4).map((m, i) => (
      <div key={i} className="rounded-lg border border-border bg-muted/40 px-3 py-1.5 min-w-0">
        <span className="block text-2xs uppercase tracking-wide text-muted-foreground break-words">
          {clean(m.label)}
        </span>
        <span className="block text-sm font-semibold tabular-nums break-words" dir="auto">{clean(m.value)}</span>
      </div>
    ))}
  </div>
);

/* ------------------------------------------------------------------ *
 * Company and participants                                            *
 * ------------------------------------------------------------------ */

/**
 * Who is on the other side of this transaction, drawn rather than described.
 *
 * Deliberately a plain indented tree and not a graph visualisation: the
 * reader is a person buying a flat, not an analyst. It collapses to a single
 * column on a phone because it never was more than one.
 *
 * Ownership percentages appear ONLY when the register stated them. A director
 * is not a shareholder, and nothing here infers one from the other.
 */
const CompanyGraph: React.FC<{ people: PersonBlock[]; owner?: string }> = ({ people, owner }) => {
  const { t } = useLanguage();
  // The tree is the COMPANY the people belong to (the developer). The flat's
  // owner may be a private person who has nothing to do with these directors.
  const entity = people.find((p) => p.entity)?.entity || owner;
  const current = people.filter((p) => !p.historical);
  const historical = people.filter((p) => p.historical);

  const Row: React.FC<{ p: PersonBlock }> = ({ p }) => (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5 min-w-0">
      <span className="text-sm font-medium break-words">{readable(p.name)}</span>
      <span className="text-xs text-muted-foreground break-words">
        {/* Every role, not just the primary one: in a small company the
            directors are usually also the partners, and showing one of the
            two tells the buyer less than the register did. */}
        {(p.roles?.length ? p.roles : [p.role])
          .map((role) => t(`verify_role_${String(role || '').toLowerCase()}`))
          .join(' · ')}
        {typeof p.ownershipPct === 'number' ? ` · ${p.ownershipPct}%` : ''}
        {p.historical && p.asOf ? ` · ${p.asOf}` : ''}
      </span>
    </div>
  );

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
      {entity ? (
        <div className="flex items-center gap-2 min-w-0">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-semibold break-words min-w-0">{readable(entity)}</p>
        </div>
      ) : null}
      {current.length ? (
        <div className="ps-4 border-s border-border divide-y divide-border/60">
          {current.map((p, i) => <Row key={i} p={p} />)}
        </div>
      ) : null}
      {historical.length ? (
        <div className="ps-4 space-y-1">
          <p className="text-2xs uppercase tracking-wide text-muted-foreground">
            {t('verify_ir_people_historical')}
          </p>
          <div className="border-s border-dashed border-border ps-3 divide-y divide-border/40">
            {historical.map((p, i) => <Row key={i} p={p} />)}
          </div>
        </div>
      ) : null}
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Snapshot                                                            *
 * ------------------------------------------------------------------ */

/** The basics, scannable, so the prose never has to spend a paragraph on
 *  restating the floor and the area. */
const Snapshot: React.FC<{ s: PropertySnapshot }> = ({ s }) => {
  const { t } = useLanguage();
  const rows: [string, string | undefined][] = [
    ['verify_snap_type', s.propertyType],
    ['verify_snap_project', s.project],
    ['verify_snap_address', s.address],
    ['verify_snap_district', s.district],
    ['verify_snap_cadastral', s.cadastralCode],
    ['verify_snap_area', s.area],
    ['verify_snap_floor', s.floor],
    ['verify_snap_rooms', s.rooms],
    ['verify_snap_unit', s.unitNumber],
    ['verify_snap_condition', s.condition],
    ['verify_snap_owner', s.owner],
    ['verify_snap_developer', s.developer],
    ['verify_snap_status', s.constructionStatus],
    ['verify_snap_parking', s.parking],
  ].filter((row): row is [string, string] => !!row[1] && String(row[1]).trim().length > 0);

  if (!rows.length) return null;

  return (
    <section className="rounded-xl border border-border bg-muted/30 p-5">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        {rows.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{t(k)}</dt>
            {/* dir="auto": a Georgian value ("83.20 კვ.მ.") keeps its own order inside an RTL page. */}
            <dd className="text-sm break-words" dir="auto">{readable(v as string)}</dd>
          </div>
        ))}
      </dl>
      {s.amenities?.length ? (
        <p className="mt-4 text-xs text-muted-foreground break-words">
          {s.amenities.map((a) => readable(a)).filter(Boolean).join(' · ')}
        </p>
      ) : null}
    </section>
  );
};

/* ------------------------------------------------------------------ *
 * Location & Living                                                   *
 * ------------------------------------------------------------------ */

/** The order a buyer cares about: daily needs first, then getting around. */
const PLACE_ORDER = [
  'SUPERMARKET', 'PHARMACY', 'SCHOOL', 'KINDERGARTEN', 'CLINIC',
  'TRANSPORT', 'PARK', 'ROAD_ACCESS', 'CITY_CENTRE', 'SERVICE',
];

/**
 * What is actually around the property, and why each kind matters.
 *
 * Rendered ONLY from places a source named. There is no geocoder at either
 * end of this pipeline, so there is no distance here and no travel time — a
 * confident "350m" invented from nothing is exactly the kind of
 * precise-sounding fabrication this product exists to avoid. What a source
 * literally said about reaching somewhere is shown as the source's words;
 * where it said nothing, nothing appears.
 *
 * The area profile beneath is general local knowledge about the district, not
 * a finding about this property, and is labelled that way rather than being
 * mixed into the evidenced places above it.
 */
/*
 * What a source said about reaching a place — its words, attributed, and a
 * figure marked approximate. "70 მ და 1 წუთი ფეხით" came from a listing site;
 * there is no geocoder here, so it is never shown as HOMATCH's measurement.
 */
const PlaceNote: React.FC<{ note: string }> = ({ note }) => {
  const { t } = useLanguage();
  const { text, sources } = splitCitations(note);
  const said = clean(text);
  if (!said) return null;
  const from = sources[0]?.host;
  /* First-strong isolates: a source's Georgian note inside an Arabic or
     Hebrew sentence otherwise has its figure and hyphen reordered by bidi. */
  const iso = (v: string) => `\u2068${v}\u2069`;
  return (
    <span className="text-muted-foreground">
      {' — '}
      {hasDistance(said) ? t(from ? 'vbi_place_approx_from' : 'vbi_place_approx', { note: iso(said), source: from ? iso(from) : '' }) : <bdi>{said}</bdi>}
      {!hasDistance(said) && from ? <span className="ms-1 text-2xs">({t('vbi_source', { source: iso(from) })})</span> : null}
    </span>
  );
};

const LocationLiving: React.FC<{ l: LocationBlock }> = ({ l }) => {
  const { t } = useLanguage();

  const places = [...(l.nearby ?? [])]
    .filter((p) => p && clean(p.name))
    .sort((a, b) => {
      const rank = (c: string) => {
        const i = PLACE_ORDER.indexOf(String(c).toUpperCase());
        return i === -1 ? PLACE_ORDER.length : i;
      };
      return rank(a.category) - rank(b.category);
    });

  const where = [l.street, l.district, l.city].map((x) => clean(x)).filter(Boolean);

  // Nothing resolved and nothing found: silence is the correct output. A
  // heading with no content under it is what gets filled with city
  // description, which is the filler this report structure exists to prevent.
  if (!places.length && !where.length && !l.profile) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold tracking-tight break-words">
        {t('verify_location_title')}
      </h2>

      {where.length ? (
        <p className="text-sm leading-6 text-muted-foreground break-words">{where.join(' · ')}</p>
      ) : null}

      {places.length ? (
        <ul className="space-y-3">
          {places.map((p, i) => (
            <li key={`${p.category}-${i}`} className="border-s-2 border-border ps-4 space-y-0.5">
              <p className="text-[15px] leading-6 break-words">
                <span className="font-medium">{clean(p.name)}</span>
                {p.note ? <PlaceNote note={p.note} /> : null}
              </p>
              <p className="text-xs leading-5 text-muted-foreground break-words">{t(p.whyKey)}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {l.profile ? (
        <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
          <p className="text-2xs uppercase tracking-wide text-muted-foreground">
            {t('verify_area_context_label')}
          </p>
          <p className="text-sm leading-6 break-words">{readable(l.profile.character)}</p>
          {l.profile.context?.length ? (
            <p className="text-xs text-muted-foreground break-words">
              {l.profile.context.map((c) => readable(c)).filter(Boolean).join(' · ')}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

/* ------------------------------------------------------------------ *
 * People                                                              *
 * ------------------------------------------------------------------ */

/** Who is connected to the property. Context, never a risk list — so no
 *  warning colours, no scores, and only the handful a buyer has a reason to
 *  know about. */
/* ------------------------------------------------------------------ *
 * Official self-checks                                                *
 * ------------------------------------------------------------------ */

/*
 * Each check answers the six questions a buyer actually has: what is being
 * checked, why it matters, where to open it, what to type in, what an
 * ordinary result looks like, and what would be worth a closer look.
 *
 * Keyed by kind rather than chosen with a ternary, so a new check cannot be
 * added without someone deciding what all six say.
 */
const SELF_CHECK_COPY: Record<SelfCheck['kind'], { title: string; help: string; expect: string; attention: string }> = {
  PROPERTY_EXTRACT: {
    title: 'verify_ir_selfcheck_property',
    help: 'verify_ir_selfcheck_property_help',
    expect: 'verify_ir_selfcheck_property_expect',
    attention: 'verify_ir_selfcheck_property_attention',
  },
  TAXPAYER_REGISTRY: {
    title: 'verify_ir_selfcheck_taxpayer',
    help: 'verify_ir_selfcheck_taxpayer_help',
    expect: 'verify_ir_selfcheck_taxpayer_expect',
    attention: 'verify_ir_selfcheck_taxpayer_attention',
  },
};

/** The buyer's own official checks. This is what replaced the old inventory
 *  of what our pipeline could not retrieve: the same underlying situation,
 *  pointed forwards, with the exact value to paste. */
const SelfChecks: React.FC<{ checks: SelfCheck[] }> = ({ checks }) => {
  const { t } = useLanguage();
  const [copied, setCopied] = React.useState<string | null>(null);

  const copy = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied((c) => (c === value ? null : c)), 2000);
    } catch {
      /* a failed copy is not worth an error message; the value is on screen */
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold tracking-tight break-words">
        {t('verify_ir_selfcheck_title')}
      </h2>
      <p className="text-sm leading-6 text-muted-foreground break-words">
        {t('verify_ir_selfcheck_intro')}
      </p>
      <div className="space-y-3">
        {checks.map((c) => (
          <div key={c.kind} className="rounded-xl border border-border p-4 space-y-2">
            <p className="text-sm font-medium break-words">{t(SELF_CHECK_COPY[c.kind].title)}</p>
            {/* WHY it matters, then WHAT an ordinary answer looks like, then
                what would be worth a second look. A buyer who has never read
                an extract needs the last two most, and they are the two the
                old card left out. */}
            <p className="text-xs leading-5 text-muted-foreground break-words">
              {t(SELF_CHECK_COPY[c.kind].help)}
            </p>
            <p className="text-xs leading-5 text-muted-foreground break-words">
              <span className="font-medium text-foreground">{t('verify_ir_selfcheck_expect_label')}: </span>
              {t(SELF_CHECK_COPY[c.kind].expect)}
            </p>
            <p className="text-xs leading-5 text-muted-foreground break-words">
              <span className="font-medium text-foreground">{t('verify_ir_selfcheck_attention_label')}: </span>
              {t(SELF_CHECK_COPY[c.kind].attention)}
            </p>
            {c.contextValue ? (
              <p className="text-xs text-muted-foreground break-words">{readable(c.contextValue)}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <code className="rounded bg-muted px-2 py-1 text-xs break-all">{c.copyValue}</code>
              <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => void copy(c.copyValue)}>
                {copied === c.copyValue ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {t('verify_ir_copy')}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

/* ------------------------------------------------------------------ *
 * Evidence drawer                                                     *
 * ------------------------------------------------------------------ */

const EvidenceDrawer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useLanguage();
  return (
    <details className="group rounded-xl border border-border bg-card">
      <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm font-medium break-words">{t('verify_report_evidence_toggle')}</span>
          <span className="block text-xs text-muted-foreground mt-0.5 break-words">
            {t('verify_report_evidence_hint')}
          </span>
        </span>
        <span className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true">›</span>
      </summary>
      {/* Children are only mounted while open, so the collapsed report never
          pays for hundreds of rows of document and revision detail. */}
      <div className="px-5 pb-5 pt-1 space-y-4">{children}</div>
    </details>
  );
};

export const LocationIcon = MapPin;

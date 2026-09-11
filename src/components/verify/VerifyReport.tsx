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
import { Button } from '@/components/ui/button';
import { FileText, Copy, Check, ExternalLink, MapPin, Users } from 'lucide-react';
import { readable } from '@/verify/readableText';

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
  summary: { label: OverallLabel; statement: string; highlights: SummaryHighlight[] };
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
  mode?: 'MODEL' | 'DETERMINISTIC';
  empty?: boolean;
}

/**
 * The order a buyer reads the report in.
 *
 * Deliberately a literal rather than an import from the synthesis module: it
 * is the ORDER that must stay stable here, and this list also has to name
 * keys that module no longer knows about.
 */
const READING_ORDER = ['SNAPSHOT', 'PROJECT', 'LOCATION', 'INFRASTRUCTURE', 'MARKET', 'PEOPLE'];

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

const clean = (s: unknown): string => stripEvidenceIds(readable(typeof s === 'string' ? s : ''));

const paragraphs = (text: string): string[] =>
  clean(text).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

const Prose: React.FC<{ text: string }> = ({ text }) => (
  <>
    {paragraphs(text).map((p, i) => (
      <p key={i} className="text-[15px] leading-7 text-foreground/90 break-words">{p}</p>
    ))}
  </>
);

export function VerifyReport({
  synthesis,
  evidence,
  onUploadContract,
}: {
  synthesis: VerifySynthesis;
  /** The full research detail, rendered inside the collapsed control. */
  evidence?: React.ReactNode;
  onUploadContract?: () => void;
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
   * given, so they are shown rather than dropped: sorted to the end, under
   * the heading they had. A renderer that silently loses part of an existing
   * report is worse than one that shows it in a new place. */
  const sections = orderForReading((r.sections ?? []).filter((s) => clean(s.body)));
  const people = (synthesis.people?.people ?? []).slice(0, 6);
  /* Which section the evidenced places belong under. LOCATION when the model
     wrote one, otherwise INFRASTRUCTURE, otherwise neither and the block
     stands on its own below. */
  const locationHost =
    (['LOCATION', 'INFRASTRUCTURE'] as const).find((k) => sections.some((s) => s.key === k)) ?? null;
  const findings = (r.keyFindings ?? []).filter((f) => clean(f.finding));

  return (
    <article className="mx-auto max-w-[68ch] space-y-8">
      <SummaryHero summary={r.summary} />

      {synthesis.snapshot ? <Snapshot s={synthesis.snapshot} /> : null}

      {findings.length ? <KeyFindings findings={findings} /> : null}

      {/* EVIDENCE, WHERE THE READER IS STILL DECIDING WHETHER TO TRUST IT.
          This used to sit at the very bottom, below the disclaimer — past the
          point where anyone was still reading. A due-diligence report is worth
          what its sources are worth, and the reader needs to know the
          conclusions are grounded BEFORE they have finished forming an opinion,
          not after. It stays a closed drawer: the summary line is the promise,
          the detail is still a deliberate click, and the page above it is
          unchanged. */}
      {evidence ? <EvidenceDrawer>{evidence}</EvidenceDrawer> : null}

      {sections.map((s) => (
        <section key={s.key} className="space-y-3">
          <h2 className="text-base font-semibold tracking-tight break-words">{clean(s.title)}</h2>
          {/* Decision-relevant numbers, pulled out of the paragraph so a
              scanning reader meets them first. */}
          {s.metrics?.length ? <Metrics metrics={s.metrics} /> : null}
          <Prose text={s.body} />
          {s.key === 'MARKET' && synthesis.market ? <PriceBar m={synthesis.market} /> : null}
          {s.key === 'PEOPLE' && people.length ? (
            <CompanyGraph people={people} owner={synthesis.snapshot?.owner} />
          ) : null}
          {/* Under whichever of the two location sections the model actually
              wrote, so the evidenced places sit with the prose about them. */}
          {s.key === locationHost && synthesis.location ? (
            <LocationLiving l={synthesis.location} />
          ) : null}
        </section>
      ))}

      {/* And on its own when the model wrote neither section. Places a source
          named are evidence, and evidence must not vanish because the prose
          did not reach it — the same reasoning as the participants below. */}
      {synthesis.location && !locationHost ? <LocationLiving l={synthesis.location} /> : null}

      {/* Only when the model had nothing to say about them under PEOPLE —
          participants are context and must not vanish just because the prose
          did not reach them. */}
      {people.length && !sections.some((s) => s.key === 'PEOPLE') ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold tracking-tight break-words flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {t('verify_ir_people_title')}
          </h2>
          <CompanyGraph people={people} owner={synthesis.snapshot?.owner} />
          {synthesis.people?.representationNote ? (
            <p className="text-sm leading-6 text-muted-foreground break-words">
              {readable(synthesis.people.representationNote)}
            </p>
          ) : null}
        </section>
      ) : null}

      {r.attentionPoints?.length ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold tracking-tight break-words">
            {t('verify_ir_attention_title')}
          </h2>
          <ul className="space-y-4">
            {r.attentionPoints.map((a, i) => (
              <li key={i} className="border-s-2 border-amber-400/70 ps-4 space-y-1">
                <p className="text-[15px] leading-7 font-medium break-words">{clean(a.point)}</p>
                {a.why ? (
                  <p className="text-sm leading-6 text-muted-foreground break-words">{clean(a.why)}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* WHAT TO DO NOW.
          Sits between the things worth looking at and the official checks a
          buyer can run themselves, because it is the bridge: attention points
          say what stood out, this says what to do about it, and Check It
          Yourself is the part they do at a registry counter. Absent entirely
          when the report found nothing that needs acting on — an empty plan is
          how the checklist this replaced got filled with filler. */}
      {r.nextSteps?.length ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold tracking-tight break-words">
            {t('verify_ir_next_steps_title')}
          </h2>
          <ol className="space-y-4">
            {r.nextSteps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <div className="space-y-1 min-w-0">
                  <p className="text-[15px] leading-7 font-medium break-words">{clean(s.step)}</p>
                  {s.why ? (
                    <p className="text-sm leading-6 text-muted-foreground break-words">{clean(s.why)}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {r.finalView ? (
        <section className="space-y-3 border-t border-border pt-6">
          <h2 className="text-base font-semibold tracking-tight break-words">
            {t('verify_ir_final_title')}
          </h2>
          <Prose text={r.finalView} />
        </section>
      ) : null}

      {synthesis.selfChecks?.length ? <SelfChecks checks={synthesis.selfChecks} /> : null}

      {r.contractUpload?.recommend !== false ? (
        <section className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-3">
          <div className="flex items-start gap-3">
            <FileText className="h-5 w-5 shrink-0 text-primary mt-0.5" aria-hidden="true" />
            <p className="text-sm leading-6 break-words min-w-0">
              {clean(r.contractUpload?.text) || t('verify_ir_upload_body')}
            </p>
          </div>
          {onUploadContract ? (
            <Button className="w-full sm:w-auto gap-2" onClick={onUploadContract}>
              <FileText className="h-4 w-4" />
              {t('verify_ir_upload_cta')}
            </Button>
          ) : null}
        </section>
      ) : null}

      <p className="text-xs text-muted-foreground/80 leading-relaxed break-words">
        {t('verify_ir_disclaimer')}
      </p>
    </article>
  );
}

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
const SummaryHero: React.FC<{ summary?: BuyerIntelligence['summary'] }> = ({ summary }) => {
  const { t } = useLanguage();
  if (!summary) return null;
  const label = (['POSITIVE', 'BALANCED', 'NEEDS_ATTENTION'] as OverallLabel[]).includes(summary.label)
    ? summary.label
    : 'BALANCED';
  const highlights = (summary.highlights ?? []).filter((h) => clean(h.headline)).slice(0, 6);

  return (
    <header className="rounded-2xl border border-border bg-card/50 p-5 sm:p-6 space-y-5">
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {t('verify_ir_summary_title')}
        </p>
        <p className="text-xl sm:text-2xl font-semibold leading-tight break-words">
          {t(OVERALL_KEY[label])}
        </p>
        {summary.statement ? (
          <p className="text-[15px] leading-7 text-foreground/85 break-words">
            {clean(summary.statement)}
          </p>
        ) : null}
      </div>

      {highlights.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {highlights.map((h, i) => {
            const st = SENTIMENT_STYLE[sentimentOf(h.sentiment)];
            return (
              <div key={i} className={`rounded-lg border border-border border-s-2 ${st.edge} bg-background/50 p-3 min-w-0`}>
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${st.dot}`} aria-hidden="true" />
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground break-words">
                    {t(`verify_dim_${String(h.dimension || '').toLowerCase()}`)}
                  </p>
                </div>
                <p className="mt-1 text-sm font-semibold break-words">{clean(h.headline)}</p>
                {h.detail ? (
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground break-words">
                    {clean(h.detail)}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
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
    <section className="space-y-3">
      <h2 className="text-base font-semibold tracking-tight break-words">
        {t('verify_ir_findings_title')}
      </h2>
      <ul className="space-y-3">
        {findings.slice(0, 7).map((f, i) => {
          const st = SENTIMENT_STYLE[sentimentOf(f.sentiment)];
          return (
            <li key={i} className={`border-s-2 ${st.edge} ps-4 space-y-1`}>
              <p className="text-[15px] leading-7 font-medium break-words">{clean(f.finding)}</p>
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
const Metrics: React.FC<{ metrics: { label: string; value: string }[] }> = ({ metrics }) => (
  <div className="flex flex-wrap gap-2">
    {metrics.slice(0, 4).map((m, i) => (
      <div key={i} className="rounded-lg border border-border bg-muted/40 px-3 py-1.5 min-w-0">
        <span className="block text-[10px] uppercase tracking-wide text-muted-foreground break-words">
          {clean(m.label)}
        </span>
        <span className="block text-sm font-semibold tabular-nums break-words">{clean(m.value)}</span>
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
  const entity = owner || people.find((p) => p.entity)?.entity;
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
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
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
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{t(k)}</dt>
            <dd className="text-sm break-words">{readable(v as string)}</dd>
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
                {p.note ? (
                  <span className="text-muted-foreground"> — {clean(p.note)}</span>
                ) : null}
              </p>
              <p className="text-xs leading-5 text-muted-foreground break-words">{t(p.whyKey)}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {l.profile ? (
        <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
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
 * Price position                                                      *
 * ------------------------------------------------------------------ */

/** Where the asking price sits in its micro-market. Rendered only when the
 *  subject actually has a price of its own — Verify runs from a cadastral
 *  code, so most of the time it does not, and a bar with no marker would
 *  imply a measurement we never made. */
const PriceBar: React.FC<{ m: MarketBlock }> = ({ m }) => {
  const { t } = useLanguage();
  if (!m.count) return null;

  const span = Math.max(1, m.max - m.min);
  const pos = (v: number): number => Math.max(0, Math.min(100, ((v - m.min) / span) * 100));
  const medianPos = pos(m.median);
  const subjectPos = m.subjectPricePerSqm ? pos(m.subjectPricePerSqm) : null;

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {t('verify_ir_market_title')}
        </p>
        <p className="text-xs text-muted-foreground">
          {t(`verify_basis_${m.basis.toLowerCase()}`)} · {m.count}
        </p>
      </div>

      <div className="relative h-2 rounded-full bg-muted">
        <div
          className="absolute top-1/2 -translate-y-1/2 h-3 w-0.5 bg-muted-foreground/70"
          style={{ insetInlineStart: `${medianPos}%` }}
          aria-hidden="true"
        />
        {subjectPos !== null ? (
          <div
            className="absolute top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-primary ring-2 ring-background"
            style={{ insetInlineStart: `calc(${subjectPos}% - 8px)` }}
            aria-hidden="true"
          />
        ) : null}
      </div>

      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{m.min.toLocaleString()}</span>
        <span>{t('verify_ir_market_median')} {m.median.toLocaleString()}</span>
        <span>{m.max.toLocaleString()}</span>
      </div>

      {m.subjectPricePerSqm && m.deltaFromMedianPct !== undefined ? (
        <p className="text-sm break-words">
          {m.subjectPricePerSqm.toLocaleString()} {m.currency}/m² ·{' '}
          {m.deltaFromMedianPct > 0 ? '+' : ''}{m.deltaFromMedianPct}%
        </p>
      ) : null}

      {/* THE WHOLE HIERARCHY, not only the band that won.
          Comparing a project's units to each other answers "what do five
          flats in this building cost". The buyer asked whether the property
          is well positioned in its real local market, and that question needs
          the street, the district and comparable developments beside it.
          Rows, not a table: at 320px a five-column table has nowhere to go. */}
      {m.tiers && m.tiers.length > 1 ? (
        <dl className="divide-y divide-border/60 border-t border-border/60 pt-1">
          {m.tiers.map((tr) => (
            <div key={tr.tier} className="flex items-baseline justify-between gap-3 py-1.5 min-w-0">
              <dt className="text-[11px] text-muted-foreground break-words min-w-0">
                {t(`verify_mkt_${tr.tier.toLowerCase()}`)}
                <span className="ms-1 opacity-70">
                  {tr.count} {t('verify_mkt_listings')}
                </span>
                {/* Neutral, not a warning: one listing is real information,
                    it just is not a spread. Saying so is more useful than
                    hiding the band or dressing it up as a market rate. */}
                {tr.thin ? (
                  <span className="ms-1 opacity-70">· {t('verify_mkt_thin')}</span>
                ) : null}
              </dt>
              <dd className="text-xs tabular-nums shrink-0">
                {tr.median.toLocaleString()}
                {tr.min !== tr.max ? (
                  <span className="text-muted-foreground">
                    {' '}({tr.min.toLocaleString()}–{tr.max.toLocaleString()})
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {m.basisIsThin ? (
        <p className="text-[11px] leading-5 text-muted-foreground break-words">
          {t('verify_mkt_thin_note')}
        </p>
      ) : null}

      {/* Why a premium or a discount may be RATIONAL. Deliberately no money
          attached to any of them: the evidence supports the factor, not a
          number, and "+8% for concierge" would be a fabrication with a
          decimal point in it. */}
      {m.qualityFactors?.length ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {m.qualityFactors.map((q, i) => (
            <span
              key={i}
              className={`rounded-full border px-2 py-0.5 text-[11px] break-words ${
                q.direction === 'SUPPORTS_PREMIUM'
                  ? 'border-border text-foreground/80'
                  : 'border-dashed border-border text-muted-foreground'
              }`}
            >
              {readable(q.factor)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
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
              <a
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary underline underline-offset-2 break-all"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                {t('verify_ir_selfcheck_open')}
              </a>
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

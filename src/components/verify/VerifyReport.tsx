// HOMATCH — the customer's Buyer Intelligence Report.
//
// WHAT CHANGED AND WHY
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

export type OverallLabel = 'POSITIVE' | 'MOSTLY_POSITIVE' | 'MIXED' | 'NEEDS_ATTENTION';

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

export interface MarketBlock {
  currency: string; median: number; mean: number; min: number; max: number; count: number;
  basis: string; basisCount: number;
  subjectPricePerSqm?: number; deltaFromMedianPct?: number; positioning?: string;
}

export interface PersonBlock {
  name: string; role: string; entity?: string; representation: string;
  certainty: string; historical: boolean; asOf?: string;
}

export interface SelfCheck {
  kind: 'PROPERTY_EXTRACT' | 'TAXPAYER_REGISTRY';
  url: string; copyValue: string; copyLabel: string; contextValue?: string;
}

export interface BuyerIntelligence {
  overallView: { label: OverallLabel; statement: string };
  executiveSummary: string;
  sections: { key: string; title: string; body: string; cites: string[] }[];
  attentionPoints: { point: string; why: string; cites: string[] }[];
  buyerActions: { title: string; action: string; why: string; cites: string[] }[];
  finalView: string;
  contractUpload: { recommend: boolean; text: string };
}

export interface VerifySynthesis {
  report: BuyerIntelligence | null;
  evidence?: EvidenceRef[];
  snapshot?: PropertySnapshot;
  market?: MarketBlock | null;
  people?: { people?: PersonBlock[]; representationNote?: string };
  selfChecks?: SelfCheck[];
  mode?: 'MODEL' | 'DETERMINISTIC';
  empty?: boolean;
}

const OVERALL_KEY: Record<OverallLabel, string> = {
  POSITIVE: 'verify_ir_overall_positive',
  MOSTLY_POSITIVE: 'verify_ir_overall_mostly_positive',
  MIXED: 'verify_ir_overall_mixed',
  NEEDS_ATTENTION: 'verify_ir_overall_attention',
};

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

  const sections = (r.sections ?? []).filter((s) => clean(s.body));
  const people = (synthesis.people?.people ?? []).slice(0, 4);

  return (
    <article className="mx-auto max-w-[68ch] space-y-8">
      <header className="space-y-3 border-b border-border pb-6">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {t(OVERALL_KEY[r.overallView?.label] ?? OVERALL_KEY.MIXED)}
        </p>
        {r.overallView?.statement ? (
          <p className="text-lg sm:text-xl font-semibold leading-8 break-words">
            {clean(r.overallView.statement)}
          </p>
        ) : null}
      </header>

      {synthesis.snapshot ? <Snapshot s={synthesis.snapshot} /> : null}

      {r.executiveSummary ? (
        <section className="space-y-4"><Prose text={r.executiveSummary} /></section>
      ) : null}

      {sections.map((s) => (
        <section key={s.key} className="space-y-3">
          <h2 className="text-base font-semibold tracking-tight break-words">{clean(s.title)}</h2>
          <Prose text={s.body} />
          {s.key === 'MARKET' && synthesis.market ? <PriceBar m={synthesis.market} /> : null}
        </section>
      ))}

      {people.length ? <People people={people} note={synthesis.people?.representationNote} /> : null}

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

      {/* Titled, scannable recommendations. The old "1 2 3" list was not
          something a person could skim, and the numbers carried no meaning. */}
      {r.buyerActions?.length ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold tracking-tight break-words">
            {t('verify_ir_actions_title')}
          </h2>
          <div className="divide-y divide-border rounded-xl border border-border">
            {r.buyerActions.map((a, i) => (
              <div key={i} className="p-4 space-y-1">
                {a.title ? (
                  <p className="text-sm font-semibold break-words">{clean(a.title)}</p>
                ) : null}
                <p className="text-[15px] leading-7 break-words">{clean(a.action)}</p>
                {a.why ? (
                  <p className="text-sm leading-6 text-muted-foreground break-words">{clean(a.why)}</p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {r.finalView ? (
        <section className="space-y-3 border-t border-border pt-6"><Prose text={r.finalView} /></section>
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

      {evidence ? <EvidenceDrawer>{evidence}</EvidenceDrawer> : null}
    </article>
  );
}

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
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * People                                                              *
 * ------------------------------------------------------------------ */

/** Who is connected to the property. Context, never a risk list — so no
 *  warning colours, no scores, and only the handful a buyer has a reason to
 *  know about. */
const People: React.FC<{ people: PersonBlock[]; note?: string }> = ({ people, note }) => {
  const { t } = useLanguage();
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold tracking-tight break-words flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {t('verify_ir_people_title')}
      </h2>
      <div className="divide-y divide-border">
        {people.map((p, i) => (
          <div key={i} className="py-3 space-y-0.5">
            <p className="text-sm font-medium break-words">{readable(p.name)}</p>
            <p className="text-xs text-muted-foreground break-words">
              {t(`verify_role_${p.role.toLowerCase()}`)}
              {p.entity ? ` · ${readable(p.entity)}` : ''}
              {p.historical && p.asOf ? ` · ${p.asOf}` : ''}
            </p>
          </div>
        ))}
      </div>
      {note ? (
        <p className="text-sm leading-6 text-muted-foreground break-words">{readable(note)}</p>
      ) : null}
    </section>
  );
};

/* ------------------------------------------------------------------ *
 * Official self-checks                                                *
 * ------------------------------------------------------------------ */

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
            <p className="text-sm font-medium break-words">
              {t(c.kind === 'PROPERTY_EXTRACT' ? 'verify_ir_selfcheck_property' : 'verify_ir_selfcheck_taxpayer')}
            </p>
            <p className="text-xs leading-5 text-muted-foreground break-words">
              {t(c.kind === 'PROPERTY_EXTRACT' ? 'verify_ir_selfcheck_property_help' : 'verify_ir_selfcheck_taxpayer_help')}
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

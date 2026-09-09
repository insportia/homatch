// HOMATCH — the customer's Verify report.
//
// WHAT CHANGED AND WHY
//
// Verify used to render its research output directly: roughly twenty cards in
// a flat list — official document tables, full revision timelines, land and
// utility matrices, comparables, raw evidence lists — with the property's
// identity repeated across several of them. That is a research console. A
// buyer about to commit a large sum cannot read it, and the things that
// actually decide their purchase were buried among the things that do not.
//
// The synthesis that fixes this already existed and was only ever wired to
// Deal Room: verify-synthesis turns the evidence ledger into an ordered,
// grounded, customer-language report. Nothing here re-derives a conclusion —
// this component renders what that endpoint decided, and nothing else.
//
// THE DIVISION OF LABOUR
//
//   verify-synthesis   decides WHAT IS TRUE (deterministically) and what it
//                      READS LIKE (model prose, validated back against the
//                      deterministic plan, discarded if it invents anything)
//   this component     decides how it LOOKS
//
// So a card here can never state a fact the projection did not produce, and
// there is exactly one place a conclusion can come from.
//
// The full research detail is not deleted — it moves behind one collapsed
// "Evidence and sources" control, which is where a curious or professional
// reader can still find every document and source record.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent } from '@/components/ui/card';
import { ShieldCheck, ShieldAlert, ShieldX, Info } from 'lucide-react';
import { readable } from '@/verify/readableText';

export type Verdict = 'POSITIVE' | 'MODERATELY_POSITIVE' | 'NEGATIVE';

export interface VerifySynthesis {
  verdict: Verdict;
  verdictReasons: string[];
  sections: { sectionKey: string; text: string }[];
  /** Named for a customer ("the debtors registry"), never by source key. */
  incompleteSources?: string[];
  empty?: boolean;
}

/** Section key -> translation key. A key with no mapping is not rendered:
 *  failing closed keeps an unlabelled block off the customer's screen. */
const SECTION_TITLE_KEY: Record<string, string> = {
  INTRO: 'verify_section_intro',
  PROPERTY: 'verify_section_property',
  OWNERSHIP: 'verify_section_ownership',
  COMPANY: 'verify_section_company',
  PEOPLE: 'verify_section_people',
  PROFESSIONALS: 'verify_section_professionals',
  CONSTRUCTION: 'verify_section_construction',
  PERMITS: 'verify_section_permits',
  LOCATION: 'verify_section_location',
  MARKET: 'verify_section_market',
  PRICE: 'verify_section_price',
  CONFIRM: 'verify_section_confirm',
  ASSESSMENT: 'verify_section_assessment',
  MEANING: 'verify_section_meaning',
  NEXT: 'verify_section_next',
};

/**
 * Restrained on purpose. A three-colour verdict on a due-diligence report has
 * to read as a considered judgement, not a traffic light, so the tone carries
 * the weight and the styling stays quiet.
 */
const VERDICT_STYLE: Record<Verdict, { icon: React.ElementType; ring: string; text: string; labelKey: string }> = {
  POSITIVE: {
    icon: ShieldCheck,
    ring: 'border-emerald-300/70 dark:border-emerald-800',
    text: 'text-emerald-700 dark:text-emerald-400',
    labelKey: 'verify_assessment_positive',
  },
  MODERATELY_POSITIVE: {
    icon: ShieldAlert,
    ring: 'border-amber-300/70 dark:border-amber-800',
    text: 'text-amber-700 dark:text-amber-400',
    labelKey: 'verify_assessment_moderately_positive',
  },
  NEGATIVE: {
    icon: ShieldX,
    ring: 'border-red-300/70 dark:border-red-900',
    text: 'text-red-700 dark:text-red-400',
    labelKey: 'verify_assessment_negative',
  },
};

export function VerifyReport({
  synthesis,
  evidence,
}: {
  synthesis: VerifySynthesis;
  /** The full research detail, rendered inside the collapsed control. */
  evidence?: React.ReactNode;
}) {
  const { t } = useLanguage();
  const style = VERDICT_STYLE[synthesis.verdict] ?? VERDICT_STYLE.MODERATELY_POSITIVE;
  const VerdictIcon = style.icon;

  const sections = (synthesis.sections ?? [])
    .map((s) => ({ ...s, title: SECTION_TITLE_KEY[s.sectionKey], body: readable(s.text) }))
    .filter((s) => s.title && s.body);

  const reasons = (synthesis.verdictReasons ?? []).map(readable).filter(Boolean);

  return (
    <div className="space-y-5">
      {/* ── The verdict, and why ─────────────────────────────── */}
      <Card className={style.ring}>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-start gap-3">
            <VerdictIcon className={`h-6 w-6 shrink-0 ${style.text}`} aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                {t('verify_assessment_title')}
              </p>
              <p className={`text-xl sm:text-2xl font-bold break-words ${style.text}`}>
                {t(style.labelKey)}
              </p>
            </div>
          </div>

          {reasons.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('verify_report_why')}</p>
              <ul className="space-y-1.5">
                {reasons.map((r) => (
                  <li key={r} className="text-sm text-muted-foreground leading-relaxed break-words ps-4 relative">
                    <span className="absolute start-0 top-[0.6em] h-1 w-1 rounded-full bg-muted-foreground/60" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── The report itself ────────────────────────────────── */}
      {sections.map((s) => (
        <Card key={s.sectionKey}>
          <CardContent className="pt-5 space-y-2">
            <h3 className="text-base font-semibold break-words">{t(s.title!)}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground break-words whitespace-pre-line">
              {s.body}
            </p>
          </CardContent>
        </Card>
      ))}

      {/* ── Coverage, stated as coverage ─────────────────────── */}
      {/* Deliberately NOT styled as a risk. A source we could not reach says
          nothing about the property, and presenting it in warning colours
          beside real findings is how a technical failure starts reading as a
          defect. */}
      {(synthesis.incompleteSources?.length ?? 0) > 0 && (
        <Card>
          <CardContent className="pt-5 space-y-2">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <h3 className="text-sm font-medium break-words">{t('verify_report_incomplete')}</h3>
            </div>
            <p className="text-sm text-muted-foreground break-words">
              {synthesis.incompleteSources!.map(readable).filter(Boolean).join(' · ')}
            </p>
            <p className="text-xs text-muted-foreground/80 leading-relaxed break-words">
              {t('verify_report_incomplete_note')}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Everything else, one control away ────────────────── */}
      {evidence && (
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
          {/* Children are only mounted while open, so the collapsed report
              never pays for hundreds of rows of document and revision detail. */}
          <div className="px-5 pb-5 pt-1 space-y-4">{evidence}</div>
        </details>
      )}
    </div>
  );
}

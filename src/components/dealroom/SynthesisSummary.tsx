// HOMATCH — the customer-facing Verify result.
//
// This replaces the fragmented card dump. The hierarchy is fixed and is the
// order a buyer actually thinks in:
//
//     VERDICT
//   → one conversational explanation
//   → what was confirmed
//   → what needs attention
//   → what could not be verified
//   → what to do next
//   → supporting detail, ON DEMAND ONLY
//
// The underlying evidence is not removed — it moves behind a disclosure, so
// the default view is an explanation rather than a database listing.
//
// Nothing here renders a parser field, a source key, an FSM state, a
// confidence number or raw JSON. `incompleteSources` is shown as plain
// customer language with an explicit note that it says nothing about the
// property, which is the difference between honest coverage reporting and
// implying a defect.
import React, { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { VerdictBanner, type Verdict } from './VerdictBanner';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';

export interface SynthesisSectionView {
  sectionKey: string;
  text: string;
}

export interface SynthesisView {
  verdict: Verdict;
  verdictReasons: string[];
  sections: SynthesisSectionView[];
  incompleteSources: string[];
  empty?: boolean;
}

/** Sections that belong in the "needs attention" band rather than the main
 * narrative. Keeping this as data rather than branching keeps the ordering
 * decision in one readable place. */
const ATTENTION_SECTIONS = new Set(['CONFIRM', 'ASSESSMENT']);
const NEXT_SECTIONS = new Set(['NEXT', 'MEANING']);

export function SynthesisSummary({
  view,
  subtitle,
  loading,
  children,
}: {
  view: SynthesisView | null;
  subtitle?: string | null;
  loading?: boolean;
  /** Supporting evidence, rendered inside the on-demand disclosure. */
  children?: React.ReactNode;
}) {
  const { t } = useLanguage();
  const [showDetail, setShowDetail] = useState(false);

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">{t('dr_summary_generating')}</p>
        </CardContent>
      </Card>
    );
  }

  if (!view) return null;

  const narrative = view.sections.filter(
    (s) => !ATTENTION_SECTIONS.has(s.sectionKey) && !NEXT_SECTIONS.has(s.sectionKey)
  );
  const attention = view.sections.filter((s) => ATTENTION_SECTIONS.has(s.sectionKey));
  const next = view.sections.filter((s) => NEXT_SECTIONS.has(s.sectionKey));

  return (
    <div className="space-y-4">
      <VerdictBanner verdict={view.verdict} reasons={view.verdictReasons} subtitle={subtitle} />

      {view.empty ? (
        <Card>
          <CardContent className="pt-6">
            <p className="measure t-body">{t('dr_summary_empty')}</p>
          </CardContent>
        </Card>
      ) : null}

      {narrative.length > 0 && (
        <Card>
          <CardContent className="pt-5 sm:pt-6 space-y-4">
            <h3 className="t-section">{t('dr_confirmed_title')}</h3>
            {narrative.map((s) => (
              <p key={s.sectionKey} className="measure t-body break-words">
                {s.text}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {attention.length > 0 && (
        <Card>
          <CardContent className="pt-5 sm:pt-6 space-y-3">
            <h3 className="t-section">{t('dr_attention_title')}</h3>
            {attention.map((s) => (
              <p key={s.sectionKey} className="measure t-body break-words">
                {s.text}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {view.incompleteSources.length > 0 && (
        <Card>
          <CardContent className="pt-5 sm:pt-6">
            <h3 className="t-section">{t('dr_unverified_title')}</h3>
            <ul className="mt-3 space-y-1.5">
              {view.incompleteSources.map((s, i) => (
                <li key={i} className="flex gap-2 text-base">
                  <span aria-hidden="true" className="opacity-50">•</span>
                  <span className="min-w-0 break-words">{s}</span>
                </li>
              ))}
            </ul>
            {/* The single most important sentence on this screen: a failed
                check is our problem, not evidence against the property. */}
            <p className="measure mt-4 flex gap-2 text-sm leading-relaxed text-foreground">
              <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span className="min-w-0">{t('dr_unverified_note')}</span>
            </p>
          </CardContent>
        </Card>
      )}

      {next.length > 0 && (
        <Card>
          <CardContent className="pt-5 sm:pt-6 space-y-3">
            <h3 className="t-section">{t('dr_next_title')}</h3>
            {next.map((s) => (
              <p key={s.sectionKey} className="measure t-body break-words">
                {s.text}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {children ? (
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full sm:w-auto justify-center gap-2"
            onClick={() => setShowDetail((v) => !v)}
            aria-expanded={showDetail}
          >
            {showDetail ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {showDetail ? t('dr_evidence_hide') : t('dr_evidence_toggle')}
          </Button>
          {showDetail && <div className="mt-4 space-y-4">{children}</div>}
        </div>
      ) : null}
    </div>
  );
}

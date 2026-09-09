// HOMATCH — the customer's Verify report.
//
// WHAT CHANGED AND WHY
//
// Verify used to render its research output directly: roughly twenty cards in
// a flat list. That was replaced by a synthesis — but the synthesis itself was
// starved, so what the customer got was a verdict card plus a handful of
// one-line sections that repeated the same finding five times.
//
// The synthesis now produces a Buyer Intelligence Report: an editorial
// briefing written from the whole evidence package. So this component stops
// looking like a dashboard of warning cards and starts looking like a
// due-diligence briefing — a comfortable reading column, real headings, real
// paragraphs, and restraint everywhere else.
//
// Design rules held deliberately:
//   - no box around every paragraph, and no accordion per sentence;
//   - the overall view is a line of prose, not a traffic light;
//   - attention points are quiet, because loud styling is how a technical
//     nuance starts reading as a defect;
//   - what could not be confirmed is never styled as risk;
//   - the full research detail stays, one control away.
//
// Nothing here decides anything. Every sentence rendered was produced and
// grounded server-side; this component only decides how it looks.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { FileText, Info, CircleAlert } from 'lucide-react';
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

export interface BuyerIntelligence {
  overallView: { label: OverallLabel; statement: string };
  executiveSummary: string;
  sections: { key: string; title: string; body: string; cites: string[] }[];
  attentionPoints: { point: string; why: string; cites: string[] }[];
  unconfirmed: { item: string; why: string }[];
  buyerActions: { action: string; why: string; cites: string[] }[];
  finalView: string;
  contractUpload: { recommend: boolean; text: string };
}

export interface VerifySynthesis {
  report: BuyerIntelligence | null;
  evidence?: EvidenceRef[];
  incompleteSources?: string[];
  mode?: 'MODEL' | 'DETERMINISTIC';
  empty?: boolean;
}

const OVERALL_KEY: Record<OverallLabel, string> = {
  POSITIVE: 'verify_ir_overall_positive',
  MOSTLY_POSITIVE: 'verify_ir_overall_mostly_positive',
  MIXED: 'verify_ir_overall_mixed',
  NEEDS_ATTENTION: 'verify_ir_overall_attention',
};

/** Paragraph splitting. The model writes prose with blank lines; we render
 *  those as real paragraphs rather than one wall of text. */
const paragraphs = (text: string): string[] =>
  readable(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

const Prose: React.FC<{ text: string }> = ({ text }) => (
  <>
    {paragraphs(text).map((p, i) => (
      <p key={i} className="text-[15px] leading-7 text-foreground/90 break-words">
        {p}
      </p>
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

  const sections = (r.sections ?? []).filter((s) => readable(s.body).trim());
  const refs = new Map((synthesis.evidence ?? []).map((e) => [e.id, e]));

  return (
    <article className="mx-auto max-w-[68ch] space-y-8">
      {/* ── Overall view: a sentence, not a traffic light ───────── */}
      <header className="space-y-3 border-b border-border pb-6">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {t(OVERALL_KEY[r.overallView?.label] ?? OVERALL_KEY.MIXED)}
        </p>
        {r.overallView?.statement ? (
          <p className="text-lg sm:text-xl font-semibold leading-8 break-words">
            {readable(r.overallView.statement)}
          </p>
        ) : null}
      </header>

      {r.executiveSummary ? (
        <section className="space-y-4">
          <Prose text={r.executiveSummary} />
        </section>
      ) : null}

      {/* ── The briefing ────────────────────────────────────────── */}
      {sections.map((s) => (
        <section key={s.key} className="space-y-3">
          <h2 className="text-base font-semibold tracking-tight break-words">{readable(s.title)}</h2>
          <Prose text={s.body} />
          <Citations ids={s.cites} refs={refs} />
        </section>
      ))}

      {/* ── What deserves attention ─────────────────────────────── */}
      {r.attentionPoints?.length ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold tracking-tight break-words">
            {t('verify_ir_attention_title')}
          </h2>
          <ul className="space-y-4">
            {r.attentionPoints.map((a, i) => (
              <li key={i} className="border-s-2 border-amber-400/70 ps-4 space-y-1">
                <p className="text-[15px] leading-7 font-medium break-words">{readable(a.point)}</p>
                {a.why ? (
                  <p className="text-sm leading-6 text-muted-foreground break-words">{readable(a.why)}</p>
                ) : null}
                <Citations ids={a.cites} refs={refs} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── What could not be confirmed ─────────────────────────── */}
      {/* Deliberately NOT styled as risk. A check we could not complete says
          nothing about the property, and putting it in warning colours beside
          real findings is how a technical gap starts reading as a defect. */}
      {r.unconfirmed?.length ? (
        <section className="space-y-3 rounded-xl bg-muted/40 p-5">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-sm font-medium break-words">{t('verify_ir_unconfirmed_title')}</h2>
          </div>
          <ul className="space-y-2">
            {r.unconfirmed.map((u, i) => (
              <li key={i} className="text-sm leading-6 text-muted-foreground break-words">
                {readable(u.item)}
                {u.why ? ` — ${readable(u.why)}` : ''}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground/80 leading-relaxed break-words">
            {t('verify_ir_unconfirmed_note')}
          </p>
        </section>
      ) : null}

      {/* ── What I would do before buying ───────────────────────── */}
      {r.buyerActions?.length ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold tracking-tight break-words">
            {t('verify_ir_actions_title')}
          </h2>
          <ol className="space-y-4">
            {r.buyerActions.map((a, i) => (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 mt-1 h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="text-[15px] leading-7 break-words">{readable(a.action)}</p>
                  {a.why ? (
                    <p className="text-sm leading-6 text-muted-foreground break-words">{readable(a.why)}</p>
                  ) : null}
                  <Citations ids={a.cites} refs={refs} />
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {r.finalView ? (
        <section className="space-y-3 border-t border-border pt-6">
          <Prose text={r.finalView} />
        </section>
      ) : null}

      {/* ── Contract upload, at the end where it belongs ─────────── */}
      {r.contractUpload?.recommend !== false ? (
        <section className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-start gap-3">
            <FileText className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
            <p className="text-sm leading-6 break-words min-w-0">
              {readable(r.contractUpload?.text) || t('verify_ir_upload_body')}
            </p>
          </div>
          {onUploadContract ? (
            <Button variant="outline" className="w-full sm:w-auto gap-2" onClick={onUploadContract}>
              <FileText className="h-4 w-4" />
              {t('verify_ir_upload_cta')}
            </Button>
          ) : null}
        </section>
      ) : null}

      {/* One measured caveat. Not one after every paragraph. */}
      <p className="text-xs text-muted-foreground/80 leading-relaxed break-words">
        {t('verify_ir_disclaimer')}
      </p>

      {evidence ? <EvidenceDrawer>{evidence}</EvidenceDrawer> : null}
    </article>
  );
}

/** Subtle, non-intrusive source indicators. A reader who does not care never
 *  notices them; a reader who does can open the drawer below. */
const Citations: React.FC<{ ids?: string[]; refs: Map<string, EvidenceRef> }> = ({ ids, refs }) => {
  const found = (ids ?? []).map((id) => refs.get(id)).filter((e): e is EvidenceRef => !!e);
  if (!found.length) return null;
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
      {found.slice(0, 6).map((e) =>
        e.url ? (
          <a
            key={e.id}
            href={e.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-muted-foreground/80 underline underline-offset-2 hover:text-foreground break-all"
          >
            {e.source || e.provenance}
          </a>
        ) : (
          <span key={e.id} className="text-[11px] text-muted-foreground/70 break-words">
            {e.source || e.provenance}
          </span>
        )
      )}
    </p>
  );
};

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

/** Kept exported so callers can render an attention icon consistently. */
export const AttentionIcon = CircleAlert;

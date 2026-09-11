// HOMATCH — what the contract actually says, in plain language.
//
// The customer uploaded a contract because they cannot read legal language.
// So this reads like an explanation from someone on their side, not like a
// database dump: no clause identifiers, no confidence scores, no model names,
// no JSON, no internal state words.
//
// Everything shown here is grounded — the pipeline discards anything whose
// wording it could not find verbatim in the document (documentExtract.ts), so
// each item can show the document's own words underneath it. That quote is
// the whole trust model made visible: the customer can check us.
//
// Absences are shown separately from facts, because "the contract does not
// mention a penalty for late handover" is a question to raise, not something
// the document says.

import { AlertTriangle, FileText, HelpCircle, Scale, CalendarClock, Coins, ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import type { DocumentAnalysis, AnalysisState } from '@/services/dealRoomDocuments';

const ATTENTION_KEY: Record<string, string> = {
  ONE_SIDED: 'dr_ca_att_one_sided',
  UNUSUAL: 'dr_ca_att_unusual',
  AMBIGUOUS: 'dr_ca_att_ambiguous',
  MISSING_PROTECTION: 'dr_ca_att_missing',
};

const PARTY_KEY: Record<string, string> = {
  BUYER: 'dr_ca_party_buyer',
  SELLER: 'dr_ca_party_seller',
  DEVELOPER: 'dr_ca_party_developer',
  BOTH: 'dr_ca_party_both',
  UNCLEAR: 'dr_ca_party_unclear',
};

/** The document's own words. Shown small and quoted so it reads as evidence
 * rather than as more of our prose. */
function Quote({ text }: { text: string }) {
  return (
    <p className="mt-1.5 text-xs text-muted-foreground border-s-2 ps-2.5 break-words whitespace-pre-line">
      {text}
    </p>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          {icon}
          {title}
        </h3>
        {children}
      </CardContent>
    </Card>
  );
}

export function ContractAnalysisPanel({
  state,
  analysis,
  busy,
  onAnalyze,
}: {
  state: AnalysisState;
  analysis: DocumentAnalysis | null;
  busy?: boolean;
  onAnalyze: () => void;
}) {
  const { t } = useLanguage();

  // Every non-DONE state gets a plain sentence and, where it makes sense, a
  // way forward. A scan is the common case and must not read like an error.
  if (state !== 'DONE' || !analysis) {
    const messageKey =
      state === 'REQUIRES_OCR'
        ? 'dr_ca_state_requires_ocr'
        : state === 'UNSUPPORTED'
          ? 'dr_ca_state_unsupported'
          : state === 'FAILED'
            ? 'dr_ca_state_failed'
            : state === 'RUNNING' || state === 'QUEUED'
              ? 'dr_ca_analyzing'
              : 'dr_ca_state_none';

    return (
      <Card>
        <CardContent className="pt-5 space-y-3">
          <p className="text-sm text-muted-foreground">{t(messageKey)}</p>
          {state !== 'RUNNING' && state !== 'QUEUED' && (
            <Button size="sm" onClick={onAnalyze} disabled={busy} className="w-full sm:w-auto">
              {t(state === 'NONE' ? 'dr_ca_analyze' : 'dr_ca_reanalyze')}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const attention = analysis.clauses.filter((c) => c.attention !== 'NORMAL');
  const ordinary = analysis.clauses.filter((c) => c.attention === 'NORMAL');

  return (
    <div className="space-y-4">
      {/* A document that contains text shaped like instructions is a fact
          about the document the buyer deserves to know. */}
      {analysis.containsInstructionLikeText && (
        <Card className="border-amber-300 dark:border-amber-800">
          <CardContent className="pt-5">
            <p className="text-sm flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
              <span>{t('dr_ca_instruction_warning')}</span>
            </p>
          </CardContent>
        </Card>
      )}

      {analysis.summary.length > 0 && (
        <Section icon={<FileText className="h-4 w-4" />} title={t('dr_ca_summary')}>
          <div className="space-y-1.5">
            {analysis.summary.map((s, i) => (
              <p key={i} className="text-sm leading-relaxed break-words">
                {s}
              </p>
            ))}
          </div>
        </Section>
      )}

      {attention.length > 0 && (
        <Section icon={<AlertTriangle className="h-4 w-4 text-amber-600" />} title={t('dr_ca_attention')}>
          <div className="space-y-3">
            {attention.map((c, i) => (
              <div key={i}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium break-words">{c.label}</span>
                  {ATTENTION_KEY[c.attention] && (
                    <Badge variant="outline" className="text-[14px]">
                      {t(ATTENTION_KEY[c.attention])}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5 break-words">{c.plain}</p>
                <Quote text={c.quote} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {ordinary.length > 0 && (
        <Section icon={<Scale className="h-4 w-4" />} title={t('dr_ca_clauses')}>
          <div className="space-y-3">
            {ordinary.map((c, i) => (
              <div key={i}>
                <span className="text-sm font-medium break-words">{c.label}</span>
                <p className="text-sm text-muted-foreground mt-0.5 break-words">{c.plain}</p>
                <Quote text={c.quote} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {analysis.obligations.length > 0 && (
        <Section icon={<Scale className="h-4 w-4" />} title={t('dr_ca_obligations')}>
          <div className="space-y-3">
            {analysis.obligations.map((o, i) => (
              <div key={i}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="text-[14px]">
                    {t(PARTY_KEY[o.party] ?? 'dr_ca_party_unclear')}
                  </Badge>
                  <span className="text-sm font-medium break-words">{o.label}</span>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5 break-words">{o.plain}</p>
                <Quote text={o.quote} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {analysis.deadlines.length > 0 && (
        <Section icon={<CalendarClock className="h-4 w-4" />} title={t('dr_ca_deadlines')}>
          <div className="space-y-3">
            {analysis.deadlines.map((d, i) => (
              <div key={i}>
                <span className="text-sm break-words">
                  <span className="font-medium">{d.label}</span>
                  {d.value ? ` — ${d.value}` : ''}
                </span>
                <Quote text={d.quote} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {analysis.financial.length > 0 && (
        <Section icon={<Coins className="h-4 w-4" />} title={t('dr_ca_financial')}>
          <div className="space-y-3">
            {analysis.financial.map((f, i) => (
              <div key={i}>
                <span className="text-sm break-words">
                  <span className="font-medium">{f.label}</span>
                  {f.value ? ` — ${f.value}` : ''}
                </span>
                <Quote text={f.quote} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Absences, kept visibly separate from anything the document states. */}
      {analysis.missingProtections.length > 0 && (
        <Section icon={<HelpCircle className="h-4 w-4" />} title={t('dr_ca_missing')}>
          <div className="space-y-2">
            {analysis.missingProtections.map((m, i) => (
              <div key={i}>
                <span className="text-sm font-medium break-words">{m.label}</span>
                <p className="text-sm text-muted-foreground mt-0.5 break-words">{m.plain}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {analysis.questions.length > 0 && (
        <Section icon={<HelpCircle className="h-4 w-4" />} title={t('dr_ca_questions')}>
          <ul className="space-y-1.5 list-disc ps-5">
            {analysis.questions.map((q, i) => (
              <li key={i} className="text-sm break-words">
                {q}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="text-xs text-muted-foreground px-1">{t('dr_ca_not_legal_advice')}</p>

      <Button size="sm" variant="outline" onClick={onAnalyze} disabled={busy} className="w-full sm:w-auto">
        {t('dr_ca_reanalyze')}
      </Button>
    </div>
  );
}

/*
 * WHAT A CONTRACT SAYS, IN THE ORDER A PERSON ACTUALLY ASKS.
 *
 * The old document reader showed the analyser's own data structure: a type, a
 * summary, then arrays of clauses, obligations, deadlines and financial rows,
 * in the order the model happened to emit them. That is a readout, not an
 * answer, and it left the one question a buyer has — should I sign this? —
 * for the buyer to assemble themselves.
 *
 * The order here is the order the questions arrive in someone's head:
 *
 *   1. What is this document?          — before anything else, name it
 *   2. In plain words                  — the short explanation
 *   3. What you are agreeing to        — the obligations that bind YOU
 *   4. What needs attention            — only the clauses that earned it
 *   5. Money                           — amounts, accounts, what is paid
 *   6. Dates                           — deadlines, in the document's words
 *   7. Who is signing                  — authority, cross-checked if possible
 *   8. What may be missing             — protections a contract like this
 *                                        usually has and this one does not
 *   9. Before you sign                 — the questions to ask out loud
 *
 * EVERY CLAIM CARRIES ITS QUOTE. Nothing on this page asserts anything about
 * the contract without the passage it came from, because a buyer taking this
 * to a lawyer or a seller needs to point at the text, not at Homatch.
 *
 * WHAT IT REFUSES TO DO: it does not score the contract, does not say whether
 * to sign, and does not call anything illegal. Homatch reads documents; it
 * does not practise law, and a confident verdict here would be both wrong and
 * the most dangerous thing on the screen.
 */
import { HelpCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { VerifySection } from '@/components/verify/ui';
import { ContractVerifyMatch } from '@/components/documents/ContractVerifyMatch';
import type { ComparisonRow } from '@/verify/intelligence/contractMatch';
import type { DocumentAnalysis } from '@/services/dealRoomDocuments';

/** A quoted passage, shown wherever a claim needs its source. */
function Quote({ quote, page }: { quote?: string | null; page?: number | null }) {
  const { t } = useLanguage();
  if (!quote) return null;
  return (
    <blockquote className="mt-2 min-w-0 border-s-2 border-border ps-3 text-2xs leading-relaxed text-muted-foreground">
      <span className="break-words">{quote}</span>
      {typeof page === 'number' ? (
        <span className="ms-1 whitespace-nowrap">{t('ct_page')} {page}</span>
      ) : null}
    </blockquote>
  );
}

/** One item: a label, what it means, and the text it came from. */
function Item({
  label, body, quote, page, tone,
}: {
  label: string;
  body?: string | null;
  quote?: string | null;
  page?: number | null;
  tone?: 'attention';
}) {
  return (
    <li
      className={`min-w-0 rounded-xl border p-3 ${
        tone === 'attention'
          ? 'border-amber-500/40 bg-amber-500/5'
          : 'border-border bg-background/40'
      }`}
    >
      <p className="min-w-0 break-words text-sm font-medium text-foreground">{label}</p>
      {body ? (
        <p className="mt-1 min-w-0 break-words text-sm leading-relaxed text-ink-soft">{body}</p>
      ) : null}
      <Quote quote={quote} page={page} />
    </li>
  );
}

const PARTY_KEY: Record<string, string> = {
  BUYER: 'ct_party_buyer',
  SELLER: 'ct_party_seller',
  DEVELOPER: 'ct_party_developer',
  BOTH: 'ct_party_both',
  UNCLEAR: 'ct_party_unclear',
};

const ATTENTION_KEY: Record<string, string> = {
  ONE_SIDED: 'ct_attention_one_sided',
  UNUSUAL: 'ct_attention_unusual',
  AMBIGUOUS: 'ct_attention_ambiguous',
  MISSING_PROTECTION: 'ct_attention_missing_protection',
};

export function ContractResult({
  analysis,
  comparison,
}: {
  analysis: DocumentAnalysis;
  /** Empty when this contract was not uploaded against a verified property. */
  comparison?: ComparisonRow[];
}) {
  const { t } = useLanguage();

  // Only clauses the analyser actually flagged. A list containing every
  // ordinary clause marked NORMAL is a readout again, and it buries the two
  // that matter among forty that do not.
  const flagged = (analysis.clauses ?? []).filter((c) => c.attention && c.attention !== 'NORMAL');

  return (
    /* data-contract-result: the mobile overflow harness waits on this to
       know the result has actually rendered. A generic tag would be
       satisfied by the loading state and measure the wrong screen. */
    <div className="space-y-5" data-contract-result>
      {/* 1 + 2 — name it, then explain it. */}
      <VerifySection
        eyebrow={t('ct_eyebrow_what')}
        title={analysis.documentType || t('ct_unknown_type')}
        accent
      >
        {analysis.summary?.length ? (
          <ul className="space-y-2">
            {analysis.summary.map((line, i) => (
              <li
                key={i}
                className="min-w-0 break-words text-base leading-relaxed text-foreground"
              >
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('ct_no_summary')}</p>
        )}
      </VerifySection>

      {/* 3 — what binds the reader. */}
      {analysis.obligations?.length ? (
        <VerifySection
          eyebrow={t('ct_eyebrow_agree')}
          title={t('ct_obligations_title')}
          subtitle={t('ct_obligations_subtitle')}
        >
          <ul className="space-y-3">
            {analysis.obligations.map((o, i) => (
              <Item
                key={i}
                label={`${t(PARTY_KEY[o.party] ?? 'ct_party_unclear')} — ${o.label}`}
                body={o.plain}
                quote={o.quote}
                page={o.page}
              />
            ))}
          </ul>
        </VerifySection>
      ) : null}

      {/* 4 — only what earned attention. */}
      {flagged.length ? (
        <VerifySection
          eyebrow={t('ct_eyebrow_attention')}
          title={t('ct_attention_title')}
          subtitle={t('ct_attention_subtitle')}
          accent
        >
          <ul className="space-y-3">
            {flagged.map((c, i) => (
              <Item
                key={i}
                tone="attention"
                label={`${c.label} · ${t(ATTENTION_KEY[c.attention] ?? 'ct_attention_unusual')}`}
                body={c.plain}
                quote={c.quote}
                page={c.page}
              />
            ))}
          </ul>
        </VerifySection>
      ) : null}

      {/* 5 — money. */}
      {analysis.financial?.length ? (
        <VerifySection eyebrow={t('ct_eyebrow_money')} title={t('ct_money_title')}>
          <ul className="space-y-3">
            {analysis.financial.map((f, i) => (
              <Item key={i} label={f.label} body={f.value} quote={f.quote} page={f.page} />
            ))}
          </ul>
        </VerifySection>
      ) : null}

      {/* 6 — dates. */}
      {analysis.deadlines?.length ? (
        <VerifySection eyebrow={t('ct_eyebrow_dates')} title={t('ct_dates_title')}>
          <ul className="space-y-3">
            {analysis.deadlines.map((d, i) => (
              <Item key={i} label={d.label} body={d.value} quote={d.quote} page={d.page} />
            ))}
          </ul>
        </VerifySection>
      ) : null}

      {/* 7 — who is signing, cross-checked against the register where we can. */}
      {comparison?.length ? <ContractVerifyMatch rows={comparison} /> : null}

      {/* 8 — what a contract like this usually has, and this one does not. */}
      {analysis.missingProtections?.length ? (
        <VerifySection
          eyebrow={t('ct_eyebrow_missing')}
          title={t('ct_missing_title')}
          subtitle={t('ct_missing_subtitle')}
        >
          <ul className="space-y-3">
            {analysis.missingProtections.map((m, i) => (
              <Item key={i} label={m.label} body={m.plain} />
            ))}
          </ul>
        </VerifySection>
      ) : null}

      {/* 9 — what to ask, out loud, before signing. */}
      {analysis.questions?.length ? (
        <VerifySection
          eyebrow={t('ct_eyebrow_ask')}
          title={t('ct_questions_title')}
          subtitle={t('ct_questions_subtitle')}
        >
          <ul className="space-y-2">
            {analysis.questions.map((q, i) => (
              <li key={i} className="flex min-w-0 gap-2">
                <HelpCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="min-w-0 break-words text-sm leading-relaxed text-foreground">{q}</span>
              </li>
            ))}
          </ul>
        </VerifySection>
      ) : null}

      <p className="min-w-0 break-words px-1 text-2xs leading-relaxed text-muted-foreground">
        {t('ct_disclaimer')}
      </p>
    </div>
  );
}

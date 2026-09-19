/*
 * „დოკუმენტი და Homatch-ის მონაცემები“ — the contract against the check.
 *
 * The one screen where a buyer can see, before they sign, whether the
 * document in front of them describes the property Homatch verified, is sold
 * by the company Homatch identified, and is signed by somebody who may sign
 * for it. All of that evidence already existed; none of it was ever put side
 * by side.
 *
 * THE VISUAL RULE THIS COMPONENT EXISTS TO HOLD
 *
 * Only a real disagreement is allowed to look like one. A contract that does
 * not mention a cadastral code is the normal case, not a warning, and a row
 * of amber markers down a screen teaches people to ignore amber. So:
 *
 *   MATCH         a quiet confirmation
 *   MISMATCH      the only thing that carries weight, and it carries advice
 *   INSUFFICIENT  stated plainly, in muted type, with no icon of alarm
 *
 * Nothing here concludes anything legal. A single signature on a jointly
 * represented company's contract may be perfectly valid on a separate
 * authority, so the representation row asks the buyer to confirm the basis
 * rather than telling them the document is defective.
 */
import { Check, AlertTriangle, Minus } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { VerifySection } from '@/components/verify/ui';
import {
  matchCounts, type ComparisonRow, type MatchState,
} from '@/verify/intelligence/contractMatch';

const FIELD_KEY: Record<ComparisonRow['field'], string> = {
  CADASTRAL: 'cm_field_cadastral',
  ADDRESS: 'cm_field_address',
  COMPANY_NAME: 'cm_field_company',
  COMPANY_ID: 'cm_field_company_id',
  REPRESENTATION: 'cm_field_representation',
};

const STATE_STYLE: Record<MatchState, { icon: typeof Check; tone: string; labelKey: string }> = {
  MATCH: { icon: Check, tone: 'text-emerald-600 dark:text-emerald-400', labelKey: 'cm_state_match' },
  MISMATCH: { icon: AlertTriangle, tone: 'text-amber-700 dark:text-amber-400', labelKey: 'cm_state_mismatch' },
  // Muted on purpose: "the contract does not say" is information, not alarm.
  INSUFFICIENT: { icon: Minus, tone: 'text-muted-foreground', labelKey: 'cm_state_unknown' },
};

export function ContractVerifyMatch({ rows }: { rows: ComparisonRow[] }) {
  const { t } = useLanguage();
  if (!rows.length) return null;

  const counts = matchCounts(rows);

  return (
    <VerifySection
      eyebrow={t('cm_eyebrow')}
      title={t('cm_title')}
      subtitle={t('cm_subtitle')}
      /* The gold hairline only when something genuinely disagrees. */
      accent={counts.MISMATCH > 0}
    >
      <ul className="space-y-3">
        {rows.map((row) => {
          const style = STATE_STYLE[row.state];
          const Icon = style.icon;
          return (
            <li
              key={row.field}
              className="min-w-0 rounded-xl border border-border bg-background/40 p-3"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.tone}`} aria-hidden="true" />
                <span className="min-w-0 break-words text-sm font-medium text-foreground">
                  {t(FIELD_KEY[row.field])}
                </span>
                <span className={`shrink-0 text-2xs ${style.tone}`}>{t(style.labelKey)}</span>
              </div>

              {/*
                * Both sides, labelled, wrapping. Never a table: at 320px a
                * two-column table of Georgian addresses is the
                * one-character-column defect waiting to happen.
                */}
              {row.contractValue || row.verifyValue ? (
                <dl className="mt-2 space-y-1">
                  {row.contractValue ? (
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                      <dt className="shrink-0 text-2xs uppercase tracking-wide text-muted-foreground">
                        {t('cm_side_contract')}
                      </dt>
                      <dd className="min-w-0 flex-1 basis-full break-words text-sm sm:basis-0">
                        {row.contractValue}
                      </dd>
                    </div>
                  ) : null}
                  {row.verifyValue ? (
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                      <dt className="shrink-0 text-2xs uppercase tracking-wide text-muted-foreground">
                        {t('cm_side_verify')}
                      </dt>
                      <dd className="min-w-0 flex-1 basis-full break-words text-sm sm:basis-0">
                        {row.verifyValue}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}

              {/* Advice only where the row earned it. */}
              {row.noteKey ? (
                <p className="mt-2 min-w-0 break-words text-sm leading-relaxed text-muted-foreground">
                  {t(row.noteKey)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="mt-4 min-w-0 break-words border-t border-border pt-3 text-2xs leading-relaxed text-muted-foreground">
        {t('cm_footnote')}
      </p>
    </VerifySection>
  );
}

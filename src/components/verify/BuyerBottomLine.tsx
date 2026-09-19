/*
 * „რას ნიშნავს ეს ყველაფერი მყიდველისთვის" — THE PART THAT WAS MISSING.
 *
 * The report ended with one model sentence under a heading and stopped. A
 * buyer who has just read nine sections about a flat has three questions left
 * and the report answered none of them directly:
 *
 *   What looks good?
 *   What should I still verify?
 *   How much do those remaining questions actually matter?
 *
 * WHY THIS IS ASSEMBLED RATHER THAN WRITTEN.
 *
 * The obvious fix is to ask the model for a closing paragraph. That produces
 * fluent text whose relationship to the evidence nobody can check, and it
 * cannot be applied to the reports already stored — the acceptance fixture is
 * a report nobody may re-run.
 *
 * So the closing is ASSEMBLED from what the run already established: the
 * positives are the highlights the model itself marked POSITIVE, the open
 * questions are the ones the run genuinely left open, and the final judgement
 * — limited or material — is a count, not an opinion. The model's own sentence
 * still leads, because it is the one piece of genuine synthesis prose the run
 * produced.
 *
 * WHAT IT WILL NOT SAY. It never advises buying, never calls a property safe,
 * and never converts "we did not check" into "there is nothing wrong". The
 * closing judgement is about the SIZE of what is unknown, which is a fact
 * about the report, not a promise about the building.
 */
import { ThumbsUp, HelpCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { VerifySection } from '@/components/verify/ui';
import type { UnconfirmedItem } from '@/verify/intelligence/buyerSummary';

export interface BottomLineHighlight {
  headline?: unknown;
  sentiment?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** How many points each column may carry before it stops being a summary. */
const COLUMN_LIMIT = 4;

export function BuyerBottomLine({
  finalView,
  highlights,
  openQuestions,
  clean,
}: {
  /** The model's own closing sentence, already scrubbed by the caller. */
  finalView?: string;
  highlights: BottomLineHighlight[];
  openQuestions: UnconfirmedItem[];
  /** The report's text gate, passed in so one scrubber serves the page. */
  clean: (s: unknown) => string;
}) {
  const { t } = useLanguage();

  const positives = highlights
    .filter((h) => str(h.sentiment).toUpperCase() === 'POSITIVE')
    .map((h) => clean(h.headline))
    .filter(Boolean)
    .slice(0, COLUMN_LIMIT);

  const attention = highlights
    .filter((h) => str(h.sentiment).toUpperCase() === 'ATTENTION')
    .map((h) => clean(h.headline))
    .filter(Boolean);

  // The things to go and check: what the model flagged, plus what the run
  // could not establish. Deduplicated, because a reader does not care which
  // half of the system noticed.
  const toVerify = [
    ...attention,
    ...openQuestions.map((q) => t(q.key)),
  ].filter((v, i, all) => v && all.indexOf(v) === i).slice(0, COLUMN_LIMIT);

  const material = openQuestions.filter((q) => q.weight === 'MATERIAL').length;

  if (!finalView && !positives.length && !toVerify.length) return null;

  return (
    <VerifySection
      eyebrow={t('verify_bottom_eyebrow')}
      title={t('verify_bottom_title')}
      accent
    >
      <div className="space-y-5">
        {finalView ? (
          <p className="min-w-0 break-words text-[15px] leading-7 text-foreground/90">
            {finalView}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          {positives.length ? (
            <div className="min-w-0 space-y-2">
              <p className="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-muted-foreground">
                <ThumbsUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t('verify_bottom_good')}
              </p>
              <ul className="space-y-1.5">
                {positives.map((p, i) => (
                  <li key={i} className="min-w-0 break-words text-sm leading-relaxed text-foreground">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {toVerify.length ? (
            <div className="min-w-0 space-y-2">
              <p className="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-muted-foreground">
                <HelpCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t('verify_bottom_verify')}
              </p>
              <ul className="space-y-1.5">
                {toVerify.map((v, i) => (
                  <li key={i} className="min-w-0 break-words text-sm leading-relaxed text-foreground">
                    {v}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {/*
          * How much the remaining unknowns weigh — a count, not a verdict, and
          * never a statement that the property is safe.
          */}
        <p className="min-w-0 break-words border-t border-border pt-3 text-sm leading-relaxed text-ink-soft">
          {material ? t('verify_bottom_material') : t('verify_bottom_limited')}
        </p>

        <p className="min-w-0 break-words text-2xs leading-relaxed text-muted-foreground">
          {t('verify_bottom_disclaimer')}
        </p>
      </div>
    </VerifySection>
  );
}

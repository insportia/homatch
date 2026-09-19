/*
 * ELECTRICITY, WATER, GAS, SEWAGE — AND WHAT WE ACTUALLY KNOW ABOUT THEM.
 *
 * The research core has produced a utilities matrix for as long as it has
 * existed. Nothing rendered it: `utilitiesMatrix` appears nowhere in the
 * report, so a buyer asking the most ordinary question about a flat — is it
 * connected — got no answer at all, whether or not the run had one.
 *
 * THE LADDER IS THE WHOLE POINT.
 *
 * "Not verified" and "not available" are different claims and only one of them
 * is ever true. A building with no confirmed gas connection may be fully
 * connected and simply undocumented in the sources this run reached; printing
 * that as "no gas" would be inventing a defect in somebody's property.
 *
 *   CONFIRMED      an official or primary source says so
 *   REPORTED       a secondary source says so — real, weaker
 *   NOT_VERIFIED   nobody the run reached said either way
 *   CONFLICTING    two sources disagree, which is itself a finding
 *
 * NOT_VERIFIED is the default and is styled as neutral, because it is the
 * honest state of most things about most buildings, and an amber row for every
 * unchecked utility would teach a reader that amber means nothing.
 */
import { Zap, Droplets, Flame, Waves, Wifi, Check, Minus, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { VerifySection } from '@/components/verify/ui';

export type UtilityConfidence = 'CONFIRMED' | 'REPORTED' | 'NOT_VERIFIED' | 'CONFLICTING';

/** The matrix the research core writes, read defensively. */
export interface UtilitiesLike {
  electricity?: unknown;
  water?: unknown;
  gas?: unknown;
  sewage?: unknown;
  internet?: unknown;
}

const UTILITIES: { key: keyof UtilitiesLike; icon: typeof Zap; labelKey: string }[] = [
  { key: 'electricity', icon: Zap, labelKey: 'verify_util_electricity' },
  { key: 'water', icon: Droplets, labelKey: 'verify_util_water' },
  { key: 'gas', icon: Flame, labelKey: 'verify_util_gas' },
  { key: 'sewage', icon: Waves, labelKey: 'verify_util_sewage' },
  { key: 'internet', icon: Wifi, labelKey: 'verify_util_internet' },
];

const STATE: Record<UtilityConfidence, { icon: typeof Check; tone: string; labelKey: string }> = {
  CONFIRMED: { icon: Check, tone: 'text-emerald-600 dark:text-emerald-400', labelKey: 'verify_util_confirmed' },
  REPORTED: { icon: Check, tone: 'text-muted-foreground', labelKey: 'verify_util_reported' },
  // Neutral on purpose: the ordinary state of an unchecked thing.
  NOT_VERIFIED: { icon: Minus, tone: 'text-muted-foreground', labelKey: 'verify_util_not_verified' },
  CONFLICTING: { icon: AlertTriangle, tone: 'text-amber-700 dark:text-amber-400', labelKey: 'verify_util_conflicting' },
};

/**
 * Maps whatever the run stored onto the ladder.
 *
 * The research core's own vocabulary is CONFIRMED_CONNECTED /
 * CONFIRMED_NOT_CONNECTED / NOT_MENTIONED. NOT_MENTIONED means the sources
 * were silent, which is NOT_VERIFIED — never "not connected".
 */
export function utilityConfidence(entry: unknown): { level: UtilityConfidence; note: string } {
  const e = (entry ?? null) as { status?: unknown; note?: unknown } | null;
  const status = typeof e?.status === 'string' ? e.status.toUpperCase() : '';
  const note = typeof e?.note === 'string' ? e.note.trim() : '';

  if (status === 'CONFLICTING') return { level: 'CONFLICTING', note };
  if (status === 'CONFIRMED_CONNECTED' || status === 'CONFIRMED_NOT_CONNECTED') {
    return { level: 'CONFIRMED', note };
  }
  if (status === 'REPORTED' || status === 'INDICATED') return { level: 'REPORTED', note };
  return { level: 'NOT_VERIFIED', note };
}

export function UtilitiesCard({ utilities }: { utilities?: UtilitiesLike | null }) {
  const { t } = useLanguage();

  /*
   * Rendered even when the matrix is absent.
   *
   * A missing section reads as "this does not apply"; a present section with
   * every row saying "not yet verified" reads as what it is — a question this
   * run did not answer, which the buyer can then go and ask.
   */
  const rows = UTILITIES.map((u) => ({
    ...u,
    ...utilityConfidence(utilities ? utilities[u.key] : null),
  }));

  return (
    <VerifySection
      eyebrow={t('verify_util_eyebrow')}
      title={t('verify_util_title')}
      subtitle={t('verify_util_subtitle')}
      accent={rows.some((r) => r.level === 'CONFLICTING')}
    >
      <ul className="space-y-2">
        {rows.map((r) => {
          const style = STATE[r.level];
          const Icon = r.icon;
          const Mark = style.icon;
          return (
            <li
              key={String(r.key)}
              className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-border bg-background/40 p-3"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 basis-full break-words text-sm font-medium text-foreground sm:basis-0">
                {t(r.labelKey)}
              </span>
              <span className={`inline-flex shrink-0 items-center gap-1 text-2xs ${style.tone}`}>
                <Mark className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="break-words">{t(style.labelKey)}</span>
              </span>
              {r.note ? (
                <span className="min-w-0 basis-full break-words text-2xs leading-relaxed text-muted-foreground">
                  {r.note}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="mt-3 min-w-0 break-words text-2xs leading-relaxed text-muted-foreground">
        {t('verify_util_footnote')}
      </p>
    </VerifySection>
  );
}

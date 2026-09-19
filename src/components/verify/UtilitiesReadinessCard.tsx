/*
 * UTILITIES & SITE READINESS.
 *
 * For a flat this is background. For LAND it is most of the question, and
 * most of the cost: a parcel with a live electricity account and a water main
 * at the boundary is a different asset from one with neither. The report used
 * to render all of it as a label, a three-state badge and a grey note — which
 * threw away the provider, what the source actually confirmed, what it was
 * tied to, and when it said so.
 *
 * WHY EACH UTILITY IS ITS OWN BLOCK
 *
 * The previous layout put the label and the status badge on one flex row.
 * Measured on a real 320px Chrome in Georgian, that crushed "ელექტროენერგია"
 * to 65px across three lines and "ინტერნეტი" to 45px: the badge could not
 * shrink, so the label was squeezed below its own content width. A block per
 * utility removes the competition entirely — the label owns its line at every
 * width, and the detail sits under it where there is room to read it.
 *
 * WHAT IS NEVER SHOWN
 *
 * An overall readiness verdict. One live electricity account says nothing
 * about water, gas or a road, and a single summary figure would imply it did.
 * Each finding is presented on its own evidence, and a utility nothing was
 * established about is shown as UNKNOWN rather than hidden — an absent row
 * reads as "not applicable", which is a different and unearned claim.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ExternalLink } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  normalizeUtilities, isLandReport, establishedCount,
  type UtilityFinding, type UtilityReadiness, type UtilityKind,
} from '@/verify/utilities';

const KIND_KEY: Record<UtilityKind, string> = {
  ELECTRICITY: 'util_kind_electricity',
  WATER: 'util_kind_water',
  SEWERAGE: 'util_kind_sewerage',
  GAS: 'util_kind_gas',
  INTERNET: 'util_kind_internet',
  ACCESS_ROAD: 'util_kind_access_road',
};

const READINESS_KEY: Record<UtilityReadiness, string> = {
  UNKNOWN: 'util_state_unknown',
  NOT_CONNECTED: 'util_state_not_connected',
  NEARBY: 'util_state_nearby',
  AVAILABLE_FOR_CONNECTION: 'util_state_available',
  APPLICATION_OR_CONNECTION_IN_PROGRESS: 'util_state_in_progress',
  CONNECTED: 'util_state_connected',
  ACTIVE_OR_SUBSCRIBED: 'util_state_active',
};

/**
 * Colour carries meaning here and nowhere else on this card.
 *
 * Green is reserved for a state that was positively established on the
 * ground — connected, or supplied today. Everything between is neutral with
 * a gold rule, because "you could connect this" is a fact about possibility,
 * not about the site. UNKNOWN is quiet on purpose: it is the absence of a
 * finding and must not compete with findings for attention.
 */
function readinessClass(r: UtilityReadiness): string {
  switch (r) {
    case 'ACTIVE_OR_SUBSCRIBED':
    case 'CONNECTED':
      return 'border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300';
    case 'APPLICATION_OR_CONNECTION_IN_PROGRESS':
    case 'AVAILABLE_FOR_CONNECTION':
    case 'NEARBY':
      return 'border-[hsl(var(--primary))]/40 bg-[hsl(var(--primary))]/10 text-foreground';
    case 'NOT_CONNECTED':
      return 'border-destructive/40 bg-destructive/5 text-destructive';
    default:
      return 'border-border bg-muted/40 text-muted-foreground';
  }
}

function Finding({ f }: { f: UtilityFinding }) {
  const { t } = useLanguage();
  const established = f.readiness !== 'UNKNOWN';
  return (
    <div className={`min-w-0 rounded-xl border p-3 ${established ? 'border-border bg-card' : 'border-border/60 bg-muted/20'}`}>
      {/* The label owns its own line at narrow widths; the badge follows it
          and wraps rather than squeezing it. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="fact min-w-0 break-words text-sm">{t(KIND_KEY[f.kind])}</span>
        <Badge variant="outline" className={`whitespace-normal text-start font-normal normal-case ${readinessClass(f.readiness)}`}>
          {t(READINESS_KEY[f.readiness])}
        </Badge>
        {f.verified ? (
          <span className="text-2xs uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            {t('util_verified')}
          </span>
        ) : null}
      </div>

      {/* What the source actually confirms, in its own terms. */}
      {f.confirms ? <p className="caveat mt-1.5 break-words">{f.confirms}</p> : null}

      {(f.provider || f.linkage || f.asOf || f.confidence) ? (
        <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
          {f.provider ? (
            <div className="min-w-0 break-words">
              <dt className="inline text-muted-foreground">{t('util_provider')}: </dt>
              <dd className="inline">{f.provider}</dd>
            </div>
          ) : null}
          {f.linkage ? (
            <div className="min-w-0 break-words">
              <dt className="inline text-muted-foreground">{t('util_linkage')}: </dt>
              <dd className="inline">{f.linkage}</dd>
            </div>
          ) : null}
          {f.asOf ? (
            <div className="min-w-0 break-words">
              <dt className="inline text-muted-foreground">{t('util_as_of')}: </dt>
              <dd className="inline tabular-nums">{f.asOf}</dd>
            </div>
          ) : null}
          {f.confidence ? (
            <div className="min-w-0 break-words">
              <dt className="inline text-muted-foreground">{t('util_confidence')}: </dt>
              <dd className="inline">{t(`util_conf_${f.confidence.toLowerCase()}`)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {f.evidence.length ? (
        <ul className="mt-2 space-y-1">
          {f.evidence.map((e, i) => (
            <li key={`${e.url ?? e.label}-${i}`} className="min-w-0 text-xs">
              {e.url ? (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-start gap-1 break-words text-primary underline underline-offset-2"
                >
                  <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">{e.label ?? e.url}</span>
                </a>
              ) : (
                <span className="break-words text-muted-foreground">{e.label}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function UtilitiesReadinessCard({ report }: { report: unknown }) {
  const { t } = useLanguage();
  const findings = normalizeUtilities(report);
  if (!findings.length) return null;

  const land = isLandReport(report);
  const established = establishedCount(findings);

  return (
    <Card className={land ? 'border-[hsl(var(--primary))]/35' : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {t(land ? 'util_title_land' : 'util_title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* An honest count, never a score. */}
        <p className="caveat">
          {t('util_established_count')
            .replace('{n}', String(established))
            .replace('{total}', String(findings.length))}
        </p>
        {land ? <p className="caveat">{t('util_land_note')}</p> : null}

        <div className="grid grid-cols-1 gap-2">
          {findings.map((f) => <Finding key={f.kind} f={f} />)}
        </div>

        {/* The boundary, stated where somebody might otherwise cross it. */}
        <p className="caveat pt-1">{t('util_no_inference_note')}</p>
      </CardContent>
    </Card>
  );
}

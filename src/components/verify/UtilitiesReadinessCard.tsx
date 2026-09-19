/*
 * UTILITIES & SITE READINESS.
 *
 * For a flat this is background. For land it is most of the question, and most
 * of the cost between buying and building. The evidence model behind it is
 * unchanged — the same ladder, the same provenance, the same refusal to infer
 * one utility from another.
 *
 * WHAT CHANGED IS WHICH OF IT YOU SEE FIRST.
 *
 * Every utility used to get an identical block, so a report with one live
 * electricity account and five unestablished services showed one finding and
 * five near-empty cards of equal weight. The reader's eye went to the
 * absences, and the product read as a list of things Homatch had failed to
 * find.
 *
 * Established findings now come first and carry their evidence. Everything
 * still unknown is named ONCE, in a single quiet line at the end — not hidden,
 * not repeated six times, and not dressed up as anything other than what it
 * is. Unknown remains unknown; it just stops being the loudest thing here.
 *
 * THE LAYOUT RULE
 *
 * A label never shares a flex row with something that will not shrink. The
 * name of a utility and its status sit in a wrapping row, and the detail sits
 * beneath in a Row that gives the label its own line below `sm`. That is what
 * stops "ელექტროენერგია" being squeezed into a column one character wide.
 */
import { Fragment } from 'react';
import { ExternalLink } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { VerifySection, Row, RowList, StatusPill, type StatusTone } from './ui';
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

/** Colour still means what it meant: established, in motion, absent, unknown. */
function toneFor(r: UtilityReadiness): StatusTone {
  switch (r) {
    case 'ACTIVE_OR_SUBSCRIBED':
    case 'CONNECTED':
      return 'confirmed';
    case 'APPLICATION_OR_CONNECTION_IN_PROGRESS':
    case 'AVAILABLE_FOR_CONNECTION':
    case 'NEARBY':
      return 'attention';
    case 'NOT_CONNECTED':
      return 'risk';
    default:
      return 'quiet';
  }
}

function Established({ f }: { f: UtilityFinding }) {
  const { t } = useLanguage();
  return (
    <div className="min-w-0 rounded-xl border border-border bg-background/40 p-4">
      {/* The name owns its line on a phone; the status wraps under it rather
          than competing with it for width. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 break-words font-display text-base font-semibold text-foreground">
          {t(KIND_KEY[f.kind])}
        </span>
        <StatusPill tone={toneFor(f.readiness)}>{t(READINESS_KEY[f.readiness])}</StatusPill>
        {f.verified ? (
          <span className="text-2xs uppercase tracking-wider text-emerald-400">{t('util_verified')}</span>
        ) : null}
      </div>

      {f.confirms ? (
        <p className="mt-2 min-w-0 break-words text-sm leading-relaxed text-muted-foreground">{f.confirms}</p>
      ) : null}

      {(f.provider || f.linkage || f.asOf) ? (
        <RowList className="mt-3">
          {f.provider ? <Row label={t('util_provider')}>{f.provider}</Row> : null}
          {f.linkage ? <Row label={t('util_linkage')}>{f.linkage}</Row> : null}
          {f.asOf ? <Row label={t('util_as_of')}><span className="tabular-nums">{f.asOf}</span></Row> : null}
        </RowList>
      ) : null}

      {f.evidence.length ? (
        <ul className="mt-3 space-y-1.5">
          {f.evidence.map((e, i) => (
            <li key={`${e.url ?? e.label}-${i}`} className="min-w-0 text-xs">
              {e.url ? (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-start gap-1.5 text-[hsl(var(--gold-ink))] underline underline-offset-2"
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
  const established = findings.filter((f) => f.readiness !== 'UNKNOWN');
  const unknown = findings.filter((f) => f.readiness === 'UNKNOWN');

  return (
    <VerifySection
      eyebrow={land ? t('util_eyebrow_land') : undefined}
      title={t(land ? 'util_title_land' : 'util_title')}
      subtitle={land ? t('util_land_note') : undefined}
      accent={land && established.length > 0}
    >
      {established.length ? (
        <div className="grid grid-cols-1 gap-3">
          {established.map((f) => <Established key={f.kind} f={f} />)}
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-muted-foreground">{t('util_none_established')}</p>
      )}

      {/*
        * THE UNKNOWNS, ONCE.
        *
        * Named so nobody mistakes their absence for a negative finding, and
        * stated in one line so they cannot outweigh what was established.
        */}
      {unknown.length ? (
        <p className="mt-4 min-w-0 break-words border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">{t('util_state_unknown')}: </span>
          {unknown.map((f, i) => (
            <Fragment key={f.kind}>
              {i > 0 ? ' · ' : ''}
              {t(KIND_KEY[f.kind])}
            </Fragment>
          ))}
          {'. '}
          {t('util_unknown_note')}
        </p>
      ) : null}

      {established.length > 0 ? (
        <p className="mt-3 min-w-0 break-words text-2xs leading-relaxed text-muted-foreground">
          {t('util_no_inference_note')}
        </p>
      ) : null}

      <span className="sr-only">
        {t('util_established_count')
          .replace('{n}', String(establishedCount(findings)))
          .replace('{total}', String(findings.length))}
      </span>
    </VerifySection>
  );
}

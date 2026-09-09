// HOMATCH — the research loading experience.
//
// WHAT THIS REPLACES
//
// A progress bar driven by `progress.percent`, which the backend sets to
// round numbers per phase (5, 60, 72...). It looked like measured progress
// and was not: a job could sit at 72% for ten minutes and then finish, or
// jump 60 -> 100. A percentage that does not measure anything is a lie told
// with a number, and it is worse than no number at all because the customer
// plans around it.
//
// So there is no percentage here. There is:
//
//   - ELAPSED TIME, which is true and which we can measure;
//   - a rotating stream of abstract activity labels;
//   - the property's identity, appearing only once it is genuinely known.
//
// WHAT THE LABELS ARE AND ARE NOT
//
// The technical rows are PRESENTATION. They describe the shape of the work
// (resolving identity, comparing market signals) and are deliberately
// abstract: they never name a website, a provider, a worker, an internal
// state or a prompt, and they never claim a specific source succeeded. They
// are not evidence, are never persisted, and nothing downstream reads them.
// A customer should understand that Homatch is working without learning how
// Homatch works.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

/** Abstract activity rows. Shape of work only — never a source or a result. */
const STREAM_KEYS = [
  'verify_stream_identity',
  'verify_stream_entities',
  'verify_stream_records',
  'verify_stream_location',
  'verify_stream_market',
  'verify_stream_temporal',
  'verify_stream_evidence',
  'verify_stream_buyer',
  'verify_stream_synthesis',
] as const;

/** Paired machine-ish labels, purely decorative. */
const TAGS = [
  'ENTITY_GRAPH :: LINK_RESOLUTION',
  'PROPERTY_VECTOR :: NORMALIZED',
  'GEO_CONTEXT :: RESOLVING',
  'MARKET_SIGNAL :: INDEXING',
  'TEMPORAL_CONTEXT :: ANALYZING',
  'EVIDENCE_GRAPH :: RECONCILING',
  'BUYER_MODEL :: SYNTHESIS_PENDING',
];

const two = (n: number): string => String(n).padStart(2, '0');

export function ResearchStream({
  subject,
  /** True once research finished and only the AI report is still being built. */
  synthesizing = false,
}: {
  subject?: string | null;
  synthesizing?: boolean;
}) {
  const { t } = useLanguage();
  const [elapsed, setElapsed] = React.useState(0);
  const [step, setStep] = React.useState(0);

  /*
   * The start time lives HERE, in a ref, not in a prop.
   *
   * It was a prop, and the interval effect depended on it. Every rewrite of
   * that prop tore the interval down and rebuilt it, more often than once a
   * second — so it never ticked and the clock froze at 00:03 in production.
   * This component mounts when a run begins and unmounts when it ends, so its
   * own mount time IS the run start, and nothing outside can reset it.
   */
  const startedAt = React.useRef(Date.now());

  React.useEffect(() => {
    const tick = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)),
      1000
    );
    return () => clearInterval(tick);
  }, []);

  React.useEffect(() => {
    // Advances on its own. It is a sense of motion, not a measurement, so it
    // deliberately does not map to backend phases.
    const rotate = setInterval(() => setStep((s) => s + 1), 3200);
    return () => clearInterval(rotate);
  }, []);

  const mm = Math.floor(elapsed / 60);
  const ss = elapsed % 60;

  // While synthesizing, the stream is pinned to the final row: research is
  // genuinely done and only the report is outstanding, and rotating through
  // earlier rows would misdescribe that.
  const visible = synthesizing
    ? [STREAM_KEYS[STREAM_KEYS.length - 1]]
    : [0, 1, 2].map((o) => STREAM_KEYS[(step + o) % STREAM_KEYS.length]);

  return (
    <section
      aria-live="polite"
      aria-label={t(synthesizing ? 'verify_stream_synth_title' : 'verify_stream_title')}
      className="rounded-2xl border border-border bg-card/60 p-5 sm:p-6 space-y-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold break-words">
            {t(synthesizing ? 'verify_stream_synth_title' : 'verify_stream_title')}
          </p>
          {subject ? (
            <p className="text-xs text-muted-foreground break-all">{subject}</p>
          ) : null}
        </div>
        {/* Truthful: this is measured, not estimated. No remaining-time guess. */}
        <p className="shrink-0 tabular-nums text-sm text-muted-foreground">
          {two(mm)}:{two(ss)}
        </p>
      </div>

      {/* Three soft pulsing bars. Motion, not measurement. */}
      <div className="flex gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1 flex-1 rounded-full bg-primary/20 overflow-hidden"
          >
            <span
              className="block h-full w-1/3 rounded-full bg-primary/70 animate-pulse"
              style={{ animationDelay: `${i * 260}ms` }}
            />
          </span>
        ))}
      </div>

      <ul className="space-y-2">
        {visible.map((k, i) => (
          <li
            key={`${k}-${step}-${i}`}
            className={`flex items-start gap-3 transition-opacity duration-500 ${
              i === 0 ? 'opacity-100' : i === 1 ? 'opacity-70' : 'opacity-40'
            }`}
          >
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-sm break-words">{t(k)}</span>
              <span className="block text-[10px] uppercase tracking-wider text-muted-foreground/60 break-words">
                {TAGS[(step + i) % TAGS.length]}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <p className="text-xs leading-relaxed text-muted-foreground break-words">
        {t('verify_stream_note')}
      </p>
    </section>
  );
}

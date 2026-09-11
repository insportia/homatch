import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, FileText, Upload } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { FeatureGlyph } from '@/components/home/FeatureGlyph';
import { PAGE, SECTION_Y } from './primitives';
import { useSectionField } from '@/site/content';

/**
 * REGION 05 — Contract Intelligence.
 *
 * The one capability that had a launcher tile and nothing else. A contract is
 * also the hardest thing on this page to explain in a sentence, because what
 * the product does is not "read a PDF" but "tell a person which paragraph
 * they should be worried about and why, in words they use".
 *
 * So the region is the reading itself, in four steps: the document arrives,
 * it is read, a clause is singled out, and the clause is explained. A visitor
 * steps through it, or it steps itself.
 *
 * WHAT IT REFUSES TO DO
 *
 * There is no contract text, no party, no address, no sum and no verdict.
 * A marketing page that prints a plausible-looking clause and calls it
 * risky is writing legal fiction about somebody's purchase. The document is
 * drawn as lines, the singled-out clause is a highlighted band, and the
 * explanation is about the KIND of thing Homatch surfaces rather than a
 * finding it has made. The region says in its own footnote that this is an
 * illustration and not advice.
 */

const STEPS = [
  { key: 'upload', label: 'mp_ci_step_1', note: 'mp_ci_step_1_d' },
  { key: 'read', label: 'mp_ci_step_2', note: 'mp_ci_step_2_d' },
  { key: 'clause', label: 'mp_ci_step_3', note: 'mp_ci_step_3_d' },
  { key: 'explain', label: 'mp_ci_step_4', note: 'mp_ci_step_4_d' },
] as const;

export function ContractIntelligenceSection() {
  const sf = useSectionField();
  const { session } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [held, setHeld] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const reduced = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      reduced.current = still.matches;
      setAutoplay(!still.matches);
    };
    sync();
    still.addEventListener('change', sync);
    return () => still.removeEventListener('change', sync);
  }, []);

  /* It walks itself so the idea lands without interaction, and stops the
     moment a visitor touches it, because something that advances under a
     thumb is worse than something that waits. */
  useEffect(() => {
    if (!autoplay || held) return;
    const id = window.setInterval(() => setStep(s => (s + 1) % STEPS.length), 2800);
    return () => window.clearInterval(id);
  }, [autoplay, held]);

  return (
    <section id="contract" className={`${PAGE} scroll-mt-20 border-t border-border ${SECTION_Y}`}>
      <div
        className="grid gap-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-center lg:gap-16"
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => setHeld(false)}
        onFocusCapture={() => setHeld(true)}
        onBlurCapture={() => setHeld(false)}
      >
        {/* ── The argument ─────────────────────────────────────── */}
        <div className="min-w-0">
          <div className="flex items-center gap-3.5">
            <FeatureGlyph name="contract" size={48} className="sm:h-14 sm:w-14" />
            <p className="min-w-0 text-[13px] font-semibold uppercase tracking-[0.22em] text-gold-ink">
              {sf('eyebrow', 'mp_contract_title')}
            </p>
          </div>

          <h2
            className="mt-6 text-balance font-semibold leading-[1.1] tracking-[-0.025em] text-foreground sm:mt-7"
            style={{ fontSize: 'clamp(1.4rem, 5.6vw, 2.75rem)' }}
          >
            {sf('title', 'mp_ci_title')}
          </h2>
          <p className="mt-4 max-w-[34rem] text-pretty text-[16px] leading-[1.65] text-ink-soft sm:mt-5 sm:text-base sm:leading-[1.7]">
            {sf('body', 'mp_ci_sub')}
          </p>

          {/* The four steps are the control. Each is a real button, so the
              whole simulation is reachable by keyboard and readable with no
              animation at all. */}
          <ol className="mt-7 grid gap-px overflow-hidden rounded-[0.9rem] border border-foreground/[0.14] bg-foreground/10 sm:mt-9">
            {STEPS.map((s, i) => {
              const on = i === step;
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => setStep(i)}
                    aria-current={on}
                    className={`flex w-full items-start gap-3.5 p-4 text-start transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none ${
                      on ? 'bg-secondary' : 'bg-card hover:bg-secondary/60'
                    }`}
                  >
                    <span
                      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[13px] font-semibold tabular-nums transition-colors duration-200 motion-reduce:transition-none ${
                        on ? 'bg-primary text-primary-foreground' : 'border border-foreground/25 text-muted-foreground'
                      }`}
                      aria-hidden="true"
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-[16px] leading-snug transition-colors duration-200 motion-reduce:transition-none ${
                          on ? 'font-semibold text-foreground' : 'font-medium text-ink-soft'
                        }`}
                      >
                        {t(s.label)}
                      </span>
                      {on && (
                        <span className="mt-1 block text-pretty text-[15px] leading-relaxed text-muted-foreground">
                          {t(s.note)}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <button
            type="button"
            onClick={() => navigate(session ? '/verify' : '/auth/signup')}
            className="group mt-7 inline-flex h-auto min-h-[3rem] items-center justify-center gap-2.5 rounded-full bg-primary px-6 py-3 text-center text-sm font-semibold text-primary-foreground transition-colors duration-300 hover:bg-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none sm:mt-9"
          >
            <Upload className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {t('mp_contract_cta')}
            <ArrowRight
              className={`h-4 w-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : ''}`}
              strokeWidth={2}
              aria-hidden="true"
            />
          </button>
          <p className="mt-3 max-w-[30rem] text-xs leading-relaxed text-muted-foreground">
            {t('mp_contract_formats')}
          </p>
        </div>

        {/* ── The document ─────────────────────────────────────── */}
        <DocumentPanel step={step} />
      </div>
    </section>
  );
}

/**
 * The document, at whichever step is selected. Everything in it is shape:
 * the page is ruled lines, the clause under attention is a gold band, and
 * the explanation panel carries the kind of question Homatch answers rather
 * than an answer about somebody's real contract.
 */
function DocumentPanel({ step }: { step: number }) {
  const { t } = useLanguage();

  /* Line 6 is the clause the illustration singles out. */
  const LINES = [96, 88, 92, 74, 90, 86, 70, 93, 80, 62];
  const CLAUSE = 6;

  return (
    <div
      className="min-w-0 overflow-hidden rounded-[1.1rem] border border-foreground/15 bg-card shadow-hover"
      role="img"
      aria-label={t('mp_ci_panel_alt')}
    >
      <div className="flex items-center justify-between gap-3 border-b border-foreground/[0.12] px-5 py-3.5 sm:px-6">
        <span className="inline-flex min-w-0 items-center gap-2.5">
          <FileText className="h-4 w-4 shrink-0 text-gold-ink" strokeWidth={2} aria-hidden="true" />
          <span className="min-w-0 truncate text-[14px] font-medium text-foreground">{t('mp_ci_doc_label')}</span>
        </span>
        <span className="shrink-0 rounded-full border border-foreground/20 px-2.5 py-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {t('mp_result_illustrative')}
        </span>
      </div>

      {/* The page */}
      <div className="relative space-y-2.5 p-5 sm:p-6" aria-hidden="true">
        {LINES.map((w, i) => {
          const isClause = i === CLAUSE;
          /* Step 0: the page is still arriving, so it is faint.
             Step 1: it has been read, so every line is solid.
             Step 2+: the clause is lifted out of the rest. */
          const read = step >= 1;
          const lifted = step >= 2 && isClause;
          return (
            <span
              key={i}
              className={`block h-2.5 rounded-full transition-[background-color,opacity] duration-500 motion-reduce:transition-none ${
                lifted ? 'bg-gold' : read ? 'bg-foreground/[0.16]' : 'bg-foreground/[0.07]'
              } ${step >= 2 && !isClause ? 'opacity-45' : 'opacity-100'}`}
              style={{ width: `${w}%` }}
            />
          );
        })}

        {/* The gold rule that marks the clause, once it has been found. */}
        <span
          className={`pointer-events-none absolute inset-x-4 h-[2.75rem] rounded-[0.5rem] border-2 border-gold transition-opacity duration-500 motion-reduce:transition-none sm:inset-x-5 ${
            step >= 2 ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ top: `calc(${CLAUSE} * 1.25rem + 0.55rem)` }}
        />
      </div>

      {/* What the reading produced */}
      <div className="border-t border-foreground/[0.12] bg-secondary/50 p-5 sm:p-6">
        {step < 2 ? (
          <p className="text-[15px] leading-relaxed text-muted-foreground">{t('mp_ci_state_reading')}</p>
        ) : (
          <>
            <p className="text-[13px] font-semibold uppercase tracking-[0.16em] text-gold-ink">
              {t('mp_ci_found_label')}
            </p>
            <p className="mt-2 text-pretty text-sm font-medium leading-snug text-foreground">{t('mp_ci_found')}</p>
            {step >= 3 && (
              <div className="mt-4 rounded-[0.7rem] bg-primary p-4 text-primary-foreground">
                <p className="text-[13px] font-semibold uppercase tracking-[0.16em] text-gold">
                  {t('mp_ci_plain_label')}
                </p>
                <p className="mt-2 text-pretty text-[15px] leading-relaxed">{t('mp_ci_plain')}</p>
              </div>
            )}
          </>
        )}
        <p className="mt-4 text-pretty text-xs leading-relaxed text-muted-foreground">{t('mp_ci_panel_note')}</p>
      </div>
    </div>
  );
}

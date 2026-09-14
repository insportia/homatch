import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Upload } from 'lucide-react';
import { ContractDocument } from './ContractDocument';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { FeatureGlyph } from '@/components/home/FeatureGlyph';
import { PAGE, SECTION_Y } from './primitives';
import { useSectionField, useFieldProps } from '@/site/content';

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
  { key: 'upload', field: 'step1', label: 'mp_ci_step_1', note: 'mp_ci_step_1_d' },
  { key: 'read', field: 'step2', label: 'mp_ci_step_2', note: 'mp_ci_step_2_d' },
  { key: 'clause', field: 'step3', label: 'mp_ci_step_3', note: 'mp_ci_step_3_d' },
  { key: 'explain', field: 'step4', label: 'mp_ci_step_4', note: 'mp_ci_step_4_d' },
] as const;

export function ContractIntelligenceSection() {
  const sf = useSectionField();
  const fp = useFieldProps();
  const { session } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  /*
   * The four steps are a READING AID, not an animation.
   *
   * They used to cycle on a setInterval started at mount, which on a phone
   * meant the sequence had been going round for half a minute before anybody
   * scrolled far enough to see it. The moving part of this region is now the
   * document beside it, which starts when it is actually on screen; these
   * stay put until somebody presses one.
   */
  const [step, setStep] = useState(0);

  return (
    <section id="contract" className={`${PAGE} scroll-mt-20 border-t border-border ${SECTION_Y}`}>
      <div className="grid gap-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-center lg:gap-16">
        {/* ── The argument ─────────────────────────────────────── */}
        <div className="min-w-0">
          <div className="flex items-center gap-3.5">
            <FeatureGlyph name="contract" size={48} className="sm:h-14 sm:w-14" />
            <p className="min-w-0 text-[14px] font-semibold uppercase tracking-[0.22em] text-gold-ink" {...fp('eyebrow')}>
              {sf('eyebrow', 'mp_contract_title')}
            </p>
          </div>

          <h2
            className="mt-6 text-balance font-semibold leading-[1.1] tracking-[-0.025em] text-foreground sm:mt-7"
            style={{ fontSize: 'clamp(1.4rem, 5.6vw, 2.75rem)' }}
           {...fp('title')}>
            {sf('title', 'mp_ci_title')}
          </h2>
          <p className="mt-4 max-w-[34rem] text-pretty text-[16px] leading-[1.65] text-ink-soft sm:mt-5 sm:text-base sm:leading-[1.7]" {...fp('body')}>
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
                      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[14px] font-semibold tabular-nums transition-colors duration-200 motion-reduce:transition-none ${
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
                        {...fp(`${s.field}_t`)}
                      >
                        {sf(`${s.field}_t`, s.label)}
                      </span>
                      {on && (
                        <span
                          className="mt-1 block text-pretty text-[16px] leading-relaxed text-muted-foreground"
                          {...fp(`${s.field}_d`)}
                        >
                          {sf(`${s.field}_d`, s.note)}
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
            <span {...fp('cta')}>{sf('cta', 'mp_contract_cta')}</span>
            <ArrowRight
              className={`h-4 w-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : ''}`}
              strokeWidth={2}
              aria-hidden="true"
            />
          </button>
          <p className="mt-3 max-w-[30rem] text-xs leading-relaxed text-muted-foreground" {...fp('formats')}>
            {sf('formats', 'mp_contract_formats')}
          </p>
        </div>

        {/* ── The document, being read ─────────────────────────── */}
        <ContractDocument
          /* The scene draws copy it does not own, so the identity of each
             string has to travel beside it. Without this the document's
             labels were registry fields that nothing on screen admitted to
             being, and the editor could not find one of them. */
          fields={{
            heading: fp('doc_heading'),
            fileName: fp('doc_file'),
            status: done => (done ? fp('doc_complete') : fp('doc_scanning')),
            note: fp('doc_note'),
            label: region => fp(`f_${region}`),
            state: region => fp(region === 'clause' ? 'st_review' : region === 'parties' ? 'st_verified' : 'st_detected'),
          }}
          copy={{
            heading: sf('doc_heading', 'mp_ci_doc_heading'),
            fileName: sf('doc_file', 'mp_ci_doc_label'),
            scanning: sf('doc_scanning', 'mp_ci_scanning'),
            complete: sf('doc_complete', 'mp_ci_st_complete'),
            note: sf('doc_note', 'mp_ci_panel_note'),
            alt: t('mp_ci_panel_alt'),
            labels: {
              parties: sf('f_parties', 'mp_ci_f_parties'),
              property: sf('f_property', 'mp_ci_f_property'),
              price: sf('f_price', 'mp_ci_f_price'),
              clause: sf('f_clause', 'mp_ci_f_clause'),
            },
            states: {
              detected: sf('st_detected', 'mp_ci_st_detected'),
              verified: sf('st_verified', 'mp_ci_st_verified'),
              review: sf('st_review', 'mp_ci_st_review'),
            },
          }}
        />
      </div>
    </section>
  );
}

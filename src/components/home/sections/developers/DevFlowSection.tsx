import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useMotion } from '@/hooks/useMotion';
import { PAGE, SECTION_Y } from '../primitives';
import { useSectionField, useFieldProps, useSectionIconName } from '@/site/content';
import { iconFor } from '@/site/icons';
import { Building2, Radio, Sparkles, PhoneCall, LineChart } from 'lucide-react';

/**
 * WHAT ACTUALLY HAPPENS, IN ORDER.
 *
 * A developer does not want a list of features; they want to know where a
 * buyer comes from and what the system does with them. So this is a chain,
 * and the chain runs: each step lights in turn, the connector fills, and a
 * panel underneath says what that step does.
 *
 * THE DEMONSTRATION IS NOT A CLAIM
 *
 * The stage names and descriptions are the product's real stages. There are
 * no numbers in it — no leads, no conversion, no revenue — because a figure
 * on a page like this reads as a result somebody achieved, and we have no
 * such figure to report. The note under the chain says plainly that it is an
 * illustration.
 *
 * MOTION
 *
 * Driven by an IntersectionObserver, so it starts when the visitor reaches
 * it rather than while they are still four screens above. It loops, because
 * the point is the CHAIN rather than any one stage, and a person who arrives
 * mid-cycle still sees the whole thing. Hovering or tapping takes control;
 * at motion level 'none' every stage is simply shown, lit, with the first
 * one selected.
 */

/** The shipped chain. Each step's words are Site Studio item fields. */
const STEPS = [
  { key: 'project', label: 'mp_dev_stage_project', desc: 'devp_step1_d', icon: Building2 },
  { key: 'demand', label: 'mp_dev_stage_demand', desc: 'devp_step2_d', icon: Radio },
  { key: 'qualify', label: 'mp_dev_stage_people', desc: 'devp_step3_d', icon: Sparkles },
  { key: 'reach', label: 'mp_dev_stage_calls', desc: 'devp_step4_d', icon: PhoneCall },
  { key: 'followup', label: 'mp_dev_stage_followup', desc: 'devp_step5_d', icon: LineChart },
] as const;

export function DevFlowSection() {
  const sf = useSectionField();
  const fp = useFieldProps();
  const icon = useSectionIconName();
  const { t, isRTL } = useLanguage();
  const still = useMotion() === 'none';

  const ref = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (still) { setStarted(false); return; }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setStarted(true); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        setStarted(true);
        io.disconnect();
      }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [still]);

  useEffect(() => {
    if (!started || held) return;
    const id = window.setInterval(() => setActive(i => (i + 1) % STEPS.length), 2600);
    return () => window.clearInterval(id);
  }, [started, held]);

  return (
    <section id="dev-flow" className="scroll-mt-24 bg-background">
      <div className={`${PAGE} ${SECTION_Y}`}>
        {/*
          * THE PROBLEM, BEFORE THE SYSTEM.
          *
          * A workflow diagram with no problem above it is a diagram of
          * something nobody asked for. Two sentences, in a bounded block, so
          * the chain underneath reads as an answer rather than as a feature
          * list.
          */}
        <div className="max-w-[46rem] rounded-[0.9rem] border-s-4 border-gold bg-card p-5 sm:p-6">
          <p className="text-[14px] font-semibold uppercase tracking-[0.2em] text-muted-foreground" {...fp('problem_eyebrow')}>
            {sf('problem_eyebrow', 'devp_problem_eyebrow')}
          </p>
          <p className="mt-2 text-pretty text-[19px] font-semibold leading-snug text-foreground sm:text-xl" {...fp('problem_title')}>
            {sf('problem_title', 'devp_problem_title')}
          </p>
          <p className="mt-2 text-pretty text-[16px] leading-relaxed text-ink-soft" {...fp('problem_body')}>
            {sf('problem_body', 'devp_problem_body')}
          </p>
        </div>

        <div className="mt-12 max-w-[46rem]">
          <p
            className="flex items-center gap-2.5 text-[14px] font-semibold uppercase tracking-[0.24em] text-gold-ink"
            {...fp('eyebrow')}
          >
            <span className="h-px w-7 bg-gold" aria-hidden="true" />
            {sf('eyebrow', 'devp_flow_eyebrow')}
          </p>
          <h2
            className="mt-4 text-balance font-semibold leading-[1.12] tracking-[-0.02em] text-foreground"
            style={{ fontSize: 'clamp(1.4rem, 5vw, 2.5rem)' }}
            {...fp('title')}
          >
            {sf('title', 'devp_flow_title')}
          </h2>
          <p className="mt-4 max-w-[38rem] text-pretty text-[16px] leading-[1.7] text-ink-soft" {...fp('body')}>
            {sf('body', 'devp_flow_body')}
          </p>
        </div>

        {/*
          * THE CHAIN.
          *
          * Horizontal on a desktop with connectors between the stages;
          * vertical on a phone, where five stages side by side would be five
          * unreadable columns. Same stages, same order, same lit state — the
          * layout reflows, the information does not shrink.
          */}
        <div
          ref={ref}
          className="mt-10"
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          onFocusCapture={() => setHeld(true)}
          onBlurCapture={() => setHeld(false)}
        >
          {/* Named, because to a screen reader this is a list of five
              buttons that change a panel, and the name is what says so. */}
          <ol className="grid gap-2 sm:grid-cols-5 sm:gap-0" aria-label={t('devp_demo_run')}>
            {STEPS.map((step, i) => {
              const on = i === active;
              const Icon = iconFor(icon(`step_${step.key}`), step.icon);
              return (
                <li key={step.key} className="flex min-w-0 items-center gap-2 sm:flex-col sm:items-stretch sm:gap-0">
                  <button
                    type="button"
                    onClick={() => { setActive(i); setHeld(true); }}
                    onMouseEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    aria-current={on}
                    className={`flex min-h-[56px] w-full min-w-0 items-center gap-3 rounded-[0.8rem] border px-3 py-2.5 text-start transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:flex-col sm:items-center sm:gap-2 sm:px-2 sm:text-center ${
                      on
                        ? 'border-gold bg-gold-soft shadow-sm'
                        : 'border-border bg-card hover:border-gold/50'
                    }`}
                    style={{
                      /* A lit stage lifts. 4px is enough to read as "this one"
                         beside its neighbours and small enough not to reflow
                         the row. */
                      transform: still || !on ? 'none' : 'translateY(-4px)',
                    }}
                  >
                    <span
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors duration-300 motion-reduce:transition-none ${
                        on ? 'bg-gold text-primary' : 'bg-secondary text-muted-foreground'
                      }`}
                    >
                      <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                    </span>
                    <span
                      className={`min-w-0 text-pretty text-[15px] leading-tight ${
                        on ? 'font-semibold text-foreground' : 'font-medium text-ink-soft'
                      }`}
                      {...fp(`step_${step.key}`)}
                    >
                      {sf(`step_${step.key}`, step.label)}
                    </span>
                  </button>

                  {/* The connector. Horizontal between columns, and simply
                      absent after the last stage. */}
                  {i < STEPS.length - 1 && (
                    <span className="hidden shrink-0 items-center px-1 sm:flex" aria-hidden="true">
                      <ArrowRight
                        className={`h-4 w-4 transition-colors duration-300 motion-reduce:transition-none ${
                          i < active ? 'text-gold' : 'text-muted-foreground/50'
                        } ${isRTL ? 'rotate-180' : ''}`}
                      />
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          {/* What the lit stage does. A fixed minimum height, so the page
              does not jump every 2.6 seconds while somebody is reading it. */}
          <div className="mt-5 rounded-[0.9rem] border border-border bg-card p-5 sm:p-6">
            {/* The lit stage, repeated. Same two fields as the chain above
                -- the panel is a second view of one stage, not a second copy
                of it -- so both places have to be clickable or an admin
                learns that editing works in one of them and not the other. */}
            <p
              className="text-[14px] font-semibold uppercase tracking-[0.18em] text-gold-ink"
              {...fp(`step_${STEPS[active].key}`)}
            >
              {sf(`step_${STEPS[active].key}`, STEPS[active].label)}
            </p>
            <p
              className="mt-2 min-h-[3.5rem] text-pretty text-[16px] leading-relaxed text-foreground"
              {...fp(`desc_${STEPS[active].key}`)}
            >
              {sf(`desc_${STEPS[active].key}`, STEPS[active].desc)}
            </p>
            <p className="mt-4 border-t border-border pt-3 text-[13px] leading-relaxed text-muted-foreground" {...fp('note')}>
              {sf('note', 'devp_demo_note')}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

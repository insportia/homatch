import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, FileText } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { SceneMedia } from '@/components/home/media/SceneMedia';
import { ArrowLink, Eyebrow } from './primitives';

/**
 * REGION 05 — Homatch Verify.
 *
 * WHY THE CADASTRAL FIELD IS HERE AND NOT IN THE HERO
 *
 * A cadastral search in the hero would say the product is a cadastral
 * lookup. It is one capability of several, so its entry point lives with its
 * own story — and it is a real one: the code is handed to /verify through
 * ?code=, which that page seeds its query from. There is no second
 * verification system behind this field and no mock result; it opens the
 * flow that already exists.
 *
 * The six steps describe what a customer does and receives. None of the
 * machinery behind them — workers, providers, queues, source enums,
 * confidence identifiers — appears here, because none of it is the
 * customer's problem.
 */
export function VerificationSection() {
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  const steps = [
    { key: '1', title: t('mp_verify_step_1_title'), desc: t('mp_verify_step_1_desc') },
    { key: '2', title: t('mp_verify_step_2_title'), desc: t('mp_verify_step_2_desc') },
    { key: '3', title: t('mp_verify_step_3_title'), desc: t('mp_verify_step_3_desc') },
    { key: '4', title: t('mp_verify_step_4_title'), desc: t('mp_verify_step_4_desc') },
    { key: '5', title: t('mp_verify_step_5_title'), desc: t('mp_verify_step_5_desc') },
    { key: '6', title: t('mp_verify_step_6_title'), desc: t('mp_verify_step_6_desc') },
  ];

  const openVerify = () => {
    const value = code.trim();
    navigate(value ? `/verify?code=${encodeURIComponent(value)}` : '/verify');
  };

  return (
    <section className="border-y border-border bg-secondary/50">
      <div className="mx-auto grid w-full max-w-[90rem] gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:gap-20 lg:px-10 lg:py-28">
        <div className="relative order-1 aspect-[4/5] overflow-hidden rounded-[1rem] sm:aspect-[16/10] lg:aspect-[4/5]">
          <SceneMedia
            scene="verification"
            alt={t('mp_verify_image_alt')}
            sizes="(min-width: 1024px) 40vw, 100vw"
            // Hold the registry documents and the cadastral map on screen and
            // let the sky crop away; the wide tablet crop sits lower for the
            // same reason.
            position="58% 62%"
            positionMobile="50% 58%"
          />
        </div>

        <div className="order-2">
          <Eyebrow>{t('mp_verify_eyebrow')}</Eyebrow>
          <h2
            className="mt-5 text-balance font-semibold leading-[1.1] tracking-[-0.02em] text-foreground"
            style={{ fontSize: 'clamp(1.75rem, 3.1vw, 2.9rem)' }}
          >
            {t('mp_verify_title')}
          </h2>
          <p className="mt-5 max-w-[34rem] text-pretty text-[15px] leading-[1.75] text-ink-soft">
            {t('mp_verify_sub')}
          </p>

          {/* The real entry point. */}
          <form
            onSubmit={e => {
              e.preventDefault();
              openVerify();
            }}
            className="mt-8 flex items-center gap-2 rounded-[0.9rem] border border-border bg-card p-2 ps-4 transition-[border-color,box-shadow] duration-300 focus-within:border-gold/60 focus-within:shadow-hover motion-reduce:transition-none"
          >
            <input
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder={t('mp_verify_code_placeholder')}
              aria-label={t('mp_verify_code_label')}
              inputMode="numeric"
              className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-foreground placeholder:text-muted-foreground/75 focus:outline-none"
            />
            <button
              type="submit"
              aria-label={t('mp_verify_code_label')}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-[0.6rem] bg-primary text-primary-foreground transition-colors duration-300 hover:bg-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
            >
              <ArrowRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </form>

          <p className="mt-3.5 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-ink" strokeWidth={1.5} aria-hidden="true" />
            {t('mp_verify_document_note')}
          </p>

          {/* Six steps, hairline-separated, two columns from sm. */}
          <ol className="mt-10 grid gap-x-10 border-t border-border sm:grid-cols-2">
            {steps.map((step, i) => (
              <li key={step.key} className={`py-6 ${i > 0 ? 'border-t border-border sm:border-t-0' : ''} ${i > 1 ? 'sm:border-t sm:border-border' : ''}`}>
                <span className="text-[11px] font-semibold tabular-nums tracking-[0.2em] text-gold-ink">{`0${i + 1}`}</span>
                <h3 className="mt-2.5 text-balance text-[15px] font-semibold leading-snug text-foreground">{step.title}</h3>
                <p className="mt-2 text-pretty text-sm leading-relaxed text-ink-soft">{step.desc}</p>
              </li>
            ))}
          </ol>

          <div className="mt-8">
            <ArrowLink label={t('mp_cap_verify_cta')} onClick={() => navigate('/verify')} />
          </div>
        </div>
      </div>
    </section>
  );
}

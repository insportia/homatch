import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { SceneMedia } from '@/components/home/media/SceneMedia';
import { Eyebrow } from './primitives';

/**
 * REGION 06 — the verification story, image-led.
 *
 * Verification is the trust product, so it gets a warm stone band, a real
 * image, and three plain steps. The steps describe what a customer does and
 * receives; none of the machinery behind them (workers, providers, queues,
 * confidence scores, state machines) appears here, because none of it is the
 * customer's problem.
 *
 * The image is a grid column here rather than an absolute panel — this
 * section has no tall copy column driving its height, so letting the media
 * set a 4:5 ratio is exactly what is wanted.
 */
export function VerificationSection() {
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  const steps = [
    { key: '1', title: t('mp_verify_step_1_title'), desc: t('mp_verify_step_1_desc') },
    { key: '2', title: t('mp_verify_step_2_title'), desc: t('mp_verify_step_2_desc') },
    { key: '3', title: t('mp_verify_step_3_title'), desc: t('mp_verify_step_3_desc') },
  ];

  return (
    <section className="bg-sand/60">
      <div className="mx-auto grid w-full max-w-[90rem] items-center gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:gap-20 lg:px-10 lg:py-28">
        <div className="relative order-1 aspect-[4/5] overflow-hidden rounded-[1.75rem] sm:aspect-[16/10] lg:aspect-[4/5]">
          <SceneMedia
            scene="verification"
            alt={t('mp_verify_image_alt')}
            sizes="(min-width: 1024px) 40vw, 100vw"
            // Portrait on desktop: hold the registry documents and the
            // cadastral map on screen and let the sky crop away. The wide
            // tablet crop sits lower for the same reason.
            position="58% 62%"
            positionMobile="50% 58%"
          />
        </div>

        <div className="order-2">
          <Eyebrow>{t('mp_verify_eyebrow')}</Eyebrow>
          <h2
            className="mt-4 text-balance font-semibold leading-[1.14] tracking-tight text-foreground"
            style={{ fontSize: 'clamp(1.75rem, 3.1vw, 2.9rem)' }}
          >
            {t('mp_verify_title')}
          </h2>

          <ol className="mt-10">
            {steps.map((step, i) => (
              <li key={step.key} className={`flex gap-6 py-7 ${i === 0 ? '' : 'border-t border-border/80'}`}>
                <span className="mt-0.5 shrink-0 text-sm font-semibold tabular-nums tracking-[0.16em] text-gold">
                  {`0${i + 1}`}
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-foreground sm:text-lg">{step.title}</h3>
                  <p className="mt-2 text-pretty text-sm leading-relaxed text-ink-soft">{step.desc}</p>
                </div>
              </li>
            ))}
          </ol>

          <Button className="mt-6 h-12 gap-2.5 rounded-full px-7 text-sm" onClick={() => navigate('/verify')}>
            {t('mp_cap_verify_cta')}
            <ArrowRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </section>
  );
}

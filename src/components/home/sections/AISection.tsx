import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { HomatchAsk } from '@/components/home/HomatchAsk';
import { ArrowLink, Eyebrow, PAGE } from './primitives';

/**
 * REGION 04 — the first dark moment.
 *
 * The page's rhythm depends on this: three cream regions, then navy. It also
 * suits the content — the assistant is the one place on the page where the
 * visitor is invited to do something rather than read, and dropping the
 * lights around it is the cheapest way to say so.
 *
 * The console is a real entry into /ai (see HomatchAsk); the dark treatment
 * changes nothing about that.
 */
export function AISection() {
  const { session } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const suggestions = [
    { key: 'about', label: t('mp_ai_sugg_about') },
    { key: 'check', label: t('mp_ai_sugg_check') },
    { key: 'clients', label: t('mp_ai_sugg_clients') },
    { key: 'cadastral', label: t('mp_ai_sugg_cadastral') },
  ];

  return (
    <section className="relative overflow-hidden bg-primary text-primary-foreground">
      {/* A single warm bloom behind the console, so the navy is not flat. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(60rem 32rem at 50% -10%, hsl(38 44% 54% / 0.16), transparent 70%)' }}
        aria-hidden="true"
      />

      <div className={`${PAGE} relative py-16 sm:py-20 lg:py-24`}>
        <div className="mx-auto max-w-[52rem] text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gold/15 text-gold">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </div>

          <div className="mt-6">
            <Eyebrow tone="light">{t('mp_ai_eyebrow')}</Eyebrow>
          </div>

          <h2
            className="mt-4 text-balance font-semibold leading-[1.14] tracking-tight"
            style={{ fontSize: 'clamp(1.75rem, 3.1vw, 2.9rem)' }}
          >
            {t('ai_title')}
          </h2>

          <p className="mx-auto mt-5 max-w-[38rem] text-pretty text-[15px] leading-relaxed text-primary-foreground/70 sm:text-base">
            {t('mp_ai_sub')}
          </p>
        </div>

        {/* The console itself sits on a light surface: the input has to read as
            somewhere you type, and an outlined field on navy does not. */}
        <div className="mx-auto mt-9 max-w-[46rem] rounded-[1.5rem] bg-card p-4 shadow-[0_24px_70px_-30px_rgba(10,18,30,0.75)] sm:p-6">
          <HomatchAsk placeholder={t('mp_ai_placeholder')} suggestions={suggestions} />
        </div>

        <div className="mt-8 flex justify-center">
          <ArrowLink
            tone="light"
            label={t('mp_ai_examples')}
            onClick={() => navigate(session ? '/ai' : '/auth/signup')}
          />
        </div>
      </div>
    </section>
  );
}

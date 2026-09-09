import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, TrendingUp } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { ArrowLink, Eyebrow, PAGE } from './primitives';

/**
 * REGION 08 — the second dark moment: what the customer actually gets back.
 *
 * ILLUSTRATIVE, AND SAID SO
 *
 * These two panels are the one place on the page showing product output, and
 * they are not fed by anything — a signed-out visitor has no matches and no
 * verification case to show. So every panel carries a visible "illustrative
 * example" marker, and the content is deliberately generic: a district and a
 * shape of demand, never a named person, a real cadastral code, or a real
 * address. Nothing here can be mistaken for a claim about a real property or
 * a real buyer.
 */
export function ResultPreviewSection() {
  const { session } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  return (
    <section className="relative overflow-hidden bg-primary text-primary-foreground">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(52rem 30rem at 82% 8%, hsl(36 38% 56% / 0.12), transparent 68%)' }}
        aria-hidden="true"
      />

      <div className={`${PAGE} relative py-20 sm:py-24 lg:py-28`}>
        <div className="max-w-[46rem]">
          <Eyebrow tone="light">{t('mp_result_eyebrow')}</Eyebrow>
          <h2
            className="mt-5 text-balance font-semibold leading-[1.1] tracking-[-0.02em] text-white"
            style={{ fontSize: 'clamp(1.75rem, 3.1vw, 2.9rem)' }}
          >
            {t('mp_result_title')}
          </h2>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {/* Panel A — a match */}
          <article className="rounded-[1rem] border border-white/12 bg-white/[0.045] p-6 sm:p-8">
            <IllustrativeTag label={t('mp_result_illustrative')} />

            <div className="mt-5 flex items-start gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold" aria-hidden="true">
                <TrendingUp className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold">{t('mp_result_match_label')}</p>
                <p className="mt-2 text-pretty text-lg font-medium leading-snug">{t('mp_result_match_line')}</p>
              </div>
            </div>

            <p className="mt-7 text-xs font-semibold uppercase tracking-[0.16em] text-white/50">
              {t('mp_result_match_why')}
            </p>
            <ul className="mt-3.5 space-y-2.5">
              {[t('mp_result_match_reason_1'), t('mp_result_match_reason_2'), t('mp_result_match_reason_3')].map(reason => (
                <li key={reason} className="flex gap-3 text-sm leading-relaxed text-white/75">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-gold/80" aria-hidden="true" />
                  {reason}
                </li>
              ))}
            </ul>
          </article>

          {/* Panel B — property intelligence */}
          <article className="rounded-[1rem] border border-white/12 bg-white/[0.045] p-6 sm:p-8">
            <IllustrativeTag label={t('mp_result_illustrative')} />

            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-gold">{t('mp_result_prop_label')}</p>

            <dl className="mt-5 space-y-4">
              <div className="border-s-2 border-gold/50 ps-4">
                <dt className="text-xs font-medium uppercase tracking-wider text-white/50">
                  {t('mp_result_prop_confirmed')}
                </dt>
                <dd className="mt-2 space-y-1.5">
                  {[t('mp_verify_frag_identity'), t('mp_verify_frag_official')].map(row => (
                    <p key={row} className="flex items-center gap-2.5 text-sm text-white/80">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-gold/80" aria-hidden="true" />
                      {row}
                    </p>
                  ))}
                </dd>
              </div>

              <div className="border-s-2 border-white/20 ps-4">
                <dt className="text-xs font-medium uppercase tracking-wider text-white/50">
                  {t('mp_result_prop_attention')}
                </dt>
                <dd className="mt-2 flex items-center gap-2.5 text-sm text-white/80">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-primary-foreground/55" aria-hidden="true" />
                  {t('mp_result_prop_attention_line')}
                </dd>
              </div>

              <div className="border-s-2 border-white/20 ps-4">
                <dt className="text-xs font-medium uppercase tracking-wider text-white/50">
                  {t('mp_result_prop_next')}
                </dt>
                <dd className="mt-2 text-sm leading-relaxed text-white/80">{t('mp_result_prop_next_line')}</dd>
              </div>
            </dl>
          </article>
        </div>

        <div className="mt-10">
          <ArrowLink
            tone="light"
            label={t('mp_match_cta')}
            onClick={() => navigate(session ? '/property/add' : '/auth/signup')}
          />
        </div>
      </div>
    </section>
  );
}

function IllustrativeTag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/60">
      <span className="h-1 w-1 rounded-full bg-white/50" aria-hidden="true" />
      {label}
    </span>
  );
}

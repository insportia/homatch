import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Check, FileText } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { SceneMedia } from '@/components/home/media/SceneMedia';
import { FeatureGlyph } from '@/components/home/FeatureGlyph';
import { PAGE } from './primitives';

/**
 * REGION 05 — Buyer Intelligence.
 *
 * The launcher already let someone start a check. This region answers the
 * question that stops them from pressing it: what do I actually get back?
 *
 * So the right-hand column is the report itself — the property that was
 * identified, what the record confirmed, what deserves attention, and the
 * step Homatch recommends. It is marked ILLUSTRATIVE in the interface,
 * because it is a composed example and a visitor is entitled to know that
 * before they read it as someone's real property.
 */
export function VerifyShowcaseSection() {
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  const confirmed = [t('mp_verify_frag_identity'), t('mp_verify_frag_official'), t('mp_market_1_title')];

  return (
    <section id="verify" className={`${PAGE} scroll-mt-24 py-20 sm:py-24 lg:py-28`}>
      <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
        {/* ── The argument ─────────────────────────────────────── */}
        <div className="min-w-0">
          <div className="flex items-center gap-4">
            <FeatureGlyph name="verify" size={56} />
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gold-ink">{t('mp_verify_eyebrow')}</p>
          </div>

          <h2
            className="mt-7 text-balance font-semibold leading-[1.08] tracking-[-0.025em] text-foreground"
            style={{ fontSize: 'clamp(1.75rem, 3.2vw, 2.75rem)' }}
          >
            {t('mp_verify_show_title')}
          </h2>
          <p className="mt-5 max-w-[34rem] text-pretty text-[15px] leading-[1.7] text-ink-soft sm:text-base">
            {t('mp_verify_capability_desc')}
          </p>

          <ul className="mt-9 space-y-4">
            {[
              { key: 'record', title: t('mp_market_2_title'), desc: t('mp_market_2_desc') },
              { key: 'project', title: t('mp_market_3_title'), desc: t('mp_market_3_desc') },
              { key: 'contract', title: t('mp_contract_title'), desc: t('mp_verify_show_contract_d') },
            ].map(row => (
              <li key={row.key} className="flex gap-3.5">
                <span className="mt-[3px] grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground" aria-hidden="true">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold leading-snug text-foreground">{row.title}</span>
                  <span className="mt-1 block text-pretty text-sm leading-relaxed text-ink-soft">{row.desc}</span>
                </span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => navigate('/verify')}
            className="group mt-9 inline-flex h-12 items-center justify-center gap-2.5 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors duration-300 hover:bg-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            {t('mp_verify_capability_cta')}
            <ArrowRight
              className={`h-4 w-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : ''}`}
              strokeWidth={2}
              aria-hidden="true"
            />
          </button>
        </div>

        {/* ── The report ───────────────────────────────────────── */}
        <div className="min-w-0 overflow-hidden rounded-[1.1rem] border border-foreground/15 bg-card shadow-hover">
          {/* The property under examination. Graded hard so the photograph
              reads as a black-and-gold plate rather than as a listing. */}
          <div className="relative h-36 saturate-[0.6] sm:h-44">
            <SceneMedia scene="verification" alt="" sizes="(min-width: 1024px) 40vw, 100vw" position="50% 55%" />
            <div className="absolute inset-0 bg-[#080808]/72" aria-hidden="true" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#080808] via-[#080808]/45 to-[#080808]/25" aria-hidden="true" />
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">{t('mp_result_prop_label')}</p>
                <p className="mt-1.5 font-mono text-[13px] tabular-nums text-white/85">01.18.06.019.055.03</p>
              </div>
              <span className="shrink-0 rounded-full border border-white/30 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/80">
                {t('mp_result_illustrative')}
              </span>
            </div>
          </div>

          <div className="p-6 sm:p-7">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {t('mp_result_prop_confirmed')}
            </p>
            <ul className="mt-3 space-y-2">
              {confirmed.map(line => (
                <li key={line} className="flex items-start gap-2.5 text-sm text-foreground">
                  <Check className="mt-[3px] h-3.5 w-3.5 shrink-0 text-[#12A06B]" strokeWidth={3} aria-hidden="true" />
                  <span className="min-w-0">{line}</span>
                </li>
              ))}
            </ul>

            <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {t('mp_result_prop_attention')}
            </p>
            <p className="mt-3 flex items-start gap-2.5 text-sm text-foreground">
              <AlertCircle className="mt-[2px] h-3.5 w-3.5 shrink-0 text-gold-ink" strokeWidth={2.5} aria-hidden="true" />
              <span className="min-w-0">{t('mp_result_prop_attention_line')}</span>
            </p>

            <div className="mt-6 rounded-[0.7rem] bg-primary p-4 text-primary-foreground">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">
                <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                {t('mp_result_prop_next')}
              </p>
              <p className="mt-2 text-pretty text-sm leading-relaxed">{t('mp_result_prop_next_line')}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

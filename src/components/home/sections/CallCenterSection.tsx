import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Mail, PhoneCall } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { FeatureGlyph } from '@/components/home/FeatureGlyph';
import { PAGE } from './primitives';

/**
 * REGION 04 — the AI Call Center, on its own.
 *
 * WHY IT GETS A WHOLE REGION
 *
 * An AI that telephones a lead, holds a conversation with them and comes
 * back with what they actually want is the least ordinary thing Homatch
 * does. The previous pass put it in a two-up beside email campaigns, where
 * it read as one of a pair of utilities. It is not one of a pair.
 *
 * Email campaigns still belong on this page — outreach is calls AND email —
 * but as the footnote at the bottom of this region, not as its equal.
 *
 * WHAT THE PANEL SHOWS, AND WHAT IT REFUSES TO
 *
 * The right-hand panel is the shape of a call: it is live, there is a voice,
 * the conversation moves through stages, and something is recorded at the
 * end. It shows no name, no number, no transcript text and no statistics.
 * A marketing page that invents "68% qualified" or a fake customer sentence
 * is lying about a product that has real calls behind it.
 */

const STAGES = ['mp_cc_stage_lead', 'mp_calls_stage_2', 'mp_cc_stage_talk', 'mp_calls_stage_3', 'mp_calls_stage_4', 'mp_cc_stage_followup'] as const;

/* A fixed, hand-set profile rather than Math.random(): the same panel has to
   look identical on every render, and a waveform that reshuffles on each
   re-render reads as noise. */
const WAVE = [
  0.35, 0.62, 0.9, 0.48, 1, 0.55, 0.3, 0.72, 0.95, 0.4, 0.66, 0.85, 0.5, 0.28,
  0.78, 1, 0.45, 0.6, 0.88, 0.33, 0.7, 0.52, 0.92, 0.38, 0.64, 0.8, 0.42, 0.58,
];

const POINTS = [
  { key: 'reach', title: 'mp_cc_point_1', desc: 'mp_cc_point_1_d' },
  { key: 'intent', title: 'mp_cc_point_2', desc: 'mp_cc_point_2_d' },
  { key: 'record', title: 'mp_cc_point_3', desc: 'mp_cc_point_3_d' },
] as const;

export function CallCenterSection() {
  const { session } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  const gated = (path: string) => () => navigate(session ? path : '/auth/signup');
  const arrow = `h-4 w-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : ''}`;

  return (
    <section id="call-center" className="relative scroll-mt-24 overflow-hidden bg-[#080808] text-white">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(64rem 32rem at 78% 0%, hsl(38 88% 54% / 0.15), transparent 64%)' }}
        aria-hidden="true"
      />

      <div className={`${PAGE} relative py-20 sm:py-24 lg:py-28`}>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-center lg:gap-16">
          {/* ── The argument ───────────────────────────────────── */}
          <div className="min-w-0">
            <div className="flex items-center gap-4">
              <FeatureGlyph name="calls" size={56} tone="dark" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gold">{t('call_center_title')}</p>
            </div>

            <h2
              className="mt-7 text-balance font-semibold leading-[1.08] tracking-[-0.025em] text-white"
              style={{ fontSize: 'clamp(1.85rem, 3.4vw, 3rem)' }}
            >
              {t('mp_cc_title')}
            </h2>
            <p className="mt-5 max-w-[36rem] text-pretty text-[15px] leading-[1.7] text-white/70 sm:text-base">
              {t('mp_cc_sub')}
            </p>

            <ul className="mt-10 grid gap-px overflow-hidden rounded-[0.9rem] border border-white/15 bg-white/10 sm:grid-cols-3">
              {POINTS.map(point => (
                <li key={point.key} className="bg-[#0C0C0C] p-5">
                  <h3 className="text-sm font-semibold text-white">{t(point.title)}</h3>
                  <p className="mt-2 text-pretty text-[13px] leading-relaxed text-white/60">{t(point.desc)}</p>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={gated('/outreach/calls')}
              className="group mt-9 inline-flex h-12 items-center justify-center gap-2.5 rounded-full bg-gold px-6 text-sm font-semibold text-[#0A0A0A] transition-colors duration-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#080808] motion-reduce:transition-none"
            >
              <PhoneCall className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden="true" />
              {t('mp_calls_cta')}
              <ArrowRight className={arrow} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>

          {/* ── The call, as an object ─────────────────────────── */}
          <LiveCallPanel />
        </div>

        {/* ── The flow, full width under both columns ──────────── */}
        <ol className="mt-16 grid gap-px overflow-hidden rounded-[0.9rem] border border-white/15 bg-white/10 sm:grid-cols-3 lg:grid-cols-6">
          {STAGES.map((stage, i) => (
            <li key={stage} className="flex items-center gap-3 bg-[#0C0C0C] px-4 py-4">
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums ${
                  i === STAGES.length - 1 ? 'bg-gold text-[#0A0A0A]' : 'border border-white/25 text-white/55'
                }`}
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span className="min-w-0 text-[13px] font-medium leading-tight text-white/85">{t(stage)}</span>
            </li>
          ))}
        </ol>

        {/* ── Email, deliberately subordinate ──────────────────── */}
        <div className="mt-6 flex flex-col gap-4 rounded-[0.9rem] border border-white/15 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div className="flex min-w-0 items-start gap-3.5">
            <Mail className="mt-0.5 h-5 w-5 shrink-0 text-gold" strokeWidth={1.75} aria-hidden="true" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white">{t('mp_email_title')}</h3>
              <p className="mt-1 text-pretty text-[13px] leading-relaxed text-white/60">{t('mp_email_desc')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={gated('/outreach/email')}
            className="group inline-flex shrink-0 items-center gap-2 text-sm font-medium text-white/85 transition-colors hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            {t('mp_email_cta')}
            <ArrowRight className={arrow} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * A call in progress. Everything in it is structural: a status, a voice, the
 * stage the conversation has reached, and the outcome slot that gets filled
 * when it ends. The bars ARE the content — there is no fabricated transcript.
 */
function LiveCallPanel() {
  const { t } = useLanguage();

  return (
    <div className="relative min-w-0" role="img" aria-label={t('mp_cc_panel_alt')}>
      <div className="rounded-[1.1rem] border border-white/18 bg-[#0C0C0C] p-6 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.9)] sm:p-7">
        {/* Status */}
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
            <span className="relative grid h-2 w-2 place-items-center">
              <span className="hm-ring absolute inset-0 rounded-full" />
              <span className="relative h-2 w-2 rounded-full bg-gold" />
            </span>
            {t('mp_cc_live')}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-white/40">02:14</span>
        </div>

        {/* The voice */}
        <div className="mt-6 flex items-center gap-4 rounded-[0.7rem] border border-white/12 bg-white/[0.04] p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gold text-[#0A0A0A]" aria-hidden="true">
            <PhoneCall className="h-4 w-4" strokeWidth={2.25} />
          </span>
          {/* The bars span the panel rather than huddling beside the avatar:
              a waveform that does not reach the edge reads as a loading
              state, not as a voice. */}
          <div className="hm-wave flex min-w-0 flex-1 items-center justify-between gap-[2px]">
            {WAVE.map((h, i) => (
              <span
                key={i}
                className="h-9 w-[3px] flex-1 rounded-full bg-gold/75"
                style={{ animationDelay: `${(i % 7) * 0.09}s`, transform: `scaleY(${h})` }}
              />
            ))}
          </div>
        </div>

        {/* What the conversation is doing right now */}
        <dl className="mt-5 space-y-px overflow-hidden rounded-[0.7rem] border border-white/12 bg-white/10">
          <Row label={t('mp_cc_row_stage')} value={t('mp_calls_stage_3')} />
          <Row label={t('mp_cc_row_language')} value={t('mp_cc_row_language_v')} />
          <Row label={t('mp_cc_row_outcome')} value={t('mp_cc_row_outcome_v')} pending />
        </dl>

        <p className="mt-5 text-pretty text-xs leading-relaxed text-white/45">{t('mp_cc_panel_note')}</p>
      </div>
    </div>
  );
}

function Row({ label, value, pending = false }: { label: string; value: string; pending?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 bg-[#0C0C0C] px-4 py-3">
      <dt className="min-w-0 text-[12px] text-white/50">{label}</dt>
      <dd className={`min-w-0 text-end text-[12px] font-medium ${pending ? 'text-white/40' : 'text-white'}`}>{value}</dd>
    </div>
  );
}

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, CircleDollarSign, Search, ShieldCheck, UserSearch } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Icon, PAGE, SECTION_Y, SectionIntro } from './primitives';

/**
 * REGION 03 — the four core capabilities.
 *
 * NOT FOUR EQUAL CARDS
 *
 * A 2×2 grid of identical white rectangles says four things weigh the same
 * and tells a visitor nothing about any of them. So the grid is asymmetric —
 * matching takes the wide cell, the other three vary in weight — and every
 * panel carries a small, honest fragment of the real product rather than a
 * marketing illustration: the demand graph matching actually produces, the
 * ranked shortlist discovery returns, a verification report's shape, a
 * financing scenario's shape.
 *
 * Those fragments are DIAGRAMS, not fake UI: nothing in them is clickable
 * and nothing shows an invented figure. The one genuinely interactive thing
 * in this region is the cadastral field in the Verify panel, which hands its
 * code to the existing /verify flow through ?code=.
 */

/* ── Panel chrome ─────────────────────────────────────────────────────
   One bordered surface per capability, with a clearly visible edge. These
   ARE contained objects, so a border is honest here; the page's rule is that
   text sections do not get one, not that nothing does. */
function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`group relative flex flex-col overflow-hidden rounded-[0.9rem] border border-foreground/15 bg-card transition-[border-color,box-shadow] duration-300 hover:border-foreground/30 hover:shadow-hover motion-reduce:transition-none ${className}`}>
      {children}
    </div>
  );
}

function PanelHead({ icon, title, desc }: { icon: React.ElementType; title: string; desc: string }) {
  return (
    <div className="p-6 sm:p-7">
      <Icon icon={icon} />
      <h3
        className="mt-5 text-balance font-semibold leading-[1.2] tracking-[-0.015em] text-foreground"
        style={{ fontSize: 'clamp(1.15rem, 1.5vw, 1.4rem)' }}
      >
        {title}
      </h3>
      <p className="mt-2.5 text-pretty text-sm leading-[1.7] text-ink-soft">{desc}</p>
    </div>
  );
}

function PanelAction({ label, onClick }: { label: string; onClick: () => void }) {
  const { isRTL } = useLanguage();
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-auto flex items-center justify-between gap-3 border-t border-foreground/12 px-6 py-4 text-start text-sm font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-7"
    >
      {label}
      <ArrowRight
        className={`h-4 w-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : ''}`}
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </button>
  );
}

/* ── Product fragments ─────────────────────────────────────────────── */

/** Demand converging on one property, then ranked. What matching produces. */
function DemandGraph({ label }: { label: string }) {
  return (
    <div className="mx-6 mb-6 rounded-[0.7rem] border border-foreground/12 bg-secondary/70 p-4 sm:mx-7">
      {/* Taller than it is wide-ish on purpose: the matching panel carries
          less copy than the one beside it, and a short wide figure left a
          dead band above the action. */}
      <svg viewBox="0 0 420 200" className="h-auto w-full" role="img" aria-label={label}>
        <g stroke="hsl(var(--foreground))" strokeOpacity="0.3" fill="none" strokeWidth="1">
          <path d="M26 24 C120 24 140 92 196 100" />
          <path d="M26 74 C110 74 150 94 196 100" />
          <path d="M26 126 C110 126 150 106 196 100" />
          <path d="M26 176 C120 176 140 110 196 100" />
        </g>
        <g stroke="hsl(var(--gold))" fill="none" strokeWidth="1.25">
          <path d="M232 100 C296 94 306 46 376 46" />
          <path d="M232 100 C296 100 306 100 376 100" />
          <path d="M232 100 C296 106 306 154 376 154" />
        </g>
        {[24, 74, 126, 176].map(y => (
          <circle key={y} cx="26" cy={y} r="4.5" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeOpacity="0.45" strokeWidth="1.25" />
        ))}
        <circle cx="214" cy="100" r="22" fill="hsl(var(--primary))" />
        <circle cx="214" cy="100" r="33" fill="none" stroke="hsl(var(--gold))" strokeOpacity="0.6" strokeWidth="1" />
        <circle cx="214" cy="100" r="45" fill="none" stroke="hsl(var(--gold))" strokeOpacity="0.22" strokeWidth="1" />
        {[
          { y: 46, w: 36, o: 1 },
          { y: 100, w: 27, o: 0.6 },
          { y: 154, w: 18, o: 0.34 },
        ].map(r => (
          <g key={r.y} opacity={r.o}>
            <rect x="376" y={r.y - 8} width="16" height="16" rx="4" fill="hsl(var(--primary))" />
            <rect x="376" y={r.y + 13} width={r.w} height="2.5" rx="1.25" fill="hsl(var(--gold))" />
          </g>
        ))}
      </svg>
    </div>
  );
}

/** A ranked shortlist: match strength, no invented prices or addresses. */
function ShortlistFragment({ label, rows }: { label: string; rows: string[] }) {
  return (
    <div className="mx-6 mb-6 space-y-2 rounded-[0.7rem] border border-foreground/12 bg-secondary/70 p-4 sm:mx-7" role="img" aria-label={label}>
      {rows.map((row, i) => (
        <div key={row} className="flex items-center gap-3">
          <span className="grid h-7 w-9 shrink-0 place-items-center rounded-md border border-foreground/12 bg-card text-foreground/45" aria-hidden="true">
            <Building2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink-soft">{row}</span>
          <span
            className="h-1.5 shrink-0 rounded-full bg-gold"
            style={{ width: `${64 - i * 18}px`, opacity: 1 - i * 0.28 }}
            aria-hidden="true"
          />
        </div>
      ))}
    </div>
  );
}

/** The shape of a verification report: confirmed / attention / next. */
function ReportFragment({ label, rows }: { label: string; rows: { text: string; state: 'ok' | 'attention' | 'next' }[] }) {
  return (
    <div className="mx-6 mb-6 space-y-1.5 rounded-[0.7rem] border border-foreground/12 bg-secondary/70 p-4 sm:mx-7" role="img" aria-label={label}>
      {rows.map(row => (
        <div key={row.text} className="flex items-center gap-2.5 rounded-md border border-foreground/10 bg-card px-2.5 py-2">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${row.state === 'ok' ? 'bg-success' : row.state === 'attention' ? 'bg-gold' : 'bg-foreground/35'}`}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate text-[11px] text-ink-soft">{row.text}</span>
        </div>
      ))}
    </div>
  );
}

/** A financing scenario's shape — labelled rows, no invented rate. */
function FinancingFragment({ label, rows, result }: { label: string; rows: string[]; result: string }) {
  return (
    <div className="mx-6 mb-6 space-y-1.5 rounded-[0.7rem] border border-foreground/12 bg-secondary/70 p-4 sm:mx-7" role="img" aria-label={label}>
      {rows.map(row => (
        <div key={row} className="flex items-center justify-between gap-3 rounded-md border border-foreground/10 bg-card px-2.5 py-2">
          <span className="min-w-0 truncate text-[11px] text-ink-soft">{row}</span>
          <span className="h-1.5 w-10 shrink-0 rounded-full bg-foreground/15" aria-hidden="true" />
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 rounded-md bg-primary px-2.5 py-2">
        <span className="min-w-0 truncate text-[11px] font-medium text-primary-foreground">{result}</span>
        <span className="h-1.5 w-10 shrink-0 rounded-full bg-gold" aria-hidden="true" />
      </div>
    </div>
  );
}

/* ── Section ──────────────────────────────────────────────────────── */

export function CoreIntelligenceSection() {
  const { session } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  const gated = (path: string) => () => navigate(session ? path : '/auth/signup');

  const openVerify = () => {
    const value = code.trim();
    navigate(value ? `/verify?code=${encodeURIComponent(value)}` : '/verify');
  };

  return (
    <section id="capabilities" className={`${PAGE} scroll-mt-24 ${SECTION_Y}`}>
      <SectionIntro eyebrow={t('mp_core_eyebrow')} title={t('mp_core_title')} body={t('mp_core_sub')} />

      <div className="mt-14 grid gap-5 lg:grid-cols-3">
        {/* Matching — the differentiator, so it takes two columns. */}
        <Panel className="lg:col-span-2">
          <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] sm:items-center">
            <PanelHead icon={UserSearch} title={t('mp_match_title')} desc={t('mp_match_desc')} />
            <DemandGraph label={t('mp_match_title')} />
          </div>
          <PanelAction label={t('mp_match_cta')} onClick={gated('/property/add')} />
        </Panel>

        {/* Find property */}
        <Panel>
          <PanelHead icon={Search} title={t('mp_find_title')} desc={t('mp_find_desc')} />
          <ShortlistFragment
            label={t('mp_find_title')}
            rows={[t('mp_find_row_1'), t('mp_find_row_2'), t('mp_find_row_3')]}
          />
          <PanelAction label={t('mp_find_cta')} onClick={gated('/ai')} />
        </Panel>

        {/* Verify — with the live cadastral entry. */}
        <Panel className="lg:col-span-2">
          <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] sm:items-center">
            <div className="p-6 sm:p-7">
              <Icon icon={ShieldCheck} />
              <h3
                className="mt-5 text-balance font-semibold leading-[1.2] tracking-[-0.015em] text-foreground"
                style={{ fontSize: 'clamp(1.15rem, 1.5vw, 1.4rem)' }}
              >
                {t('mp_verify_capability_title')}
              </h3>
              <p className="mt-2.5 text-pretty text-sm leading-[1.7] text-ink-soft">{t('mp_verify_capability_desc')}</p>

              {/* The real entry point into the existing /verify flow. */}
              <form
                onSubmit={e => {
                  e.preventDefault();
                  openVerify();
                }}
                className="mt-5 flex items-center gap-2 rounded-[0.7rem] border border-foreground/25 bg-card p-1.5 ps-3.5 transition-[border-color,box-shadow] duration-300 focus-within:border-gold focus-within:shadow-hover motion-reduce:transition-none"
              >
                <input
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  placeholder={t('mp_verify_code_placeholder')}
                  aria-label={t('mp_verify_code_label')}
                  inputMode="numeric"
                  className="min-w-0 flex-1 bg-transparent py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                <button
                  type="submit"
                  aria-label={t('mp_verify_code_label')}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-[0.5rem] bg-primary text-primary-foreground transition-colors duration-300 hover:bg-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
                >
                  <ArrowRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </form>
            </div>

            <ReportFragment
              label={t('mp_verify_capability_title')}
              rows={[
                { text: t('mp_verify_frag_identity'), state: 'ok' },
                { text: t('mp_verify_frag_official'), state: 'ok' },
                { text: t('mp_verify_frag_attention'), state: 'attention' },
                { text: t('mp_verify_frag_next'), state: 'next' },
              ]}
            />
          </div>
          <PanelAction label={t('mp_verify_capability_cta')} onClick={() => navigate('/verify')} />
        </Panel>

        {/* Mortgage AI */}
        <Panel>
          <PanelHead icon={CircleDollarSign} title={t('mp_mortgage_title')} desc={t('mp_mortgage_desc')} />
          <FinancingFragment
            label={t('mp_mortgage_title')}
            rows={[t('mp_mortgage_row_price'), t('mp_mortgage_row_down'), t('mp_mortgage_row_term')]}
            result={t('mp_mortgage_row_result')}
          />
          <PanelAction label={t('mp_mortgage_cta')} onClick={() => navigate('/mortgage')} />
        </Panel>
      </div>
    </section>
  );
}

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Upload } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { FeatureGlyph, type GlyphName } from '@/components/home/FeatureGlyph';
import { PAGE } from './primitives';

/**
 * REGION 02 — the action launcher.
 *
 * THE POINT OF THE WHOLE PAGE
 *
 * A visitor who has read the hero now knows what Homatch claims. This is
 * where they get to do one of the things it claims. Every tile here starts a
 * REAL task on a route that already exists — there is no "learn more", and
 * nothing here is a placeholder for a feature that is not built.
 *
 * WHERE EACH TILE GOES, AND WHAT IT NEEDS
 *
 *   Verify       /verify?code=…   public. The field posts straight into the
 *                                 Verification Center's own code reader.
 *   Contract     /verify          the contract upload lives inside the
 *                                 Verification Center and only appears to a
 *                                 signed-in account, so a signed-out visitor
 *                                 is sent to sign-up rather than to a page
 *                                 that will not show them the control.
 *   Matching     /property/add    behind RouteGuard.
 *   Homatch AI   /ai              renders signed-out with a sign-in panel, so
 *                                 it is linked directly either way.
 *   Find         /ai              same page, carrying the question.
 *   Mortgage     /mortgage        public; the calculator runs signed-out.
 *
 * There is no "compare properties" tile. Homatch has no comparison feature,
 * and a launcher that opens onto something that does not exist is worse than
 * a launcher with one fewer tile.
 */
export function ActionLauncherSection() {
  const { session } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  /** Signed-out visitors go to sign-up for the routes that are truly gated. */
  const gated = (path: string) => () => navigate(session ? path : '/auth/signup');

  const openVerify = () => {
    const value = code.trim();
    navigate(value ? `/verify?code=${encodeURIComponent(value)}` : '/verify');
  };

  return (
    <section id="start" className={`${PAGE} scroll-mt-24 py-16 sm:py-20 lg:py-24`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-[42rem]">
          <p className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-gold-ink">
            <span className="h-px w-7 bg-gold" aria-hidden="true" />
            {t('mp_launch_eyebrow')}
          </p>
          <h2
            className="mt-4 text-balance font-semibold leading-[1.08] tracking-[-0.025em] text-foreground"
            style={{ fontSize: 'clamp(1.75rem, 3.2vw, 2.75rem)' }}
          >
            {t('mp_launch_title')}
          </h2>
        </div>
        <p className="max-w-[24rem] text-pretty text-sm leading-[1.7] text-ink-soft">{t('mp_launch_sub')}</p>
      </div>

      {/* ── The four primary tiles ─────────────────────────────────
          One column on a phone, because each carries a real sentence and a
          real control; two from sm, where a 300px column can hold them. */}
      <div className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2">
        {/* Verify — the only tile with a live field, because it is the only
            capability whose entry point is public and takes one value. */}
        <Tile glyph="verify" title={t('mp_verify_capability_title')} desc={t('mp_verify_capability_desc')} as="div">
          <form
            onSubmit={e => {
              e.preventDefault();
              openVerify();
            }}
            className="flex flex-col gap-2.5 sm:flex-row"
          >
            <input
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder={t('mp_verify_code_placeholder')}
              aria-label={t('mp_verify_code_label')}
              inputMode="numeric"
              className="h-11 min-w-0 flex-1 rounded-[0.6rem] border border-foreground/22 bg-card px-3.5 text-sm text-foreground transition-colors placeholder:text-muted-foreground/80 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/25"
            />
            <button
              type="submit"
              className="group/go inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-[0.6rem] bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors duration-300 hover:bg-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
            >
              {t('mp_launch_verify_go')}
              <ArrowRight
                className={`h-4 w-4 shrink-0 transition-transform duration-300 group-hover/go:translate-x-0.5 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover/go:-translate-x-0.5' : ''}`}
                strokeWidth={2}
                aria-hidden="true"
              />
            </button>
          </form>
        </Tile>

        <Tile
          glyph="contract"
          title={t('mp_contract_title')}
          desc={t('mp_contract_desc')}
          onClick={gated('/verify')}
          action={
            <span className="inline-flex items-center gap-2">
              <Upload className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              {t('mp_contract_cta')}
            </span>
          }
          note={t('mp_contract_formats')}
        />

        <Tile
          glyph="matching"
          title={t('mp_match_title')}
          desc={t('mp_match_desc')}
          onClick={gated('/property/add')}
          action={t('mp_match_cta')}
        />

        <Tile
          glyph="ai"
          title={t('ai_title')}
          desc={t('mp_launch_ai_desc')}
          onClick={() => navigate('/ai')}
          action={t('mp_flow_cta')}
        />
      </div>

      {/* ── Secondary actions ──────────────────────────────────────
          Real capabilities, smaller because they are entered less often.
          Two columns at every width; the tile itself stacks its glyph over
          its label until there is room for a row. */}
      <div className="mt-4 grid grid-cols-2 gap-4">
        <MiniTile
          glyph="property"
          title={t('mp_find_title')}
          onClick={() => navigate('/ai', { state: { prompt: t('mp_hero_action_property_prompt') } })}
        />
        <MiniTile glyph="mortgage" title={t('mp_mortgage_title')} onClick={() => navigate('/mortgage')} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The tile                                                            *
 *                                                                     *
 * A white card whose WHOLE SURFACE is the control, which is what makes *
 * a launcher feel like a launcher. The Verify tile is the exception:   *
 * it contains a field and a submit, so it renders as a plain <div>     *
 * rather than nesting interactive elements inside a button.            *
 * ------------------------------------------------------------------ */

function Tile({
  glyph, title, desc, action, note, onClick, as = 'button', children,
}: {
  glyph: GlyphName;
  title: string;
  desc: string;
  action?: React.ReactNode;
  note?: string;
  onClick?: () => void;
  as?: 'button' | 'div';
  children?: React.ReactNode;
}) {
  const { isRTL } = useLanguage();

  const body = (
    <>
      <FeatureGlyph
        name={glyph}
        size={60}
        className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-[1.04] motion-reduce:transform-none"
      />

      <h3
        className="mt-6 text-balance font-semibold leading-[1.18] tracking-[-0.015em] text-foreground"
        style={{ fontSize: 'clamp(1.15rem, 1.55vw, 1.4rem)' }}
      >
        {title}
      </h3>
      {/* Clamped on a phone. Four full-width tiles each carrying a six-line
          paragraph turns the launcher into the long stack of tall panels this
          layout exists to avoid; the full sentence is there from sm up, and
          the tile's destination is the same either way. */}
      <p className="mt-2.5 line-clamp-3 text-pretty text-[14.5px] leading-[1.65] text-ink-soft sm:line-clamp-none">
        {desc}
      </p>

      <div className="mt-6 border-t border-foreground/12 pt-5">
        {children ?? (
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground transition-colors duration-300 group-hover:text-gold-ink motion-reduce:transition-none">
            {action}
            <ArrowRight
              className={`h-4 w-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : ''}`}
              strokeWidth={2}
              aria-hidden="true"
            />
          </span>
        )}
        {note && <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{note}</p>}
      </div>
    </>
  );

  /* The gold edge that appears along the top on hover — the one premium
     detail every tile shares, and the reason the grid reads as a set. */
  const shell =
    'group relative flex h-full flex-col overflow-hidden rounded-[1.1rem] border border-foreground/14 bg-card p-6 text-start transition-[border-color,box-shadow,transform] duration-300 hover:border-foreground/45 hover:shadow-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none sm:p-7';

  const edge = (
    <span
      className="pointer-events-none absolute inset-x-0 top-0 h-[3px] origin-left scale-x-0 bg-gold transition-transform duration-300 group-hover:scale-x-100 motion-reduce:transition-none rtl:origin-right"
      aria-hidden="true"
    />
  );

  if (as === 'div') {
    return (
      <div className={shell}>
        {edge}
        {body}
      </div>
    );
  }

  return (
    <button type="button" onClick={onClick} className={shell}>
      {edge}
      {body}
    </button>
  );
}

/** The compact form of the same idea: glyph, label, arrow. */
function MiniTile({ glyph, title, onClick }: { glyph: GlyphName; title: string; onClick: () => void }) {
  const { isRTL } = useLanguage();
  return (
    <button
      type="button"
      onClick={onClick}
      /* Glyph above label on a phone: two of these side by side at 320px
         leave about 7px for the text once a 44px glyph, an arrow and the
         padding have taken their share, which is not a layout — it is a
         squeeze. The row form returns at sm, where the column is wide
         enough to hold the glyph, the label and the arrow together. */
      className="group flex flex-col items-start gap-3 rounded-[1.1rem] border border-foreground/14 bg-card p-4 text-start transition-[border-color,box-shadow] duration-300 hover:border-foreground/45 hover:shadow-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none sm:flex-row sm:items-center sm:gap-3.5 sm:p-5"
    >
      <FeatureGlyph
        name={glyph}
        size={44}
        className="transition-transform duration-300 group-hover:scale-[1.06] motion-reduce:transform-none"
      />
      <span className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-foreground">{title}</span>
      <ArrowRight
        className={`hidden h-4 w-4 shrink-0 text-muted-foreground transition-[transform,color] duration-300 group-hover:text-gold-ink motion-reduce:transform-none sm:block ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : 'group-hover:translate-x-1'}`}
        strokeWidth={2}
        aria-hidden="true"
      />
    </button>
  );
}

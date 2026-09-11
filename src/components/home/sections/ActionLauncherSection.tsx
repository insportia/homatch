import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Upload } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { FeatureGlyph, type GlyphName } from '@/components/home/FeatureGlyph';
import { PAGE, SECTION_Y } from './primitives';
import { useSectionField } from '@/site/content';

/**
 * REGION 02 — the action launcher.
 *
 * THE POINT OF THE WHOLE PAGE
 *
 * A visitor who has read the hero now knows what Homatch claims. This is
 * where they get to do one of the things it claims. Every tile starts a REAL
 * task on a route that already exists; there is no "learn more", and nothing
 * here stands in for a feature that is not built.
 *
 * SIX TILES, ONE SIZE
 *
 * The previous pass had four large tiles and two small ones. Size reads as
 * importance whatever the intent, so the two in the small row looked like
 * accessories to the four above them. They are not: the mortgage consultant
 * and the campaign tools are products people pay to use. Every tile is now
 * the same tile, in a 3 x 2 grid that becomes two columns on a tablet and one
 * on a phone. Difference of treatment happens further down the page, where
 * each capability gets a section shaped around what it actually does.
 *
 * WHERE EACH TILE GOES, AND WHAT IT NEEDS
 *
 *   Verify     /verify?code=…    public. The field posts straight into the
 *                                Verification Center's own code reader.
 *   Contract   /verify           the contract upload lives inside the
 *                                Verification Center and only renders for a
 *                                signed-in account, so a signed-out visitor
 *                                goes to sign-up rather than to a page that
 *                                will not show them the control.
 *   Matching   /property/add     behind RouteGuard.
 *   Mortgage   /mortgage         public; the calculator runs signed out.
 *   Calls      /outreach/calls   behind RouteGuard.
 *   Email      /outreach/email   behind RouteGuard.
 *
 * Homatch AI is not a tile. It is the hero's own interaction and has its own
 * region; these six are what a question to it reaches.
 *
 * There is no "compare properties" tile either. Homatch has no comparison
 * feature, and a launcher that opens onto something that does not exist is
 * worse than a launcher with one fewer tile.
 */
export function ActionLauncherSection() {
  const sf = useSectionField();
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
    <section id="start" className={`${PAGE} scroll-mt-20 ${SECTION_Y}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
        <div className="max-w-[40rem]">
          <p className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-gold-ink">
            <span className="h-px w-6 shrink-0 bg-gold" aria-hidden="true" />
            {sf('eyebrow', 'mp_launch_eyebrow')}
          </p>
          <h2
            className="mt-3.5 text-balance font-semibold leading-[1.1] tracking-[-0.025em] text-foreground"
            style={{ fontSize: 'clamp(1.4rem, 5.6vw, 2.75rem)' }}
          >
            {sf('title', 'mp_launch_title')}
          </h2>
        </div>
        <p className="max-w-[22rem] text-pretty text-[13.5px] leading-[1.6] text-ink-soft sm:text-sm">
          {sf('body', 'mp_launch_sub')}
        </p>
      </div>

      <div className="mt-8 grid gap-3.5 sm:mt-10 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        {/* Verify — the one tile with a live field, because it is the one
            capability whose entry point is public and takes a single value. */}
        <Tile glyph="verify" title={t('mp_tile_verify_t')} desc={t('mp_tile_verify_d')} as="div">
          <form
            onSubmit={e => {
              e.preventDefault();
              openVerify();
            }}
            className="flex flex-col gap-2"
          >
            <input
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder={t('mp_verify_code_placeholder')}
              aria-label={t('mp_verify_code_label')}
              inputMode="numeric"
              className="h-11 w-full min-w-0 rounded-[0.6rem] border border-foreground/[0.22] bg-card px-3.5 text-sm text-foreground transition-colors placeholder:text-muted-foreground/80 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/25"
            />
            <button
              type="submit"
              className="group/go inline-flex h-11 w-full items-center justify-center gap-2 rounded-[0.6rem] bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors duration-300 hover:bg-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
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
          desc={t('mp_tile_contract_d')}
          onClick={gated('/verify')}
          action={
            <span className="inline-flex items-center gap-2">
              <Upload className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              {t('mp_contract_cta')}
            </span>
          }
        />

        <Tile
          glyph="matching"
          title={t('mp_tile_match_t')}
          desc={t('mp_tile_match_d')}
          onClick={gated('/property/add')}
          action={t('mp_match_cta')}
        />

        <Tile
          glyph="mortgage"
          title={t('mp_mortgage_title')}
          desc={t('mp_tile_mortgage_d')}
          onClick={() => navigate('/mortgage')}
          action={t('mp_mortgage_cta')}
        />

        <Tile
          glyph="calls"
          title={t('call_center_title')}
          desc={t('mp_tile_calls_d')}
          onClick={gated('/outreach/calls')}
          action={t('mp_calls_cta')}
        />

        <Tile
          glyph="email"
          title={t('mp_email_title')}
          desc={t('mp_tile_email_d')}
          onClick={gated('/outreach/email')}
          action={t('mp_email_cta')}
        />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The tile                                                            *
 *                                                                     *
 * A white card whose WHOLE SURFACE is the control, which is what makes *
 * a launcher feel like a launcher. Verify is the exception: it holds a *
 * field and a submit, so it renders as a plain <div> rather than       *
 * nesting interactive elements inside a button.                       *
 * ------------------------------------------------------------------ */

function Tile({
  glyph, title, desc, action, onClick, as = 'button', children,
}: {
  glyph: GlyphName;
  title: string;
  desc: string;
  action?: React.ReactNode;
  onClick?: () => void;
  as?: 'button' | 'div';
  children?: React.ReactNode;
}) {
  const { isRTL } = useLanguage();

  const body = (
    <>
      {/* Glyph and title share a row on a phone, so a tile does not open with
          60px of picture before its first word; they stack from sm, where
          there is height to spend on the composition. */}
      <div className="flex items-center gap-3.5 sm:block">
        <FeatureGlyph
          name={glyph}
          size={48}
          className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-[1.04] motion-reduce:transform-none sm:h-14 sm:w-14"
        />
        <h3
          className="min-w-0 flex-1 text-balance font-semibold leading-[1.2] tracking-[-0.012em] text-foreground sm:mt-5"
          style={{ fontSize: 'clamp(1.05rem, 1.45vw, 1.3rem)' }}
        >
          {title}
        </h3>
      </div>

      <p className="mt-3 text-pretty text-[13.5px] leading-[1.6] text-ink-soft sm:mt-2.5 sm:text-[14.5px] sm:leading-[1.65]">
        {desc}
      </p>

      <div className="mt-5 border-t border-foreground/[0.12] pt-4 sm:mt-6 sm:pt-5">
        {children ?? (
          <span className="inline-flex items-center gap-2 text-start text-sm font-semibold text-foreground transition-colors duration-300 group-hover:text-gold-ink motion-reduce:transition-none">
            {action}
            <ArrowRight
              className={`h-4 w-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : ''}`}
              strokeWidth={2}
              aria-hidden="true"
            />
          </span>
        )}
      </div>
    </>
  );

  const shell =
    'group relative flex h-full flex-col overflow-hidden rounded-[1.1rem] border border-foreground/[0.14] bg-card p-5 text-start transition-[border-color,box-shadow] duration-300 hover:border-foreground/45 hover:shadow-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none sm:p-6';

  /* The gold edge along the top on hover: the one premium detail every tile
     shares, and the reason the grid reads as a set rather than six cards. */
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

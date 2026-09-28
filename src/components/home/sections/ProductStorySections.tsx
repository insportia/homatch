import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useProductNavigation } from '@/site/productEntry';
import { FeatureGlyph } from '@/components/home/FeatureGlyph';
import { PAGE, SECTION_Y } from './primitives';
import { useSectionField, useFieldProps } from '@/site/content';
import type { TranslationKey } from '@/i18n/translations';
import { SUPPORTED_LANGUAGES } from '@/types/types';

/**
 * THREE PRODUCT STORIES — Find Property, Investment Analysis, For Expats.
 *
 * These are the three services that until now existed on the homepage only as
 * launcher tiles, while Verify, Matching, Mortgage and the campaign tools each
 * had a region shaped around what they do. Same treatment now, same visual
 * language as their neighbours: the two-column region, the drawn glyph, the
 * check-listed points, the pill CTA, and a right-hand artifact whose VALUES
 * are blanked bars — the page has no customer and no data, and a plausible
 * number would be a fabricated result (the Mortgage region set this rule).
 *
 * Each region's artifact is different because each product's output is:
 * Find Property produces a confirmed SEARCH PLAN, Investment produces a
 * DECISION MODEL, For Expats produces a PERSONAL PATH. No shared generic card.
 */

/* Shared idioms, identical to MortgageSection's. */
const H2 = 'mt-6 text-balance font-semibold leading-[1.1] tracking-[-0.025em] text-foreground sm:mt-7';
const H2_SIZE = { fontSize: 'clamp(1.4rem, 5.6vw, 2.75rem)' } as const;
const BODY = 'mt-4 max-w-[34rem] text-pretty text-[16px] leading-[1.65] text-ink-soft sm:mt-5 sm:text-base sm:leading-[1.7]';
const CTA = 'group mt-7 inline-flex h-12 items-center justify-center gap-2.5 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors duration-300 hover:bg-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none sm:mt-9';
const PANEL = 'min-w-0 overflow-hidden rounded-[1.1rem] border border-foreground/15 bg-card shadow-hover';
const PANEL_HEAD = 'border-b border-foreground/[0.12] px-5 py-4 text-[14px] font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:px-6';

function Points({ fields }: { fields: readonly { field: string; title: TranslationKey; desc: TranslationKey }[] }) {
  const sf = useSectionField();
  const fp = useFieldProps();
  return (
    <ul className="mt-7 space-y-3.5 sm:mt-9 sm:space-y-4">
      {fields.map((point) => (
        <li key={point.field} className="flex gap-3.5">
          <span className="mt-[3px] grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground" aria-hidden="true">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
          <span className="min-w-0">
            <span className="block text-[17px] font-semibold leading-snug text-foreground" {...fp(`${point.field}_t`)}>
              {sf(`${point.field}_t`, point.title)}
            </span>
            <span className="mt-1 block text-pretty text-[16px] leading-relaxed text-ink-soft sm:text-sm" {...fp(`${point.field}_d`)}>
              {sf(`${point.field}_d`, point.desc)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Cta({ onClick, field, fallback }: { onClick: () => void; field: string; fallback: TranslationKey }) {
  const sf = useSectionField();
  const fp = useFieldProps();
  const { isRTL } = useLanguage();
  return (
    <button type="button" onClick={onClick} className={CTA}>
      <span {...fp(field)}>{sf(field, fallback)}</span>
      <ArrowRight
        className={`h-4 w-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none ${isRTL ? 'rotate-180 group-hover:-translate-x-1' : ''}`}
        strokeWidth={2}
        aria-hidden="true"
      />
    </button>
  );
}

/* Blanked value bars — the honesty device the Mortgage panel established. */
const bar = (w: string, tone = 'bg-foreground/20') => (
  <span className={`h-2 ${w} rounded-full ${tone}`} aria-hidden="true" />
);

/* ────────────────────────────────────────────────────────────────────────
 * FIND PROPERTY — describe → understood → plan → confirm → results
 * ──────────────────────────────────────────────────────────────────────── */

const FP_POINTS = [
  { field: 'p1', title: 'mp_fp_point_1' as TranslationKey, desc: 'mp_fp_point_1_d' as TranslationKey },
  { field: 'p2', title: 'mp_fp_point_2' as TranslationKey, desc: 'mp_fp_point_2_d' as TranslationKey },
  { field: 'p3', title: 'mp_fp_point_3' as TranslationKey, desc: 'mp_fp_point_3_d' as TranslationKey },
] as const;

export function FindPropertyStorySection() {
  const sf = useSectionField();
  const fp = useFieldProps();
  const { t } = useLanguage();
  const { signedIn } = useProductNavigation();
  const navigate = useNavigate();

  return (
    <section id="find-property" className={`${PAGE} scroll-mt-20 ${SECTION_Y}`}>
      <div className="grid gap-9 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div className="min-w-0">
          <div className="flex items-center gap-3.5">
            <FeatureGlyph name="property" size={48} className="sm:h-14 sm:w-14" />
            <p className="min-w-0 text-[14px] font-semibold uppercase tracking-[0.22em] text-gold-ink" {...fp('eyebrow')}>
              {sf('eyebrow', 'mp_fp_eyebrow')}
            </p>
          </div>
          <h2 className={H2} style={H2_SIZE} {...fp('title')}>{sf('title', 'mp_tile_findprop_t')}</h2>
          <p className={BODY} {...fp('body')}>{sf('body', 'mp_fp_desc')}</p>
          <Points fields={FP_POINTS} />
          <Cta
            onClick={() => navigate(signedIn ? '/find-property' : '/for-buyers')}
            field="cta"
            fallback="mp_fp_cta"
          />
        </div>

        {/* The artifact: a request becoming a confirmed plan. Values blank. */}
        <div className={PANEL} role="img" aria-label={t('mp_tile_findprop_t')}>
          <p className={PANEL_HEAD} {...fp('panel')}>{sf('panel', 'mp_fp_panel')}</p>

          {/* 1 — their own words. An illustrative sentence, labelled as the
              request, not a listing and not a promise. */}
          <div className="px-5 py-4 sm:px-6">
            <p className="rounded-[0.9rem] rounded-ss-sm border border-foreground/15 bg-secondary px-4 py-3 text-[15px] leading-relaxed text-foreground" {...fp('sample')}>
              {sf('sample', 'mp_fp_sample')}
            </p>
          </div>

          {/* 2 — what HOMATCH understood, as the plan's own rows: each row a
              requirement with its firmness, values blanked. */}
          <dl className="divide-y divide-foreground/10 border-t border-foreground/10">
            {([
              ['row_city', 'mp_fp_row_city', 'mp_fp_strength_required'],
              ['row_budget', 'mp_fp_row_budget', 'mp_fp_strength_required'],
              ['row_rooms', 'mp_fp_row_rooms', 'mp_fp_strength_preferred'],
            ] as const).map(([field, key, strengthKey]) => (
              <div key={field} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                <dt className="min-w-0 flex-1 text-[15px] text-ink-soft sm:text-sm" {...fp(field)}>{sf(field, key)}</dt>
                <dd className="flex shrink-0 items-center gap-2.5">
                  {bar('w-12 sm:w-16')}
                  <span className="rounded-full border border-foreground/20 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t(strengthKey)}
                  </span>
                </dd>
              </div>
            ))}
          </dl>

          {/* 3 — the confirmation: the customer approves the plan, matching
              starts. The dark band is the same one every artifact resolves in. */}
          <div className="flex items-center justify-between gap-4 bg-primary px-5 py-5 text-primary-foreground sm:px-6">
            <p className="min-w-0 text-[15px] font-semibold uppercase tracking-[0.14em] text-gold sm:text-sm" {...fp('confirm')}>
              {sf('confirm', 'mp_fp_confirm')}
            </p>
            <span className="flex shrink-0 items-center gap-2" aria-hidden="true">
              <span className="h-3 w-16 rounded-full bg-gold sm:w-24" />
            </span>
          </div>

          <p className="px-5 py-4 text-pretty text-xs leading-relaxed text-muted-foreground sm:px-6" {...fp('note')}>
            {sf('note', 'mp_fp_note')}
          </p>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * INVESTMENT ANALYSIS — inputs on one side, the decision numbers on the other
 * ──────────────────────────────────────────────────────────────────────── */

const INV_POINTS = [
  { field: 'p1', title: 'mp_inv_point_1' as TranslationKey, desc: 'mp_inv_point_1_d' as TranslationKey },
  { field: 'p2', title: 'mp_inv_point_2' as TranslationKey, desc: 'mp_inv_point_2_d' as TranslationKey },
  { field: 'p3', title: 'mp_inv_point_3' as TranslationKey, desc: 'mp_inv_point_3_d' as TranslationKey },
] as const;

export function InvestmentStorySection() {
  const sf = useSectionField();
  const fp = useFieldProps();
  const { t } = useLanguage();
  const navigate = useNavigate();

  return (
    <section id="investment" className={`${PAGE} scroll-mt-20 ${SECTION_Y}`}>
      {/* Mirrored: artifact first on desktop, so this region does not read as
          a copy of its neighbour. On a phone the text still leads. */}
      <div className="grid gap-9 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div className="min-w-0 lg:order-2">
          <div className="flex items-center gap-3.5">
            <FeatureGlyph name="matching" size={48} className="sm:h-14 sm:w-14" />
            <p className="min-w-0 text-[14px] font-semibold uppercase tracking-[0.22em] text-gold-ink" {...fp('eyebrow')}>
              {sf('eyebrow', 'mp_inv_eyebrow')}
            </p>
          </div>
          <h2 className={H2} style={H2_SIZE} {...fp('title')}>{sf('title', 'mp_tile_invest_t')}</h2>
          <p className={BODY} {...fp('body')}>{sf('body', 'mp_inv_desc')}</p>
          <Points fields={INV_POINTS} />
          <Cta onClick={() => navigate('/investment')} field="cta" fallback="mp_inv_cta" />
        </div>

        {/* The model: three decision figures over the inputs that feed them.
            Every value a blank bar — a yield printed here would be a forecast
            nobody made. */}
        <div className={`${PANEL} lg:order-1`} role="img" aria-label={t('mp_tile_invest_t')}>
          <p className={PANEL_HEAD} {...fp('panel')}>{sf('panel', 'mp_inv_panel')}</p>

          <div className="grid grid-cols-3 divide-x divide-foreground/10 rtl:divide-x-reverse">
            {([
              ['m_yield', 'mp_inv_m_yield'],
              ['m_breakeven', 'mp_inv_m_breakeven'],
              ['m_margin', 'mp_inv_m_margin'],
            ] as const).map(([field, key]) => (
              <div key={field} className="px-4 py-4 sm:px-5">
                <p className="text-2xs font-semibold uppercase tracking-[0.1em] text-muted-foreground" {...fp(field)}>
                  {sf(field, key)}
                </p>
                <span className="mt-2.5 block h-3 w-14 rounded-full bg-foreground/20" aria-hidden="true" />
              </div>
            ))}
          </div>

          <dl className="divide-y divide-foreground/10 border-t border-foreground/10">
            {([
              ['row_price', 'mp_inv_row_price'],
              ['row_income', 'mp_inv_row_income'],
              ['row_costs', 'mp_inv_row_costs'],
            ] as const).map(([field, key]) => (
              <div key={field} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                <dt className="min-w-0 flex-1 text-[15px] text-ink-soft sm:text-sm" {...fp(field)}>{sf(field, key)}</dt>
                <dd className="flex shrink-0 items-center gap-2">{bar('w-14 sm:w-20')}{bar('w-9 sm:w-12', 'bg-foreground/10')}</dd>
              </div>
            ))}
          </dl>

          <div className="flex items-center justify-between gap-4 bg-primary px-5 py-5 text-primary-foreground sm:px-6">
            <p className="min-w-0 text-[15px] font-semibold uppercase tracking-[0.14em] text-gold sm:text-sm" {...fp('verdict')}>
              {sf('verdict', 'mp_inv_verdict')}
            </p>
            <span className="h-3 w-20 shrink-0 rounded-full bg-gold sm:w-28" aria-hidden="true" />
          </div>

          <p className="px-5 py-4 text-pretty text-xs leading-relaxed text-muted-foreground sm:px-6" {...fp('note')}>
            {sf('note', 'mp_inv_note')}
          </p>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * FOR EXPATS — a personal, localized path through Georgian property steps
 * ──────────────────────────────────────────────────────────────────────── */

const EX_POINTS = [
  { field: 'p1', title: 'mp_ex_point_1' as TranslationKey, desc: 'mp_ex_point_1_d' as TranslationKey },
  { field: 'p2', title: 'mp_ex_point_2' as TranslationKey, desc: 'mp_ex_point_2_d' as TranslationKey },
  { field: 'p3', title: 'mp_ex_point_3' as TranslationKey, desc: 'mp_ex_point_3_d' as TranslationKey },
] as const;

export function ExpatsStorySection() {
  const sf = useSectionField();
  const fp = useFieldProps();
  const { t } = useLanguage();
  const navigate = useNavigate();

  return (
    <section id="for-expats" className={`${PAGE} scroll-mt-20 ${SECTION_Y}`}>
      <div className="grid gap-9 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div className="min-w-0">
          <div className="flex items-center gap-3.5">
            <FeatureGlyph name="ai" size={48} className="sm:h-14 sm:w-14" />
            <p className="min-w-0 text-[14px] font-semibold uppercase tracking-[0.22em] text-gold-ink" {...fp('eyebrow')}>
              {sf('eyebrow', 'mp_ex_eyebrow')}
            </p>
          </div>
          <h2 className={H2} style={H2_SIZE} {...fp('title')}>{sf('title', 'mp_tile_expat_t')}</h2>
          <p className={BODY} {...fp('body')}>{sf('body', 'mp_ex_desc')}</p>
          <Points fields={EX_POINTS} />
          <Cta onClick={() => navigate('/for-expats/georgia')} field="cta" fallback="mp_ex_cta" />
        </div>

        {/* The path: numbered steps a foreign buyer actually walks, with the
            first marked done — a path in progress, not a brochure list. */}
        <div className={PANEL} role="img" aria-label={t('mp_tile_expat_t')}>
          <p className={PANEL_HEAD} {...fp('panel')}>{sf('panel', 'mp_ex_panel')}</p>

          <ol className="divide-y divide-foreground/10">
            {([
              ['step1', 'mp_ex_step_1', true],
              ['step2', 'mp_ex_step_2', false],
              ['step3', 'mp_ex_step_3', false],
              ['step4', 'mp_ex_step_4', false],
            ] as const).map(([field, key, done], index) => (
              <li key={field} className="flex items-center gap-3.5 px-5 py-3.5 sm:px-6">
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold ${
                    done ? 'bg-primary text-gold' : 'border border-foreground/20 text-muted-foreground'
                  }`}
                  aria-hidden="true"
                >
                  {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : index + 1}
                </span>
                <span className="min-w-0 flex-1 text-[15px] leading-snug text-foreground sm:text-sm" {...fp(field)}>
                  {sf(field, key)}
                </span>
                {bar('w-9 sm:w-12', 'bg-foreground/10')}
              </li>
            ))}
          </ol>

          <div className="flex items-center justify-between gap-4 bg-primary px-5 py-5 text-primary-foreground sm:px-6">
            <p className="min-w-0 text-[15px] font-semibold uppercase tracking-[0.14em] text-gold sm:text-sm" {...fp('langline')}>
              {sf('langline', 'mp_ex_langline')}
            </p>
            <span className="shrink-0 text-[13px] font-semibold tracking-[0.2em] text-white/70" aria-hidden="true" dir="ltr">
              {SUPPORTED_LANGUAGES.map((l) => l.code.toUpperCase()).join('·')}
            </span>
          </div>

          <p className="px-5 py-4 text-pretty text-xs leading-relaxed text-muted-foreground sm:px-6" {...fp('note')}>
            {sf('note', 'mp_ex_note')}
          </p>
        </div>
      </div>
    </section>
  );
}

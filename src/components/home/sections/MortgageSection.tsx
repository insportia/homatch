import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Landmark, TrendingUp } from 'lucide-react';
import { PAGE, SECTION_Y } from './primitives';
import { useSectionField, useFieldProps } from '@/site/content';
import type { TranslationKey } from '@/i18n/translations';

/**
 * REGION — the money: Mortgage and Investment, side by side.
 *
 * Both are public and both compute in the browser, so a visitor gets the
 * complete tool with no account; that is why these two buttons go straight to
 * the products and nothing here asks anybody to sign up.
 *
 * WHAT IT DOES NOT DRAW
 *
 * The previous region showed a "scenario" panel of grey bars standing in for
 * a monthly payment. A plausible payment on a marketing page is a quote
 * nobody made, and a bar pretending to be a number is the same thing more
 * quietly. Each card now says what the tool answers and what it does not —
 * Homatch does not arrange the loan, and does not forecast prices.
 *
 * The section type is still `mortgage`, so every field an admin already
 * wrote here keeps its key.
 */
export function MortgageSection() {
  const sf = useSectionField();
  const fp = useFieldProps();

  return (
    <section id="mortgage" className={`hm-pub-band scroll-mt-24 ${SECTION_Y}`}>
      <div className={PAGE}>
        <div className="max-w-[46rem]">
          <p className="hm-pub-eyebrow" {...fp('eyebrow')}>{sf('eyebrow', 'mp_mortgage_eyebrow')}</p>
          <h2 className="hm-pub-h2 mt-4 text-foreground" {...fp('title')}>{sf('title', 'pub_money_title')}</h2>
          <p className="hm-pub-lead mt-4" {...fp('body')}>{sf('body', 'pub_money_body')}</p>
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-2 lg:gap-6">
          <ToolCard
            to="/mortgage"
            icon={Landmark}
            title={['m_t', 'mp_mortgage_title']}
            body={['m_d', 'mp_mortgage_desc']}
            points={[['p1_t', 'mp_mortgage_point_1'], ['p2_t', 'mp_mortgage_point_2'], ['p3_t', 'mp_mortgage_point_3']]}
            cta={['cta', 'mp_mortgage_cta']}
            note={['note', 'mp_mortgage_note']}
          />
          <ToolCard
            to="/investment"
            icon={TrendingUp}
            title={['i_t', 'inv_product_eyebrow']}
            body={['i_d', 'inv_page_description']}
            points={[
              ['i1_t', 'inv_strategy_rental_title'],
              ['i2_t', 'inv_strategy_renovate_title'],
              ['i3_t', 'inv_strategy_construction_title'],
            ]}
            cta={['i_cta', 'pub_invest_cta']}
            note={['i_note', 'pub_invest_note']}
          />
        </div>
      </div>
    </section>
  );
}

type Field = [string, TranslationKey];

function ToolCard({
  to, icon: Glyph, title, body, points, cta, note,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: Field;
  body: Field;
  points: Field[];
  cta: Field;
  note: Field;
}) {
  const sf = useSectionField();
  const fp = useFieldProps();
  const navigate = useNavigate();
  const text = ([key, fallback]: Field) => sf(key, fallback);

  return (
    <article className="hm-pub-card bg-card flex flex-col p-6 sm:p-8">
      <span className="hm-pub-icon" aria-hidden="true"><Glyph className="h-5 w-5" strokeWidth={1.8} /></span>
      <h3 className="hm-pub-h3 mt-5 !text-[1.375rem] text-foreground" {...fp(title[0])}>{text(title)}</h3>
      <p className="mt-2.5 text-pretty text-[15.5px] leading-relaxed text-ink-soft" {...fp(body[0])}>{text(body)}</p>
      <ul className="mt-5 grid gap-2">
        {points.map(point => (
          <li key={point[0]} className="flex items-start gap-2.5 text-[15px] font-medium text-foreground">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-gold-ink" strokeWidth={2.5} aria-hidden="true" />
            <span {...fp(point[0])}>{text(point)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-7">
        <button type="button" onClick={() => navigate(to)} className="hm-pub-btn hm-pub-btn--secondary w-full sm:w-auto">
          <span {...fp(cta[0])}>{text(cta)}</span>
          <ArrowRight className="hm-pub-arrow" strokeWidth={2} aria-hidden="true" />
        </button>
        <p className="mt-4 text-pretty text-[13px] leading-relaxed text-muted-foreground" {...fp(note[0])}>{text(note)}</p>
      </div>
    </article>
  );
}

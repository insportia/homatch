import React from 'react';
import { ArrowRight } from 'lucide-react';
import { PAGE } from './primitives';
import { MatchPreview } from '@/components/home/publicUi';
import { useSectionField, useFieldProps } from '@/site/content';
import { useProductNavigation } from '@/site/productEntry';

/**
 * REGION 04 — what a match looks like to the owner who receives it.
 *
 * The section above explains where demand comes from; this one shows what
 * arrives. The card on the right is STRUCTURE: the fit word, the reasons
 * Homatch gives, the origin, and the caveat. No name, no budget figure, no
 * count — there is no real person behind an illustration, so none is drawn.
 *
 * The caveat is the product's own sentence (mp_match_caveat) and it is part
 * of the card, because on the real screen it is part of the card too.
 */
export function MatchingShowcaseSection() {
  const sf = useSectionField();
  const fp = useFieldProps();
  const { openProduct } = useProductNavigation();

  return (
    <section id="matching" className={`${PAGE} scroll-mt-24 py-16 sm:py-20 lg:py-24`}>
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="min-w-0">
          <p className="hm-pub-eyebrow" {...fp('eyebrow')}>{sf('eyebrow', 'pub_match_eyebrow')}</p>
          <h2 className="hm-pub-h2 mt-4 text-foreground" {...fp('title')}>{sf('title', 'mp_match_title')}</h2>
          <p className="hm-pub-lead mt-4 max-w-[36rem]" {...fp('body')}>{sf('body', 'mp_match_desc')}</p>
          <button
            type="button"
            onClick={() => openProduct('find_client')}
            className="hm-pub-btn hm-pub-btn--primary mt-8"
          >
            <span {...fp('cta')}>{sf('cta', 'pub_paths_owner_cta')}</span>
            <ArrowRight className="hm-pub-arrow" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <MatchPreview
          className="min-w-0"
          why={sf('why_label', 'mp_result_match_why')}
          reasons={[
            sf('reason1', 'mp_result_match_reason_1'),
            sf('reason2', 'mp_result_match_reason_2'),
            sf('reason3', 'mp_result_match_reason_3'),
          ]}
          caveat={sf('caveat', 'mp_match_caveat')}
          marks={{
            why: fp('why_label'),
            reasons: [fp('reason1'), fp('reason2'), fp('reason3')],
            caveat: fp('caveat'),
          }}
        />
      </div>
    </section>
  );
}

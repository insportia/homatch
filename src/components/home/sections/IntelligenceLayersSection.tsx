import React from 'react';
import { ArrowDown, ArrowRight, Globe2, Network, Scale, Sparkles } from 'lucide-react';
import { PAGE } from './primitives';
import { useSectionField, useFieldProps } from '@/site/content';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';

/**
 * REGION 03 — how a match is found. The navigation's "How matching works"
 * lands here, which is why the id is still `intelligence`.
 *
 * WHAT THIS REPLACED
 *
 * "Seven layers under every property" and an animated building scan. It
 * described what Homatch knows about a flat; it never said where the PEOPLE
 * come from, which is the question every owner and every buyer actually has.
 *
 * THE MECHANISM, AS IT IS
 *
 * Two sources of demand. The HOMATCH network is people stating their own
 * requirements on Homatch — a Find Property search plan, a conversation, a
 * viewing request. External intelligence is demand Homatch finds outside
 * itself, with its source recorded. Either can meet a property and become a
 * match, and a match carries its reasons and one of three fit words.
 *
 * And then the sentence the whole product depends on: a match is potential
 * interest, not a confirmed buyer. It is in the diagram, not in a footnote.
 */
export function IntelligenceLayersSection() {
  const sf = useSectionField();
  const fp = useFieldProps();
  const { t } = useLanguage();

  const field = (key: string, fallback: TranslationKey) => ({ text: sf(key, fallback), mark: fp(key) });

  return (
    <section id="intelligence" className="hm-pub-band scroll-mt-24 py-16 sm:py-20 lg:py-24">
      <div className={PAGE}>
        <div className="max-w-[46rem]">
          <p className="hm-pub-eyebrow" {...fp('eyebrow')}>{sf('eyebrow', 'pub_how_eyebrow')}</p>
          <h2 className="hm-pub-h2 mt-4 text-foreground" {...fp('title')}>{sf('title', 'pub_how_title')}</h2>
          <p className="hm-pub-lead mt-4" {...fp('body')}>{sf('body', 'pub_how_body')}</p>
        </div>

        <div className="mt-12 grid items-center gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-5">
          {/* The two sources, stacked: they feed the same thing. */}
          <div className="grid gap-4">
            <Node
              icon={Network}
              title={field('native_t', 'pub_how_native_t')}
              body={field('native_d', 'pub_how_native_d')}
            />
            <Node
              icon={Globe2}
              title={field('external_t', 'pub_how_external_t')}
              body={field('external_d', 'pub_how_external_d')}
            />
          </div>

          <Connector />

          <div className="hm-pub-card bg-card flex flex-col border-gold-border/70 p-6 shadow-[var(--pub-shadow-md)] sm:p-7">
            <span className="hm-pub-icon hm-pub-icon--gold" aria-hidden="true">
              <Sparkles className="h-5 w-5" strokeWidth={1.9} />
            </span>
            <h3 className="hm-pub-h3 mt-4 text-foreground" {...fp('match_t')}>{sf('match_t', 'pub_how_match_t')}</h3>
            <p className="mt-2 text-pretty text-[15.5px] leading-relaxed text-ink-soft" {...fp('match_d')}>{sf('match_d', 'pub_how_match_d')}</p>
            {/* The three words a customer actually sees on a match. */}
            <ul className="mt-5 flex flex-wrap gap-2" aria-label={t('pub_how_tiers')}>
              {(['match_fit_strong', 'match_fit_good', 'match_fit_possible'] as const).map((k, i) => (
                <li
                  key={k}
                  className={`rounded-full border px-3 py-1 text-[13px] font-semibold ${
                    i === 0 ? 'border-gold-border/70 bg-gold-soft text-gold-ink' : 'border-border bg-card text-ink-soft'
                  }`}
                >
                  {t(k)}
                </li>
              ))}
            </ul>
          </div>

          <Connector />

          <Node
            icon={Scale}
            title={field('decide_t', 'pub_how_decide_t')}
            body={field('decide_d', 'pub_how_decide_d')}
            emphasis
          />
        </div>
      </div>
    </section>
  );
}

function Node({
  icon: Glyph, title, body, emphasis = false,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: { text: string; mark: object };
  body: { text: string; mark: object };
  emphasis?: boolean;
}) {
  return (
    <div className={`hm-pub-card bg-card flex flex-col p-5 sm:p-6 ${emphasis ? 'sm:p-7' : ''}`}>
      <span className="hm-pub-icon" aria-hidden="true">
        <Glyph className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <h3 className="hm-pub-h3 mt-4 text-foreground" {...title.mark}>{title.text}</h3>
      <p className="mt-2 text-pretty text-[15px] leading-relaxed text-ink-soft" {...body.mark}>{body.text}</p>
    </div>
  );
}

/** Down on a phone, across from lg; turned round in a right-to-left language. */
function Connector() {
  return (
    <div className="flex items-center justify-center" aria-hidden="true">
      <span className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-gold-ink shadow-[var(--pub-shadow-sm)]">
        <ArrowDown className="h-4 w-4 lg:hidden" strokeWidth={2} />
        <ArrowRight className="hidden h-4 w-4 lg:block rtl:-scale-x-100" strokeWidth={2} />
      </span>
    </div>
  );
}

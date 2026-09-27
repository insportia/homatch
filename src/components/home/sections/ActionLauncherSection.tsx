import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Globe2, Home, Landmark, Search, ShieldCheck, TrendingUp, Users } from 'lucide-react';
import { PAGE } from './primitives';
import { PubSteps } from '@/components/home/publicUi';
import { useSectionField, useFieldProps } from '@/site/content';
import { useProductNavigation, type ProductKey } from '@/site/productEntry';
import type { TranslationKey } from '@/i18n/translations';

/**
 * REGION 02 — the two ways in, and everything else Homatch does.
 *
 * WHAT THIS REPLACED
 *
 * Six equal tiles: Verify, Contracts, Matching, Mortgage, AI Calls, Email.
 * Equal size said equal importance, and it buried the product. Homatch is a
 * matching platform with tools around it; a visitor should see the two sides
 * of a match first, as the two biggest things on the page after the hero, and
 * then the tools.
 *
 * Every tile used to route a signed-out visitor to /auth/signup through a
 * `gated()` helper — including Verify, which is public. Now each control goes
 * where it says: the product entry pages for the two authenticated products
 * (src/site/productEntry.ts), and the public tools directly.
 *
 * The two cards' steps are the product's actual sequence, in the same words
 * as the entry pages, because a visitor who reads one and then the other
 * should meet the same promise.
 */
const INDEX: {
  key: string;
  to: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: TranslationKey;
  desc: TranslationKey;
}[] = [
  { key: 'verify', to: '/verify', icon: ShieldCheck, title: 'nav_verify', desc: 'pub_navd_verify' },
  { key: 'mortgage', to: '/mortgage', icon: Landmark, title: 'nav_mortgage', desc: 'pub_navd_mortgage' },
  { key: 'investment', to: '/investment', icon: TrendingUp, title: 'nav_investment', desc: 'pub_navd_investment' },
  { key: 'expat', to: '/for-expats/georgia', icon: Globe2, title: 'nav_for_expats', desc: 'pub_navd_expat' },
  { key: 'brokers', to: '/brokers', icon: Users, title: 'pub_nav_brokers', desc: 'pub_navd_brokers' },
];

export function ActionLauncherSection() {
  const sf = useSectionField();
  const fp = useFieldProps();

  return (
    <section id="start" className={`${PAGE} scroll-mt-24 pb-16 pt-10 sm:pb-20 sm:pt-12 lg:pb-24 lg:pt-14`}>
      <div className="max-w-[44rem]">
        <p className="hm-pub-eyebrow" {...fp('eyebrow')}>{sf('eyebrow', 'pub_paths_eyebrow')}</p>
        <h2 className="hm-pub-h2 mt-4 text-foreground" {...fp('title')}>{sf('title', 'pub_paths_title')}</h2>
        <p className="hm-pub-lead mt-4" {...fp('body')}>{sf('body', 'pub_paths_body')}</p>
      </div>

      <div className="mt-10 grid gap-5 lg:grid-cols-2 lg:gap-6">
        <PathCard
          product="find_client"
          field="owner"
          icon={Home}
          keys={{
            eyebrow: 'pub_owner_eyebrow',
            title: 'pub_owner_title',
            steps: [
              ['pub_owner_step1_t', 'pub_owner_step1_d'],
              ['pub_owner_step2_t', 'pub_owner_step2_d'],
              ['pub_owner_step3_t', 'pub_owner_step3_d'],
            ],
            cta: 'pub_paths_owner_cta',
          }}
        />
        <PathCard
          product="find_property"
          field="buyer"
          icon={Search}
          keys={{
            eyebrow: 'pub_buyer_eyebrow',
            title: 'pub_buyer_title',
            steps: [
              ['pub_buyer_step1_t', 'pub_buyer_step1_d'],
              ['pub_buyer_step2_t', 'pub_buyer_step2_d'],
              ['pub_buyer_step3_t', 'pub_buyer_step3_d'],
            ],
            cta: 'pub_paths_buyer_cta',
          }}
        />
      </div>

      {/* THE TOOLS AROUND A MATCH. Every one is a public page a visitor can
          open without an account. */}
      <div className="mt-14 sm:mt-16">
        <h3 className="hm-pub-h3 text-foreground" {...fp('index_title')}>{sf('index_title', 'pub_index_title')}</h3>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {INDEX.map(item => (
            <li key={item.key}>
              <Link
                to={item.to}
                className="hm-pub-card bg-card hm-pub-card--link group flex h-full flex-row items-start gap-3.5 p-4 lg:flex-col lg:gap-4 lg:p-5"
              >
                <span className="hm-pub-icon" aria-hidden="true">
                  <item.icon className="h-5 w-5" strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[16px] font-semibold text-foreground">
                    <span {...fp(`index_${item.key}_t`)}>{sf(`index_${item.key}_t`, item.title)}</span>
                    <ArrowRight className="hm-pub-arrow h-4 w-4 text-muted-foreground group-hover:text-gold-ink" aria-hidden="true" />
                  </span>
                  <span className="mt-1 block text-pretty text-[14.5px] leading-snug text-muted-foreground" {...fp(`index_${item.key}_d`)}>
                    {sf(`index_${item.key}_d`, item.desc)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PathCard({
  product, field, icon: Glyph, keys,
}: {
  product: ProductKey;
  field: 'owner' | 'buyer';
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  keys: {
    eyebrow: TranslationKey;
    title: TranslationKey;
    steps: [TranslationKey, TranslationKey][];
    cta: TranslationKey;
  };
}) {
  const sf = useSectionField();
  const fp = useFieldProps();
  const { openProduct } = useProductNavigation();

  return (
    <article className="hm-pub-card bg-card flex flex-col overflow-hidden">
      {/* The gold rule is the one ornament: it says "start here" twice. */}
      <span className="h-[3px] bg-gradient-to-r from-gold via-gold/70 to-transparent rtl:bg-gradient-to-l" aria-hidden="true" />
      <div className="flex flex-1 flex-col p-5 sm:p-8">
        <div className="flex items-center gap-3.5">
          <span className="hm-pub-icon hm-pub-icon--gold" aria-hidden="true">
            <Glyph className="h-5 w-5" strokeWidth={1.9} />
          </span>
          <p className="text-[14px] font-semibold text-gold-ink" {...fp(`${field}_eyebrow`)}>{sf(`${field}_eyebrow`, keys.eyebrow)}</p>
        </div>
        <h3 className="hm-pub-h2 mt-5 !text-[clamp(1.4rem,3.2vw,1.9rem)] text-foreground" {...fp(`${field}_title`)}>
          {sf(`${field}_title`, keys.title)}
        </h3>
        <PubSteps
          className="mt-6"
          steps={keys.steps.map(([title, body], i) => ({
            title: sf(`${field}_s${i + 1}_t`, title),
            body: sf(`${field}_s${i + 1}_d`, body),
            titleMark: fp(`${field}_s${i + 1}_t`),
            bodyMark: fp(`${field}_s${i + 1}_d`),
          }))}
        />
        <div className="mt-auto pt-8">
          <button
            type="button"
            onClick={() => openProduct(product)}
            className="hm-pub-btn hm-pub-btn--primary w-full sm:w-auto"
          >
            <span {...fp(`${field}_cta`)}>{sf(`${field}_cta`, keys.cta)}</span>
            <ArrowRight className="hm-pub-arrow" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}

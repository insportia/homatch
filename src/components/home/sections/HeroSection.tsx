import React from 'react';
import { Check, Home, Mic, Search } from 'lucide-react';
import { AiTalkPanel } from '@/components/home/AiTalkPanel';
import { PAGE } from './primitives';
import { useSectionField, useFieldProps } from '@/site/content';
import { useProductNavigation } from '@/site/productEntry';

/**
 * REGION 01 — the hero.
 *
 * WHAT IT HAS TO SAY, AND IN WHAT ORDER
 *
 * What Homatch is, who it is for, and the two ways in. A visitor either has a
 * property and wants the people who might buy or rent it, or wants a property
 * and has a description of it. Those are the two buttons; nothing else in the
 * hero competes with them.
 *
 * WHY IT IS WHITE NOW
 *
 * It was a black band with a graded photograph, and the header sat on it
 * transparent. On a phone that black band was the whole first screen, and it
 * made the white page under it read as a second website. The public site is
 * light (the `.hm-public` scope in index.css): ink, hairlines, and gold only
 * as a signal.
 *
 * AI TALK
 *
 * The voice demo keeps its own dark stage — it is a live object, and the dark
 * ground is part of how it reads as one. Only its CONTAINER is placed here;
 * the panel and its voice logic are unchanged (§26). It sits beside the copy
 * from lg up and under it below, where AiTalkPanel sizes itself so it never
 * takes the whole viewport (§81).
 *
 * THREE FACTS, NOT THREE NUMBERS
 *
 * Under the buttons: languages, how paying works, and that Verify needs no
 * account. Each is a property of the product that is true on day one. There
 * is no count of users, properties or matches here, because Homatch has not
 * published one it can stand behind.
 */
export function HeroSection() {
  const sf = useSectionField();
  const fp = useFieldProps();
  const { openProduct } = useProductNavigation();

  const facts = ['fact1', 'fact2', 'fact3'] as const;
  const factKey = { fact1: 'pub_hero_fact1', fact2: 'pub_hero_fact2', fact3: 'pub_hero_fact3' } as const;

  return (
    <section className="relative isolate overflow-hidden bg-background">
      {/* A drafting grid that fades out from the top corner: structure, not
          decoration, and at 5% it is felt rather than seen. */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 [background-image:linear-gradient(hsl(var(--border)/0.7)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.7)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_70%_60%_at_20%_0%,black,transparent_75%)]"
        aria-hidden="true"
      />
      {/* One warm light behind the AI Talk stage. A gradient on a box the
          size of the section, rather than a blurred disc hanging off its
          edge: nothing extends past the viewport to be clipped. */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 ltr:[background:radial-gradient(38rem_28rem_at_88%_0%,hsl(var(--gold)/0.12),transparent_70%)] rtl:[background:radial-gradient(38rem_28rem_at_12%_0%,hsl(var(--gold)/0.12),transparent_70%)]"
        aria-hidden="true"
      />

      <div className={`${PAGE} grid items-center gap-10 pb-12 pt-8 sm:pt-12 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:gap-14 lg:pb-16 lg:pt-14`}>
        <div className="min-w-0">
          <p className="hm-pub-eyebrow" {...fp('eyebrow')}>{sf('eyebrow', 'pub_hero_eyebrow')}</p>

          {/* The name, then the proposition, as one heading. Two lines rather
              than one sentence so the name is unmistakable before the phrase
              under it is read. */}
          <h1 className="hm-pub-h1 mt-5 text-foreground">
            <span className="block" {...fp('brand')}>{sf('brand', 'brand_name')}</span>
            <span className="block" {...fp('title')}>{sf('title', 'mp_hero_h1')}</span>
          </h1>

          <p className="mt-5 max-w-[36rem] text-balance text-[1.1875rem] font-semibold leading-snug text-foreground sm:text-[1.3rem]" {...fp('subtitle')}>
            {sf('subtitle', 'pub_hero_sub')}
          </p>
          <p className="hm-pub-lead mt-3 max-w-[36rem]" {...fp('body')}>
            {sf('body', 'pub_hero_body')}
          </p>

          <div className="mt-8 grid gap-3 sm:flex sm:flex-wrap">
            <button
              type="button"
              onClick={() => openProduct('find_property')}
              className="hm-pub-btn hm-pub-btn--primary hm-pub-btn--lg justify-start sm:justify-center"
            >
              <Search className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden="true" />
              <span {...fp('cta_find')}>{sf('cta_find', 'dnav_find_property')}</span>
            </button>
            <button
              type="button"
              onClick={() => openProduct('find_client')}
              className="hm-pub-btn hm-pub-btn--secondary hm-pub-btn--lg justify-start sm:justify-center"
            >
              <Home className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden="true" />
              <span {...fp('cta_owner')}>{sf('cta_owner', 'pub_nav_find_client')}</span>
            </button>
          </div>

          <ul className="mt-8 grid gap-2.5 text-[15px] text-ink-soft sm:grid-cols-3 sm:gap-4 lg:grid-cols-1 lg:gap-2.5 xl:grid-cols-3 xl:gap-4">
            {facts.map(f => (
              <li key={f} className="flex items-start gap-2.5">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gold-soft text-gold-ink" aria-hidden="true">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                <span className="min-w-0 leading-snug" {...fp(f)}>{sf(f, factKey[f])}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* AI TALK. A demonstration of what Homatch understands, on its own
            dark stage. Only this frame is the page's; the panel is its own. */}
        <div className="min-w-0">
          <p className="mb-3 flex items-center justify-center gap-2 text-[13.5px] font-medium text-muted-foreground lg:justify-start">
            <Mic className="h-4 w-4 text-gold-ink" strokeWidth={2} aria-hidden="true" />
            <span {...fp('talk_label')}>{sf('talk_label', 'pub_hero_talk_label')}</span>
          </p>
          <div className="mx-auto max-w-[27rem] rounded-[1.4rem] bg-[hsl(var(--pub-night))] p-1.5 text-white shadow-[var(--pub-shadow-lg)] ring-1 ring-black/5 lg:mx-0 lg:max-w-none">
            <AiTalkPanel />
          </div>
        </div>
      </div>
    </section>
  );
}

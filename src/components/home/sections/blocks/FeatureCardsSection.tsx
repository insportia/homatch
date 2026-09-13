// HOMATCH — a group of short points an admin writes and arranges.
//
// WHY THESE ARE NOT BOXES
//
// The registry calls the type "feature cards", because that is what an admin
// is looking for when they go to add one. What it RENDERS is columns under a
// hairline rule, because this page's design language says a bordered surface
// appears only where it holds a real object or interaction (see the note on
// ../primitives). A grid of bordered rectangles is the single fastest way to
// make an editorial page look like a dashboard, and it is exactly what an
// editor with a "card block" tends to produce. So the block an admin adds is
// already the right shape; they cannot choose the wrong one.
//
// Three variants, all the same content read three ways:
//
//   grid    three across, for points that are peers
//   list    one per row with the icon beside it, for longer points
//   steps   numbered, for points that happen in order
import React from 'react';
import { Sparkles } from 'lucide-react';
import {
  useFieldProps, useIsEditing, useItemField, useItemIcon, useItemProps,
  useSectionItems, useSectionSettings, spacingClass,
} from '@/site/content';
import { useLanguage } from '@/contexts/LanguageContext';
import { Reveal } from '@/components/common/Reveal';
import { PAGE, Icon } from '../primitives';
import { BlockIntro, useBlockIntro } from './intro';

export function FeatureCardsSection() {
  const { variant, theme, spacing } = useSectionSettings();
  const items = useSectionItems();
  const itemField = useItemField();
  const itemIcon = useItemIcon();
  const editing = useIsEditing();
  const fp = useFieldProps();
  const ip = useItemProps();
  const { t } = useLanguage();

  const intro = useBlockIntro();
  const dark = theme === 'dark';

  /*
   * Nothing written in this language, and no children: on the public site
   * that is a block that does not exist yet, and half of one is worse than
   * none. In the editor it must still be here to be written into.
   */
  if (!intro.written && items.length === 0 && !editing) return null;

  const steps = variant === 'steps';
  const list = variant === 'list';

  return (
    <section className={dark ? 'bg-[#0D0D0D] text-white' : 'bg-background text-foreground'}>
      <div className={`${PAGE} ${spacingClass(spacing)}`}>
        <BlockIntro values={intro} dark={dark} />

        {items.length > 0 && (
          <ul
            className={`mt-12 sm:mt-16 ${
              list || steps
                ? 'flex flex-col gap-px'
                : 'grid gap-px sm:grid-cols-2 lg:grid-cols-3'
            } ${dark ? 'bg-white/10' : 'bg-foreground/10'}`}
          >
            {items.map((item, i) => {
              const Glyph = itemIcon(item, 'glyph', Sparkles);
              const title = itemField(item, 'title')
                || (editing ? t('studio_ph_card_title') : '');
              const body = itemField(item, 'body')
                || (editing ? t('studio_ph_card_body') : '');

              /*
               * The hairline between cards is the LIST's background showing
               * through a one-pixel gap, not a border on each card. A border
               * per card doubles at every shared edge and lands differently
               * at each breakpoint as the columns rewrap; a gap cannot.
               */
              return (
                <Reveal
                  as="li"
                  key={item.id}
                  delayIndex={i}
                  {...ip(item.id)}
                  className={`${dark ? 'bg-[#0D0D0D]' : 'bg-background'} ${
                    list || steps ? 'flex gap-5 py-7 sm:gap-6 sm:py-8' : 'px-1 py-7 sm:px-6 sm:py-8'
                  }`}
                >
                  {steps ? (
                    <span
                      aria-hidden="true"
                      className={`grid h-11 w-11 shrink-0 place-items-center rounded-[0.6rem] border text-[15px] font-semibold tabular-nums ${
                        dark
                          ? 'border-white/25 bg-white/[0.07] text-gold'
                          : 'border-foreground/15 bg-secondary text-foreground'
                      }`}
                    >
                      {i + 1}
                    </span>
                  ) : (
                    <Icon icon={Glyph} tone={dark ? 'light' : 'dark'} className={list ? '' : 'mb-5'} />
                  )}

                  <div className={list || steps ? 'min-w-0' : ''}>
                    <h3
                      className={`text-[17px] font-semibold leading-snug tracking-[-0.01em] ${dark ? 'text-white' : 'text-foreground'}`}
                      {...fp('title', item.id)}
                    >
                      {title}
                    </h3>
                    <p
                      className={`mt-2 text-pretty text-[15px] leading-[1.7] ${dark ? 'text-white/70' : 'text-ink-soft'}`}
                      {...fp('body', item.id)}
                    >
                      {body}
                    </p>
                  </div>
                </Reveal>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

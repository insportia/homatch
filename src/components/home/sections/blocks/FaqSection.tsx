// HOMATCH — questions and answers an admin writes.
//
// WHY <details> AND NOT A useState ACCORDION
//
// An accordion built from state needs the button, the aria-expanded, the
// aria-controls, the id pairing, the keyboard handling and the "open one,
// close the others" decision — and needs all of it to survive the answer
// being found by the browser's own in-page search, which a hidden div breaks.
// <details> is that widget, already correct, already searchable in every
// current browser, and it works before any JavaScript has run.
//
// WHY IT DOES NOT COLLAPSE IN THE EDITOR
//
// A collapsed answer is an answer with no caret in it. Worse, the element an
// admin would click to open the question is the same element they would click
// to edit it, so every attempt to place a caret in a question would also
// toggle the panel underneath. In the editor the whole set is simply laid
// open, which is also how an admin wants to read what they have written.
import React from 'react';
import {
  useFieldProps, useIsEditing, useItemField, useItemProps, useSectionItems,
  useSectionSettings, spacingClass,
} from '@/site/content';
import { useLanguage } from '@/contexts/LanguageContext';
import { ChevronDown } from 'lucide-react';
import { Reveal } from '@/components/common/Reveal';
import { PAGE } from '../primitives';
import { BlockIntro, useBlockIntro } from './intro';

export function FaqSection() {
  const { variant, theme, spacing } = useSectionSettings();
  const items = useSectionItems();
  const itemField = useItemField();
  const editing = useIsEditing();
  const fp = useFieldProps();
  const ip = useItemProps();
  const { t } = useLanguage();

  const intro = useBlockIntro();
  const dark = theme === 'dark';

  if (!intro.written && items.length === 0 && !editing) return null;

  const hairline = dark ? 'border-white/15' : 'border-foreground/10';
  const q = `text-[16px] font-semibold leading-snug tracking-[-0.01em] ${dark ? 'text-white' : 'text-foreground'}`;
  const a = `mt-3 text-pretty text-[15px] leading-[1.75] ${dark ? 'text-white/70' : 'text-ink-soft'}`;

  return (
    <section className={dark ? 'bg-[#0D0D0D] text-white' : 'bg-background text-foreground'}>
      <div className={`${PAGE} ${spacingClass(spacing)}`}>
        <BlockIntro values={intro} dark={dark} />

        {items.length > 0 && (
          <div
            className={`mt-12 sm:mt-16 ${
              // Two columns is a masonry problem when the answers differ in
              // length, so the second variant is two independent columns of
              // questions rather than one list flowed across two.
              variant === 'two_column' ? 'md:columns-2 md:gap-12' : 'max-w-[52rem]'
            }`}
          >
            {items.map((item, i) => {
              const question = itemField(item, 'question')
                || (editing ? t('studio_ph_question') : '');
              const answer = itemField(item, 'answer')
                || (editing ? t('studio_ph_answer') : '');

              const marks = (
                <>
                  <span className={q} {...fp('question', item.id)}>{question}</span>
                  <span className={a} {...fp('answer', item.id)}>{answer}</span>
                </>
              );

              return (
                <Reveal
                  key={item.id}
                  delayIndex={i}
                  {...ip(item.id)}
                  className={`break-inside-avoid border-t ${hairline} ${
                    // The last question needs a rule under it, or the list
                    // ends on an open edge and reads as unfinished.
                    i === items.length - 1 ? `border-b ${hairline}` : ''
                  }`}
                >
                  {editing ? (
                    <div className="flex flex-col py-6">{marks}</div>
                  ) : (
                    <details className="group py-6">
                      <summary className="flex cursor-pointer list-none items-start justify-between gap-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4">
                        <span className={q}>{question}</span>
                        <ChevronDown
                          className={`mt-0.5 h-5 w-5 shrink-0 transition-transform duration-300 group-open:rotate-180 motion-reduce:transition-none ${dark ? 'text-white/50' : 'text-ink-soft'}`}
                          strokeWidth={1.75}
                          aria-hidden="true"
                        />
                      </summary>
                      <p className={`${a} pe-11`}>{answer}</p>
                    </details>
                  )}
                </Reveal>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

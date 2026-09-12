// HOMATCH — the one section whose content is written by an admin.
//
// Every other section on the public site carries reviewed six-language copy
// in the code and merely ACCEPTS overrides. This one has nothing to fall
// back on, which makes it the only place a page can be missing copy in a
// language, and the only place this component can legitimately render
// nothing.
//
// It renders nothing rather than a placeholder on purpose. A half-translated
// announcement block showing English to an Arabic reader, or showing an
// empty bordered box, is worse than the block not being there: the rest of
// the page is complete and correct without it.
//
// It is also deliberately NOT rich text in the HTML sense. §11 forbids
// exposing custom HTML, colors or font sizes, so this takes plain strings and
// applies the site's own type scale. Paragraph breaks are the only structure,
// and they come from blank lines rather than markup, so nothing an admin can
// type becomes an element.
import React from 'react';
import {
  useFieldProps, useIsEditing, useSectionRaw, useSectionSettings, spacingClass,
} from '@/site/content';
import { useLanguage } from '@/contexts/LanguageContext';
import { PAGE } from './primitives';

export function RichTextSection() {
  // useSectionRaw, not useSectionField: there is no translation key to fall
  // back to, and inventing one would put another page's copy in this block.
  const raw = useSectionRaw();
  const { variant, theme, spacing } = useSectionSettings();
  const editing = useIsEditing();
  const fp = useFieldProps();
  const { t } = useLanguage();

  const storedEyebrow = raw('eyebrow');
  const storedTitle = raw('title');
  const storedBody = raw('body') ?? '';

  /*
   * IN THE EDITOR, AN EMPTY BLOCK STILL HAS TO EXIST.
   *
   * On the public site a block with no title renders nothing, which is
   * right — see the header. In the editor that same rule made a freshly
   * added block zero pixels tall: the admin pressed "add", nothing
   * appeared, and there was no text to click into to write any. So here,
   * and only here, empty fields render prompts.
   *
   * The prompts are NOT content. Nothing is written to the draft unless
   * the admin types over one, so a block left untouched still publishes
   * as nothing at all.
   */
  const eyebrow = storedEyebrow || (editing ? t('studio_ph_eyebrow') : undefined);
  const title = storedTitle || (editing ? t('studio_ph_title') : undefined);
  const body = storedBody || (editing ? t('studio_ph_body') : '');


  // A block with no title in THIS language has not been written for this
  // language yet. See the header: nothing is better than a fragment.
  if (!title) return null;

  const dark = theme === 'dark';
  const paragraphs = body.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

  return (
    <section className={dark ? 'bg-[#0D0D0D] text-white' : 'bg-background text-foreground'}>
      <div className={`${PAGE} ${spacingClass(spacing)}`}>
        <div className={`${variant === 'centered' ? 'mx-auto max-w-[44rem] text-center' : 'max-w-[44rem]'} ${editing && !storedTitle ? 'opacity-60' : ''}`}>
          {eyebrow && (
            <p
              className={`text-[14px] font-semibold uppercase tracking-[0.22em] ${dark ? 'text-gold' : 'text-gold-ink'}`}
              {...fp('eyebrow')}
            >
              {eyebrow}
            </p>
          )}
          <h2
            className={`mt-4 text-balance font-semibold leading-[1.1] tracking-[-0.025em] ${dark ? 'text-white' : 'text-foreground'}`}
            style={{ fontSize: 'clamp(1.4rem, 5.6vw, 2.5rem)' }}
            {...fp('title')}
          >
            {title}
          </h2>

          {/*
            * ONE ELEMENT WHILE EDITING, PARAGRAPHS WHEN PUBLISHED.
            *
            * The model stores `body` as a single string and splits it on blank
            * lines to make paragraphs. That is right for reading and wrong for
            * a caret: an admin clicking the second paragraph would be editing
            * a FRAGMENT of the stored value, and committing it would replace
            * the whole field with that fragment.
            *
            * So the editor gets the real string in one box, with the line
            * breaks preserved visually by pre-wrap. Same classes, same
            * typography; only the paragraph gaps differ, and only while
            * editing.
            */}
          {editing ? (
            <p
              className={`mt-4 whitespace-pre-wrap text-pretty text-[16px] leading-[1.7] sm:text-base ${dark ? 'text-white/70' : 'text-ink-soft'}`}
              {...fp('body')}
            >
              {body}
            </p>
          ) : paragraphs.map((p, i) => (
            <p
              key={p.slice(0, 32) + String(i)}
              className={`mt-4 text-pretty text-[16px] leading-[1.7] sm:text-base ${dark ? 'text-white/70' : 'text-ink-soft'}`}
            >
              {p}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}

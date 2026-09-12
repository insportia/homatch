// HOMATCH — the opening block of an admin-authored section.
//
// The designed sections use SectionIntro from ../primitives, which renders a
// heading it was handed. These three cannot: every line of their copy has to
// carry its own Studio field mark, so an admin can put a caret in it, and
// SectionIntro has nowhere to put those marks.
//
// So this is the same typography, composed here, with the marks attached and
// with one extra rule the designed sections do not need: in the editor an
// empty field renders a PROMPT. A block an admin has just added has no words
// at all, and without prompts it would be a few pixels of nothing — no text
// to click into, and therefore no way to write any.
//
// The prompts are not content. Nothing reaches the draft unless the admin
// types over one, so an untouched block still publishes as nothing.
import React from 'react';
import { useFieldProps, useIsEditing, useSectionRaw } from '@/site/content';
import { useLanguage } from '@/contexts/LanguageContext';
import { Eyebrow } from '../primitives';

export interface BlockIntroValues {
  eyebrow?: string;
  title?: string;
  body?: string;
  /** True when the admin has actually written a title in this language. */
  written: boolean;
}

/**
 * Read the three intro fields, with editor prompts standing in for blanks.
 *
 * Returned rather than rendered, because each section needs `written` to
 * decide whether it has anything to show at all.
 */
export function useBlockIntro(): BlockIntroValues {
  const raw = useSectionRaw();
  const editing = useIsEditing();
  const { t } = useLanguage();

  const title = raw('title');
  return {
    eyebrow: raw('eyebrow') || (editing ? t('studio_ph_eyebrow') : undefined),
    title: title || (editing ? t('studio_ph_title') : undefined),
    body: raw('body') || (editing ? t('studio_ph_body') : undefined),
    written: Boolean(title),
  };
}

export function BlockIntro({
  values, dark, align = 'start',
}: { values: BlockIntroValues; dark: boolean; align?: 'start' | 'center' }) {
  const fp = useFieldProps();
  const editing = useIsEditing();

  return (
    <div
      className={`${align === 'center' ? 'mx-auto max-w-[46rem] text-center' : 'max-w-[46rem]'} ${
        // Dimmed while it is still showing prompts, so an admin can see at a
        // glance which blocks they have actually written.
        editing && !values.written ? 'opacity-60' : ''
      }`}
    >
      {values.eyebrow && (
        <Eyebrow tone={dark ? 'light' : 'dark'} {...fp('eyebrow')}>{values.eyebrow}</Eyebrow>
      )}
      <h2
        className={`mt-5 text-balance font-semibold leading-[1.1] tracking-[-0.02em] ${dark ? 'text-white' : 'text-foreground'}`}
        style={{ fontSize: 'clamp(1.75rem, 3.1vw, 2.9rem)' }}
        {...fp('title')}
      >
        {values.title}
      </h2>
      {values.body && (
        <p
          className={`mt-5 text-pretty text-[17px] leading-[1.75] sm:text-base ${dark ? 'text-white/75' : 'text-ink-soft'}`}
          {...fp('body')}
        >
          {values.body}
        </p>
      )}
    </div>
  );
}

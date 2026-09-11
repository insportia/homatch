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
import { useSectionRaw, useSectionSettings, spacingClass } from '@/site/content';
import { PAGE } from './primitives';

export function RichTextSection() {
  // useSectionRaw, not useSectionField: there is no translation key to fall
  // back to, and inventing one would put another page's copy in this block.
  const raw = useSectionRaw();
  const { variant, theme, spacing } = useSectionSettings();

  const eyebrow = raw('eyebrow');
  const title = raw('title');
  const body = raw('body') ?? '';

  // A block with no title in THIS language has not been written for this
  // language yet. See the header: nothing is better than a fragment.
  if (!title) return null;

  const dark = theme === 'dark';
  const paragraphs = body.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

  return (
    <section className={dark ? 'bg-[#0D0D0D] text-white' : 'bg-background text-foreground'}>
      <div className={`${PAGE} ${spacingClass(spacing)}`}>
        <div className={variant === 'centered' ? 'mx-auto max-w-[44rem] text-center' : 'max-w-[44rem]'}>
          {eyebrow && (
            <p
              className={`text-[14px] font-semibold uppercase tracking-[0.22em] ${dark ? 'text-gold' : 'text-gold-ink'}`}
            >
              {eyebrow}
            </p>
          )}
          <h2
            className={`mt-4 text-balance font-semibold leading-[1.1] tracking-[-0.025em] ${dark ? 'text-white' : 'text-foreground'}`}
            style={{ fontSize: 'clamp(1.4rem, 5.6vw, 2.5rem)' }}
          >
            {title}
          </h2>
          {paragraphs.map((p, i) => (
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

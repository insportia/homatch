/* './model.ts' with the extension, not the bare specifier: this module is
   imported directly by a node test with no bundler to resolve it. */
import { STYLE_AXES, type SectionStyle, type StyleAxis } from './model.ts';

/**
 * A STYLE PRESET, TURNED INTO SOMETHING THE BROWSER UNDERSTANDS.
 *
 * Every axis becomes either a data attribute the stylesheet has a rule for,
 * or a custom property that a component reads. Nothing becomes an inline
 * colour, length or shadow, and that is deliberate rather than tidy:
 *
 *   A data attribute can only match a rule somebody wrote and reviewed. A
 *   stored value the code no longer knows matches nothing and the section
 *   renders as designed — which is the correct failure, because the
 *   alternative is a section with no background.
 *
 *   The two custom properties are lengths and a ratio, both consumed with a
 *   fallback (`var(--hm-measure, 90rem)`), so a missing one is the default
 *   rather than an unset width.
 *
 * WHERE EACH AXIS ACTUALLY LANDS
 *
 *   surface      the ground under the section, for sections that do not
 *                paint their own. The dark regions paint theirs, so `muted`
 *                on one of those is overridden by the rule in index.css that
 *                targets the section element directly.
 *   width        the measure, through --hm-measure, which the PAGE class
 *                reads. Every section built on PAGE responds.
 *   align        where that measure sits once it is narrower than the page.
 *   textAlign    text-align, inherited down the section.
 *   density      the section's own vertical padding.
 *   accent       remaps --gold, --gold-ink and --gold-soft inside the
 *                section, so every gold rule, icon and control in it goes
 *                quiet together rather than one at a time.
 *   cardStyle    the border, radius and shadow of cards inside it.
 *   mediaRatio   --hm-media-ratio, read by the picture plates that opt in.
 *   theme        already existed; a section-level light/dark where the
 *                component supports it.
 *   spacing      already existed; the vertical rhythm around the section.
 */

export interface StyleMark {
  className: string;
  style: Record<string, string>;
  attrs: Record<string, string>;
}

/** How wide the measure is, per step. */
const MEASURE: Record<string, string> = {
  narrow: '64rem',
  wide: '104rem',
  full: '100%',
};

/** The aspect ratio a picture plate takes, per step. */
const RATIO: Record<string, string> = {
  square: '1 / 1',
  wide: '21 / 9',
  tall: '3 / 4',
};

/**
 * The attributes and properties one section's style resolves to.
 *
 * An axis left at 'default' emits nothing at all — no attribute, no property
 * — so a section nobody has styled carries exactly the DOM it carried before
 * style presets existed.
 */
export function styleMark(style: SectionStyle | undefined): StyleMark {
  const attrs: Record<string, string> = {};
  const vars: Record<string, string> = {};
  if (!style) return { className: '', style: vars, attrs };

  const at = (axis: StyleAxis) => {
    const value = style[axis];
    const allowed: readonly string[] = STYLE_AXES[axis];
    return typeof value === 'string' && value !== 'default' && allowed.includes(value)
      ? value : null;
  };

  const surface = at('surface');
  if (surface) attrs['data-hm-surface'] = surface;

  const align = at('align');
  if (align) attrs['data-hm-align'] = align;

  const textAlign = at('textAlign');
  if (textAlign) attrs['data-hm-text'] = textAlign;

  const density = at('density');
  if (density) attrs['data-hm-density'] = density;

  const accent = at('accent');
  if (accent) attrs['data-hm-accent'] = accent;

  const cards = at('cardStyle');
  if (cards) attrs['data-hm-cards'] = cards;

  const width = at('width');
  if (width && MEASURE[width]) vars['--hm-measure'] = MEASURE[width];

  const ratio = at('mediaRatio');
  if (ratio && RATIO[ratio]) vars['--hm-media-ratio'] = RATIO[ratio];

  /* One marker when anything at all is set, so a stylesheet rule can scope
     itself to styled sections without listing every axis. */
  const styled = Object.keys(attrs).length > 0 || Object.keys(vars).length > 0;
  return {
    className: styled ? 'hm-styled' : '',
    style: vars,
    attrs: styled ? { ...attrs, 'data-hm-style': '' } : attrs,
  };
}

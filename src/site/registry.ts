import type { TranslationKey } from '@/i18n/translations';

/**
 * THE SECTION REGISTRY
 *
 * §4: "Do not allow arbitrary React component injection. Only registered
 * safe section types may render."
 *
 * This file is that allowlist. A section type that is not here has no
 * component, no fields and no variants, so normalizePage() drops it before
 * anything reaches React. Adding a section to the website is a code change
 * with a review, which is the point: the editor changes CONTENT, never what
 * code runs.
 *
 * WHY THE COMPONENTS ARE NOT IN THIS FILE
 *
 * Metadata only, no imports of React components. The public renderer and
 * the Site Studio inspector both need the field lists; only the renderer
 * needs the components. Keeping them apart means the inspector's
 * definitions cost a visitor nothing (§26).
 *
 * WHAT A `fallback` MEANS
 *
 * The translation key the section already uses. A field with a fallback can
 * never be blank on the public site, because with no override the reviewed
 * six-language copy renders. A field WITHOUT one is admin-authored content,
 * and is the only kind that can genuinely be missing in a locale.
 */

export type FieldKind = 'text' | 'textarea';

export interface SectionFieldDef {
  key: string;
  /** Label for the inspector. */
  labelKey: TranslationKey;
  kind: FieldKind;
  /** Existing translation key, or null for admin-authored content. */
  fallback: TranslationKey | null;
}

export interface SectionMediaDef {
  slot: string;
  labelKey: TranslationKey;
}

export interface SectionDef {
  type: string;
  labelKey: TranslationKey;
  /** Variants actually implemented in the component. Never aspirational. */
  variants: readonly string[];
  /** Themes the component genuinely supports, or [] when it is fixed. */
  themes: readonly ('light' | 'dark')[];
  fields: readonly SectionFieldDef[];
  media: readonly SectionMediaDef[];
  /** May an admin add another one of these to a page? */
  repeatable: boolean;
}

const f = (
  key: string, labelKey: TranslationKey, fallback: TranslationKey | null, kind: FieldKind = 'text',
): SectionFieldDef => ({ key, labelKey, kind, fallback });

export const SECTION_DEFS: readonly SectionDef[] = [
  {
    type: 'hero',
    labelKey: 'studio_sec_hero',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'mp_hero_eyebrow'),
      f('brand', 'studio_f_brand', 'brand_name'),
      f('title', 'studio_f_title', 'mp_hero_h1'),
      f('subtitle', 'studio_f_subtitle', 'mp_hero_h2'),
      f('body', 'studio_f_body', 'mp_hero_scope', 'textarea'),
      f('placeholder', 'studio_f_placeholder', 'mp_hero_ai_placeholder'),
    ],
    media: [{ slot: 'photo', labelKey: 'studio_m_photo' }],
  },
  {
    type: 'action_launcher',
    labelKey: 'studio_sec_launcher',
    variants: ['default', 'two_column'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'mp_launch_eyebrow'),
      f('title', 'studio_f_title', 'mp_launch_title'),
      f('body', 'studio_f_body', 'mp_launch_sub', 'textarea'),
    ],
    media: [],
  },
  {
    type: 'intelligence_layers',
    labelKey: 'studio_sec_layers',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'mp_layers_eyebrow'),
      f('title', 'studio_f_title', 'mp_layers_title'),
      f('body', 'studio_f_body', 'mp_layers_sub', 'textarea'),
    ],
    media: [],
  },
  {
    type: 'verify',
    labelKey: 'studio_sec_verify',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'mp_verify_eyebrow'),
      f('title', 'studio_f_title', 'mp_verify_show_title'),
      f('body', 'studio_f_body', 'mp_verify_capability_desc', 'textarea'),
      f('cta', 'studio_f_cta', 'mp_verify_capability_cta'),
    ],
    media: [{ slot: 'plate', labelKey: 'studio_m_photo' }],
  },
  {
    type: 'contract_intelligence',
    labelKey: 'studio_sec_contract',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'mp_contract_title'),
      f('title', 'studio_f_title', 'mp_ci_title'),
      f('body', 'studio_f_body', 'mp_ci_sub', 'textarea'),
      f('cta', 'studio_f_cta', 'mp_contract_cta'),
    ],
    media: [],
  },
  {
    type: 'matching',
    labelKey: 'studio_sec_matching',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'mp_match_eyebrow'),
      f('title', 'studio_f_title', 'mp_match_title'),
      f('subtitle', 'studio_f_subtitle', 'mp_match_show_title'),
      f('body', 'studio_f_body', 'mp_match_desc', 'textarea'),
    ],
    media: [],
  },
  {
    type: 'mortgage',
    labelKey: 'studio_sec_mortgage',
    variants: ['split', 'calculator_focus', 'scenario_compare'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'mp_mortgage_eyebrow'),
      f('title', 'studio_f_title', 'mp_mortgage_show_title'),
      f('body', 'studio_f_body', 'mp_mortgage_desc', 'textarea'),
      f('cta', 'studio_f_cta', 'mp_mortgage_cta'),
    ],
    media: [],
  },
  {
    type: 'call_center',
    labelKey: 'studio_sec_calls',
    variants: ['split', 'console_focus', 'workflow_focus'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'call_center_title'),
      f('title', 'studio_f_title', 'mp_cc_title'),
      f('body', 'studio_f_body', 'mp_cc_sub', 'textarea'),
      f('cta', 'studio_f_cta', 'mp_calls_cta'),
    ],
    media: [],
  },
  {
    type: 'email_campaign',
    labelKey: 'studio_sec_email',
    variants: ['campaign_builder', 'message_focus', 'workflow'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'mp_email_eyebrow'),
      f('title', 'studio_f_title', 'mp_email_show_title'),
      f('body', 'studio_f_body', 'mp_email_desc', 'textarea'),
      f('cta', 'studio_f_cta', 'mp_email_cta'),
    ],
    media: [],
  },
  {
    type: 'homatch_ai',
    labelKey: 'studio_sec_ai',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'mp_flow_eyebrow'),
      f('title', 'studio_f_title', 'mp_flow_title'),
      f('body', 'studio_f_body', 'mp_flow_sub', 'textarea'),
    ],
    media: [],
  },
  {
    type: 'developers',
    labelKey: 'studio_sec_developers',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'mp_dev_eyebrow'),
      f('title', 'studio_f_title', 'mp_dev_title'),
      f('body', 'studio_f_body', 'mp_dev_sub', 'textarea'),
      f('cta', 'studio_f_cta', 'mp_dev_cta'),
    ],
    media: [{ slot: 'backdrop', labelKey: 'studio_m_photo' }],
  },
  {
    type: 'closing_cta',
    labelKey: 'studio_sec_closing',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('title', 'studio_f_title', 'mp_cta_title'),
      f('body', 'studio_f_body', 'mp_cta_body', 'textarea'),
      f('cta', 'studio_f_cta', 'mp_cta_primary'),
      f('cta_secondary', 'studio_f_cta_secondary', 'mp_verify_capability_cta'),
    ],
    media: [{ slot: 'photo', labelKey: 'studio_m_photo' }],
  },

  /* ── About ─────────────────────────────────────────────────────── */
  {
    type: 'about_hero',
    labelKey: 'studio_sec_about_hero',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'about_eyebrow'),
      f('title', 'studio_f_title', 'about_title'),
      f('body', 'studio_f_body', 'about_lede', 'textarea'),
      f('subtitle', 'studio_f_subtitle', 'about_lede_2'),
    ],
    media: [],
  },
  {
    type: 'about_what',
    labelKey: 'studio_sec_about_what',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'about_what_eyebrow'),
      f('title', 'studio_f_title', 'about_what_title'),
      f('body', 'studio_f_body', 'about_what_body', 'textarea'),
    ],
    media: [],
  },
  {
    type: 'about_market',
    labelKey: 'studio_sec_about_market',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'about_market_eyebrow'),
      f('title', 'studio_f_title', 'about_market_title'),
      f('body', 'studio_f_body', 'about_market_body', 'textarea'),
      f('note', 'studio_f_note', 'about_market_note', 'textarea'),
    ],
    media: [],
  },
  {
    type: 'about_sources',
    labelKey: 'studio_sec_about_sources',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'about_sources_eyebrow'),
      f('title', 'studio_f_title', 'about_sources_title'),
      f('body', 'studio_f_body', 'about_sources_body', 'textarea'),
      f('note', 'studio_f_note', 'about_sources_note', 'textarea'),
    ],
    media: [],
  },
  {
    type: 'about_intl',
    labelKey: 'studio_sec_about_intl',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'about_intl_eyebrow'),
      f('title', 'studio_f_title', 'about_intl_title'),
      f('body', 'studio_f_body', 'about_intl_body', 'textarea'),
    ],
    media: [],
  },
  {
    type: 'about_ask',
    labelKey: 'studio_sec_about_ask',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'about_ask_eyebrow'),
      f('title', 'studio_f_title', 'about_ask_title'),
      f('body', 'studio_f_body', 'about_ask_body', 'textarea'),
      f('note', 'studio_f_note', 'about_limits', 'textarea'),
    ],
    media: [],
  },

  /* ── The one admin-authored block ──────────────────────────────── */
  {
    type: 'rich_text',
    labelKey: 'studio_sec_rich_text',
    variants: ['default', 'centered'],
    themes: ['light', 'dark'],
    repeatable: true,
    fields: [
      // No fallback: this content exists only if an admin writes it, which
      // is why it is the only section that can report a locale as missing.
      f('eyebrow', 'studio_f_eyebrow', null),
      f('title', 'studio_f_title', null),
      f('body', 'studio_f_body', null, 'textarea'),
    ],
    media: [],
  },
];

const BY_TYPE = new Map(SECTION_DEFS.map(d => [d.type, d]));

export function sectionDef(type: string): SectionDef | undefined {
  return BY_TYPE.get(type);
}

export const KNOWN_SECTION_TYPES: readonly string[] = SECTION_DEFS.map(d => d.type);

export function variantsFor(type: string): readonly string[] {
  return BY_TYPE.get(type)?.variants ?? ['default'];
}

/** Public routes a link may point at. Kept here rather than derived from
 *  routes.tsx so the validator does not drag every page component into the
 *  editor bundle. */
export const PUBLIC_ROUTES: readonly string[] = [
  '/', '/about', '/verify', '/verify/:id', '/mortgage', '/partners',
  '/privacy', '/terms', '/ai', '/auth/login', '/auth/signup',
  '/dashboard', '/property/add', '/outreach/calls', '/outreach/email', '/credits',
];

/** The rules object normalizePage() needs, assembled from the registry. */
export const NORMALIZE_RULES = {
  knownTypes: KNOWN_SECTION_TYPES,
  variantsFor,
  knownRoutes: PUBLIC_ROUTES,
};

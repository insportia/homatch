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
  /**
   * A picture, or a video address.
   *
   * Both live in the same `media` map on the model, because both are a URL
   * with a caption. They differ in the editor -- one opens a file picker, the
   * other takes a pasted address checked by src/site/video.ts -- and in what
   * the component renders.
   */
  kind?: 'image' | 'video';
}

/**
 * One icon slot an admin may change.
 *
 * The stored value is a NAME from src/site/icons.ts, never markup, which is
 * the reason an icon is editable at all. See that module for the argument.
 */
export interface SectionIconDef {
  slot: string;
  labelKey: TranslationKey;
}

/**
 * THE SHAPE OF ONE REPEATED CHILD.
 *
 * A section with this declared has children an admin can add, reorder,
 * duplicate and delete -- cards, questions, steps. The child's own fields are
 * declared exactly like the section's, and for the same reason: the editor
 * offers what is declared and nothing else, so an admin cannot invent a field
 * the component does not render.
 *
 * `max` is not a database limit. It is the point past which the design stops
 * working: a nine-card grid on a phone is a column of nine identical boxes,
 * and the honest place to say so is before the tenth is added.
 */
export interface ItemGroupDef {
  /** What one child is called, in the list and on the add control. */
  itemLabelKey: TranslationKey;
  max: number;
  /**
   * How many children a freshly added block starts with.
   *
   * Not zero. A block that arrives as a heading with nothing under it looks
   * broken, gives an admin nothing to type into, and hides the fact that it
   * repeats at all behind a control they have to go and find. Starting with
   * three empty cards shows what the block IS on the first press.
   */
  seed: number;
  fields: readonly SectionFieldDef[];
  icons: readonly SectionIconDef[];
  media: readonly SectionMediaDef[];
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
  /**
   * Icon slots. Optional because the twenty sections that shipped before
   * icons were editable have none, and writing `icons: []` twenty times says
   * nothing that the absence does not already say.
   */
  icons?: readonly SectionIconDef[];
  /** Declared only by sections whose children repeat. */
  items?: ItemGroupDef;
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
      f('eyebrow', 'studio_f_eyebrow', 'pub_hero_eyebrow'),
      f('brand', 'studio_f_brand', 'brand_name'),
      f('title', 'studio_f_title', 'mp_hero_h1'),
      f('subtitle', 'studio_f_subtitle', 'pub_hero_sub'),
      f('body', 'studio_f_body', 'pub_hero_body', 'textarea'),
      /* The two ways in. Each opens the product for somebody signed in and
         its public entry page for somebody who is not (site/productEntry). */
      f('cta_find', 'studio_f_cta', 'dnav_find_property'),
      f('cta_owner', 'studio_f_cta_secondary', 'pub_nav_find_client'),
      /* Three facts under the buttons. Facts, not figures: there is no
         count of anything here, and an admin adding one should know that
         the page was designed not to carry it. */
      f('fact1', 'pub_hero_fact1', 'pub_hero_fact1'),
      f('fact2', 'pub_hero_fact2', 'pub_hero_fact2'),
      f('fact3', 'pub_hero_fact3', 'pub_hero_fact3'),
      // AI TALK sits inside the hero, so its copy belongs to the hero's
      // fields. Its STATE labels deliberately do not: "Listening" is the
      // product reporting a fact about itself, not a message to tune.
      f('talk_label', 'pub_hero_talk_label', 'pub_hero_talk_label'),
      f('talk_badge', 'talk_badge', 'talk_badge'),
      f('talk_title', 'talk_title', 'talk_title'),
      f('talk_languages', 'talk_languages', 'talk_languages'),
      f('talk_idle_body', 'talk_idle_body', 'talk_idle_body', 'textarea'),
      f('talk_start', 'talk_start', 'talk_start'),
    ],
    media: [],
  },
  {
    type: 'action_launcher',
    labelKey: 'studio_sec_launcher',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'pub_paths_eyebrow'),
      f('title', 'studio_f_title', 'pub_paths_title'),
      f('body', 'studio_f_body', 'pub_paths_body', 'textarea'),
      /* THE TWO PATHS. The owner's and the buyer's, each with the three
         steps the product actually takes, in the same words as the entry
         pages (/for-owners, /for-buyers). */
      f('owner_eyebrow', 'pub_owner_eyebrow', 'pub_owner_eyebrow'),
      f('owner_title', 'pub_owner_title', 'pub_owner_title'),
      f('owner_s1_t', 'pub_owner_step1_t', 'pub_owner_step1_t'),
      f('owner_s1_d', 'pub_owner_step1_d', 'pub_owner_step1_d', 'textarea'),
      f('owner_s2_t', 'pub_owner_step2_t', 'pub_owner_step2_t'),
      f('owner_s2_d', 'pub_owner_step2_d', 'pub_owner_step2_d', 'textarea'),
      f('owner_s3_t', 'pub_owner_step3_t', 'pub_owner_step3_t'),
      f('owner_s3_d', 'pub_owner_step3_d', 'pub_owner_step3_d', 'textarea'),
      f('owner_cta', 'studio_f_cta', 'pub_paths_owner_cta'),
      f('buyer_eyebrow', 'pub_buyer_eyebrow', 'pub_buyer_eyebrow'),
      f('buyer_title', 'pub_buyer_title', 'pub_buyer_title'),
      f('buyer_s1_t', 'pub_buyer_step1_t', 'pub_buyer_step1_t'),
      f('buyer_s1_d', 'pub_buyer_step1_d', 'pub_buyer_step1_d', 'textarea'),
      f('buyer_s2_t', 'pub_buyer_step2_t', 'pub_buyer_step2_t'),
      f('buyer_s2_d', 'pub_buyer_step2_d', 'pub_buyer_step2_d', 'textarea'),
      f('buyer_s3_t', 'pub_buyer_step3_t', 'pub_buyer_step3_t'),
      f('buyer_s3_d', 'pub_buyer_step3_d', 'pub_buyer_step3_d', 'textarea'),
      f('buyer_cta', 'studio_f_cta', 'pub_paths_buyer_cta'),
      /* The public tools around a match. */
      f('index_title', 'pub_index_title', 'pub_index_title'),
      f('index_verify_t', 'nav_verify', 'nav_verify'),
      f('index_verify_d', 'pub_navd_verify', 'pub_navd_verify', 'textarea'),
      f('index_mortgage_t', 'nav_mortgage', 'nav_mortgage'),
      f('index_mortgage_d', 'pub_navd_mortgage', 'pub_navd_mortgage', 'textarea'),
      f('index_investment_t', 'nav_investment', 'nav_investment'),
      f('index_investment_d', 'pub_navd_investment', 'pub_navd_investment', 'textarea'),
      f('index_expat_t', 'nav_for_expats', 'nav_for_expats'),
      f('index_expat_d', 'pub_navd_expat', 'pub_navd_expat', 'textarea'),
      f('index_brokers_t', 'pub_nav_brokers', 'pub_nav_brokers'),
      f('index_brokers_d', 'pub_navd_brokers', 'pub_navd_brokers', 'textarea'),
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
      f('eyebrow', 'studio_f_eyebrow', 'pub_how_eyebrow'),
      f('title', 'studio_f_title', 'pub_how_title'),
      f('body', 'studio_f_body', 'pub_how_body', 'textarea'),
      /* HOW A MATCH IS FOUND: the two sources of demand, the match, and the
         decision that stays with the person. The last one carries the
         sentence the product depends on -- potential interest, not a
         confirmed buyer -- so rewording it deserves care. */
      f('native_t', 'pub_how_native_t', 'pub_how_native_t'),
      f('native_d', 'pub_how_native_d', 'pub_how_native_d', 'textarea'),
      f('external_t', 'pub_how_external_t', 'pub_how_external_t'),
      f('external_d', 'pub_how_external_d', 'pub_how_external_d', 'textarea'),
      f('match_t', 'pub_how_match_t', 'pub_how_match_t'),
      f('match_d', 'pub_how_match_d', 'pub_how_match_d', 'textarea'),
      f('decide_t', 'pub_how_decide_t', 'pub_how_decide_t'),
      f('decide_d', 'pub_how_decide_d', 'pub_how_decide_d', 'textarea'),
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
      // The report itself. Nine lines that used to be reachable only through
      // a deploy.
      f('pi_label', 'mp_result_prop_label', 'mp_result_prop_label'),
      f('pi_confirmed', 'mp_result_prop_confirmed', 'mp_result_prop_confirmed'),
      f('pi_l1', 'mp_verify_frag_identity', 'mp_verify_frag_identity'),
      f('pi_l2', 'mp_verify_frag_official', 'mp_verify_frag_official'),
      f('pi_l3', 'mp_market_1_title', 'mp_market_1_title'),
      f('pi_attention', 'mp_result_prop_attention', 'mp_result_prop_attention'),
      f('pi_attention_line', 'mp_result_prop_attention_line', 'mp_result_prop_attention_line', 'textarea'),
      f('pi_next', 'mp_result_prop_next', 'mp_result_prop_next'),
      f('pi_next_line', 'mp_result_prop_next_line', 'mp_result_prop_next_line', 'textarea'),
      /* WHAT A CHECK COVERS. Three lines that are the section's actual
         promise -- records, project context, contract -- and the part most
         likely to need rewording as sources are added. */
      f('cap1_t', 'mp_market_2_title', 'mp_market_2_title'),
      f('cap1_d', 'mp_market_2_desc', 'mp_market_2_desc', 'textarea'),
      f('cap2_t', 'mp_market_3_title', 'mp_market_3_title'),
      f('cap2_d', 'mp_market_3_desc', 'mp_market_3_desc', 'textarea'),
      f('cap3_t', 'mp_contract_title', 'mp_contract_title'),
      f('cap3_d', 'mp_verify_show_contract_d', 'mp_verify_show_contract_d', 'textarea'),
    ],
    icons: [
      { slot: 'pi_ok', labelKey: 'mp_result_prop_confirmed' },
      { slot: 'pi_warn', labelKey: 'mp_result_prop_attention' },
      { slot: 'pi_next', labelKey: 'mp_result_prop_next' },
    ],
    media: [{ slot: 'plate', labelKey: 'studio_m_photo' }],
  },
  /*
    * THE DEVELOPER / B2B PAGE.
    *
    * Three blocks, and every word in them is a field. That matters more here
    * than anywhere else on the site: the commercial packaging for developers
    * is still being decided, and an offer that can only be changed by a
    * deploy is an offer that goes stale between decisions.
    *
    * None of them is repeatable. They are the page's own regions, in the
    * order the argument is made -- problem, system, integrations -- and a
    * second copy of any one of them would be a page that argues twice.
    */
  {
    type: 'pricing_intro',
    labelKey: 'studio_sec_pricing_intro',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'nav_pricing'),
      f('title', 'studio_f_title', 'payg_headline'),
      f('body', 'studio_f_body', 'payg_no_subscription', 'textarea'),
    ],
    media: [],
  },
  {
    type: 'dev_hero',
    labelKey: 'studio_sec_dev_hero',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'mp_dev_eyebrow'),
      f('title', 'studio_f_title', 'mp_dev_title'),
      f('body', 'studio_f_body', 'mp_dev_sub', 'textarea'),
      /* Three, in the order a reader needs them: start, ask, read on. The
         first is the one this page exists for, and until it was added the
         Developer page had no route into the Developer product at all. */
      f('cta_start', 'studio_f_cta_start', 'devp_hero_cta_start'),
      f('cta', 'studio_f_cta', 'mp_dev_cta'),
      f('cta_secondary', 'studio_f_cta_secondary', 'devp_hero_cta2'),
    ],
    media: [],
  },
  {
    type: 'dev_flow',
    labelKey: 'studio_sec_dev_flow',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('problem_eyebrow', 'devp_problem_eyebrow', 'devp_problem_eyebrow'),
      f('problem_title', 'devp_problem_title', 'devp_problem_title'),
      f('problem_body', 'devp_problem_body', 'devp_problem_body', 'textarea'),
      f('eyebrow', 'studio_f_eyebrow', 'devp_flow_eyebrow'),
      f('title', 'studio_f_title', 'devp_flow_title'),
      f('body', 'studio_f_body', 'devp_flow_body', 'textarea'),
      f('step_project', 'mp_dev_stage_project', 'mp_dev_stage_project'),
      f('desc_project', 'devp_step1_d', 'devp_step1_d', 'textarea'),
      f('step_demand', 'mp_dev_stage_demand', 'mp_dev_stage_demand'),
      f('desc_demand', 'devp_step2_d', 'devp_step2_d', 'textarea'),
      f('step_qualify', 'mp_dev_stage_people', 'mp_dev_stage_people'),
      f('desc_qualify', 'devp_step3_d', 'devp_step3_d', 'textarea'),
      f('step_reach', 'mp_dev_stage_calls', 'mp_dev_stage_calls'),
      f('desc_reach', 'devp_step4_d', 'devp_step4_d', 'textarea'),
      f('step_followup', 'mp_dev_stage_followup', 'mp_dev_stage_followup'),
      f('desc_followup', 'devp_step5_d', 'devp_step5_d', 'textarea'),
      f('note', 'studio_f_note', 'devp_demo_note', 'textarea'),
    ],
    icons: [
      { slot: 'step_project', labelKey: 'mp_dev_stage_project' },
      { slot: 'step_demand', labelKey: 'mp_dev_stage_demand' },
      { slot: 'step_qualify', labelKey: 'mp_dev_stage_people' },
      { slot: 'step_reach', labelKey: 'mp_dev_stage_calls' },
      { slot: 'step_followup', labelKey: 'mp_dev_stage_followup' },
    ],
    media: [],
  },
  {
    type: 'dev_api',
    labelKey: 'studio_sec_dev_api',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'devp_api_eyebrow'),
      f('title', 'studio_f_title', 'devp_api_title'),
      f('body', 'studio_f_body', 'devp_api_body', 'textarea'),
      f('point_feed_t', 'studio_f_title', 'devp_api_eyebrow'),
      f('point_feed_d', 'studio_f_body', 'devp_api_body', 'textarea'),
      f('point_connect_t', 'studio_f_title', 'devp_api_eyebrow'),
      f('point_connect_d', 'studio_f_body', 'devp_api_body', 'textarea'),
      f('point_control_t', 'studio_f_title', 'devp_api_eyebrow'),
      f('point_control_d', 'studio_f_body', 'devp_api_body', 'textarea'),
      f('note', 'studio_f_note', 'devp_api_note', 'textarea'),
    ],
    icons: [
      { slot: 'feed', labelKey: 'devp_api_eyebrow' },
      { slot: 'connect', labelKey: 'devp_api_eyebrow' },
      { slot: 'control', labelKey: 'devp_api_eyebrow' },
    ],
    media: [],
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
      /* The document-analysis scene. Every word in it is a label rather
         than contract prose, so all of it is safe to hand to an admin --
         and it has to be, or the scene only reads correctly in English. */
      f('doc_heading', 'mp_ci_doc_heading', 'mp_ci_doc_heading'),
      f('doc_file', 'mp_ci_doc_label', 'mp_ci_doc_label'),
      f('doc_scanning', 'mp_ci_scanning', 'mp_ci_scanning'),
      f('doc_complete', 'mp_ci_st_complete', 'mp_ci_st_complete'),
      f('doc_note', 'mp_ci_panel_note', 'mp_ci_panel_note', 'textarea'),
      f('f_parties', 'mp_ci_f_parties', 'mp_ci_f_parties'),
      f('f_property', 'mp_ci_f_property', 'mp_ci_f_property'),
      f('f_price', 'mp_ci_f_price', 'mp_ci_f_price'),
      f('f_clause', 'mp_ci_f_clause', 'mp_ci_f_clause'),
      f('st_detected', 'mp_ci_st_detected', 'mp_ci_st_detected'),
      f('st_verified', 'mp_ci_st_verified', 'mp_ci_st_verified'),
      f('st_review', 'mp_ci_st_review', 'mp_ci_st_review'),
      /* THE FOUR STEPS. The reading, described. Each is a button as well as
         a line of copy, so the words are both the explanation and the
         control an admin's visitor presses. */
      f('step1_t', 'mp_ci_step_1', 'mp_ci_step_1'),
      f('step1_d', 'mp_ci_step_1_d', 'mp_ci_step_1_d', 'textarea'),
      f('step2_t', 'mp_ci_step_2', 'mp_ci_step_2'),
      f('step2_d', 'mp_ci_step_2_d', 'mp_ci_step_2_d', 'textarea'),
      f('step3_t', 'mp_ci_step_3', 'mp_ci_step_3'),
      f('step3_d', 'mp_ci_step_3_d', 'mp_ci_step_3_d', 'textarea'),
      f('step4_t', 'mp_ci_step_4', 'mp_ci_step_4'),
      f('step4_d', 'mp_ci_step_4_d', 'mp_ci_step_4_d', 'textarea'),
      f('formats', 'pub_contract_formats', 'pub_contract_formats', 'textarea'),
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
      f('eyebrow', 'studio_f_eyebrow', 'pub_match_eyebrow'),
      f('title', 'studio_f_title', 'mp_match_title'),
      f('body', 'studio_f_body', 'mp_match_desc', 'textarea'),
      /* The match card: the label over the reasons, the three reasons, and
         the caveat that keeps the claim honest. */
      f('why_label', 'mp_result_match_why', 'mp_result_match_why'),
      f('reason1', 'mp_result_match_reason_1', 'mp_result_match_reason_1', 'textarea'),
      f('reason2', 'mp_result_match_reason_2', 'mp_result_match_reason_2', 'textarea'),
      f('reason3', 'mp_result_match_reason_3', 'mp_result_match_reason_3', 'textarea'),
      f('caveat', 'mp_match_caveat', 'mp_match_caveat', 'textarea'),
      f('cta', 'studio_f_cta', 'pub_paths_owner_cta'),
    ],
    media: [],
  },
  {
    type: 'mortgage',
    labelKey: 'studio_sec_mortgage',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', 'mp_mortgage_eyebrow'),
      f('title', 'studio_f_title', 'pub_money_title'),
      f('body', 'studio_f_body', 'pub_money_body', 'textarea'),
      /* Mortgage and Investment, side by side. What each answers and what
         it does not; no figures, because a payment on a marketing page is a
         quote nobody made. */
      f('m_t', 'mp_mortgage_title', 'mp_mortgage_title'),
      f('m_d', 'mp_mortgage_desc', 'mp_mortgage_desc', 'textarea'),
      f('p1_t', 'mp_mortgage_point_1', 'mp_mortgage_point_1'),
      f('p2_t', 'mp_mortgage_point_2', 'mp_mortgage_point_2'),
      f('p3_t', 'mp_mortgage_point_3', 'mp_mortgage_point_3'),
      f('cta', 'studio_f_cta', 'mp_mortgage_cta'),
      f('note', 'mp_mortgage_note', 'mp_mortgage_note', 'textarea'),
      f('i_t', 'inv_product_eyebrow', 'inv_product_eyebrow'),
      f('i_d', 'inv_page_description', 'inv_page_description', 'textarea'),
      f('i1_t', 'inv_strategy_rental_title', 'inv_strategy_rental_title'),
      f('i2_t', 'inv_strategy_renovate_title', 'inv_strategy_renovate_title'),
      f('i3_t', 'inv_strategy_construction_title', 'inv_strategy_construction_title'),
      f('i_cta', 'studio_f_cta_secondary', 'pub_invest_cta'),
      f('i_note', 'pub_invest_note', 'pub_invest_note', 'textarea'),
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
      f('eyebrow', 'studio_f_eyebrow', 'nav_professional'),
      f('title', 'studio_f_title', 'pub_pro_title'),
      f('body', 'studio_f_body', 'pub_pro_body', 'textarea'),
      /* Brokers, developers, partners: one line each on what their public
         page is for. */
      f('brokers_t', 'pub_nav_brokers', 'pub_nav_brokers'),
      f('brokers_d', 'pub_pro_brokers_d', 'pub_pro_brokers_d', 'textarea'),
      f('brokers_cta', 'pub_pro_brokers_cta', 'pub_pro_brokers_cta'),
      f('developers_t', 'mp_nav_developers', 'mp_nav_developers'),
      f('developers_d', 'pub_pro_developers_d', 'pub_pro_developers_d', 'textarea'),
      f('developers_cta', 'pub_pro_developers_cta', 'pub_pro_developers_cta'),
      f('partners_t', 'home_nav_partners', 'home_nav_partners'),
      f('partners_d', 'pub_pro_partners_d', 'pub_pro_partners_d', 'textarea'),
      f('partners_cta', 'pub_pro_partners_cta', 'pub_pro_partners_cta'),
    ],
    media: [],
  },
  {
    type: 'closing_cta',
    labelKey: 'studio_sec_closing',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('title', 'studio_f_title', 'pub_close_title'),
      f('body', 'studio_f_body', 'pub_close_body', 'textarea'),
      f('cta', 'studio_f_cta', 'mp_cta_primary'),
      f('cta_secondary', 'studio_f_cta_secondary', 'mp_verify_capability_cta'),
      /* The pricing panel. The credit rate itself is not a field: it is the
         Pricing page's figure, not copy. */
      f('price_label', 'payg_headline', 'payg_headline'),
      f('price_body', 'payg_no_subscription', 'payg_no_subscription', 'textarea'),
      f('price_cta', 'pub_close_pricing', 'pub_close_pricing'),
    ],
    media: [],
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
      /* THE EIGHT CAPABILITIES. The page's own answer to "what is this",
         one card each, and the part that changes every time the product
         does. The route behind each card is not a field: renaming a card is
         content, re-pointing it is a code change. */
      f('cap_verify_t', 'mp_verify_capability_title', 'mp_verify_capability_title'),
      f('cap_verify_d', 'about_cap_verify', 'about_cap_verify', 'textarea'),
      f('cap_contract_t', 'mp_contract_title', 'mp_contract_title'),
      f('cap_contract_d', 'about_cap_contract', 'about_cap_contract', 'textarea'),
      f('cap_match_t', 'mp_tile_match_t', 'mp_tile_match_t'),
      f('cap_match_d', 'about_cap_match', 'about_cap_match', 'textarea'),
      f('cap_mortgage_t', 'mp_mortgage_title', 'mp_mortgage_title'),
      f('cap_mortgage_d', 'about_cap_mortgage', 'about_cap_mortgage', 'textarea'),
      f('cap_calls_t', 'call_center_title', 'call_center_title'),
      f('cap_calls_d', 'about_cap_calls', 'about_cap_calls', 'textarea'),
      f('cap_email_t', 'mp_email_title', 'mp_email_title'),
      f('cap_email_d', 'about_cap_email', 'about_cap_email', 'textarea'),
      f('cap_find_t', 'mp_find_title', 'mp_find_title'),
      f('cap_find_d', 'about_cap_find', 'about_cap_find', 'textarea'),
      f('cap_ai_t', 'ai_title', 'ai_title'),
      f('cap_ai_d', 'about_cap_ai', 'about_cap_ai', 'textarea'),
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
      /* The nine property kinds. A list that grows with the market rather
         than with the code. */
      f('kind_apartments', 'about_market_apartments', 'about_market_apartments'),
      f('kind_resale', 'about_market_resale', 'about_market_resale'),
      f('kind_new', 'about_market_new', 'about_market_new'),
      f('kind_houses', 'about_market_houses', 'about_market_houses'),
      f('kind_land', 'about_market_land', 'about_market_land'),
      f('kind_commercial', 'about_market_commercial', 'about_market_commercial'),
      f('kind_rentals', 'about_market_rentals', 'about_market_rentals'),
      f('kind_projects', 'about_market_projects', 'about_market_projects'),
      f('kind_developers', 'about_market_developers', 'about_market_developers'),
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
      /* THE EIGHT KINDS OF EVIDENCE. This is the page's accountability
         claim -- what an answer is allowed to rest on -- so it is the last
         list that should need a deploy to correct. */
      f('src_official_t', 'about_src_official', 'about_src_official'),
      f('src_official_d', 'about_src_official_d', 'about_src_official_d', 'textarea'),
      f('src_listings_t', 'about_src_listings', 'about_src_listings'),
      f('src_listings_d', 'about_src_listings_d', 'about_src_listings_d', 'textarea'),
      f('src_projects_t', 'about_src_projects', 'about_src_projects'),
      f('src_projects_d', 'about_src_projects_d', 'about_src_projects_d', 'textarea'),
      f('src_web_t', 'about_src_web', 'about_src_web'),
      f('src_web_d', 'about_src_web_d', 'about_src_web_d', 'textarea'),
      f('src_market_t', 'about_src_market', 'about_src_market'),
      f('src_market_d', 'about_src_market_d', 'about_src_market_d', 'textarea'),
      f('src_documents_t', 'about_src_documents', 'about_src_documents'),
      f('src_documents_d', 'about_src_documents_d', 'about_src_documents_d', 'textarea'),
      f('src_yours_t', 'about_src_yours', 'about_src_yours'),
      f('src_yours_d', 'about_src_yours_d', 'about_src_yours_d', 'textarea'),
      f('src_intent_t', 'about_src_intent', 'about_src_intent'),
      f('src_intent_d', 'about_src_intent_d', 'about_src_intent_d', 'textarea'),
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
      f('point1', 'about_intl_1', 'about_intl_1', 'textarea'),
      f('point2', 'about_intl_2', 'about_intl_2', 'textarea'),
      f('point3', 'about_intl_3', 'about_intl_3', 'textarea'),
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
      /* The same eight questions the home page offers, editable separately:
         the two pages are read by different people arriving for different
         reasons, and one shared list would tie them together for good. */
      f('q_buy', 'mp_intent_buy', 'mp_intent_buy', 'textarea'),
      f('q_price', 'mp_intent_price', 'mp_intent_price', 'textarea'),
      f('q_contract', 'mp_intent_contract', 'mp_intent_contract', 'textarea'),
      f('q_sell', 'mp_intent_sell', 'mp_intent_sell', 'textarea'),
      f('q_finance', 'mp_intent_finance', 'mp_intent_finance', 'textarea'),
      f('q_district', 'mp_intent_district', 'mp_intent_district', 'textarea'),
      f('q_rent', 'mp_intent_rent', 'mp_intent_rent', 'textarea'),
      f('q_platform', 'mp_intent_platform', 'mp_intent_platform', 'textarea'),
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


  /* ── The site's own chrome ─────────────────────────────────────── *
   *                                                                   *
   * The header and the footer are not part of any page, so they live  *
   * on a slug no route renders and are handed to the real components  *
   * by ShellScope. An admin renames "Verify" once, and it is renamed  *
   * on all seven pages.                                               *
   *                                                                   *
   * Every field's LABEL here is the translation key it falls back to.  *
   * The label for the Verify nav item is the word "Verify", in the     *
   * admin's own language, which is exactly what the field is -- and it *
   * costs no new string to say so.                                     *
   *                                                                   *
   * Every field HAS a fallback, which is the safety property that      *
   * matters most on this particular block: there is no stored value,   *
   * no failed fetch and no bad save that can leave the site with an    *
   * unlabelled navigation.                                             *
   * ──────────────────────────────────────────────────────────────── */
  {
    type: 'site_header',
    labelKey: 'studio_sec_header',
    variants: ['default'],
    themes: [],
    // There is one header. It is hidden by nothing and duplicated by nobody.
    repeatable: false,
    fields: [
      /* One field per label the header actually renders. A field for a link
         that is no longer in the navigation is a control that edits nothing,
         which is the thing the Admin redesign set out to remove. */
      f('nav_find_property', 'dnav_find_property', 'dnav_find_property'),
      f('nav_find_client', 'pub_nav_find_client', 'pub_nav_find_client'),
      f('nav_verify', 'nav_verify', 'nav_verify'),
      f('nav_services', 'pub_nav_services', 'pub_nav_services'),
      f('nav_intelligence', 'pub_nav_how', 'pub_nav_how'),
      f('nav_mortgage', 'nav_mortgage', 'nav_mortgage'),
      f('nav_investment', 'nav_investment', 'nav_investment'),
      f('nav_expat', 'nav_for_expats', 'nav_for_expats'),
      f('nav_professional', 'nav_professional', 'nav_professional'),
      f('nav_brokers', 'pub_nav_brokers', 'pub_nav_brokers'),
      f('nav_developers', 'mp_nav_developers', 'mp_nav_developers'),
      f('nav_partners', 'home_nav_partners', 'home_nav_partners'),
      f('nav_more', 'pub_nav_more', 'pub_nav_more'),
      f('nav_company', 'nav_company', 'nav_company'),
      f('nav_about', 'nav_about', 'nav_about'),
      f('nav_pricing', 'nav_pricing', 'nav_pricing'),
      f('cta_login', 'nav_login', 'nav_login'),
      f('cta_signup', 'nav_signup', 'nav_signup'),
      f('cta_dashboard', 'nav_dashboard', 'nav_dashboard'),
    ],
    media: [],
  },
  {
    type: 'site_footer',
    labelKey: 'studio_sec_footer',
    variants: ['default'],
    themes: [],
    repeatable: false,
    fields: [
      f('tagline', 'mp_footer_tagline', 'mp_footer_tagline', 'textarea'),
      f('heading_product', 'mp_footer_product', 'mp_footer_product'),
      f('heading_professional', 'nav_professional', 'nav_professional'),
      f('heading_company', 'mp_footer_company', 'mp_footer_company'),
      f('heading_legal', 'mp_footer_legal', 'mp_footer_legal'),
      f('link_find_property', 'dnav_find_property', 'dnav_find_property'),
      f('link_find_client', 'pub_nav_find_client', 'pub_nav_find_client'),
      f('link_verify', 'nav_verify', 'nav_verify'),
      f('link_contract', 'mp_contract_title', 'mp_contract_title'),
      f('link_mortgage', 'nav_mortgage', 'nav_mortgage'),
      f('link_investment', 'nav_investment', 'nav_investment'),
      f('link_expat', 'nav_for_expats', 'nav_for_expats'),
      f('link_brokers', 'pub_nav_brokers', 'pub_nav_brokers'),
      f('link_developers', 'mp_nav_developers', 'mp_nav_developers'),
      f('link_partners', 'home_nav_partners', 'home_nav_partners'),
      f('link_about', 'nav_about', 'nav_about'),
      f('link_pricing', 'nav_pricing', 'nav_pricing'),
      f('link_privacy', 'home_footer_privacy', 'home_footer_privacy'),
      f('link_terms', 'home_footer_terms', 'home_footer_terms'),
      f('brand_tagline', 'brand_tagline', 'brand_tagline'),
    ],
    media: [],
  },

  /* ── The blocks an admin builds out of ─────────────────────────── *
   *                                                                   *
   * Everything above is a region of the designed site, made editable. *
   * These three are different: they exist to be ADDED, several times, *
   * on any page, and their content is entirely the admin's. That is   *
   * why they are the ones with repeating children, icon slots and a   *
   * video address -- and why each carries no fallback translation     *
   * key, because there is no shipped copy for content nobody has      *
   * written yet.                                                      *
   * ──────────────────────────────────────────────────────────────── */
  {
    type: 'feature_cards',
    labelKey: 'studio_sec_feature_cards',
    // 'steps' numbers the cards; it is the same content read as a sequence,
    // which is why it is a variant rather than a second section type.
    variants: ['grid', 'list', 'steps'],
    themes: ['light', 'dark'],
    repeatable: true,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', null),
      f('title', 'studio_f_title', null),
      f('body', 'studio_f_body', null, 'textarea'),
    ],
    media: [],
    items: {
      itemLabelKey: 'studio_item_card',
      // Three across on a desktop grid; four rows of that is already a page
      // of its own.
      max: 12,
      seed: 3,
      fields: [
        f('title', 'studio_f_title', null),
        f('body', 'studio_f_body', null, 'textarea'),
      ],
      icons: [{ slot: 'glyph', labelKey: 'studio_i_glyph' }],
      media: [],
    },
  },
  {
    type: 'faq',
    labelKey: 'studio_sec_faq',
    variants: ['default', 'two_column'],
    themes: ['light', 'dark'],
    repeatable: true,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', null),
      f('title', 'studio_f_title', null),
      f('body', 'studio_f_body', null, 'textarea'),
    ],
    media: [],
    items: {
      itemLabelKey: 'studio_item_question',
      max: 20,
      seed: 3,
      fields: [
        f('question', 'studio_f_question', null),
        f('answer', 'studio_f_answer', null, 'textarea'),
      ],
      icons: [],
      media: [],
    },
  },
  {
    type: 'video_block',
    labelKey: 'studio_sec_video',
    variants: ['default', 'wide'],
    themes: ['light', 'dark'],
    repeatable: true,
    fields: [
      f('eyebrow', 'studio_f_eyebrow', null),
      f('title', 'studio_f_title', null),
      f('body', 'studio_f_body', null, 'textarea'),
    ],
    media: [
      { slot: 'video', labelKey: 'studio_m_video', kind: 'video' },
      // Shown until somebody presses play, so the page does not open six
      // third-party connections nobody asked for.
      { slot: 'poster', labelKey: 'studio_m_poster' },
    ],
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

/** The repeating-child shape for a type, or undefined if it has none. */
export function itemsDef(type: string): ItemGroupDef | undefined {
  return BY_TYPE.get(type)?.items;
}

/**
 * Routes a visitor with NO account can open. Kept here rather than derived
 * from routes.tsx so the validator does not drag every page component into
 * the editor bundle; tests/matrix/publicNav.test.mjs checks each one is a
 * real route declared `public: true`.
 *
 * This list used to hold /dashboard, /property/add, /outreach/*, /credits,
 * /contracts and /ai as well -- all behind RouteGuard -- so "public route"
 * meant "any route a page might link to", and nothing could tell a public
 * destination from a login bounce.
 */
export const PUBLIC_ROUTES: readonly string[] = [
  '/', '/about', '/pricing', '/partners', '/developers', '/brokers',
  '/verify', '/mortgage', '/investment',
  '/for-expats', '/for-expats/georgia', '/for-expats/georgia/:slug',
  // The public front doors of Find Property and the owner workspace.
  '/for-buyers', '/for-owners',
  '/privacy', '/terms', '/auth/login', '/auth/signup',
];

/**
 * Signed-in destinations a site page may still link to -- a "go to your
 * dashboard" button, say. Legitimate links, so the link checker accepts
 * them; kept apart so they are never mistaken for public pages.
 */
export const SIGNED_IN_ROUTES: readonly string[] = [
  '/dashboard', '/find-property', '/property', '/property/add', '/contracts',
  '/verify/history', '/verify/:id', '/ai', '/credits', '/profile',
  '/outreach/calls', '/outreach/email',
];

/** The rules object normalizePage() needs, assembled from the registry. */
export const NORMALIZE_RULES = {
  knownTypes: KNOWN_SECTION_TYPES,
  variantsFor,
  knownRoutes: [...PUBLIC_ROUTES, ...SIGNED_IN_ROUTES],
};

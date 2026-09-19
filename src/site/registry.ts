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
      f('eyebrow', 'studio_f_eyebrow', 'mp_hero_eyebrow'),
      f('brand', 'studio_f_brand', 'brand_name'),
      f('title', 'studio_f_title', 'mp_hero_h1'),
      f('subtitle', 'studio_f_subtitle', 'mp_hero_h2'),
      f('body', 'studio_f_body', 'mp_hero_scope', 'textarea'),
      f('placeholder', 'studio_f_placeholder', 'mp_hero_ai_placeholder'),
      // AI TALK sits inside the hero, so its copy belongs to the hero's
      // fields. Its STATE labels deliberately do not: "Listening" is the
      // product reporting a fact about itself, not a message to tune.
      f('talk_badge', 'talk_badge', 'talk_badge'),
      f('talk_title', 'talk_title', 'talk_title'),
      f('talk_languages', 'talk_languages', 'talk_languages'),
      /* The invitation and the control under it. The invitation is the one
         message in the panel written to persuade rather than to report; the
         states beside it ("Listening", "Microphone blocked") stay out, and
         say so on the element itself. */
      f('talk_idle_body', 'talk_idle_body', 'talk_idle_body', 'textarea'),
      f('talk_start', 'talk_start', 'talk_start'),
      /* ASK HOMATCH. The heading over the field, and the three starter
         questions beneath it -- which are also what gets SENT, so rewriting
         one changes the conversation it opens. */
      f('ask_heading', 'ai_title', 'ai_title'),
      f('ask_q1', 'mp_intent_buy', 'mp_intent_buy', 'textarea'),
      f('ask_q2', 'mp_intent_price', 'mp_intent_price', 'textarea'),
      f('ask_q3', 'mp_intent_contract', 'mp_intent_contract', 'textarea'),
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
      /* THE SIX TILES. Title, subtext and call to action for each — the
         menu labels, menu subtext and CTA copy that were hardcoded, and
         that an admin could see on the page but not change. Each falls
         back to the reviewed key it always used. */
      f('tile_verify_t', 'mp_tile_verify_t', 'mp_tile_verify_t'),
      f('tile_verify_d', 'mp_tile_verify_d', 'mp_tile_verify_d', 'textarea'),
      f('tile_verify_a', 'mp_launch_verify_go', 'mp_launch_verify_go'),
      f('tile_contract_t', 'mp_contract_title', 'mp_contract_title'),
      f('tile_contract_d', 'mp_tile_contract_d', 'mp_tile_contract_d', 'textarea'),
      f('tile_contract_a', 'mp_contract_cta', 'mp_contract_cta'),
      f('tile_match_t', 'mp_tile_match_t', 'mp_tile_match_t'),
      f('tile_match_d', 'mp_tile_match_d', 'mp_tile_match_d', 'textarea'),
      f('tile_match_a', 'mp_match_cta', 'mp_match_cta'),
      f('tile_mortgage_t', 'mp_mortgage_title', 'mp_mortgage_title'),
      f('tile_mortgage_d', 'mp_tile_mortgage_d', 'mp_tile_mortgage_d', 'textarea'),
      f('tile_mortgage_a', 'mp_mortgage_cta', 'mp_mortgage_cta'),
      f('tile_calls_t', 'call_center_title', 'call_center_title'),
      f('tile_calls_d', 'mp_tile_calls_d', 'mp_tile_calls_d', 'textarea'),
      f('tile_calls_a', 'mp_calls_cta', 'mp_calls_cta'),
      f('tile_email_t', 'mp_email_title', 'mp_email_title'),
      f('tile_email_d', 'mp_tile_email_d', 'mp_tile_email_d', 'textarea'),
      f('tile_email_a', 'mp_email_cta', 'mp_email_cta'),
    ],
    /* And the icon on each tile. Unset keeps the drawn glyph the tile
       shipped with; choosing one replaces it from the curated set. */
    icons: [
      { slot: 'tile_verify', labelKey: 'mp_tile_verify_t' },
      { slot: 'tile_contract', labelKey: 'mp_contract_title' },
      { slot: 'tile_match', labelKey: 'mp_tile_match_t' },
      { slot: 'tile_mortgage', labelKey: 'mp_mortgage_title' },
      { slot: 'tile_calls', labelKey: 'call_center_title' },
      { slot: 'tile_email', labelKey: 'mp_email_title' },
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
      /* THE SEVEN LAYERS. The name of each one and the sentence explaining
         it -- the section's entire argument, and until now the only part of
         it nobody could change without a deploy. */
      f('layer_property', 'mp_layer_property', 'mp_layer_property'),
      f('layer_property_d', 'mp_layer_property_d', 'mp_layer_property_d', 'textarea'),
      f('layer_project', 'mp_layer_project', 'mp_layer_project'),
      f('layer_project_d', 'mp_layer_project_d', 'mp_layer_project_d', 'textarea'),
      f('layer_location', 'mp_layer_location', 'mp_layer_location'),
      f('layer_location_d', 'mp_layer_location_d', 'mp_layer_location_d', 'textarea'),
      f('layer_market', 'mp_layer_market', 'mp_layer_market'),
      f('layer_market_d', 'mp_layer_market_d', 'mp_layer_market_d', 'textarea'),
      f('layer_demand', 'mp_layer_demand', 'mp_layer_demand'),
      f('layer_demand_d', 'mp_layer_demand_d', 'mp_layer_demand_d', 'textarea'),
      f('layer_contract', 'mp_layer_contract', 'mp_layer_contract'),
      f('layer_contract_d', 'mp_layer_contract_d', 'mp_layer_contract_d', 'textarea'),
      f('layer_financing', 'mp_layer_financing', 'mp_layer_financing'),
      f('layer_financing_d', 'mp_layer_financing_d', 'mp_layer_financing_d', 'textarea'),
      /* THE BUILDING SCENE. Stage labels, callout labels and the
         illustrative values shown beside the analysed unit. The animation
         must not depend on literal English: it plays in six languages, and
         the demo numbers are an admin's to change. */
      f('bi_stage_idle', 'bi_stage_idle', 'bi_stage_idle'),
      f('bi_stage_scan', 'bi_stage_scan', 'bi_stage_scan'),
      f('bi_stage_floors', 'bi_stage_floors', 'bi_stage_floors'),
      f('bi_stage_floor', 'bi_stage_floor', 'bi_stage_floor'),
      f('bi_stage_unit', 'bi_stage_unit', 'bi_stage_unit'),
      f('bi_stage_done', 'bi_stage_done', 'bi_stage_done'),
      f('bi_cal_floor', 'bi_cal_floor', 'bi_cal_floor'),
      f('bi_cal_area', 'bi_cal_area', 'bi_cal_area'),
      f('bi_cal_rooms', 'bi_cal_rooms', 'bi_cal_rooms'),
      f('bi_cal_status', 'bi_cal_status', 'bi_cal_status'),
      f('bi_val_floor', 'bi_val_floor', 'bi_val_floor'),
      f('bi_val_area', 'bi_val_area', 'bi_val_area'),
      f('bi_val_rooms', 'bi_val_rooms', 'bi_val_rooms'),
      f('bi_val_status', 'bi_val_status', 'bi_val_status'),
      f('bi_note', 'bi_note', 'bi_note'),
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
      f('title', 'studio_f_title', 'pricing_page_title'),
      f('body', 'studio_f_body', 'pricing_page_sub', 'textarea'),
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
      f('formats', 'mp_contract_formats', 'mp_contract_formats', 'textarea'),
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
      /* THE FOUR BEATS, and then the shortlist panel: the label over it,
         the three reasons it gives, the caveat that keeps the claim honest,
         and the control. All of it was a deploy away until now. */
      f('beat1', 'mp_match_beat_1', 'mp_match_beat_1'),
      f('beat2', 'mp_match_beat_2', 'mp_match_beat_2'),
      f('beat3', 'mp_match_beat_3', 'mp_match_beat_3'),
      f('beat4', 'mp_match_beat_4', 'mp_match_beat_4'),
      f('why_label', 'mp_result_match_why', 'mp_result_match_why'),
      f('reason1', 'mp_result_match_reason_1', 'mp_result_match_reason_1', 'textarea'),
      f('reason2', 'mp_result_match_reason_2', 'mp_result_match_reason_2', 'textarea'),
      f('reason3', 'mp_result_match_reason_3', 'mp_result_match_reason_3', 'textarea'),
      f('caveat', 'mp_match_caveat', 'mp_match_caveat', 'textarea'),
      f('cta', 'studio_f_cta', 'mp_match_cta'),
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
      /* The three things the consultant answers, and every label in the
         scenario panel beside them. The panel's VALUES stay drawn rather
         than written: a plausible monthly payment on a marketing page is a
         quote nobody made. */
      f('p1_t', 'mp_mortgage_point_1', 'mp_mortgage_point_1'),
      f('p1_d', 'mp_mortgage_point_1_d', 'mp_mortgage_point_1_d', 'textarea'),
      f('p2_t', 'mp_mortgage_point_2', 'mp_mortgage_point_2'),
      f('p2_d', 'mp_mortgage_point_2_d', 'mp_mortgage_point_2_d', 'textarea'),
      f('p3_t', 'mp_mortgage_point_3', 'mp_mortgage_point_3'),
      f('p3_d', 'mp_mortgage_point_3_d', 'mp_mortgage_point_3_d', 'textarea'),
      f('scenario', 'mp_mortgage_scenario', 'mp_mortgage_scenario'),
      f('row_price', 'mp_mortgage_row_price', 'mp_mortgage_row_price'),
      f('row_down', 'mp_mortgage_row_down', 'mp_mortgage_row_down'),
      f('row_term', 'mp_mortgage_row_term', 'mp_mortgage_row_term'),
      f('row_rate', 'mp_mortgage_row_rate', 'mp_mortgage_row_rate'),
      f('row_result', 'mp_mortgage_row_result', 'mp_mortgage_row_result'),
      f('note', 'mp_mortgage_note', 'mp_mortgage_note', 'textarea'),
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
      /* What the calls do, the six stages a call passes through, and the
         labels on the live-call panel. The duration and the waveform are
         not copy and are not offered. */
      f('p1_t', 'mp_cc_point_1', 'mp_cc_point_1'),
      f('p1_d', 'mp_cc_point_1_d', 'mp_cc_point_1_d', 'textarea'),
      f('p2_t', 'mp_cc_point_2', 'mp_cc_point_2'),
      f('p2_d', 'mp_cc_point_2_d', 'mp_cc_point_2_d', 'textarea'),
      f('p3_t', 'mp_cc_point_3', 'mp_cc_point_3'),
      f('p3_d', 'mp_cc_point_3_d', 'mp_cc_point_3_d', 'textarea'),
      f('stage1', 'mp_cc_stage_lead', 'mp_cc_stage_lead'),
      f('stage2', 'mp_calls_stage_2', 'mp_calls_stage_2'),
      f('stage3', 'mp_cc_stage_talk', 'mp_cc_stage_talk'),
      f('stage4', 'mp_calls_stage_3', 'mp_calls_stage_3'),
      f('stage5', 'mp_calls_stage_4', 'mp_calls_stage_4'),
      f('stage6', 'mp_cc_stage_followup', 'mp_cc_stage_followup'),
      f('live', 'mp_cc_live', 'mp_cc_live'),
      f('row_stage', 'mp_cc_row_stage', 'mp_cc_row_stage'),
      f('row_stage_v', 'mp_calls_stage_3', 'mp_calls_stage_3'),
      f('row_language', 'mp_cc_row_language', 'mp_cc_row_language'),
      f('row_language_v', 'mp_cc_row_language_v', 'mp_cc_row_language_v'),
      f('row_outcome', 'mp_cc_row_outcome', 'mp_cc_row_outcome'),
      f('row_outcome_v', 'mp_cc_row_outcome_v', 'mp_cc_row_outcome_v'),
      f('panel_note', 'mp_cc_panel_note', 'mp_cc_panel_note', 'textarea'),
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
      /* The three points, the builder's field labels and the six stages a
         campaign passes through. Counts and rates stay absent. */
      f('p1_t', 'mp_email_point_1', 'mp_email_point_1'),
      f('p1_d', 'mp_email_point_1_d', 'mp_email_point_1_d', 'textarea'),
      f('p2_t', 'mp_email_point_2', 'mp_email_point_2'),
      f('p2_d', 'mp_email_point_2_d', 'mp_email_point_2_d', 'textarea'),
      f('p3_t', 'mp_email_point_3', 'mp_email_point_3'),
      f('p3_d', 'mp_email_point_3_d', 'mp_email_point_3_d', 'textarea'),
      f('field1', 'mp_email_field_1', 'mp_email_field_1'),
      f('field2', 'mp_email_field_2', 'mp_email_field_2'),
      f('field3', 'mp_email_field_3', 'mp_email_field_3'),
      f('field_ai', 'mp_email_field_ai', 'mp_email_field_ai'),
      f('stage1', 'mp_email_stage_1', 'mp_email_stage_1'),
      f('stage2', 'mp_email_stage_2', 'mp_email_stage_2'),
      f('stage3', 'mp_email_stage_3', 'mp_email_stage_3'),
      f('stage4', 'mp_email_stage_4', 'mp_email_stage_4'),
      f('stage5', 'mp_email_stage_5', 'mp_email_stage_5'),
      f('stage6', 'mp_email_stage_6', 'mp_email_stage_6'),
      f('panel_note', 'mp_email_panel_note', 'mp_email_panel_note', 'textarea'),
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
      /* THE EIGHT QUESTIONS. Each is the section's argument and its control
         at once: what is written here is what gets asked. The list beside
         them -- what a question can reach -- is the other half. */
      f('intent_label', 'mp_intent_label', 'mp_intent_label'),
      f('q_buy', 'mp_intent_buy', 'mp_intent_buy', 'textarea'),
      f('q_price', 'mp_intent_price', 'mp_intent_price', 'textarea'),
      f('q_contract', 'mp_intent_contract', 'mp_intent_contract', 'textarea'),
      f('q_sell', 'mp_intent_sell', 'mp_intent_sell', 'textarea'),
      f('q_finance', 'mp_intent_finance', 'mp_intent_finance', 'textarea'),
      f('q_district', 'mp_intent_district', 'mp_intent_district', 'textarea'),
      f('q_rent', 'mp_intent_rent', 'mp_intent_rent', 'textarea'),
      f('q_platform', 'mp_intent_platform', 'mp_intent_platform', 'textarea'),
      f('reach_label', 'mp_ai_reach_label', 'mp_ai_reach_label'),
      f('reach_match', 'mp_match_title', 'mp_match_title'),
      f('reach_find', 'mp_find_title', 'mp_find_title'),
      f('reach_verify', 'mp_verify_capability_title', 'mp_verify_capability_title'),
      f('reach_contract', 'mp_contract_title', 'mp_contract_title'),
      f('reach_mortgage', 'mp_mortgage_title', 'mp_mortgage_title'),
      f('reach_calls', 'call_center_title', 'call_center_title'),
      f('reach_email', 'mp_email_title', 'mp_email_title'),
      f('reach_dev', 'mp_dev_eyebrow', 'mp_dev_eyebrow'),
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
      /* The three arguments, the six stages of the operation, and where the
         flow arrives. The commercial packaging changes; a deploy per change
         is what made it go stale. */
      f('p1_t', 'mp_dev_point_1_title', 'mp_dev_point_1_title'),
      f('p1_d', 'mp_dev_point_1_desc', 'mp_dev_point_1_desc', 'textarea'),
      f('p2_t', 'mp_dev_point_2_title', 'mp_dev_point_2_title'),
      f('p2_d', 'mp_dev_point_2_desc', 'mp_dev_point_2_desc', 'textarea'),
      f('p3_t', 'mp_dev_point_3_title', 'mp_dev_point_3_title'),
      f('p3_d', 'mp_dev_point_3_desc', 'mp_dev_point_3_desc', 'textarea'),
      f('stage1', 'mp_dev_stage_project', 'mp_dev_stage_project'),
      f('stage2', 'mp_dev_stage_demand', 'mp_dev_stage_demand'),
      f('stage3', 'mp_dev_stage_people', 'mp_dev_stage_people'),
      f('stage4', 'mp_dev_stage_calls', 'mp_dev_stage_calls'),
      f('stage5', 'mp_dev_stage_email', 'mp_dev_stage_email'),
      f('stage6', 'mp_dev_stage_followup', 'mp_dev_stage_followup'),
      f('outcome', 'mp_dev_stage_outcome', 'mp_dev_stage_outcome'),
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
      f('nav_start', 'mp_nav_start', 'mp_nav_start'),
      f('nav_intelligence', 'mp_nav_capabilities', 'mp_nav_capabilities'),
      f('nav_verify', 'nav_verify', 'nav_verify'),
      f('nav_mortgage', 'nav_mortgage', 'nav_mortgage'),
      f('nav_developers', 'mp_nav_developers', 'mp_nav_developers'),
      f('nav_about', 'nav_about', 'nav_about'),
      f('nav_partners', 'home_nav_partners', 'home_nav_partners'),
      f('cta_login', 'nav_login', 'nav_login'),
      f('cta_signup', 'nav_signup', 'nav_signup'),
      f('cta_dashboard', 'nav_dashboard', 'nav_dashboard'),
      /* The line under the wordmark. The wordmark itself is the logotype and
         is not offered -- see useNotEditable in the lockup. */
      f('brand_tagline', 'brand_tagline', 'brand_tagline'),
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
      f('heading_company', 'mp_footer_company', 'mp_footer_company'),
      f('heading_legal', 'mp_footer_legal', 'mp_footer_legal'),
      f('link_verify', 'nav_verify', 'nav_verify'),
      f('link_contract', 'mp_contract_title', 'mp_contract_title'),
      f('link_mortgage', 'nav_mortgage', 'nav_mortgage'),
      f('link_ai', 'ai_title', 'ai_title'),
      f('link_calls', 'call_center_title', 'call_center_title'),
      f('link_email', 'mp_email_title', 'mp_email_title'),
      f('link_about', 'nav_about', 'nav_about'),
      f('link_partners', 'home_nav_partners', 'home_nav_partners'),
      f('link_developers', 'mp_nav_developers', 'mp_nav_developers'),
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

/** Public routes a link may point at. Kept here rather than derived from
 *  routes.tsx so the validator does not drag every page component into the
 *  editor bundle. */
export const PUBLIC_ROUTES: readonly string[] = [
  '/', '/about', '/verify', '/verify/:id', '/verify/history', '/mortgage', '/partners',
  // Contracts is a product of its own, so a site page may link straight to it.
  '/contracts',
  '/privacy', '/terms', '/ai', '/auth/login', '/auth/signup',
  '/dashboard', '/property/add', '/outreach/calls', '/outreach/email', '/credits',
];

/** The rules object normalizePage() needs, assembled from the registry. */
export const NORMALIZE_RULES = {
  knownTypes: KNOWN_SECTION_TYPES,
  variantsFor,
  knownRoutes: PUBLIC_ROUTES,
};

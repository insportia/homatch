import type { SitePageContent, SiteSection } from '../model';

/**
 * WHICH SECTIONS RENDER, IN WHICH ORDER.
 *
 * Split out of SitePage.tsx with no React imports, so it can be unit tested
 * directly. SitePage is the component; this is the decision it makes, and the
 * decision is the part that can silently produce a wrong or empty page.
 */

/**
 * The running order the code ships with, per page.
 *
 * This is the list HomePage.tsx used to hold inline. Reordering in the editor
 * produces a stored page that supersedes it; deleting that stored page
 * returns the site to exactly this.
 */
export const DEFAULT_HOME_ORDER: readonly string[] = [
  'hero', 'action_launcher', 'intelligence_layers', 'verify',
  'contract_intelligence', 'matching', 'mortgage', 'call_center',
  'email_campaign', 'homatch_ai', 'developers', 'closing_cta',
];

export const DEFAULT_ABOUT_ORDER: readonly string[] = [
  'about_hero', 'about_what', 'about_market', 'about_sources',
  'about_intl', 'about_ask',
];

/**
 * Pages that are composed ENTIRELY of admin-added blocks.
 *
 * Their shipped content is still rendered by their own component — this
 * is the band beside it, which starts empty and holds whatever an admin
 * adds. An empty default order is not a missing page; it is a page whose
 * blocks are all content-managed.
 */
const CONTENT_ONLY: readonly string[] = [];

/**
 * The site's own chrome, edited as a page in its own right.
 *
 * Not rendered by any route: ShellScope hands these two sections to the real
 * header and footer wherever they appear. Site Studio renders them here so
 * that editing a navigation label is the same act as editing a heading --
 * click the words, type.
 */
/**
 * The Developer / B2B page.
 *
 * Problem and system are one block: the workflow only makes sense directly
 * under the thing it answers, and splitting them let an admin reorder them
 * into a diagram with no question above it.
 */
export const DEFAULT_DEVELOPERS_ORDER: readonly string[] = [
  'dev_hero', 'dev_flow', 'dev_api', 'closing_cta',
];

export const SHELL_ORDER: readonly string[] = ['site_header', 'site_footer'];

const ORDERS: Readonly<Record<string, readonly string[]>> = {
  home: DEFAULT_HOME_ORDER,
  about: DEFAULT_ABOUT_ORDER,
  /* The heading. Everything else on /pricing is the live plan catalogue,
     which is data rather than content, plus whatever an admin adds. */
  pricing: ['pricing_intro'],
  partners: CONTENT_ONLY,
  developers: DEFAULT_DEVELOPERS_ORDER,
  mortgage: CONTENT_ONLY,
  privacy: CONTENT_ONLY,
  terms: CONTENT_ONLY,
  verify: CONTENT_ONLY,
  shell: SHELL_ORDER,
};

/**
 * The running order the code ships for a page.
 *
 * An unknown slug falls back to the home order deliberately: that is what
 * the single call site did before, and a typo in a slug should render the
 * home page rather than an empty document.
 */
export function defaultOrderFor(slug: string): readonly string[] {
  return ORDERS[slug] ?? DEFAULT_HOME_ORDER;
}

export interface ResolvedSection {
  type: string;
  /** null means "no overrides": the component renders its shipped copy. */
  section: SiteSection | null;
}

/**
 * Merge stored sections over the code's running order.
 *
 * A stored page is authoritative about ORDER and VISIBILITY, because those
 * are things the editor owns outright. But a section type the code ships and
 * the stored page never mentions still renders, in its shipped position.
 * That is what makes adding a section in code safe: it appears on the live
 * site without anyone having to re-save every page first, and it is why a
 * page stored last year cannot quietly delete this year's work.
 */
export function resolveSections(
  slug: string,
  stored: SitePageContent | null,
  /** The editor shows hidden sections dimmed; the public site omits them. */
  showHidden = false,
): ResolvedSection[] {
  const order = defaultOrderFor(slug);

  if (!stored || stored.sections.length === 0) {
    return order.map(type => ({ type, section: null }));
  }

  const storedTypes = new Set(stored.sections.map(s => s.type));
  const out: ResolvedSection[] = [];

  for (const section of stored.sections) {
    // A hidden section is absent from the site, but must stay reachable in
    // the editor: an admin who hides something has to be able to find it
    // again to bring it back.
    if (!section.enabled && !showHidden) continue;
    out.push({ type: section.type, section });
  }

  // Anything the code knows about that the stored page predates, inserted
  // next to the section it ships after.
  //
  // The stored order is arbitrary, so there is no position that is right in
  // every sense. The rule chosen is: sit directly after the LAST section
  // already on the page that ships before you. That keeps a new section with
  // its neighbours when the admin only reordered a little, degrades to the
  // top of the page when it has no shipped predecessor present, and never
  // reorders anything the admin arranged deliberately.
  //
  // Walking `order` forwards matters: each insertion becomes an anchor for
  // the next one, so a run of new sections stays in its shipped sequence.
  for (const type of order) {
    if (storedTypes.has(type)) continue;
    const at = order.indexOf(type);

    let after = -1;
    for (let i = 0; i < out.length; i += 1) {
      const pos = order.indexOf(out[i].type);
      if (pos !== -1 && pos < at) after = i;
    }

    out.splice(after + 1, 0, { type, section: null });
  }

  return out;
}

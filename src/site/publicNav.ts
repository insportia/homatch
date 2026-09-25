// HOMATCH — the public navigation, in one place.
//
// WHY THIS FILE EXISTS
//
// Nine files each declared their own `headerLinks: HeaderLink[]` — HomePage,
// AboutPage, PricingPage, PartnersPage, DevelopersPage, PrivacyPage,
// TermsPage, PublicProjectPage and the Studio-rendered shell. They had drifted
// into four different navigations:
//
//   HomePage      start intelligence verify mortgage investment developers about
//   ShellBlocks   start intelligence verify mortgage developers about
//   PricingPage   verify mortgage investment
//   AboutPage     home what market sources verify
//
// So which product areas existed depended on which page you were standing on,
// Investment vanished inside the Studio-rendered header, and Pricing was
// reachable from the navigation of no page at all — including Pricing's own.
// Adding Expat to "the navigation" would have meant adding it nine times and
// missing at least one.
//
// THE SHAPE, AND WHY IT IS NOT ONE FLAT ROW
//
// Seven flat links is what made the desktop header crowd and the labels
// collide: six languages disagree about how long a word is, and Georgian and
// Turkish are the long ones. The fix is hierarchy rather than smaller text.
//
//   PRIMARY     Expat · Intelligence · Verify · Investment · Mortgage
//   COMPANY     About · Pricing
//   PROFESSIONAL  For developers · Partners
//
// Company and For professionals are real destinations, not leftovers — they
// are simply not what a visitor came to do, so they cost one control each
// instead of four.
//
// EXPAT COMES FIRST AMONG THE PRODUCTS, AND NOT BEFORE THEM
//
// §6: Workspace → Expat → Intelligence. On a public page there is no
// workspace, so Expat leads the product links; in the signed-in shell it sits
// after the workspace group, which is the same rule seen from inside.

import type { TranslationKey } from '@/i18n/translations';
import { useLanguage } from '@/contexts/LanguageContext';
import type { HeaderLink } from '@/components/home/PublicHeader';

export interface PublicNavLink {
  key: string;
  labelKey: TranslationKey;
  /** In-page region id, or a router path when it starts with '/'. */
  target: string;
  /** Present on a group. A group is never itself a destination. */
  children?: PublicNavLink[];
}

/**
 * The navigation, for a given page.
 *
 * @param onHome  The home page renders `start` and `intelligence` as in-page
 *                regions because they ARE regions of it. Everywhere else the
 *                same two ideas are routes, and scrolling to an element that
 *                is not on this page would do nothing at all.
 */
export function publicNav({ onHome = false }: { onHome?: boolean } = {}): PublicNavLink[] {
  return [
    /*
     * WHAT HOMATCH DOES, IN THE ORDER SOMEBODY ARRIVES WANTING IT.
     *
     * The two matching actions lead because they are the product: a visitor
     * either has a property and wants demand, or wants a property and has
     * demand. Everything else on this list is something they reach for once
     * one of those two is underway.
     *
     * Expat is NOT first. §6's Workspace -> Expat -> Intelligence is about
     * the signed-in hierarchy, where it sits after the work; giving it the
     * first slot out here would tell a Georgian seller that Homatch is a
     * relocation site. It is last among the products and still primary,
     * which is where somebody who needs it will look for it.
     *
     * There is no Start link: the logo goes home, which every visitor
     * already knows, and the slot is worth more to Find a property.
     */
    { key: 'find_property', labelKey: 'dnav_find_property', target: '/ai' },
    { key: 'find_client', labelKey: 'dnav_find_client', target: '/property/add' },
    { key: 'verify', labelKey: 'nav_verify', target: '/verify' },
    onHome
      ? { key: 'intelligence', labelKey: 'mp_nav_capabilities', target: 'intelligence' }
      : { key: 'intelligence', labelKey: 'mp_nav_capabilities', target: '/#intelligence' },
    { key: 'investment', labelKey: 'nav_investment', target: '/investment' },
    { key: 'expat', labelKey: 'nav_for_expats', target: '/for-expats/georgia' },

    /*
     * Mortgage is deliberately not here. It is linked from the home page's
     * own sections, the footer, the Expat plan, What can I buy, and both
     * signed-in navigations -- so it is discoverable without spending the
     * scarcest row in the product on it.
     */
    {
      key: 'professional',
      labelKey: 'nav_professional',
      target: '',
      children: [
        { key: 'developers', labelKey: 'mp_nav_developers', target: '/developers' },
        { key: 'partners', labelKey: 'home_nav_partners', target: '/partners' },
      ],
    },
    {
      key: 'company',
      labelKey: 'nav_company',
      target: '',
      children: [
        { key: 'about', labelKey: 'nav_about', target: '/about' },
        { key: 'pricing', labelKey: 'nav_pricing', target: '/pricing' },
      ],
    },
  ];
}
/** Every destination the navigation can reach, groups flattened away. */
export function publicNavTargets(): string[] {
  const out: string[] = [];
  for (const link of publicNav()) {
    if (link.children) { out.push(...link.children.map((c) => c.target)); continue; }
    out.push(link.target);
  }
  return out.filter((t) => t.startsWith('/'));
}

/**
 * The same navigation, translated, in the shape the header renders.
 *
 * Kept here rather than in each page so that a page cannot accidentally
 * ship a navigation of its own again -- which is how four of them appeared.
 */
export function usePublicNavLinks({ onHome = false }: { onHome?: boolean } = {}): HeaderLink[] {
  const { t } = useLanguage();
  const toLink = (link: PublicNavLink): HeaderLink => ({
    key: link.key,
    label: t(link.labelKey),
    target: link.target,
    ...(link.children ? { children: link.children.map(toLink) } : {}),
  });
  return publicNav({ onHome }).map(toLink);
}

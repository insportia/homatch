// HOMATCH — the public navigation, in one place.
//
// WHY THIS FILE EXISTS
//
// Nine files each declared their own `headerLinks: HeaderLink[]` — HomePage,
// AboutPage, PricingPage, PartnersPage, DevelopersPage, PrivacyPage,
// TermsPage, PublicProjectPage and the Studio-rendered shell. They had drifted
// into four different navigations, so which product areas existed depended
// on which page you were standing on. One list, read by every page, is the
// fix; tests/matrix/publicNav.test.mjs keeps it that way.
//
// THE SHAPE
//
//   PRIMARY       Find a property · Find a buyer or tenant · Verify
//   SERVICES      How matching works · Mortgage · Investment · For expats
//   PROFESSIONAL  Brokers · For developers · Partners
//   COMPANY       About · Pricing
//
// The two matching actions lead because they are the product: a visitor
// either has a property and wants demand, or wants a property and has demand.
// Verify sits beside them because it is the one tool a visitor can use in
// full without an account. Everything else is grouped: seven flat links is
// what made the desktop header crowd, and six languages disagree about how
// long a word is. Hierarchy is the fix that smaller text was standing in for.
//
// Expat is NOT first. §6's Workspace -> Expat -> Intelligence order is about
// the signed-in hierarchy; giving it the first slot out here would tell a
// Georgian seller that Homatch is a relocation site. It is the last of the
// services and still one click from every page.
//
// SIGNED OUT IS NOT A DEAD END
//
// Find Property (/find-property) and the owner workspace (/property) are
// authenticated: each writes rows that belong to an account. They used to be
// linked here directly — `/ai` and `/property/add` — so a visitor pressing
// either of the two most important links on the site landed on an anonymous
// chat or was bounced to a login screen with no idea why.
//
// Now each link has two destinations. `target` is the PUBLIC one — a page
// that explains the product and offers sign-up or log-in, and sends the
// visitor on to the product afterwards. `signedInTarget` is where somebody
// who already has an account goes straight away. The header picks between
// them from the auth state, so neither group of people ever sees the other's
// page.

import type { TranslationKey } from '@/i18n/translations';
import { useLanguage } from '@/contexts/LanguageContext';
import type { HeaderLink } from '@/components/home/PublicHeader';

export interface PublicNavLink {
  key: string;
  labelKey: TranslationKey;
  /** In-page region id, or a router path when it starts with '/'. Public. */
  target: string;
  /** Where a signed-in visitor goes instead, when that differs. */
  signedInTarget?: string;
  /** One line under the label in a group's menu. */
  descKey?: TranslationKey;
  /** Present on a group. A group is never itself a destination. */
  children?: PublicNavLink[];
}

/**
 * The navigation, for a given page.
 *
 * @param onHome  "How matching works" is an in-page region of the home page;
 *                everywhere else it is the same region reached by route, since
 *                scrolling to an element that is not on this page does nothing.
 */
export function publicNav({ onHome = false }: { onHome?: boolean } = {}): PublicNavLink[] {
  return [
    {
      key: 'find_property',
      labelKey: 'dnav_find_property',
      target: '/for-buyers',
      signedInTarget: '/find-property',
    },
    {
      key: 'find_client',
      labelKey: 'pub_nav_find_client',
      target: '/for-owners',
      signedInTarget: '/property',
    },
    { key: 'verify', labelKey: 'nav_verify', target: '/verify' },
    {
      key: 'services',
      labelKey: 'pub_nav_services',
      target: '',
      children: [
        onHome
          ? { key: 'intelligence', labelKey: 'pub_nav_how', descKey: 'pub_navd_how', target: 'intelligence' }
          : { key: 'intelligence', labelKey: 'pub_nav_how', descKey: 'pub_navd_how', target: '/#intelligence' },
        { key: 'mortgage', labelKey: 'nav_mortgage', descKey: 'pub_navd_mortgage', target: '/mortgage' },
        { key: 'investment', labelKey: 'nav_investment', descKey: 'pub_navd_investment', target: '/investment' },
        { key: 'expat', labelKey: 'nav_for_expats', descKey: 'pub_navd_expat', target: '/for-expats/georgia' },
      ],
    },
    {
      /*
       * B2B, not "professionals": the group names the RELATIONSHIP (business
       * to business), and its children are the two business audiences —
       * brokers and developers — with the partner programme beside them.
       * The label is the term "B2B" in every locale on purpose; it is
       * industry vocabulary, not a sentence to translate.
       */
      key: 'b2b',
      labelKey: 'nav_b2b',
      target: '',
      children: [
        { key: 'brokers', labelKey: 'pub_nav_brokers', descKey: 'pub_navd_brokers', target: '/brokers' },
        { key: 'developers', labelKey: 'mp_nav_developers', descKey: 'pub_navd_developers', target: '/developers' },
        { key: 'partners', labelKey: 'home_nav_partners', descKey: 'pub_navd_partners', target: '/partners' },
      ],
    },
    {
      key: 'company',
      labelKey: 'nav_company',
      target: '',
      children: [
        { key: 'about', labelKey: 'nav_about', descKey: 'pub_navd_about', target: '/about' },
        /* Immediately after About, by explicit product requirement. */
        { key: 'contact', labelKey: 'nav_contact', descKey: 'pub_navd_contact', target: '/contact' },
        { key: 'pricing', labelKey: 'nav_pricing', descKey: 'pub_navd_pricing', target: '/pricing' },
      ],
    },
  ];
}

/** Every link, groups flattened away. */
export function flatPublicNav(options?: { onHome?: boolean }): PublicNavLink[] {
  const out: PublicNavLink[] = [];
  for (const link of publicNav(options)) {
    if (link.children) out.push(...link.children);
    else out.push(link);
  }
  return out;
}

/** Every destination the navigation can reach, signed out and signed in. */
export function publicNavTargets(): string[] {
  const out: string[] = [];
  for (const link of flatPublicNav()) {
    out.push(link.target);
    if (link.signedInTarget) out.push(link.signedInTarget);
  }
  return out.filter((t) => t.startsWith('/'));
}

/** The destination for this visitor. */
export function destinationFor(link: Pick<PublicNavLink, 'target' | 'signedInTarget'>, signedIn: boolean): string {
  return signedIn && link.signedInTarget ? link.signedInTarget : link.target;
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
    ...(link.signedInTarget ? { signedInTarget: link.signedInTarget } : {}),
    ...(link.descKey ? { description: t(link.descKey) } : {}),
    ...(link.children ? { children: link.children.map(toLink) } : {}),
  });
  return publicNav({ onHome }).map(toLink);
}

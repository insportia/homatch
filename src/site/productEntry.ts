// HOMATCH — where a product link goes, for somebody signed in and for somebody not.
//
// Two of Homatch's products are authenticated by nature, because each writes
// rows that belong to one account:
//
//   Find Property   /find-property   a confirmed plan creates an intent profile
//                                    and an active search subscription
//   My property     /property/add    a property, and the matching that runs on it
//
// A public page that links straight to either sends a visitor with no account
// to a login screen with no explanation — or, for the old `/ai` link, to an
// anonymous chat that was not the product at all. So each has a PUBLIC entry
// page that explains it and offers sign-up or log-in, and the link picks
// between the two from the auth state.
//
// The return path survives the round trip in sessionStorage (services/
// returnTo.ts), which both LoginPage and SignupPage consume before falling
// back to the dashboard — the only form that also survives the Google
// redirect.

import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { rememberPendingPath } from '@/services/returnTo';

export type ProductKey = 'find_property' | 'find_client';

export const PRODUCT_ENTRIES: Readonly<Record<ProductKey, { publicPath: string; appPath: string }>> = {
  find_property: { publicPath: '/for-buyers', appPath: '/find-property' },
  find_client: { publicPath: '/for-owners', appPath: '/property/add' },
};

/** The destination for a product link, given who is looking. */
export function productPath(product: ProductKey, signedIn: boolean): string {
  const entry = PRODUCT_ENTRIES[product];
  return signedIn ? entry.appPath : entry.publicPath;
}

/**
 * Navigation that knows about accounts.
 *
 *   openProduct(p)     the product itself when signed in, its public page when not
 *   startAuth(kind, p) sign-up or log-in, then on to `p` — never the dashboard
 *   gated(path)        a signed-in-only path; signed out, it is sign-up first
 */
export function useProductNavigation() {
  const navigate = useNavigate();
  const { status } = useAuth();
  const signedIn = status === 'AUTHENTICATED';

  const startAuth = (kind: 'signup' | 'login', then: string) => {
    rememberPendingPath(then);
    navigate(kind === 'signup' ? '/auth/signup' : '/auth/login', { state: { from: { pathname: then } } });
  };

  return {
    signedIn,
    openProduct: (product: ProductKey) => navigate(productPath(product, signedIn)),
    startAuth,
    gated: (path: string) => (signedIn ? navigate(path) : startAuth('signup', path)),
  };
}

import { FEATURES } from '@/config/features';

/**
 * Whether Design Studio is presented to this viewer.
 *
 * Public switch: FEATURES.designStudio. Until it is on, the product is shown only for
 * authorised testing — a signed-in admin, or a build made with
 * VITE_FEATURE_DESIGN_STUDIO=on. Hiding is presentation only; every row behind it is
 * owner-scoped by RLS regardless of who can see the navigation entry.
 */
export function designStudioEnabled(user?: { is_admin?: boolean | null } | null): boolean {
  if (FEATURES.designStudio) return true;
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  if (env?.VITE_FEATURE_DESIGN_STUDIO === 'on') return true;
  return user?.is_admin === true;
}

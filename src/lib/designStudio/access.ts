/**
 * Whether Design Studio is presented to this viewer.
 *
 * The owner's switch in Admin → Service Control Center (service key `design_studio`)
 * is the only authority now. It replaced the build-time FEATURES.designStudio flag and
 * its admin / VITE_FEATURE_DESIGN_STUDIO bypasses: a product whose backend is paused
 * must not be shown to anybody as if it worked, and switching it back on must not
 * need a deploy. Hiding is presentation only; the edge functions refuse new work on
 * their own (supabase/functions/_shared/serviceControl.ts).
 */
export function designStudioEnabled(serviceVisible: boolean): boolean {
  return serviceVisible === true;
}

// WHERE THE FLOATING AI SHORTCUT MAY APPEAR — one rule, no scattered checks.
//
// THE BUG THIS FILE FIXES: the shortcut was mounted by AppLayout on every
// authenticated screen with a single carve-out for /ai. On /live-chat it sat
// at `bottom-20 right-4` — exactly over the message composer's send control,
// on the one kind of screen whose whole job is its own composer.
//
// THE RULE: the shortcut is a CONVENIENCE for screens that are not about
// conversation. It never renders where
//   1. the person is already inside the AI product, or
//   2. the screen carries its own persistent composer (person-to-person or
//      channel messaging), which the shortcut would obstruct or duplicate.
//
// Pure function of the pathname, with no React in it, so the eligibility
// behaviour is tested directly (tests/matrix/floatingAiShortcut.test.mjs)
// rather than through a screenshot.

/**
 * Routes whose screens own a persistent composer or ARE the AI product.
 * A prefix match covers detail/thread subpaths (e.g. /chat while a thread
 * is open — same screen, same composer).
 */
const COMPOSER_ROUTES = [
  '/ai',                      // the AI product itself — the shortcut duplicates it
  '/live-chat',               // community chat: sticky composer + send
  '/chat',                    // Private Messages: inbox/thread composer
  '/outreach/whatsapp/inbox', // WhatsApp thread view: reply composer
] as const;

export function shouldShowFloatingAiShortcut(pathname: string): boolean {
  return !COMPOSER_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

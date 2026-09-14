import { useLocation } from 'react-router-dom';
import type { CommsChannel } from '@/services/communications';
import type { CommsProduct } from '@/components/communications/CommsWorkspace';

/*
 * WHICH PRODUCT AM I IN.
 *
 * AI Calls, WhatsApp and Email share tables, services and components. They do
 * not share a user experience, and the thing that keeps them apart has to
 * survive every way a person can arrive at a screen: a click, a deep link, a
 * refresh, the back button, a bookmark from three weeks ago.
 *
 * WHY THE PATH AND NOT A PROP OR A CONTEXT
 *
 * A prop is set by whoever rendered the page, so it is correct only for the
 * routes somebody remembered to pass it on. A context is worse: it survives
 * navigation but not a refresh, so /outreach/calls/contacts would open as
 * Calls when clicked and as "nothing in particular" when reloaded -- and the
 * reload is exactly how somebody returns to a link they saved.
 *
 * The URL is the one piece of state the browser restores for us. A screen
 * that reads its channel from the path cannot be in the wrong product, and a
 * deep link cannot land in a generic shell, because there is no code path in
 * which the channel is absent but the route is present.
 */

/** The path prefix each product owns. Order matters only for readability. */
const PREFIXES: Array<[string, CommsChannel]> = [
  ['/outreach/calls', 'AI_CALL'],
  ['/outreach/whatsapp', 'WHATSAPP'],
  ['/outreach/email', 'EMAIL'],
];

/**
 * The channel a path belongs to, or null for the genuinely cross-channel
 * surfaces (the hub, billing) that are ABOUT all of them.
 *
 * Exported as a pure function so it can be tested without a router and
 * asserted against the route table itself.
 */
export function channelFromPath(pathname: string): CommsChannel | null {
  for (const [prefix, channel] of PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return channel;
  }
  return null;
}

/** The same answer, for a component. */
export function useCommsChannel(): CommsChannel | null {
  return channelFromPath(useLocation().pathname);
}

/** The rail that belongs to a channel. */
export function productForChannel(channel: CommsChannel | null): CommsProduct {
  switch (channel) {
    case 'AI_CALL': return 'calls';
    case 'WHATSAPP': return 'whatsapp';
    case 'EMAIL': return 'email';
    default: return 'hub';
  }
}

/** The rail a screen should render, from where it is. */
export function useCommsProduct(): CommsProduct {
  return productForChannel(useCommsChannel());
}

/**
 * The product's own name, for a title or a breadcrumb.
 *
 * "Communications > Contacts" tells somebody the category they are in, which
 * they already knew, and hides the one thing they need to be sure of: WHICH
 * contacts these are. "AI Calls > Contacts" answers that.
 */
export const CHANNEL_TITLE_KEY: Record<CommsChannel, string> = {
  AI_CALL: 'comms_nav_calls',
  WHATSAPP: 'comms_nav_whatsapp',
  EMAIL: 'dnav_email',
};

/** Where a product's own copy of a shared screen lives. */
export function channelPath(channel: CommsChannel | null, suffix: string): string {
  switch (channel) {
    case 'AI_CALL': return `/outreach/calls${suffix}`;
    case 'WHATSAPP': return `/outreach/whatsapp${suffix}`;
    case 'EMAIL': return `/outreach/email${suffix}`;
    default: return `/outreach${suffix}`;
  }
}

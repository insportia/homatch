// HOMATCH FOR DEVELOPERS — what an anonymous visitor may ask for.
//
// Two RPCs and nothing else. There is no Supabase table read on this path at
// all: `anon` has no grant on a single dev_* table, so a mistake in a
// component cannot turn into a leak. Everything the shared page renders
// arrives from dev_share_resolve as one json payload of named fields.

import { supabase } from '@/db/supabase';
import { reportError } from '@/lib/errorReporting';
import type { SharedUnitPayload, ShareEvent } from './types';

export async function resolveShare(token: string): Promise<SharedUnitPayload> {
  const { data, error } = await supabase.rpc('dev_share_resolve', { p_token: token });
  if (error) {
    reportError(error, { route: '/s', stage: 'resolveShare', boundary: 'developer-share' });
    return { error: 'NOT_FOUND' };
  }
  return (data ?? { error: 'NOT_FOUND' }) as SharedUnitPayload;
}

export async function resolvePublicProject(
  workspaceSlug: string, projectSlug: string,
): Promise<SharedUnitPayload> {
  const { data, error } = await supabase.rpc('dev_public_project', {
    p_workspace_slug: workspaceSlug, p_project_slug: projectSlug,
  });
  if (error) {
    reportError(error, { route: '/projects', stage: 'resolvePublicProject', boundary: 'developer-share' });
    return { error: 'NOT_FOUND' };
  }
  return (data ?? { error: 'NOT_FOUND' }) as SharedUnitPayload;
}

/**
 * A per-browser, per-session random string.
 *
 * It is NOT an identity. The server hashes it together with the link's own
 * token and today's date before storing anything, so the value here cannot be
 * joined to another link, another day, or anything outside this product. It
 * exists so a developer can tell "opened once" from "opened eight times" (§22)
 * and for nothing else — which is why it lives in sessionStorage and is gone
 * when the tab closes.
 */
function visitorKey(): string | null {
  try {
    const existing = sessionStorage.getItem('homatch-share-visit');
    if (existing) return existing;
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const value = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem('homatch-share-visit', value);
    return value;
  } catch {
    // A browser with storage blocked still gets the page; it just counts as a
    // fresh visit each time, which is the honest answer in that case.
    return null;
  }
}

/**
 * Deliberately not awaited by callers and deliberately never surfaced.
 *
 * A buyer reading an apartment page must never see an error because an
 * analytics write failed, and must never be made to wait for one. The failure
 * still reaches our own logs.
 */
export function trackShare(
  token: string, event: ShareEvent, meta: Record<string, unknown> = {},
): void {
  void supabase
    .rpc('dev_share_track', {
      p_token: token, p_event: event, p_meta: meta, p_visitor: visitorKey(),
    })
    .then(({ error }) => {
      if (error) {
        reportError(error, { route: '/s', stage: `trackShare:${event}`, boundary: 'developer-share' });
      }
    });
}

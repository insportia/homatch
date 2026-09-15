// HOMATCH FOR DEVELOPERS — what an anonymous visitor may ask for.
//
// Two RPCs and nothing else. There is no Supabase table read on this path at
// all: `anon` has no grant on a single dev_* table, so a mistake in a
// component cannot turn into a leak. Everything the shared page renders
// arrives from dev_share_resolve as one json payload of named fields.

import { supabase } from '@/db/supabase';
import { reportError } from '@/lib/errorReporting';
import type { SharedUnitPayload, ShareEvent, BuyerRoomPayload } from './types';

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
 * THE BUYER'S OWN ROOM.
 *
 * One token, one purchase. The payload carries the unit, the reservation or
 * the contract, the instalment plan, what has actually been confirmed as paid,
 * and the documents somebody deliberately marked BUYER — nothing else. No CRM
 * note, no internal document, no other buyer, no price rule, no commission.
 *
 * As with the shared unit page, `anon` holds no table grant, so the boundary
 * is the function's own SELECT list rather than a filter a component has to
 * remember.
 */
export async function resolveBuyerRoom(token: string): Promise<BuyerRoomPayload> {
  const { data, error } = await supabase.rpc('dev_buyer_room', { p_token: token });
  if (error) {
    reportError(error, { route: '/buyer', stage: 'resolveBuyerRoom', boundary: 'developer-share' });
    return { error: 'NOT_FOUND' };
  }
  return (data ?? { error: 'NOT_FOUND' }) as BuyerRoomPayload;
}

/**
 * A download link for one document the buyer was given.
 *
 * A Supabase signed URL is an HMAC minted with the service key, so this is the
 * one thing on the buyer path that SQL cannot do alone. The edge function asks
 * the DATABASE whether the token and the document belong together — only a
 * document marked BUYER, on this token's own lead, resolves to a path — and
 * signs just the path it is handed. A buyer who edits the document id in the
 * request gets NOT_FOUND, not somebody else's contract.
 */
export async function buyerRoomDocumentUrl(
  token: string, documentId: string,
): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke<{ url?: string; error?: string }>(
    'developer-buyer-document',
    { body: { token, documentId } },
  );
  if (error || !data?.url) {
    if (error) {
      reportError(error, {
        route: '/buyer', stage: 'buyerRoomDocument', boundary: 'developer-share',
      });
    }
    return null;
  }
  return data.url;
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

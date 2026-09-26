// HOMATCH — the client side of Connected Social Accounts.
//
// Thin on purpose. Every judgement — what a platform can reach, whether a
// connection is usable today, whether a community is readable — is made on the
// server from the acquisition matrix in research-core. A second opinion computed
// here would drift, and the one it would drift on is "can we legitimately read
// this", which is not a question a browser should be answering.
//
// WHAT NEVER COMES BACK
//
// Tokens. The edge function selects columns explicitly, and the tables hold no
// token at all — a connection carries the NAME of a platform secret. The types
// below have nowhere to put one, which is the point: a field that does not exist
// cannot be rendered by accident.

import { supabase } from '@/db/supabase';

export interface SocialSurface {
  surface: string;
  best: string;
  modes: Array<{ mode: string; availability: string }>;
  requires: string[];
}

export interface SocialConnectionCard {
  provider: string;
  platform: string;
  /** OAUTH platforms redirect; CREDENTIALS platforms take a provisioned secret. */
  connectMechanism: 'OAUTH' | 'CREDENTIALS';
  status: string;
  statusDetail: string;
  /** NAMES of secrets an operator must provision. Never values. */
  missingAppCredentials: string[];
  account: { id: string | null; name: string | null } | null;
  connectionId: string | null;
  connectedAt: string | null;
  lastValidatedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  tokenExpiresAt: string | null;
  grantedScopes: string[];
  surfaces: SocialSurface[];
  targets: {
    total: number;
    readable: number;
    /**
     * Communities the account belongs to that the platform will not serve
     * programmatically. The honest middle state, and the one a green dot would
     * hide — see the Facebook Groups removal of 2024-04-22.
     */
    memberButUnreadable: number;
    joinRequired: number;
    enabled: number;
  };
  volume: {
    itemsRead: number;
    commentsRead: number;
    demandFound: number;
    supplyFound: number;
  };
}

/** Pull the server's own error text out of a non-2xx edge response. */
async function edgeError(error: unknown): Promise<Error & { reasonCode?: string }> {
  const context = (error as { context?: Response })?.context;
  let message = error instanceof Error ? error.message : String(error);
  let reasonCode: string | undefined;
  if (context && typeof context.json === 'function') {
    try {
      const payload = await context.clone().json();
      if (payload?.error) message = String(payload.error);
      if (payload?.reasonCode) reasonCode = String(payload.reasonCode);
      if (Array.isArray(payload?.missingAppCredentials) && payload.missingAppCredentials.length) {
        message += ` (${payload.missingAppCredentials.join(', ')})`;
      }
    } catch { /* a body that is not JSON tells us nothing */ }
  }
  const failure = new Error(message) as Error & { reasonCode?: string };
  if (reasonCode) failure.reasonCode = reasonCode;
  return failure;
}

export async function getSocialConnections(): Promise<{
  cards: SocialConnectionCard[];
  diagnostics: unknown;
}> {
  const { data, error } = await supabase.functions.invoke('social-connections?action=status', {
    method: 'GET',
  });
  if (error) throw await edgeError(error);
  return { cards: data?.cards ?? [], diagnostics: data?.diagnostics ?? null };
}

/**
 * Ask the server for the platform's own authorization URL.
 *
 * The URL is built server-side because it carries the app id and the requested
 * scopes, and the scope list is the one place a removed permission must not
 * appear — sending a dead permission gets the whole authorization rejected and
 * the operator sees "authorization failed" with no clue that we caused it.
 */
export async function startSocialAuthorization(provider: string): Promise<{
  authorizeUrl: string;
  requestedScopes: string[];
}> {
  const { data, error } = await supabase.functions.invoke('social-connections?action=start', {
    body: {
      provider,
      /*
       * The EDGE FUNCTION, not this page.
       *
       * The platform redirects with `?code=`, and that code is a credential in
       * transit. Sending it to a React route puts it in the browser's history,
       * in the referrer of anything the page loads next, and within reach of
       * every installed extension. Sending it to the function means it is
       * exchanged server-side and the browser only ever sees the redirect back.
       *
       * Pinned at issue time and compared on callback, so a code cannot be
       * delivered to an address we did not nominate.
       */
      redirectUri: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/social-connections?action=callback`,
    },
  });
  if (error) throw await edgeError(error);
  if (!data?.authorizeUrl) throw new Error('the server returned no authorization URL');
  return { authorizeUrl: String(data.authorizeUrl), requestedScopes: data.requestedScopes ?? [] };
}

export async function disconnectSocialProvider(provider: string): Promise<void> {
  const { error } = await supabase.functions.invoke('social-connections?action=disconnect', {
    body: { provider },
  });
  if (error) throw await edgeError(error);
}

/* ────────────────────────────────────────────────────────────────────────
 * Global intelligence over time
 * ──────────────────────────────────────────────────────────────────────── */

export type IntelligenceWindow =
  | 'LAST_HOUR' | 'TODAY' | 'YESTERDAY' | 'LAST_24H'
  | 'THIS_WEEK' | 'LAST_7D' | 'THIS_MONTH' | 'LAST_30D';

/**
 * Which clock the question is about.
 *
 * Surfaced to the operator rather than defaulted, because the two answers are
 * genuinely different: a channel that posted nothing this week but which we only
 * read today shows a full DISCOVERED bar and an empty PUBLISHED one, and that
 * contrast is the finding rather than a glitch.
 */
export type IntelligenceClock = 'discovered_at' | 'published_at' | 'last_verified_at';

export interface IntelligencePoint {
  bucketStart: string;
  evidence: number;
  demand: number;
  supply: number;
  reference: number;
  unknown: number;
  unavailable: number;
  /** False when this bucket was filled in to keep the series continuous. */
  fromQuery: boolean;
}

export interface IntelligenceSeries {
  window: IntelligenceWindow;
  bounds: { from: string; to: string; column: IntelligenceClock };
  bucket: 'HOUR' | 'DAY' | 'WEEK' | 'MONTH';
  buckets: number;
  bucketsWithEvidence: number;
  totals: {
    evidence: number;
    demand: number;
    supply: number;
    reference: number;
    unknown: number;
    unavailable: number;
  };
  filters: { platform: string | null; direction: string | null; language: string | null };
  series: IntelligencePoint[];
}

/**
 * Windowed counts of community evidence.
 *
 * `tzOffsetMinutes` is read from the operator's own browser and sent, because a
 * calendar window is LOCAL: a Tbilisi operator at 01:00 asking for "today" does
 * not mean "since 04:00 yesterday UTC". Dropping it would produce an
 * off-by-one-day report that looks entirely reasonable.
 */
export async function getCommunityIntelligence(request: {
  window: IntelligenceWindow;
  column?: IntelligenceClock;
  bucket?: 'HOUR' | 'DAY' | 'WEEK' | 'MONTH';
  platform?: string | null;
  direction?: string | null;
  language?: string | null;
}): Promise<IntelligenceSeries> {
  const { data, error } = await supabase.functions.invoke('community-intelligence', {
    body: {
      ...request,
      /*
       * getTimezoneOffset() returns minutes to ADD to local time to reach UTC, so
       * Tbilisi (UTC+4) reports -240. The server wants minutes EAST of UTC, hence
       * the negation. Getting this backwards moves every calendar boundary by
       * twice the offset and is invisible in the output.
       */
      tzOffsetMinutes: -new Date().getTimezoneOffset(),
    },
  });
  if (error) throw await edgeError(error);
  return data as IntelligenceSeries;
}

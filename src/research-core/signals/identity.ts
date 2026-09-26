// WHAT MAKES TWO PIECES OF CONTENT THE SAME PIECE OF CONTENT.
//
// This module exists because of a bug that cost money, and because the same
// bug was already sitting in a second place.
//
// THE BUG THAT COST MONEY. run-matching-v2 de-duplicated matches on
// intent_profile_id. classify-signals-v2 DELETES a signal's intent_profiles row
// and inserts a fresh one on every re-classification, so the id is not an
// identity, it is a receipt for the last time an opinion was formed. forum.ge
// post 14328580 came back with a new profile id, the guard matched nothing, and
// one buyer appeared twice on one property: 35 credits already paid, 20 more
// offered. The fix was to key on signal_id, which is the person.
//
// THE SAME BUG, STILL UNFIXED, IN adapters/meta-platform.ts:
//
//   id: deterministicId('sig', platform, input.item.contentUrl ?? contentHash(input.item.text))
//
// Read the fallback. When a Facebook or Instagram item has no direct content
// URL — which is most comments and any post whose permalink the page did not
// expose — the signal's IDENTITY becomes a hash of its TEXT. So a person who
// edits their post to add a budget becomes a different person. A typo
// correction becomes a second lead. Re-running a scan after somebody fixed
// their spelling manufactures a new purchasable match out of the same human
// being asking for the same flat.
//
// It has not cost anything yet only because those two adapters are exported and
// wired to no worker. That is luck, not design, and it expires the moment
// somebody wires them.
//
// WHAT THIS MODULE DOES ABOUT IT
//
// It makes platform-native identity the ONLY way to have an identity. Every
// adapter must hand over the ids the platform itself assigns — a Facebook post
// id, a Reddit comment id, a Telegram chat+message pair — and an adapter that
// cannot is told so, loudly, instead of quietly being given a hash.
//
// `contentFingerprint` still exists and is still a hash of the text. That is
// correct and it is a DIFFERENT QUESTION: identity answers "is this the same
// item", the fingerprint answers "has its text changed since we last looked".
// Conflating them is what makes an edit look like a new person. Keeping them
// apart is what lets an edit be recorded as an edit.
//
// WHY A URL IS NOT AN IDENTITY EITHER
//
// The old code preferred `contentUrl`, which is better than a text hash and
// still not identity. URLs carry locale prefixes, tracking parameters, `?
// comment_id=`, `/posts/` versus `/permalink/`, and mobile hostnames. The same
// comment reached two ways is two URLs. Platforms assign ids precisely so that
// clients do not have to guess, and every platform in scope exposes them.

import { deterministicId } from '../core/ids.ts';
import { ResearchError } from '../core/errors.ts';
import type { SignalPlatform } from './types.ts';

/**
 * The ids a platform itself assigns to a piece of content.
 *
 * `communityId` is the container — a group, a subreddit, a channel, a board.
 * `externalContentId` is the item. `parentContentId` is the item it sits under,
 * for a comment. `threadId` is the conversation, where the platform has a
 * notion of one distinct from the parent.
 *
 * All of them are the PLATFORM'S strings, verbatim. Not normalised, not
 * lowercased, not parsed into numbers — an id is an opaque token and the moment
 * we start tidying it we start inventing collisions.
 */
export interface PlatformIdentity {
  platform: SignalPlatform;
  /** The group / subreddit / channel / board / page this came from. */
  communityId: string;
  /** The platform's own id for this post, comment or message. */
  externalContentId: string;
  /** For a comment or reply: the platform's id for what it answers. */
  parentContentId?: string | null;
  /** The conversation, where the platform models one separately. */
  threadId?: string | null;
}

/**
 * Platforms whose ids are only unique WITHIN a container.
 *
 * A Telegram message id is unique per chat, not globally — message 42 exists in
 * every channel that has posted 42 times. Same for VK, where the pair is
 * (owner_id, post_id). Reddit and Meta assign globally unique ids, so including
 * the community there is harmless but not required.
 *
 * Getting this wrong in the unsafe direction collapses two different messages
 * from two different channels into one signal, which would silently delete
 * evidence. So the list errs toward including the container.
 */
const CONTAINER_SCOPED: ReadonlySet<SignalPlatform> = new Set<SignalPlatform>([
  'TELEGRAM', 'VK', 'FORUM', 'WEBSITE', 'OTHER',
]);

export class UnstableIdentityError extends ResearchError {
  constructor(platform: SignalPlatform, detail: string) {
    super('VALIDATION_ERROR', `${platform} signal has no stable platform identity: ${detail}`, {
      retryable: false,
      details: { platform, detail },
    });
    this.name = 'UnstableIdentityError';
  }
}

/** A token that could not serve as an identity. */
const USABLE_ID = /^[\w.:@~+-]{1,256}$/;

/**
 * Build a signal id from platform-native identity, or refuse.
 *
 * THROWS rather than falling back. There is no safe fallback: every candidate —
 * the text, the URL, a timestamp, a row counter — is either unstable across
 * edits or unstable across access paths, and a signal whose identity moves is
 * a signal that can be sold twice. An adapter that reaches this error has a
 * bug in the adapter, and the right place to find that out is here.
 */
export function stableSignalId(identity: PlatformIdentity): string {
  const community = String(identity.communityId ?? '').trim();
  const content = String(identity.externalContentId ?? '').trim();

  if (!content) {
    throw new UnstableIdentityError(identity.platform, 'externalContentId is empty');
  }
  if (!USABLE_ID.test(content)) {
    throw new UnstableIdentityError(
      identity.platform,
      `externalContentId ${JSON.stringify(content.slice(0, 40))} is not an id-shaped token`,
    );
  }

  if (CONTAINER_SCOPED.has(identity.platform)) {
    if (!community) {
      throw new UnstableIdentityError(
        identity.platform,
        'ids on this platform are unique only within a community, and communityId is empty, '
          + 'so two messages from two channels would collapse into one signal',
      );
    }
    return deterministicId('sig', identity.platform, community, content);
  }

  return deterministicId('sig', identity.platform, content);
}

/**
 * True when this identity is complete enough to build a stable id.
 *
 * For a producer that wants to skip an item rather than fail a whole scan: a
 * single comment whose id the page did not expose should cost that comment, not
 * the other forty.
 */
export function hasStableIdentity(identity: Partial<PlatformIdentity> | null | undefined): boolean {
  if (!identity?.platform) return false;
  try {
    stableSignalId(identity as PlatformIdentity);
    return true;
  } catch {
    return false;
  }
}

/**
 * The id of the parent, for linking a comment to its post.
 *
 * Returns null when there is no parent, which is the ordinary case for a
 * top-level post and must not be confused with "the parent id was lost".
 */
export function stableParentId(identity: PlatformIdentity): string | null {
  const parent = String(identity.parentContentId ?? '').trim();
  if (!parent) return null;
  return stableSignalId({
    platform: identity.platform,
    communityId: identity.communityId,
    externalContentId: parent,
  });
}

/* ────────────────────────────────────────────────────────────────────────
 * What changed between two sightings
 * ──────────────────────────────────────────────────────────────────────── */

export type SightingVerdict =
  /** Same item, same text. Nothing to do but move `lastSeenAt`. */
  | 'UNCHANGED'
  /** Same item, different text. The author edited it; evidence updates. */
  | 'EDITED'
  /** First time we have seen this id. */
  | 'NEW';

export interface Sighting {
  verdict: SightingVerdict;
  /** Plain words, because this decides whether a customer sees new evidence. */
  detail: string;
}

/**
 * Compare a fresh read against what we already hold FOR THE SAME ID.
 *
 * This is the function that makes the separation pay off. Because identity is
 * platform-native, an edit arrives as the same id with a different fingerprint
 * and is reported as EDITED — one person, one lead, updated text. Under the old
 * scheme the same event arrived as a brand-new id and was indistinguishable
 * from a second person posting something similar.
 */
export function compareSighting(
  known: { contentFingerprint: string | null } | null,
  fresh: { contentFingerprint: string },
): Sighting {
  if (!known) {
    return { verdict: 'NEW', detail: 'this platform id has not been seen before' };
  }
  if (!known.contentFingerprint) {
    return {
      verdict: 'EDITED',
      detail: 'the stored row carries no fingerprint, so a change cannot be ruled out; '
        + 'treated as edited rather than assumed unchanged',
    };
  }
  if (known.contentFingerprint === fresh.contentFingerprint) {
    return { verdict: 'UNCHANGED', detail: 'same platform id, identical text' };
  }
  return {
    verdict: 'EDITED',
    detail: 'same platform id, different text: the author edited it. One signal, updated evidence '
      + '— never a second signal, which is what a text-derived id would have produced',
  };
}

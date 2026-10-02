// A PROPERTY SOMEBODY ELSE IS OFFERING.
//
// The other half of Find Property. OpportunityCard shows a PERSON the matcher found for
// a property you own; this shows a PROPERTY the matcher found for a search you wrote.
// Same family, opposite direction, and deliberately not the same component — a card that
// tried to be both would end up describing neither.
//
// WHAT IT REPLACES was the generic stack: a shadcn Card holding four `rounded-full
// bg-secondary` capsules for city, price, rooms and area, a fifth outlined capsule for
// the date, a bordered box for the broker and a 12px gold word for the action. Pill soup
// with a text link at the bottom — five capsules saying five facts that are not five
// categories, and a destination that did not look like one.
//
// WHAT IT IS NOW:
//
//     4 months ago                                    myhome.ge
//     Three-room flat in Vake with a balcony
//     ⌖ Vake, Tbilisi   ₾ $142,000   ⌂ 3 rooms   ▭ 78 m²
//     Matches your plan on location, type and budget.
//     Not quite what you preferred: floor
//     ▏Rustaveli Estate
//      Seen in the market · not registered with Homatch
//      Seen on 3 sources · 12 listings attributed
//     Open the listing ↗
//
// THREE THINGS IT WILL NOT DO
//
//   Claim a broker is registered. `registeredWithHomatch` is false for every firm found
//   by reading a portal, because a registration needs an account that discovery does not
//   have. The label is the server's own key, translated, and this card never composes one.
//
//   Imply a listing is fresh when nobody recorded when it was published. No date, no line
//   — rather than "recently" or today's date standing in for a real one.
//
//   Score the result. The order is the matcher's own and there is no percentage here;
//   `whyThisMatches` is the matcher's sentence about this particular pairing, which is a
//   reason rather than a number.

import { BedDouble, Building2, Coins, MapPin, Ruler, SquareArrowOutUpRight } from 'lucide-react';
import React from 'react';
import { Fact, LinkAction } from '@/components/customer/surface';
import { safeExternalUrl } from '@/lib/safeExternalUrl';

/** What is being offered, each part already formatted and localised by the caller. */
export interface ListingFacts {
  /** District and city, in the reader's script. */
  place?: string | null;
  /** The asking price, through the money formatter. */
  price?: string | null;
  /** Rooms, with its own word. */
  rooms?: string | null;
  /** Floor area, with its unit. */
  area?: string | null;
}

/**
 * Where a result came from, as the source gave it, with the labels already translated.
 * Every link is checked again here (safeExternalUrl); one that is not a real http(s)
 * URL is shown as text, never as a link.
 */
export interface ListingAttribution {
  sourceLabel: string;
  /** The channel, group, board or site name, or the platform when the registry has none. */
  sourceName: string;
  sourceUrl?: string | null;
  threadLabel: string;
  threadUrl?: string | null;
  authorLabel: string;
  authorName?: string | null;
  authorUrl?: string | null;
  originalLabel: string;
  /** The post as written, public contacts included. */
  originalText?: string | null;
  showMore: string;
  showLess: string;
  /** The same property on other sources (cross-source dedupe), each an exact link. */
  alsoSeenLabel?: string;
  alsoSeen?: Array<{ name: string; url: string | null }>;
}

const LONG_TEXT = 280;

function OutLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      dir="auto"
      className="break-all text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
    >
      {children}
    </a>
  );
}

function SourceBlock({ attribution }: { attribution: ListingAttribution }) {
  const [open, setOpen] = React.useState(false);
  const sourceUrl = safeExternalUrl(attribution.sourceUrl);
  const threadUrl = safeExternalUrl(attribution.threadUrl);
  const authorUrl = safeExternalUrl(attribution.authorUrl);
  const author = attribution.authorName ?? (authorUrl ? authorUrl.replace(/^https?:\/\//, '') : null);
  const text = attribution.originalText ?? null;
  const long = (text?.length ?? 0) > LONG_TEXT;
  const alsoSeen = (attribution.alsoSeen ?? [])
    .map((s) => ({ name: s.name, url: safeExternalUrl(s.url) }))
    .filter((s): s is { name: string; url: string } => !!s.url);
  return (
    <div className="mt-2.5 space-y-1 border-s-2 border-border ps-2.5 text-2xs leading-snug">
      <p className="break-words text-muted-foreground">
        {attribution.sourceLabel}:{' '}
        {sourceUrl ? <OutLink href={sourceUrl}>{attribution.sourceName}</OutLink> : <span dir="auto">{attribution.sourceName}</span>}
        {threadUrl ? <>{' · '}<OutLink href={threadUrl}>{attribution.threadLabel}</OutLink></> : null}
      </p>
      {author ? (
        <p className="break-words text-muted-foreground">
          {attribution.authorLabel}:{' '}
          {authorUrl ? <OutLink href={authorUrl}>{author}</OutLink> : <span dir="auto">{author}</span>}
        </p>
      ) : null}
      {alsoSeen.length ? (
        <p className="break-words text-muted-foreground">
          {attribution.alsoSeenLabel}:{' '}
          {alsoSeen.map((s, i) => (
            <React.Fragment key={s.url}>
              {i > 0 ? ' · ' : null}
              <OutLink href={s.url}>{s.name}</OutLink>
            </React.Fragment>
          ))}
        </p>
      ) : null}
      {text ? (
        <div>
          <p className="font-semibold text-foreground">{attribution.originalLabel}</p>
          <p dir="auto" className={`whitespace-pre-wrap break-words text-foreground/90 ${long && !open ? 'line-clamp-4' : ''}`}>
            {text}
          </p>
          {long ? (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="mt-0.5 inline-flex min-h-9 items-center font-semibold text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            >
              {open ? attribution.showLess : attribution.showMore}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ListingCard({
  headline,
  freshness,
  source,
  facts,
  whyLine,
  missesLabel,
  misses,
  broker,
  actionLabel,
  href,
  attribution,
}: {
  headline: string;
  /** How long ago it was published, in the reader's language. Null when unrecorded. */
  freshness?: string | null;
  /** Which site it was read from. An operator's fact, so it sits quietly. */
  source?: string | null;
  facts: ListingFacts;
  /** The matcher's own sentence about this pairing. */
  whyLine?: string | null;
  missesLabel: string;
  /** What the customer preferred and this does not have. Named, never averaged away. */
  misses?: readonly string[] | null;
  /**
   * Who is offering it, and what they are to Homatch.
   *
   * Three fields because they are three facts and flattening them is how a card ends up
   * claiming a firm is registered. `name` is the firm's own; `standing` is the server's
   * disclosure key, translated; `provenance` is what was actually observed.
   */
  broker?: { name: string; standing: string; provenance: string } | null;
  actionLabel: string;
  href?: string | null;
  /** Where it came from: source, author, the post as written. */
  attribution?: ListingAttribution | null;
}) {
  /* The one action opens the exact source, and only a real http(s) link. */
  const actionHref = safeExternalUrl(href);
  /*
   * The fact row, built from what exists, capped at four.
   *
   * A listing usually has all four and they are all decision-relevant — where, how much,
   * how many rooms, how big — which is one more than an opportunity card carries, because
   * here the headline is somebody else's listing title and cannot be relied on to have
   * said any of them.
   */
  const shown = [
    facts.place ? { icon: MapPin, value: facts.place } : null,
    facts.price ? { icon: Coins, value: facts.price } : null,
    facts.rooms ? { icon: BedDouble, value: facts.rooms } : null,
    facts.area ? { icon: Ruler, value: facts.area } : null,
  ].filter(Boolean) as Array<{
    icon: React.ComponentType<{ className?: string }>;
    value: string;
  }>;

  return (
    <article className="hm-discovery-panel p-3.5 transition-colors hover:border-[hsl(var(--ring))]/35">
      {/* ── when it was said, and where it was read ─────────────────── */}
      {(freshness || source) && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-2xs">
          {/* The age of a listing is the most decision-relevant thing about it after the
              price, so it leads. Absent when nobody recorded a publication date. */}
          <span className="text-muted-foreground">{freshness ?? ''}</span>
          {source ? <span className="text-muted-foreground/70">{source}</span> : null}
        </div>
      )}

      {/* ── what it is, in the seller's own words ───────────────────── */}
      {/* dir="auto": a Russian or Georgian listing title inside an Arabic page takes its
          own direction rather than inheriting the page's. */}
      <h3 dir="auto" className="font-display text-[0.9375rem] font-semibold leading-snug text-foreground">
        {headline}
      </h3>

      {/* ── the facts, as values rather than capsules ───────────────── */}
      {shown.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {shown.map((fact) => (
            <Fact key={fact.value} icon={fact.icon}>
              {fact.value}
            </Fact>
          ))}
        </div>
      )}

      {/* ── why the matcher offered it ──────────────────────────────── */}
      {whyLine ? (
        <p dir="auto" className="mt-2 text-2xs leading-snug text-foreground/90">{whyLine}</p>
      ) : null}

      {/*
        WHAT IT DOES NOT HAVE, NAMED.
        A preference that was missed is the reason somebody skips a result, and folding it
        into a score would leave them working out for themselves why the fourth one down
        is worse than the third.
      */}
      {(misses?.length ?? 0) > 0 && (
        <p className="mt-1.5 text-2xs leading-snug text-muted-foreground">
          {missesLabel}: {misses?.join(', ')}
        </p>
      )}

      {/*
        WHO IS OFFERING, AND WHAT THEY ARE TO HOMATCH.
        Two separate facts reported separately, through the same quotation treatment the
        rest of the family uses for something that came from outside. The label is the
        server's key; nothing here composes a claim about a firm.
      */}
      {broker ? (
        <div className="mt-2.5 border-s-2 border-border ps-2.5">
          {/* A name reads as a name. It was going through SourceQuote's label slot, which
              is a 13px uppercase eyebrow for one word — so a Georgian firm's name and the
              whole disclosure sentence came out shouting across three lines. */}
          <p dir="auto" className="break-words text-2xs font-semibold text-foreground">
            {broker.name}
          </p>
          <p className="break-words text-2xs text-muted-foreground">{broker.standing}</p>
          <p className="break-words text-2xs text-muted-foreground/75">{broker.provenance}</p>
        </div>
      ) : null}

      {/* ── where it came from ───────────────────────────────────────── */}
      {attribution ? <SourceBlock attribution={attribution} /> : null}

      {/* ── one action, and it leaves ───────────────────────────────── */}
      {actionHref ? (
        <div className="mt-3 border-t border-border/50 pt-2.5">
          <LinkAction label={actionLabel} href={actionHref} icon={SquareArrowOutUpRight} />
        </div>
      ) : null}
    </article>
  );
}

/**
 * A state that is not a list.
 *
 * "You have no search" and "your search is running and nothing matches yet" are different
 * situations with different next actions, and both used to be a centred shadcn Card with
 * a 36px outline icon at 30% opacity in the middle of it — which is what a page looks
 * like when nobody decided what it should say.
 */
export function DiscoveryState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  /** The second sentence, where there is one worth saying. */
  body?: string | null;
  action?: React.ReactNode;
}) {
  return (
    <div className="hm-discovery-panel flex flex-col items-start gap-2 px-5 py-6">
      <span
        className="grid h-9 w-9 place-items-center rounded-full bg-[hsl(var(--secondary))] text-muted-foreground ring-1 ring-inset ring-border"
        aria-hidden="true"
      >
        <Icon className="h-4 w-4" />
      </span>
      <p className="break-words font-display text-sm font-semibold text-foreground">{title}</p>
      {body ? (
        <p className="max-w-prose break-words text-2xs leading-relaxed text-muted-foreground">
          {body}
        </p>
      ) : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

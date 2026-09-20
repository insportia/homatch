// HOMATCH FOR EXPATS — where people actually find flats here.
//
// The honest answer to "where do I look for a rental in Tbilisi" is not a
// portal. It is a handful of Telegram channels and Facebook groups, and a
// foreigner who does not know that spends three weeks on listing sites
// wondering why everything is overpriced.
//
// THE ROWS ARE NOT OURS AND ARE NOT INVENTED
//
// They come from `community_directory`, which another Homatch workstream
// curates and re-verifies; every row carries the date it was last checked
// and that date is shown. FOR EXPATS added no table for this and wrote no
// entries. §84 forbids inventing a directory; the alternative was not to
// build the surface at all, and there was real data sitting there.
//
// WHAT IS DELIBERATELY NOT CLAIMED
//
// No ranking by quality, no "best group", no safety assurance. They are
// ordered by member count where it is known, which is a fact about the
// group rather than a judgement of it, and the page says plainly that
// these are public groups Homatch does not run.

import React from 'react';
import { ExternalLink, Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { recordOutbound, type RentalCommunity } from '@/services/expats';
import { outboundEvent } from '@/expats/research/attribution';

export function RentalCommunities({ communities }: { communities: readonly RentalCommunity[] }) {
  const { t, lang } = useLanguage();
  const { homatchUser } = useAuth();

  if (communities.length === 0) return null;

  const formatMembers = (n: number) => {
    try {
      return new Intl.NumberFormat(lang).format(n);
    } catch {
      return String(n);
    }
  };

  return (
    <section data-expat-communities>
      <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--gold-ink))]">
        {t('expat_communities_eyebrow')}
      </p>
      <h2 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
        {t('expat_communities_title')}
      </h2>
      <p className="mt-3 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">
        {t('expat_communities_body')}
      </p>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {communities.map((c) => (
          <li key={c.id}>
            <a
              href={c.url ?? '#'}
              target="_blank"
              rel="noopener noreferrer nofollow"
              data-expat-community={c.id}
              onClick={() => {
                const e = outboundEvent({ action: 'WEBSITE_OPENED', providerId: c.id });
                void recordOutbound({
                  userId: homatchUser?.id ?? null,
                  action: e.action,
                  stage: e.stage,
                });
              }}
              className="group flex h-full items-start gap-3 rounded-xl border border-border p-4 transition-colors hover:border-[hsl(var(--gold-border))]"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{c.name}</span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
                  <span className="rounded-full border border-border px-2 py-0.5">{c.platform}</span>
                  {c.language ? <span className="uppercase">{c.language}</span> : null}
                  {c.memberCount !== null ? (
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" aria-hidden="true" />
                      {formatMembers(c.memberCount)}
                    </span>
                  ) : null}
                  {c.lastVerifiedAt ? (
                    <span>
                      {t('expat_communities_checked', {
                        date: c.lastVerifiedAt.slice(0, 10),
                      })}
                    </span>
                  ) : null}
                </span>
              </span>
              <ExternalLink
                className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </a>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-2xs leading-relaxed text-muted-foreground">
        {t('expat_communities_disclaimer')}
      </p>
    </section>
  );
}

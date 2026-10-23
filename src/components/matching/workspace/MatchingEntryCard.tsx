// The property page's way into the matching workspace (owner, 2026-10-24).
//
// It replaced the paid external search launch (budget dialog, campaign controls): the
// property page no longer starts, pauses or prices a search. It says what the workspace
// offers right now — from the same server switches the workspace reads — and opens it.

import { ArrowRight, Database, Sparkles, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { NAVY_BAND } from '@/components/findBuyers/brand';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { EMPTY_FILTERS, getInternalPage, getWorkspaceState, type WorkspaceState } from '@/services/matchingWorkspace';
import { formatCount, formatCredits } from './format';

export function MatchingEntryCard({ propertyId }: { propertyId: string }) {
  const { t, lang } = useLanguage();
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [internalAvailable, setInternalAvailable] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    getWorkspaceState().then((s) => { if (alive) setState(s); }).catch(() => undefined);
    /* Counts are optional: a page far past the end returns them without rows. */
    getInternalPage(propertyId, { view: 'UNLOCKED', filters: EMPTY_FILTERS, sort: 'BEST', page: 100000 })
      .then((p) => { if (alive) setInternalAvailable(Number(p.counts?.LOCKED ?? 0)); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [propertyId]);

  const href = `/property/${encodeURIComponent(propertyId)}/matches`;
  const maintenance = state?.maintenance === true;
  const tiles = state && !maintenance ? [
    state.internal ? {
      key: 'internal', icon: Users, title: t('mw_product_internal'),
      line: internalAvailable != null ? t('mw_entry_internal_count', { n: formatCount(internalAvailable, lang) }) : t('mw_entry_internal_line'),
      to: `${href}?product=internal`,
    } : null,
    state.curated ? {
      key: 'external', icon: Database, title: t('mw_product_external'),
      line: state.curatedPrice ? t('mw_entry_external_price', { credits: formatCredits(state.curatedPrice.credits, lang) }) : t('mw_entry_external_line'),
      to: `${href}?product=external`,
    } : null,
  ].filter((x): x is NonNullable<typeof x> => x != null) : [];

  return (
    <section aria-labelledby="pow-matching-title" data-testid="pow-matching-entry" className="hm-owner-panel overflow-hidden">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <div className={cn('space-y-2 p-5 text-white sm:p-6', NAVY_BAND)}>
          <p className="inline-flex items-center gap-1.5 text-2xs font-bold uppercase tracking-[0.16em] text-[hsl(38_92%_64%)]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{t('mw_eyebrow')}
          </p>
          <h2 id="pow-matching-title" className="font-display text-lg font-semibold tracking-[-0.01em] break-words">{t('mw_entry_title')}</h2>
          <p className="text-2xs leading-relaxed text-[hsl(218_40%_85%)] break-words">{maintenance ? t('mw_mt_subheading') : t('mw_entry_body')}</p>
        </div>
        <div className="flex flex-col justify-center gap-3 p-5 sm:p-6">
          {tiles.length ? (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {tiles.map(({ key, icon: Icon, title, line, to }) => (
                <Link key={key} to={to} data-testid={`pow-matching-${key}`}
                  className="group flex min-w-0 items-start gap-3 rounded-xl bg-[hsl(42_100%_97%)] p-3 ring-1 ring-inset ring-[hsl(40_70%_86%)] hover:ring-[hsl(40_80%_62%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-[hsl(34_90%_36%)] ring-1 ring-inset ring-[hsl(40_80%_84%)]"><Icon className="h-4 w-4" aria-hidden="true" /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[hsl(218_45%_14%)] break-words">{title}</span>
                    <span className="block text-2xs text-[hsl(218_28%_38%)] break-words">{line}</span>
                  </span>
                </Link>
              ))}
            </div>
          ) : null}
          <Link to={href} data-testid="pow-matching-open"
            className="inline-flex min-h-11 items-center justify-center gap-1.5 self-start rounded-lg bg-[hsl(38_92%_54%)] px-4 text-sm font-semibold text-[#161309] hover:bg-[hsl(38_92%_60%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]">
            <span className="break-words">{t('mw_entry_cta')}</span>
            <ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

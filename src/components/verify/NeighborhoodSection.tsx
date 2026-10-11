/*
 * What is nearby, measured (OpenStreetMap).
 *
 * Renders the lookup verify-synthesis stored at build time
 * (synthesis_json.location.neighborhood). Nothing is fetched here, and
 * nothing here is estimated: distances are the straight-line metres the
 * build measured, route numbers are OSM route refs, and the source date is
 * Overpass's own data timestamp. The view (top places, pros, cons) is the
 * same pure derivation the build uses — see neighborhood.ts.
 *
 * Premium Verify identity: navy surfaces from the theme tokens, gold
 * (text-primary) for the accents. Mobile first; logical properties only.
 */
import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Bus, Check, Info } from 'lucide-react';
import {
  neighborhoodView,
  OSM_ATTRIBUTION,
  OSM_COPYRIGHT_URL,
  type NeighborhoodPoint,
  type StoredNeighborhood,
} from '@/verify/intelligence/neighborhood';

/** "2026-10-10T20:59:02Z" → "10.10.2026"; anything else → null. */
function dataDate(iso: string | null | undefined): string | null {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

/* First-strong isolate, so a Georgian place name keeps its order inside
   an Arabic or Hebrew sentence. */
const iso = (v: string) => `⁨${v}⁩`;

const Point: React.FC<{ p: NeighborhoodPoint; tone: 'pro' | 'con' }> = ({ p, tone }) => {
  const { t } = useLanguage();
  const vars = Object.fromEntries(Object.entries(p.vars ?? {}).map(([k, v]) => [k, k === 'name' ? iso(v) : v]));
  return (
    <li className="flex min-w-0 items-start gap-2 text-sm leading-6">
      {tone === 'pro' ? (
        <Check className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      ) : (
        <Info className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span className="min-w-0 break-words">{t(p.key, vars)}</span>
    </li>
  );
};

export const NeighborhoodSection: React.FC<{ n: StoredNeighborhood }> = ({ n }) => {
  const { t } = useLanguage();
  const view = neighborhoodView(n);
  if (!view) return null;

  if (view.status !== 'OK') {
    return (
      <div className="rounded-xl border border-border bg-card p-4" data-neighborhood-status={view.status}>
        <p className="text-sm leading-6 text-muted-foreground break-words">
          {t(view.status === 'NO_LOCATION' ? 'verify_nb_no_location' : 'verify_nb_unavailable')}
        </p>
      </div>
    );
  }

  const date = dataDate(n.osmBase) ?? dataDate(n.fetchedAt);
  const metres = (m: number) => t('verify_nb_m', { m: String(m) });

  return (
    <div className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5" data-neighborhood-status="OK">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="font-display text-base font-semibold tracking-tight break-words">{t('verify_nb_title')}</h3>
          <span className="rounded-full border border-primary/40 px-2 py-0.5 text-2xs uppercase tracking-wide text-primary">
            {t('verify_nb_straight_label')}
          </span>
        </div>
        {n.center?.basis ? (
          <p className="text-xs leading-5 text-muted-foreground break-words">{t(`verify_nb_basis_${n.center.basis}`)}</p>
        ) : null}
      </div>

      {view.pros.length || view.cons.length ? (
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          {view.pros.length ? (
            <div className="min-w-0 space-y-2">
              <p className="text-2xs uppercase tracking-wide text-primary">{t('verify_nb_pros')}</p>
              <ul className="space-y-1.5">{view.pros.map((p) => <Point key={p.key} p={p} tone="pro" />)}</ul>
            </div>
          ) : null}
          {view.cons.length ? (
            <div className="min-w-0 space-y-2">
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">{t('verify_nb_cons')}</p>
              <ul className="space-y-1.5">{view.cons.map((p) => <Point key={p.key} p={p} tone="con" />)}</ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {view.stops.length ? (
        <div className="min-w-0 space-y-2 border-t border-border pt-4">
          <p className="flex items-center gap-2 text-2xs uppercase tracking-wide text-muted-foreground">
            <Bus className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            {t('verify_nb_transit')}
          </p>
          <ul className="space-y-2">
            {view.stops.map((s) => (
              <li key={s.osm} className="min-w-0 border-s-2 border-primary/40 ps-3">
                <p className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 text-sm leading-6">
                  <span className="min-w-0 break-words font-medium"><bdi>{s.name ?? t('verify_nb_stop_unnamed')}</bdi></span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{metres(s.distanceM)}</span>
                </p>
                {s.routes.length ? (
                  <p className="text-xs leading-5 text-muted-foreground break-words">
                    {t('verify_nb_stop_routes', { routes: s.routes.map((r) => r.split(':')[1]).join(', ') })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {view.routesByMode.length ? (
            <div className="flex flex-wrap gap-2">
              {view.routesByMode.map((g) => (
                <span key={g.mode} className="rounded-lg border border-border bg-muted/40 px-2.5 py-1 text-xs">
                  <span className="text-muted-foreground">{t(`verify_nb_mode_${g.mode}`)} </span>
                  <span className="font-semibold tabular-nums">{g.refs.join(', ')}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs leading-5 text-muted-foreground break-words">{t('verify_nb_routes_unavailable')}</p>
          )}
        </div>
      ) : null}

      {view.categories.length ? (
        <div className="grid min-w-0 grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2">
          {view.categories.map((c) => (
            <div key={c.category} className="min-w-0 rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2">
                <p className="min-w-0 break-words text-sm font-semibold">{t(`verify_nb_cat_${c.category}`)}</p>
                <p className="shrink-0 text-2xs text-muted-foreground tabular-nums">{t('verify_nb_count', { count: String(c.counts.r1000) })}</p>
              </div>
              {c.top.length ? (
                <ul className="mt-2 space-y-1">
                  {c.top.map((p) => (
                    <li key={p.osm} className="flex min-w-0 items-baseline justify-between gap-3 text-sm leading-6">
                      <span className="min-w-0 break-words"><bdi>{p.name}</bdi></span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{metres(p.distanceM)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground break-words">{t('verify_nb_unnamed_only')}</p>
              )}
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-1 border-t border-border pt-3 text-2xs leading-5 text-muted-foreground">
        <p className="break-words">{t('verify_nb_distance_note')}</p>
        <p className="break-words">{t('verify_nb_incomplete')}</p>
        <p className="break-words">
          {date ? <>{t('verify_nb_source', { date })} </> : null}
          <a
            href={OSM_COPYRIGHT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-primary/50 underline-offset-2 hover:text-foreground"
          >
            {OSM_ATTRIBUTION}
          </a>
        </p>
      </div>
    </div>
  );
};

export default NeighborhoodSection;

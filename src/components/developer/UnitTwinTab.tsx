import React, { Suspense, lazy, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, ExternalLink, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { Panel, EmptyState, LoadingRows } from './primitives';
import { loadUnitScene, type TwinScene } from '@/services/developer/twin';
import { listWalkthroughs } from '@/services/developer/inventory';
import type { DevUnit, DevWalkthrough } from '@/services/developer/types';

/**
 * THE WALKTHROUGH OF ONE APARTMENT.
 *
 * What this tab used to be: a list of pasted embed URLs with a publish button
 * beside each, and no way to open any of them. A developer looking for the
 * three-dimensional product they had been sold found a text field containing
 * a link.
 *
 * What it is now, in the only order that is honest:
 *
 *   1. If our 3D team has published an interior scene for this apartment's
 *      LAYOUT, it renders here, in the drawer, as the actual scene. One scene
 *      serves every apartment of that type — twenty layouts across five
 *      hundred apartments is twenty interiors, not five hundred.
 *   2. If an external tour has been attached, it is offered as a link that
 *      opens, rather than as a URL printed on the screen.
 *   3. Otherwise the tab says plainly that no interior exists yet, and offers
 *      the thing that DOES exist: this apartment's own building, in 3D, on
 *      its own floor.
 *
 * There is no path through this component that opens a photo gallery and
 * calls it a walkthrough.
 */

const TwinCanvas = lazy(() => import('./TwinCanvas'));

export function UnitTwinTab({ unit }: { unit: DevUnit }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [scene, setScene] = useState<TwinScene | null>(null);
  const [tours, setTours] = useState<DevWalkthrough[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const [s, w] = await Promise.all([
        loadUnitScene(unit.id).catch(() => null),
        listWalkthroughs(unit.id).catch(() => [] as DevWalkthrough[]),
      ]);
      if (cancelled) return;
      setScene(s);
      setTours(w);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [unit.id]);

  if (loading) return <LoadingRows rows={4} />;

  const published = tours.filter((tour) => tour.status === 'PUBLISHED' && tour.embed_url);

  return (
    <div className="space-y-5">
      {scene && scene.assets.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-border">
          <Suspense fallback={(
            <div className="flex h-72 items-center justify-center bg-sand/40">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-gold border-t-transparent" />
            </div>
          )}>
            <TwinCanvas
              scene={scene}
              floors={[]}
              activeLevel={null}
              onSelectLevel={() => {}}
              className="h-72"
            />
          </Suspense>
          <p className="border-t border-border px-3 py-2 text-2xs text-muted-foreground">
            {t('dev_unit_twin_layout_note')}
          </p>
        </section>
      ) : (
        <Panel>
          <EmptyState
            icon={<Box className="h-7 w-7" />}
            title={t('dev_unit_twin_none_title')}
            description={t('dev_unit_twin_none_body')}
            action={(
              <Button
                variant="outline"
                onClick={() => navigate(`/developers/projects/${unit.project_id}?view=twin`)}
              >
                <Building2 className="mr-2 h-4 w-4" />
                {t('dev_unit_twin_see_building')}
              </Button>
            )}
          />
        </Panel>
      )}

      {/* An attached external tour is a link that opens, not a URL on a page. */}
      {published.length > 0 && (
        <section>
          <p className="mb-2 text-2xs uppercase tracking-[0.14em] text-muted-foreground">
            {t('dev_unit_twin_external')}
          </p>
          <ul className="space-y-2">
            {published.map((tour) => (
              <li key={tour.id}>
                <Button variant="outline" size="sm" className="w-full justify-start" asChild>
                  <a href={tour.embed_url ?? undefined} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-3.5 w-3.5" />
                    {tour.title || t('dev_tour_untitled')}
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

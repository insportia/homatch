import React, { useState } from 'react';
import { ImageIcon, Maximize2, X, Ruler } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { Panel, EmptyState } from './primitives';
import { SectionHead } from './visuals';
import type { DevUnit } from '@/services/developer/types';

/**
 * THE PHOTOGRAPHS AND THE PLAN.
 *
 * dev_units has carried `photos` and `floor_plan_url` since the schema was
 * written. The drawer showed neither: a salesperson opening an apartment to
 * send it to a buyer could read its area and could not see it.
 *
 * Nothing is generated and nothing is substituted. Where a developer has
 * uploaded neither, the panel says so and names what to upload — a missing
 * photograph is a fact about the inventory, not something to paper over with
 * a stock image.
 */
export function UnitMedia({ unit }: { unit: DevUnit }) {
  const { t } = useLanguage();
  const photos = (unit.photos ?? []).filter(Boolean);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const nothing = photos.length === 0 && !unit.floor_plan_url;
  if (nothing) {
    return (
      <Panel>
        <EmptyState
          icon={<ImageIcon className="h-7 w-7" />}
          title={t('dev_unit_media_none_title')}
          description={t('dev_unit_media_none_body')}
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      {photos.length > 0 && (
        <section>
          <SectionHead title={t('dev_unit_media_gallery')} />
          {/* The first photograph large, the rest beside it. An apartment is
              sold on the first image; a uniform grid of thumbnails buries it. */}
          <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <button
              type="button"
              onClick={() => setLightbox(photos[0])}
              className="group relative overflow-hidden rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img
                src={photos[0]}
                alt=""
                loading="lazy"
                className="aspect-[4/3] w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
              />
              <span className="absolute right-2 top-2 rounded-md bg-background/85 p-1.5 backdrop-blur">
                <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </button>
            {photos.length > 1 && (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-1">
                {photos.slice(1, 4).map((photo) => (
                  <li key={photo}>
                    <button
                      type="button"
                      onClick={() => setLightbox(photo)}
                      className="block w-full overflow-hidden rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <img
                        src={photo}
                        alt=""
                        loading="lazy"
                        className="aspect-[4/3] w-full object-cover"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {photos.length > 4 && (
            <p className="mt-2 text-2xs text-muted-foreground">
              {t('dev_unit_media_more').replace('{n}', String(photos.length - 4))}
            </p>
          )}
        </section>
      )}

      {unit.floor_plan_url && (
        <section>
          <SectionHead title={t('dev_unit_media_plan')} />
          <Panel className="p-3">
            {/* A plan is read, not admired: white ground, contained, and one
                press away from full size. */}
            <button
              type="button"
              onClick={() => setLightbox(unit.floor_plan_url)}
              className="block w-full rounded-md bg-white p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img
                src={unit.floor_plan_url}
                alt={t('dev_unit_media_plan')}
                loading="lazy"
                className="mx-auto max-h-80 w-auto max-w-full object-contain"
              />
            </button>
            <p className="mt-2 flex items-center gap-1.5 text-2xs text-muted-foreground">
              <Ruler className="h-3 w-3" aria-hidden="true" />
              {t('dev_unit_media_plan_hint')}
            </p>
          </Panel>
        </section>
      )}

      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
          <button
            type="button"
            aria-label={t('dev_close')}
            onClick={() => setLightbox(null)}
            className="absolute inset-0"
          />
          <img
            src={lightbox}
            alt=""
            className={cn(
              'relative max-h-[90vh] max-w-full rounded-lg object-contain',
              lightbox === unit.floor_plan_url && 'bg-white p-4',
            )}
          />
          <Button
            variant="secondary"
            size="icon"
            onClick={() => setLightbox(null)}
            aria-label={t('dev_close')}
            className="absolute right-4 top-4"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

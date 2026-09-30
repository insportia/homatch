import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { resolveSpatialSource, provenanceLabel } from '@/lib/designStudio/spatialSource';
import { SUPPORTED_GENERATORS } from '@/lib/designStudio/engine';
import type { SpatialSourceRecord } from '@/lib/designStudio/types';
import { cn } from '@/lib/utils';

/**
 * Where a project's space stands, in one line: "3D space available · From
 * your floor plan · Estimated dimensions", or "No 3D space yet". Computed by
 * the same resolver the workspace opens with, so the launcher never promises
 * a space the workspace would refuse.
 */
export function SpaceStatus({
  sources,
  activeSourceId,
  className,
}: {
  sources: SpatialSourceRecord[];
  activeSourceId?: string | null;
  className?: string;
}) {
  const { t } = useLanguage();
  const resolution = resolveSpatialSource({
    sources,
    preferredSourceId: activeSourceId ?? null,
    supportedGenerators: SUPPORTED_GENERATORS,
  });

  if (!resolution.source) {
    const processing = sources.some((s) => s.status === 'PROCESSING');
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-[13px] text-muted-foreground', className)}>
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" aria-hidden="true" />
        {t(processing ? 'ds_space_preparing' : 'ds_space_none')}
      </span>
    );
  }

  const label = provenanceLabel(resolution.source);
  return (
    <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px]', className)}>
      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-[hsl(152_54%_34%)]" aria-hidden="true" />
        {t('ds_space_available')}
      </span>
      <span className="text-muted-foreground" aria-hidden="true">·</span>
      <span className="text-muted-foreground">{t(label.originKey)}</span>
      <span className="text-muted-foreground" aria-hidden="true">·</span>
      <span className={resolution.source.geometry_state === 'ESTIMATED' ? 'text-[hsl(32_78%_34%)]' : 'text-muted-foreground'}>
        {t(label.geometryKey)}
      </span>
    </span>
  );
}

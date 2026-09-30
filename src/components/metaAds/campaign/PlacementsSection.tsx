// Placements: where Meta delivered the ads, from the placement breakdown.
import React from 'react';
import type { CampaignDetail } from '@/services/metaAds';
import { SegmentTable } from './SegmentTable';
import { Card, placementName, type Fmt, type T } from './shared';

export function PlacementsSection({ t, fmt, d }: { t: T; fmt: Fmt; d: CampaignDetail }) {
  const title = t('mm_c_placements_title');
  return (
    <Card id="mm-placements" title={title}>
      <SegmentTable t={t} fmt={fmt} label={title} rows={d.analysis?.segments?.placement}
        name={(k) => placementName(t, k)} leader={d.analysis?.leaders?.placement} />
    </Card>
  );
}

// Audience: age and gender as Meta reports them.
import React from 'react';
import type { CampaignDetail } from '@/services/metaAds';
import { SegmentTable } from './SegmentTable';
import { Card, Muted, ageGenderName, type Fmt, type T } from './shared';

export function AudienceSection({ t, fmt, d }: { t: T; fmt: Fmt; d: CampaignDetail }) {
  const title = t('mm_c_audience_title');
  return (
    <Card id="mm-audience" title={title}>
      <Muted className="mb-3">{t('mm_c_audience_note')}</Muted>
      <SegmentTable t={t} fmt={fmt} label={title} rows={d.analysis?.segments?.ageGender}
        name={(k) => ageGenderName(t, k)} leader={d.analysis?.leaders?.audience} />
    </Card>
  );
}

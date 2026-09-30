// Geography: countries and regions from Meta's breakdowns. No leader is
// named here — the server does not judge geography.
import React from 'react';
import type { CampaignDetail } from '@/services/metaAds';
import { SegmentTable } from './SegmentTable';
import { Card, countryName, type Fmt, type T } from './shared';

export function GeoSection({ t, fmt, d }: { t: T; fmt: Fmt; d: CampaignDetail }) {
  const countries = t('mm_c_geo_countries');
  const regions = t('mm_c_geo_regions');
  return (
    <div className="space-y-4">
      <Card id="mm-geo-countries" title={countries}>
        <SegmentTable t={t} fmt={fmt} label={countries} rows={d.analysis?.segments?.country}
          name={(k) => countryName(fmt.lang, k)} />
      </Card>
      <Card id="mm-geo-regions" title={regions}>
        <SegmentTable t={t} fmt={fmt} label={regions} rows={d.analysis?.segments?.region} name={(k) => k} />
      </Card>
    </div>
  );
}

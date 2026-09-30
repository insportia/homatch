// Where the numbers come from and how fresh they are.
import React from 'react';
import { Database } from 'lucide-react';
import type { CampaignDetail } from '@/services/metaAds';
import type { Fmt, T } from './shared';

export function ProvenanceNote({ t, fmt, provenance }: { t: T; fmt: Fmt; provenance: CampaignDetail['provenance'] }) {
  const synced = fmt.rel(provenance.lastSyncedAt);
  const insights = fmt.rel(provenance.insightsSyncedAt);
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs text-muted-foreground" data-mm-provenance="">
      <Database className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="font-semibold">{t('mm_c_prov_data')}</span>
      <span aria-hidden="true">·</span>
      <span title={fmt.dateTime(provenance.lastSyncedAt)}>{t('mm_c_prov_synced', { when: synced ?? t('mm_c_prov_never') })}</span>
      <span aria-hidden="true">·</span>
      <span title={fmt.dateTime(provenance.insightsSyncedAt)}>{t('mm_c_prov_insights', { when: insights ?? t('mm_c_prov_never') })}</span>
    </p>
  );
}

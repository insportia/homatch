// The pipeline status of one lead: NEW → CONTACTED → QUALIFIED → VIEWING →
// NEGOTIATING → WON / LOST. The shown value changes only AFTER the update
// resolved; a failed save leaves the previous status in place.
import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { LEAD_STATUSES, type MetaLeadRow } from '@/services/metaAds';
import { SELECT_CLASS } from './format';

export const PIPELINE: readonly string[] = LEAD_STATUSES;

export function LeadStatusSelect({ lead, onChange }: {
  lead: MetaLeadRow;
  onChange: (status: string) => Promise<boolean>;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const legacy = !PIPELINE.includes(lead.status);
  return (
    <select
      className={SELECT_CLASS}
      value={lead.status}
      disabled={busy}
      aria-busy={busy}
      aria-label={t('mm_w_lead_change_status')}
      onClick={e => e.stopPropagation()}
      onChange={async e => {
        const next = e.target.value;
        if (next === lead.status) return;
        setBusy(true);
        try { await onChange(next); } finally { setBusy(false); }
      }}
    >
      {legacy && (
        <option value={lead.status} disabled>
          {t('mm_w_lead_legacy_status')}: {t(`mads_lead_${lead.status.toLowerCase()}`)}
        </option>
      )}
      {LEAD_STATUSES.map(s => <option key={s} value={s}>{t(`mm_w_lead_status_${s}`)}</option>)}
    </select>
  );
}

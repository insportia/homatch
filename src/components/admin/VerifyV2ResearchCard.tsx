// Admin → Providers: how V2 Verify research spends (admin_settings.verify_v2_research).
//
// Applies only to jobs stamped V2 (admin preview today); V1 and customers are
// untouched. Read once per job at creation and stamped, like the engine. Every
// value is validated again server-side by parseResearchTuning (an unknown or
// out-of-range value means "as V1"), and every save is one audited
// admin_set_setting write with a required reason.
import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getAdminSettings, updateAdminSetting } from '@/services/api';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import {
  parseResearchTuning, RESEARCH_STAGE_KEYS, VERIFY_V2_RESEARCH_SETTING_KEY, type ResearchStageKey, type ResearchTuning,
} from '@/verify/v2/researchRequest';

const STAGE_LABEL: Record<ResearchStageKey, string> = {
  identity: 'adm_v2r_stage_identity',
  official_collection: 'adm_v2r_stage_official',
  public_research: 'adm_v2r_stage_public',
  market: 'adm_v2r_stage_market',
};
const MODEL_OPTIONS = [['', 'adm_v2r_default'], ['gpt-5.6-luna', 'Luna'], ['gpt-5.6-terra', 'Terra']] as const; // labels: MODEL_NAME, or the i18n key
/* Model names: product names, the same in every language. */
const MODEL_NAME = { luna: 'Luna', terra: 'Terra' } as const;
const selectCls = 'h-9 rounded-md border border-input bg-background px-2 text-sm';

export function VerifyV2ResearchCard() {
  const { t } = useLanguage();
  const [tuning, setTuning] = useState<ResearchTuning>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const settings = await getAdminSettings();
      setTuning(parseResearchTuning(settings.find((s) => s.key === VERIFY_V2_RESEARCH_SETTING_KEY)?.value));
    } catch {
      /* an unreadable setting shows "as V1" */
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const setStage = (k: ResearchStageKey, patch: Record<string, unknown>) =>
    setTuning((cur) => {
      const next = { ...(cur[k] ?? {}), ...patch } as Record<string, unknown>;
      for (const key of Object.keys(next)) if (next[key] === '' || next[key] == null) delete next[key];
      return { ...cur, [k]: next };
    });
  const label = (k: string) => (k === 'Luna' || k === 'Terra' ? k : t(k));

  const save = async () => {
    setSaving(true);
    try {
      // What is stored is exactly what the server will read back.
      const value = parseResearchTuning(tuning);
      await updateAdminSetting(VERIFY_V2_RESEARCH_SETTING_KEY, value, reason.trim());
      setTuning(value);
      setReason('');
      toast.success(t('adm_v2r_saved'));
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('adm_v2r_title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-2xs text-muted-foreground">{t('adm_v2r_note')}</p>
        <div className="space-y-2">
          {RESEARCH_STAGE_KEYS.map((k) => (
            <div key={k} className="flex flex-wrap items-center gap-2" data-testid={`v2r-${k}`}>
              <span className="w-40 shrink-0 font-medium">{t(STAGE_LABEL[k])}</span>
              <select aria-label={`${t(STAGE_LABEL[k])} · ${t('adm_v2r_model')}`} className={selectCls} value={tuning[k]?.model ?? ''} onChange={(e) => setStage(k, { model: e.target.value })}>
                {MODEL_OPTIONS.map(([v, l]) => <option key={v} value={v}>{label(l)}</option>)}
              </select>
              <Input
                aria-label={`${t(STAGE_LABEL[k])} · ${t('adm_v2r_max_searches')}`}
                className="h-9 w-24"
                inputMode="numeric"
                placeholder={t('adm_v2r_max_searches')}
                value={tuning[k]?.maxSearches ?? ''}
                onChange={(e) => setStage(k, { maxSearches: e.target.value === '' ? '' : Number(e.target.value) })}
              />
              {k === 'market' ? (
                <select aria-label={t('adm_v2r_market_mode')} className={selectCls} value={tuning.market?.mode ?? ''} onChange={(e) => setStage('market', { mode: e.target.value })}>
                  <option value="">{t('adm_v2r_default')}</option>
                  <option value="AUTO">{t('adm_v2r_market_auto')}</option>
                  <option value="CODE">{t('adm_v2r_market_code')}</option>
                  <option value="AI">{t('adm_v2r_market_ai')}</option>
                </select>
              ) : null}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-40 shrink-0 font-medium">{t('adm_v2r_report')}</span>
          <select aria-label={t('adm_v2r_report')} className={selectCls} value={tuning.report?.policy ?? ''} onChange={(e) => setTuning((c) => ({ ...c, report: e.target.value ? { policy: e.target.value as 'AUTO' } : undefined }))}>
            <option value="">{t('adm_v2r_default')}</option>
            <option value="AUTO">{t('adm_v2r_report_auto')}</option>
            <option value="LUNA">{MODEL_NAME.luna}</option>
            <option value="TERRA">{MODEL_NAME.terra}</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-40 shrink-0 font-medium">{t('adm_v2r_budget')}</span>
          <Input aria-label={t('adm_v2r_ceiling')} className="h-9 w-28" inputMode="decimal" placeholder={t('adm_v2r_ceiling')} value={tuning.budget?.ceilingUsd ?? ''}
            onChange={(e) => setTuning((c) => ({ ...c, budget: { ...(c.budget ?? {}), ceilingUsd: e.target.value === '' ? undefined : Number(e.target.value) } }))} />
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={tuning.escalation?.enabled === true} onChange={(e) => setTuning((c) => ({ ...c, escalation: e.target.checked ? { enabled: true } : undefined }))} />
            {t('adm_v2r_escalation')}
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input className="h-9 min-w-0 flex-1" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('adm_engine_reason')} aria-label={t('adm_engine_reason')} />
          <Button size="sm" disabled={saving || reason.trim().length < 3} onClick={() => void save()}>{t('adm_v2r_save')}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

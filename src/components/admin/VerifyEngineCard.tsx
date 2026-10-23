// Admin → Providers: which Verify engine NEW jobs run on (V1 original / V2 code-first).
//
// One confirmed, audited write of admin_settings.verify_engine through
// admin_set_setting (actor, old/new value, reason, time in admin_audit_log).
// The server reads it once per new job and stamps the job, so running jobs keep
// their engine (src/verify/engine.ts). V2 cannot be chosen until the code-first
// engine is deployed (VERIFY_V2_AVAILABLE).
import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getAdminSettings, updateAdminSetting } from '@/services/api';
import { listAudit, type AuditRow } from '@/services/adminControl';
import { Confirm } from '@/components/admin/control/AdminKit';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import {
  parseEngineSetting, VERIFY_ENGINE_SETTING_KEY, VERIFY_V2_AVAILABLE, type VerifyEngine,
} from '@/verify/engine';

export function VerifyEngineCard() {
  const { t, lang } = useLanguage();
  const [active, setActive] = useState<VerifyEngine>('V1');
  const [history, setHistory] = useState<AuditRow[]>([]);
  const [target, setTarget] = useState<VerifyEngine | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const settings = await getAdminSettings();
      setActive(parseEngineSetting(settings.find((s) => s.key === VERIFY_ENGINE_SETTING_KEY)?.value).active);
      const audit = await listAudit({ action: 'SETTING_UPDATED' }, 100, 0);
      setHistory((audit?.rows ?? []).filter((r) => r.entity_id === VERIFY_ENGINE_SETTING_KEY).slice(0, 5));
    } catch {
      /* the card still shows V1 (the safe default) when settings cannot be read */
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const confirm = async () => {
    if (!target) return;
    setSaving(true);
    try {
      await updateAdminSetting(VERIFY_ENGINE_SETTING_KEY, { active: target }, reason.trim());
      setActive(target);
      toast.success(t('adm_engine_saved'));
      setTarget(null);
      setReason('');
      void load();
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === 'ka' ? 'ka-GE' : lang);
  const option = (engine: VerifyEngine, label: string) => {
    const unavailable = engine === 'V2' && !VERIFY_V2_AVAILABLE;
    return (
      <Button
        key={engine}
        size="sm"
        variant={active === engine ? 'default' : 'outline'}
        aria-pressed={active === engine}
        disabled={saving || active === engine || unavailable}
        onClick={() => setTarget(engine)}
      >
        {label}
      </Button>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('adm_engine_title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{t('adm_engine_active')}: {active}</Badge>
          {option('V1', t('adm_engine_v1'))}
          {option('V2', t('adm_engine_v2'))}
        </div>
        <p className="text-2xs text-muted-foreground">{t('adm_engine_new_jobs_only')}</p>
        {!VERIFY_V2_AVAILABLE ? <p className="text-2xs text-muted-foreground">{t('adm_engine_v2_unavailable')}</p> : null}
        {history.length ? (
          <ul className="space-y-1 text-2xs text-muted-foreground">
            {history.map((h) => {
              const m = (h.metadata ?? {}) as Record<string, any>;
              return (
                <li key={h.id} className="break-words">
                  {fmt(h.created_at)} · {h.admin?.email ?? h.admin_ref} · {parseEngineSetting(m.old).active} → {parseEngineSetting(m.new).active}
                  {m.reason ? ` · ${String(m.reason)}` : ''}
                </li>
              );
            })}
          </ul>
        ) : null}
      </CardContent>
      <Confirm
        open={target !== null}
        onOpenChange={(v) => { if (!v) { setTarget(null); setReason(''); } }}
        title={t('adm_engine_confirm_title', { engine: target ?? '' })}
        description={t('adm_engine_confirm_body')}
        confirmLabel={t('adm_engine_confirm')}
        onConfirm={() => void confirm()}
        busy={saving}
        confirmDisabled={reason.trim().length < 3}
      >
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('adm_engine_reason')} aria-label={t('adm_engine_reason')} />
      </Confirm>
    </Card>
  );
}

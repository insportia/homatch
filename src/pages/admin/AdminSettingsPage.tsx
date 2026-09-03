import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle, Save, Shield, RefreshCw, CheckCircle2 } from 'lucide-react';
import { getAdminSettings, updateAdminSetting } from '@/services/api';
import type { AdminSetting } from '@/types/types';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

// ── Setting groups ─────────────────────────────────────────────
const SETTING_GROUPS: { label: string; keys: string[]; danger?: boolean }[] = [
  {
    label: 'Provider Monthly Spend Caps (USD)',
    keys: ['spend_cap_global', 'spend_cap_dataforseo', 'spend_cap_apify', 'spend_cap_zenrows', 'spend_cap_scrapingbee', 'spend_cap_brightdata', 'spend_cap_openai'],
  },
  {
    label: 'Rate Limits',
    keys: ['rate_limit_imports_per_hour', 'rate_limit_matching_per_day', 'rate_limit_unlocks_per_hour'],
  },
  {
    label: 'System Limits',
    keys: ['max_photos_per_property', 'max_import_retries', 'circuit_breaker_threshold', 'cache_ttl_hours'],
  },
  {
    label: 'Production Safety',
    keys: ['mock_data_providers'],
    danger: true,
  },
];

// Friendly label + type per key
const KEY_META: Record<string, { label: string; type: 'number' | 'boolean' | 'text'; warn?: string }> = {
  spend_cap_global:              { label: 'Global hard ceiling (USD/month)', type: 'number' },
  spend_cap_dataforseo:          { label: 'DataForSEO cap (USD/month)', type: 'number' },
  spend_cap_apify:               { label: 'Apify cap (USD/month)', type: 'number' },
  spend_cap_zenrows:             { label: 'ZenRows cap (USD/month)', type: 'number' },
  spend_cap_scrapingbee:         { label: 'ScrapingBee cap (USD/month)', type: 'number' },
  spend_cap_brightdata:          { label: 'BrightData cap (USD/month)', type: 'number' },
  spend_cap_openai:              { label: 'OpenAI cap (USD/month)', type: 'number' },
  rate_limit_imports_per_hour:   { label: 'Max imports / user / hour', type: 'number' },
  rate_limit_matching_per_day:   { label: 'Max matching starts / user / day', type: 'number' },
  rate_limit_unlocks_per_hour:   { label: 'Max unlocks / user / hour', type: 'number' },
  max_photos_per_property:       { label: 'Max photos per property', type: 'number' },
  max_import_retries:            { label: 'Max provider retries per import', type: 'number' },
  circuit_breaker_threshold:     { label: 'Circuit-breaker consecutive failures', type: 'number' },
  cache_ttl_hours:               { label: 'Cache TTL (hours)', type: 'number' },
  mock_data_providers:           {
    label: 'Mock/demo data mode',
    type: 'boolean',
    warn: 'Must be OFF in production. Enabling this causes fake matches and disables real provider calls.',
  },
};

function parseSettingValue(raw: unknown): string {
  if (typeof raw === 'string') return raw.replace(/^"|"$/g, '');
  return String(raw ?? '');
}

function serializeSettingValue(val: string): string {
  return `"${val}"`;
}

export default function AdminSettingsPage() {
  const { t } = useLanguage();
  const [settings, setSettings] = useState<AdminSetting[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved]   = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    getAdminSettings().then(data => {
      setSettings(data);
      const d: Record<string, string> = {};
      for (const s of data) d[s.key] = parseSettingValue(s.value);
      setDraft(d);
    }).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleSave = async (key: string) => {
    setSaving(prev => ({ ...prev, [key]: true }));
    try {
      await updateAdminSetting(key, serializeSettingValue(draft[key] ?? ''));
      setSaved(prev => ({ ...prev, [key]: true }));
      setTimeout(() => setSaved(prev => ({ ...prev, [key]: false })), 2000);
      toast.success(`Saved: ${KEY_META[key]?.label ?? key}`);
    } catch {
      toast.error(`Failed to save ${key}`);
    } finally {
      setSaving(prev => ({ ...prev, [key]: false }));
    }
  };

  const settingMap = Object.fromEntries(settings.map(s => [s.key, s]));

  const isMockOn = draft['mock_data_providers'] === 'true';

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">{t('admin_settings_page_title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('admin_settings_subtitle')}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load} className="gap-1.5 text-muted-foreground">
          <RefreshCw className="h-3.5 w-3.5" /> {t('admin_refresh')}
        </Button>
      </div>

      {/* Production safety alert */}
      {isMockOn && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/8 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-destructive">{t('admin_settings_mock_mode_on')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('admin_settings_mock_mode_warning')}
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : (
        <div className="space-y-6">
          {SETTING_GROUPS.map(group => (
            <Card key={group.label} className={cn(group.danger && 'border-destructive/30')}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  {group.danger && <Shield className="h-4 w-4 text-destructive" />}
                  <CardTitle className="text-sm font-semibold">{group.label}</CardTitle>
                </div>
                {group.danger && (
                  <CardDescription className="text-xs text-destructive/80">
                    {t('admin_settings_danger_zone')}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {group.keys.map((key, idx) => {
                  const meta = KEY_META[key];
                  if (!meta) return null;
                  const setting = settingMap[key];
                  const val = draft[key] ?? '';
                  const isSaving = saving[key];
                  const isSaved  = saved[key];

                  return (
                    <div key={key}>
                      {idx > 0 && <Separator className="mb-4" />}
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0 space-y-1">
                          <Label className="text-sm font-medium leading-none">{meta.label}</Label>
                          {meta.warn && (
                            <p className="text-xs text-destructive/80">{meta.warn}</p>
                          )}
                          {setting?.description && !meta.warn && (
                            <p className="text-xs text-muted-foreground">{setting.description}</p>
                          )}
                        </div>

                        {meta.type === 'boolean' ? (
                          <div className="flex items-center gap-2 shrink-0">
                            <Switch
                              checked={val === 'true'}
                              onCheckedChange={async (checked) => {
                                const newVal = String(checked);
                                setDraft(prev => ({ ...prev, [key]: newVal }));
                                setSaving(prev => ({ ...prev, [key]: true }));
                                try {
                                  await updateAdminSetting(key, serializeSettingValue(newVal));
                                  setSaved(prev => ({ ...prev, [key]: true }));
                                  setTimeout(() => setSaved(prev => ({ ...prev, [key]: false })), 2000);
                                  toast.success(`${meta.label}: ${checked ? 'ON' : 'OFF'}`);
                                } catch {
                                  toast.error('Failed to save');
                                } finally {
                                  setSaving(prev => ({ ...prev, [key]: false }));
                                }
                              }}
                            />
                            <Badge
                              variant={val === 'true' ? 'destructive' : 'outline'}
                              className="text-[10px] px-1.5"
                            >
                              {val === 'true' ? 'ON' : 'OFF'}
                            </Badge>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 shrink-0">
                            <Input
                              type={meta.type === 'number' ? 'number' : 'text'}
                              value={val}
                              onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))}
                              className="w-28 h-8 text-sm"
                              min={0}
                            />
                            <Button
                              size="sm"
                              variant={isSaved ? 'outline' : 'default'}
                              className="h-8 w-8 p-0 shrink-0"
                              onClick={() => handleSave(key)}
                              disabled={isSaving}
                              title={t('general_save')}
                            >
                              {isSaved
                                ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                                : isSaving
                                  ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                  : <Save className="h-3.5 w-3.5" />}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {t('admin_settings_enforcement_note')}{' '}
        {t('admin_settings_storage_note', { table: 'admin_settings' })}
      </p>
    </div>
  );
}

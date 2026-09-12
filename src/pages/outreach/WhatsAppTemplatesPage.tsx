// HOMATCH — WhatsApp templates.
//
// §37. The single most important thing this screen does is refuse to imply
// that Homatch generating copy means Meta approving it. A template Homatch
// wrote is DRAFT. It becomes APPROVED when Meta says so, in a webhook or in a
// sync, and never because a button here was pressed.
//
// The preview is a plain, honest rendering of the message with its variables
// filled in. It deliberately does not copy WhatsApp's interface chrome.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, Plus, RefreshCw, Sparkles, Loader2 } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  PageHeader, LoadingBlock, EmptyState, ErrorState, StatusBadge, relativeTime,
} from '@/components/communications/primitives';
import { listTemplates, saveTemplate, syncWhatsApp } from '@/services/communications';
import type { CommTemplate } from '@/types/communications';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

const CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const;
const LANGUAGES = ['ka', 'en', 'ru', 'tr', 'ar', 'he'] as const;

export default function WhatsAppTemplatesPage() {
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();

  const [templates, setTemplates] = useState<CommTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<CommTemplate> | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { setTemplates(await listTemplates()); }
    catch { setError('comm_templates_load_failed'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onSync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await syncWhatsApp();
      toast[result.ok ? 'success' : 'error'](t(result.ok ? 'comm_templates_synced' : 'comm_templates_sync_failed'));
      if (result.ok) void load();
    } finally { setSyncing(false); }
  }, [load, t]);

  const onSave = useCallback(async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const saved = await saveTemplate(editing);
      if (!saved) { toast.error(t('comm_save_failed')); return; }
      toast.success(t('comm_template_saved'));
      setEditing(null);
      void load();
    } finally { setBusy(false); }
  }, [editing, load, t]);

  return (
    <RouteGuard>
      <AppLayout>
        <div className="mx-auto max-w-4xl space-y-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/outreach/whatsapp')}>
            <ArrowLeft className="me-1.5 h-3.5 w-3.5 rtl:rotate-180" />{t('comm_channel_whatsapp')}
          </Button>

          <PageHeader
            title={t('comm_templates_title')}
            subtitle={t('comm_templates_subtitle')}
            primary={{ label: t('comm_template_new'), onClick: () => setEditing({ language: 'ka', category: 'MARKETING' }) }}
            secondary={{ label: t('comm_sync_with_meta'), onClick: () => void onSync() }}
          >
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
          </PageHeader>

          <Alert>
            <AlertDescription className="text-xs">{t('comm_templates_approval_note')}</AlertDescription>
          </Alert>

          {error ? <ErrorState messageKey={error} onRetry={() => { setLoading(true); void load(); }} /> : null}

          {loading ? <LoadingBlock rows={4} /> : !templates.length ? (
            <EmptyState
              icon={FileText}
              titleKey="comm_templates_empty"
              bodyKey="comm_templates_empty_body"
              action={{ labelKey: 'comm_template_new', onClick: () => setEditing({ language: 'ka', category: 'MARKETING' }) }}
              secondary={{ labelKey: 'comm_sync_with_meta', onClick: () => void onSync() }}
            />
          ) : (
            <ul className="space-y-2">
              {templates.map((tpl) => (
                <li key={tpl.id}>
                  <Card>
                    <CardContent className="p-3.5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-mono text-xs font-medium">{tpl.name}</span>
                            <Badge variant="outline" className="text-[13px] uppercase">{tpl.language}</Badge>
                            <Badge variant="outline" className="text-[13px]">{tpl.category}</Badge>
                            <StatusBadge status={tpl.status} />
                          </p>
                          <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">{tpl.body_text}</p>
                          {tpl.rejection_reason ? (
                            <p className="mt-1 text-[13px] text-red-500">{tpl.rejection_reason}</p>
                          ) : null}
                        </div>
                        <Button
                          size="sm" variant="outline"
                          // An APPROVED template cannot be edited in place —
                          // Meta approved specific text, and changing it here
                          // would leave the row claiming an approval for words
                          // Meta never saw.
                          disabled={tpl.status === 'APPROVED'}
                          onClick={() => setEditing(tpl)}
                        >
                          {t(tpl.status === 'APPROVED' ? 'comm_locked' : 'comm_edit')}
                        </Button>
                      </div>
                      <p className="mt-2 text-[13px] text-muted-foreground">
                        {tpl.last_synced_at
                          ? t('comm_template_synced').replace('{when}', relativeTime(tpl.last_synced_at, language))
                          : t('comm_template_never_synced')}
                      </p>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>

        <TemplateEditor
          value={editing}
          onChange={setEditing}
          onSave={() => void onSave()}
          busy={busy}
        />
      </AppLayout>
    </RouteGuard>
  );
}

function TemplateEditor({
  value, onChange, onSave, busy,
}: {
  value: Partial<CommTemplate> | null;
  onChange: (v: Partial<CommTemplate> | null) => void;
  onSave: () => void;
  busy: boolean;
}) {
  const { t } = useLanguage();

  // Every hook runs on every render. The early return below used to sit above
  // this one, which is a rules-of-hooks violation: the hook order changed
  // between "no template open" and "a template open", and React's state would
  // have been read from the wrong slot.
  const variables = useMemo(() => {
    const found = new Set<string>();
    for (const m of String(value?.body_text ?? '').matchAll(/\{\{(\d+)\}\}/g)) found.add(m[1]);
    return [...found].sort((a, b) => Number(a) - Number(b));
  }, [value?.body_text]);

  if (!value) return null;

  // Meta rejects templates whose body starts or ends with a variable. Warning
  // here saves a rejection round trip that takes hours.
  const body = String(value.body_text ?? '').trim();
  const edgeVariable = /^\{\{\d+\}\}/.test(body) || /\{\{\d+\}\}$/.test(body);

  return (
    <Dialog open onOpenChange={(open) => !open && onChange(null)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{value.id ? t('comm_edit') : t('comm_template_new')}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-[1fr_240px]">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('comm_template_name')}</Label>
              <Input
                value={value.name ?? ''}
                // Meta requires lowercase letters, digits and underscores.
                onChange={(e) => onChange({ ...value, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 60) })}
                className="h-8 font-mono text-xs"
              />
              <p className="text-[13px] text-muted-foreground">{t('comm_template_name_hint')}</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('comm_agent_languages')}</Label>
                <Select value={value.language ?? 'ka'} onValueChange={(v) => onChange({ ...value, language: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l.toUpperCase()}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('comm_template_category')}</Label>
                <Select
                  value={value.category ?? 'MARKETING'}
                  onValueChange={(v) => onChange({ ...value, category: v as CommTemplate['category'] })}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t('comm_template_body')}</Label>
              <Textarea
                value={value.body_text ?? ''}
                onChange={(e) => onChange({ ...value, body_text: e.target.value })}
                rows={6} maxLength={1024} className="text-sm"
              />
              <p className="text-[13px] text-muted-foreground">{t('comm_template_body_hint')}</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t('comm_template_footer')}</Label>
              <Input
                value={value.footer_text ?? ''}
                onChange={(e) => onChange({ ...value, footer_text: e.target.value.slice(0, 60) })}
                className="h-8 text-xs" maxLength={60}
              />
            </div>

            {edgeVariable ? (
              <Alert variant="destructive">
                <AlertDescription className="text-[13px]">{t('comm_template_edge_variable')}</AlertDescription>
              </Alert>
            ) : null}
          </div>

          {/* An honest preview: the message as it will read, without borrowing
              WhatsApp's own interface design. */}
          <div className="space-y-2">
            <Label className="text-xs">{t('comm_template_preview')}</Label>
            <div className="rounded-lg border bg-muted/40 p-3">
              <div className="rounded-lg bg-background p-2.5 shadow-sm">
                {value.header_text ? <p className="mb-1 text-xs font-semibold">{value.header_text}</p> : null}
                <p className="whitespace-pre-wrap text-xs">
                  {String(value.body_text ?? t('comm_template_preview_empty'))
                    .replace(/\{\{(\d+)\}\}/g, (_, n) => `[${t('comm_template_variable')} ${n}]`)}
                </p>
                {value.footer_text ? (
                  <p className="mt-1.5 text-[13px] text-muted-foreground">{value.footer_text}</p>
                ) : null}
              </div>
            </div>
            {variables.length ? (
              <p className="text-[13px] text-muted-foreground">
                {t('comm_template_variables_found').replace('{n}', String(variables.length))}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onChange(null)}>{t('comm_cancel')}</Button>
          <Button size="sm" onClick={onSave} disabled={busy || !value.name || !value.body_text}>
            {busy ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {t('comm_save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

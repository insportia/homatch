// EMAIL STUDIO — design version history. The server keeps a snapshot of the design document at most
// every two minutes while the author works, plus one for every "save version" and every restore
// (email_design_versions, newest 50 per campaign). Restoring puts that version on the canvas as a
// new edit (undo brings the current one back) and records a RESTORE snapshot on save.

import { History, Loader2, RotateCcw } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { type EmailDoc, normalizeDoc } from '@/emailMarketing/designer/document';
import { renderDesignBody } from '@/emailMarketing/designer/render';
import { cn } from '@/lib/utils';
import { type DesignVersion, listDesignVersions } from '@/services/emailCampaignStudio';

export function VersionHistory({ campaignId, open, onOpenChange, onRestore, rtl }: {
  campaignId: string | null; open: boolean; onOpenChange: (o: boolean) => void; onRestore: (doc: EmailDoc) => void; rtl: boolean;
}) {
  const { t, lang } = useLanguage();
  const [versions, setVersions] = useState<DesignVersion[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pick, setPick] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !campaignId) return;
    setVersions(null); setFailed(false); setPick(null);
    listDesignVersions(campaignId).then((v) => { setVersions(v); setPick(v[0]?.id ?? null); }).catch(() => setFailed(true));
  }, [open, campaignId]);

  const chosen = versions?.find((v) => v.id === pick) ?? null;
  const preview = useMemo(() => (chosen ? `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#F6F3EE"><div style="max-width:600px;margin:12px auto;background:#fff">${renderDesignBody(normalizeDoc(chosen.design), { rtl, draft: true }).html}</div></body>` : ''), [chosen, rtl]);
  const when = (iso: string) => new Date(iso).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-4 w-4" />{t('ems_b_history')}</DialogTitle>
          <DialogDescription>{t('ems_b_history_sub')}</DialogDescription>
        </DialogHeader>
        {!campaignId ? <p className="text-sm text-muted-foreground">{t('ems_b_history_unsaved')}</p>
          : failed ? <p className="text-sm text-red-700">{t('ems_b_history_failed')}</p>
          : versions === null ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
          : versions.length === 0 ? <p className="text-sm text-muted-foreground">{t('ems_b_history_empty')}</p>
          : (
            <div className="grid min-h-0 gap-3 md:grid-cols-[15rem_minmax(0,1fr)]">
              <ul className="max-h-[60dvh] space-y-1 overflow-y-auto pe-1">
                {versions.map((v) => (
                  <li key={v.id}>
                    <button type="button" onClick={() => setPick(v.id)} aria-pressed={pick === v.id}
                      className={cn('w-full rounded-lg border px-2.5 py-2 text-start text-xs', pick === v.id ? 'border-[hsl(38_70%_55%)] bg-[hsl(38_90%_96%)]' : 'hover:bg-muted')}>
                      <span className="block font-medium">{when(v.created_at)}</span>
                      <span className="block text-2xs text-muted-foreground">{t(`ems_b_version_${v.reason.toLowerCase()}`)}{v.subject ? ` · ${v.subject}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="min-w-0 space-y-2">
                <iframe title={t('ems_b_history')} sandbox="" srcDoc={preview} className="h-[52dvh] w-full rounded-lg border bg-white" />
                <div className="flex justify-end">
                  <Button type="button" className="gap-1.5" disabled={!chosen} onClick={() => { if (chosen) { onRestore(normalizeDoc(chosen.design)); onOpenChange(false); } }}>
                    <RotateCcw className="h-4 w-4" />{t('ems_b_restore')}
                  </Button>
                </div>
              </div>
            </div>
          )}
      </DialogContent>
    </Dialog>
  );
}

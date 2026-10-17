// CLEAR OLD RESULTS (owner, 2026-10-17) — owner-scoped, behind an explicit confirmation.
//
// Opening the dialog only READS what would be cleared (find_buyers_clear_results_preview);
// nothing changes until the owner presses the confirm button (find_buyers_clear_results).
// Only completed searches' results are hidden; contacts already opened (UNLOCKED legacy
// matches) stay available; the property, a running search and its
// results, credits / charges / payments and the search history and audit are never touched.
// A server without the RPCs (not deployed yet) says so and offers nothing to confirm.

import React, { useEffect, useState } from 'react';
import { CheckCircle2, Eraser, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { clearOldResults, getClearResultsPreview, type ClearOutcome, type ClearPreview } from '@/services/findBuyersLeads';
import { DASH_BTN } from '@/components/findBuyers/FindBuyersDashboard';

type Phase = 'loading' | 'ready' | 'unavailable' | 'clearing' | 'failed';

export function ClearResultsDialog({ open, propertyId, onClose, onCleared }: {
  open: boolean;
  propertyId: string;
  onClose: () => void;
  onCleared: (outcome: ClearOutcome) => void;
}) {
  const { t } = useLanguage();
  const [phase, setPhase] = useState<Phase>('loading');
  const [preview, setPreview] = useState<ClearPreview | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setPhase('loading');
    setPreview(null);
    getClearResultsPreview(propertyId).then((p) => {
      if (!alive) return;
      setPreview(p);
      setPhase(p ? 'ready' : 'unavailable');
    });
    return () => { alive = false; };
  }, [open, propertyId]);

  const nothing = preview ? preview.leads + preview.legacyMatches === 0 : true;
  const busy = phase === 'clearing';
  const confirm = async () => {
    setPhase('clearing');
    const outcome = await clearOldResults(propertyId);
    if (!outcome) { setPhase('failed'); return; }
    onCleared(outcome);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[90dvh] max-w-[calc(100%-2rem)] overflow-y-auto bg-white sm:max-w-md [&>*]:min-w-0" data-testid="fbd-clear-dialog">
        <DialogHeader>
          <span className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(218_52%_11%)] text-[hsl(40_94%_64%)]">
            <Eraser className="h-5 w-5" aria-hidden="true" />
          </span>
          <DialogTitle className="break-words font-display text-lg text-[hsl(218_45%_14%)]">{t('fbrx_clear_title')}</DialogTitle>
          <DialogDescription className="break-words text-sm leading-relaxed text-[hsl(218_28%_30%)]">{t('fbrx_clear_body')}</DialogDescription>
        </DialogHeader>

        {phase === 'loading' ? (
          <p className="flex items-center gap-2 py-4 text-sm text-[hsl(218_28%_38%)]" role="status" data-testid="fbd-clear-loading">
            <Loader2 className="h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />{t('fbrx_clear_loading')}
          </p>
        ) : phase === 'unavailable' ? (
          <p role="alert" className="rounded-xl bg-[hsl(42_100%_96%)] px-3 py-3 text-sm text-[hsl(218_45%_14%)]" data-testid="fbd-clear-unavailable">{t('fbrx_clear_unavailable')}</p>
        ) : (
          <div className="space-y-3">
            <dl className="divide-y divide-[hsl(40_30%_88%)] rounded-xl ring-1 ring-inset ring-[hsl(40_50%_84%)]" data-testid="fbd-clear-preview">
              <div className="px-3 py-2.5 text-sm" data-testid="fbd-clear-leads" data-n={preview?.leads ?? 0}>
                {t('fbrx_clear_count_leads', { n: String(preview?.leads ?? 0) })}
              </div>
              <div className="px-3 py-2.5 text-sm" data-testid="fbd-clear-matches" data-n={preview?.legacyMatches ?? 0}>
                {t('fbrx_clear_count_matches', { n: String(preview?.legacyMatches ?? 0) })}
              </div>
            </dl>
            {(preview?.legacyUnlockedKept ?? 0) > 0 && (
              <p className="rounded-xl bg-[hsl(150_45%_96%)] px-3 py-2 text-xs leading-relaxed text-[hsl(218_45%_14%)]" data-testid="fbd-clear-unlocked-kept" data-n={preview?.legacyUnlockedKept}>
                {t('fbrx_clear_unlocked_kept', { n: String(preview?.legacyUnlockedKept ?? 0) })}
              </p>
            )}
            {preview?.activeCampaign && (
              <p className="rounded-xl bg-[hsl(42_100%_96%)] px-3 py-2 text-xs leading-relaxed text-[hsl(218_45%_14%)]" data-testid="fbd-clear-active">{t('fbrx_clear_active_note')}</p>
            )}
            <div>
              <p className="text-2xs font-bold uppercase tracking-[0.12em] text-[hsl(34_90%_32%)]">{t('fbrx_clear_kept_title')}</p>
              <ul className="mt-1.5 space-y-1 text-xs text-[hsl(218_28%_30%)]" data-testid="fbd-clear-kept">
                {['fbrx_clear_kept_property', 'fbrx_clear_kept_active', 'fbrx_clear_kept_credits', 'fbrx_clear_kept_history'].map((k) => (
                  <li key={k} className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(150_45%_30%)]" aria-hidden="true" /><span className="min-w-0 break-words">{t(k)}</span></li>
                ))}
              </ul>
            </div>
            {nothing && <p className="text-sm text-[hsl(218_28%_38%)]" data-testid="fbd-clear-nothing">{t('fbrx_clear_nothing')}</p>}
            {phase === 'failed' && <p role="alert" className="rounded-lg bg-[hsl(0_60%_97%)] px-3 py-2 text-sm text-[hsl(0_55%_34%)]" data-testid="fbd-clear-failed">{t('fbrx_clear_failed')}</p>}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 min-[420px]:flex-row min-[420px]:justify-end">
          <button type="button" onClick={onClose} disabled={busy} data-testid="fbd-clear-cancel"
            className={cn(DASH_BTN, 'bg-white text-[hsl(218_45%_14%)] ring-1 ring-inset ring-[hsl(40_60%_76%)]')}>
            <span className="min-w-0 break-words">{t('fbrx_clear_cancel')}</span>
          </button>
          {phase !== 'unavailable' && phase !== 'loading' && (
            <button type="button" onClick={() => void confirm()} disabled={busy || nothing} data-testid="fbd-clear-confirm"
              className={cn(DASH_BTN, 'bg-[hsl(218_52%_11%)] text-white')}>
              {busy ? <Loader2 className="h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" /> : <Eraser className="h-4 w-4 shrink-0" aria-hidden="true" />}
              <span className="min-w-0 break-words">{t('fbrx_clear_confirm')}</span>
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ClearResultsDialog;

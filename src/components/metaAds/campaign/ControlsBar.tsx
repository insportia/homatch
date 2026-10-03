// Pause / Resume / End (confirm first) and Edit budget / duration. Every
// write is WRITE-THROUGH: while the call is in flight the page says "Waiting
// for Meta to confirm…", and success appears only after the promise resolved.
// Stopping spend (pause, end) stays available during a review or suspension;
// resuming and edits do not, and say why.
import React, { useRef, useState } from 'react';
import { CalendarDays, Loader2, Pause, Play, Square, Wallet } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { pauseCampaignConfirmed, resumeCampaignConfirmed, endCampaign, type CampaignDetail } from '@/services/metaAds';
import { errorText, type Fmt, type T } from './shared';

export const LIVE_STATUSES = ['SUBMITTED', 'META_REVIEW', 'ACTIVE', 'PAUSED'];
type Kind = 'pause' | 'resume' | 'end';

export function ControlsBar({ t, fmt, d, onChanged, onEditBudget, onEditDuration }: {
  t: T; fmt: Fmt; d: CampaignDetail; onChanged: () => void; onEditBudget: () => void; onEditDuration: () => void;
}) {
  const c = d.campaign;
  const [confirm, setConfirm] = useState<Kind | null>(null);
  const [pending, setPending] = useState<Kind | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const keyRef = useRef<string>('');

  if (!LIVE_STATUSES.includes(c.status)) return null;

  const locked = c.guard_state === 'LOCKED_FOR_REVIEW' || d.guard?.campaignState === 'LOCKED_FOR_REVIEW';
  const suspended = d.guard?.account?.status === 'SUSPENDED';
  const restricted = locked || suspended;
  const reason = suspended ? t('mm_c_suspended_reason') : locked ? t('mm_c_locked_reason') : null;

  const ask = (k: Kind) => {
    keyRef.current = crypto.randomUUID();   // one key per confirmation: a double click commits once
    setStatus(null);
    setConfirm(k);
  };

  async function run(kind: Kind) {
    setPending(kind);
    setStatus(null);
    try {
      if (kind === 'pause') await pauseCampaignConfirmed(c.id, keyRef.current);
      else if (kind === 'resume') await resumeCampaignConfirmed(c.id, keyRef.current);
      else await endCampaign(c.id, keyRef.current);
      // Reached only after Meta confirmed and the promise resolved.
      setStatus({ ok: true, text: t(`mm_c_done_${kind}`) });
    } catch (e) {
      setStatus({ ok: false, text: errorText(t, e, fmt) });
    } finally {
      setPending(null);
      setConfirm(null);
      onChanged();
    }
  }

  const btn = 'inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3.5 text-2xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-border))] disabled:cursor-not-allowed disabled:opacity-55';
  const quiet = `${btn} border border-border bg-card text-foreground hover:bg-[hsl(var(--secondary))]`;
  const gold = `${btn} bg-[hsl(38_92%_54%)] font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)]`;
  const busy = pending !== null;

  return (
    <div className="rounded-2xl border border-border bg-card px-3 py-3 shadow-card sm:px-4" data-mm-controls="">
      <div role="group" aria-label={t('mm_c_controls_label')} className="flex flex-wrap items-center gap-2">
        {c.status === 'PAUSED' ? (
          <button type="button" className={gold} disabled={busy || restricted} onClick={() => ask('resume')}
            aria-describedby={restricted ? 'mm-controls-reason' : undefined}>
            <Play className="h-3.5 w-3.5" aria-hidden="true" />{t('mm_c_resume')}
          </button>
        ) : (
          <button type="button" className={quiet} disabled={busy} onClick={() => ask('pause')}>
            <Pause className="h-3.5 w-3.5" aria-hidden="true" />{t('mm_c_pause')}
          </button>
        )}
        <button type="button" className={quiet} disabled={busy || restricted} onClick={onEditBudget}
          aria-describedby={restricted ? 'mm-controls-reason' : undefined}>
          <Wallet className="h-3.5 w-3.5" aria-hidden="true" />{t('mm_c_edit_budget')}
        </button>
        <button type="button" className={quiet} disabled={busy || restricted} onClick={onEditDuration}
          aria-describedby={restricted ? 'mm-controls-reason' : undefined}>
          <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />{t('mm_c_edit_duration')}
        </button>
        <button type="button" className={`${quiet} sm:ms-auto`} disabled={busy} onClick={() => ask('end')}>
          <Square className="h-3.5 w-3.5" aria-hidden="true" />{t('mm_c_end')}
        </button>
      </div>
      {reason && <p id="mm-controls-reason" className="mt-2 text-2xs leading-relaxed text-muted-foreground">{reason}</p>}
      <p aria-live="polite" role="status" className="mt-2 text-[13px] empty:hidden" data-mm-write-status="">
        {pending ? <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{t('mm_c_waiting_meta')}</span>
          : status ? <span className={status.ok ? 'text-[hsl(152_54%_30%)]' : 'text-destructive'}>{status.text}</span> : null}
      </p>

      <Dialog open={confirm !== null} onOpenChange={(o) => { if (!o && !busy) setConfirm(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-2xl">
          {confirm && (
            <>
              <DialogHeader className="pr-10">
                <DialogTitle>{t(`mm_c_confirm_${confirm}_title`)}</DialogTitle>
                <DialogDescription>{t(`mm_c_confirm_${confirm}_body`)}</DialogDescription>
              </DialogHeader>
              {pending && (
                <p aria-live="polite" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{t('mm_c_waiting_meta')}
                </p>
              )}
              <DialogFooter className="gap-2 sm:gap-2">
                <button type="button" className={quiet} disabled={busy} onClick={() => setConfirm(null)}>{t('mm_c_cancel')}</button>
                <button type="button" className={gold} disabled={busy} onClick={() => run(confirm)}>
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}{t('mm_c_confirm')}
                </button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

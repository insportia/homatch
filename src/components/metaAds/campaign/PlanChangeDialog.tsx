// Edit budget / duration: PREVIEW FIRST, then commit. The preview shows the
// financial delta — additional service fee reserved from the HOMATCH Balance,
// or the amount released to it — and a shortfall offers Add funds. The commit
// is write-through: success is shown only after Meta confirmed.
import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  previewBudget, commitBudget, previewDuration, commitDuration, depositCheckout, type PlanChangePreview,
} from '@/services/metaAds';
import { errorText, type Fmt, type T } from './shared';

export interface PlanChangeProps {
  t: T; fmt: Fmt; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void;
  campaign: { id: string; daily_budget_cents: number | null; duration_days: number | null };
}

export function PlanChangeDialog({ kind, t, fmt, open, onOpenChange, onDone, campaign }: PlanChangeProps & { kind: 'budget' | 'duration' }) {
  const initial = kind === 'budget'
    ? (campaign.daily_budget_cents != null ? String(campaign.daily_budget_cents / 100) : '')
    : (campaign.duration_days != null ? String(campaign.duration_days) : '');
  const [value, setValue] = useState(initial);
  const [preview, setPreview] = useState<PlanChangePreview | null>(null);
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'previewing' | 'committing' | 'funding'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    if (open) { setValue(initial); setPreview(null); setPreviewFor(null); setError(null); setDone(null); setPhase('idle'); keyRef.current = null; }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = (() => {
    const n = Number(value.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return null;
    return kind === 'budget' ? Math.round(n * 100) : Math.round(n);
  })();
  const fresh = preview != null && previewFor === value;

  async function runPreview() {
    if (parsed == null) return;
    setPhase('previewing'); setError(null); setDone(null);
    try {
      const r = kind === 'budget' ? await previewBudget(campaign.id, parsed) : await previewDuration(campaign.id, parsed);
      setPreview(r.preview); setPreviewFor(value);
      // One idempotency key per previewed change: a double click commits once.
      keyRef.current = crypto.randomUUID();
    } catch (e) {
      setPreview(null); setError(errorText(t, e, fmt));
    } finally { setPhase('idle'); }
  }

  async function commit() {
    if (!fresh || !preview || preview.shortfallCents > 0 || parsed == null || !keyRef.current) return;
    setPhase('committing'); setError(null); setDone(null);
    try {
      if (kind === 'budget') await commitBudget(campaign.id, parsed, keyRef.current);
      else await commitDuration(campaign.id, parsed, keyRef.current);
      // Only now — Meta confirmed and the promise resolved.
      setDone(t(kind === 'budget' ? 'mm_c_done_budget' : 'mm_c_done_duration'));
      onDone();
    } catch (e) {
      setError(errorText(t, e, fmt));
      keyRef.current = crypto.randomUUID();
    } finally { setPhase('idle'); }
  }

  async function addFunds() {
    if (!preview?.shortfallCents) return;
    setPhase('funding');
    try {
      const { url } = await depositCheckout(preview.shortfallCents);
      window.location.assign(url);
    } catch (e) {
      setError(errorText(t, e, fmt)); setPhase('idle');
    }
  }

  const busy = phase !== 'idle';
  const label = kind === 'budget' ? t('mm_c_budget_label', { currency: fmt.currency }) : t('mm_c_duration_label');
  const inputId = `mm-plan-${kind}`;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader className="pr-10">
          <DialogTitle>{t(kind === 'budget' ? 'mm_c_budget_title' : 'mm_c_duration_title')}</DialogTitle>
          <DialogDescription>{t('mm_c_budget_lead')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor={inputId} className="mb-1 block text-[13px] font-semibold text-foreground">{label}</label>
            <div className="flex gap-2">
              <Input id={inputId} inputMode={kind === 'budget' ? 'decimal' : 'numeric'} dir="ltr" value={value}
                onChange={(e) => setValue(e.target.value)} aria-invalid={value !== '' && parsed == null} className="min-w-0 flex-1" />
              <button type="button" onClick={runPreview} disabled={busy || parsed == null}
                className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-2xs font-semibold text-foreground hover:bg-[hsl(var(--secondary))] disabled:opacity-60">
                {phase === 'previewing' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                {phase === 'previewing' ? t('mm_c_previewing') : t('mm_c_preview')}
              </button>
            </div>
            {kind === 'duration' && preview?.minDays != null && (
              <p className="mt-1 text-2xs text-muted-foreground">{t('mm_c_pv_min_days', { days: preview.minDays })}</p>
            )}
          </div>

          {preview && (
            <div className={`rounded-xl border border-border p-3 text-[13px] ${fresh ? '' : 'opacity-60'}`} data-mm-plan-preview="">
              <dl className="space-y-1">
                <Row label={t('mm_c_pv_daily')} value={<><bdi>{fmt.money(preview.currentDailyCents)}</bdi> → <bdi>{fmt.money(preview.newDailyCents)}</bdi></>} />
                <Row label={t('mm_c_pv_days')} value={<><bdi>{t('mm_c_pv_days_value', { days: preview.currentDays })}</bdi> → <bdi>{t('mm_c_pv_days_value', { days: preview.newDays })}</bdi></>} />
                <Row label={t('mm_c_pv_fee')} value={`${fmt.num(preview.feePercent, 2)}%`} />
                <Row label={t('mm_c_pv_held')} value={fmt.money(preview.heldFeeCents)} />
                <Row label={t('mm_c_pv_required')} value={fmt.money(preview.requiredFeeCents)} />
                <Row label={t('mm_c_pv_available')} value={fmt.money(preview.availableCents)} />
              </dl>
              <p className="mt-2 font-semibold text-foreground">
                {preview.additionalCents > 0 ? t('mm_c_pv_additional', { amount: fmt.money(preview.additionalCents) })
                  : preview.releaseCents > 0 ? t('mm_c_pv_release', { amount: fmt.money(preview.releaseCents) })
                    : t('mm_c_pv_nochange')}
              </p>
              {preview.shortfallCents > 0 && (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-3 py-2 text-[hsl(var(--gold-ink))]">
                  <span>{t('mm_c_pv_shortfall', { amount: fmt.money(preview.shortfallCents) })}</span>
                  <button type="button" onClick={addFunds} disabled={busy}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[hsl(38_92%_54%)] px-3 text-2xs font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)]">
                    {phase === 'funding' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}{t('mm_c_add_funds')}
                  </button>
                </div>
              )}
              {!fresh && <p className="mt-2 text-2xs text-muted-foreground">{t('mm_c_pv_stale')}</p>}
            </div>
          )}

          <p aria-live="polite" className="text-[13px] empty:hidden">
            {phase === 'committing' ? <span className="text-muted-foreground">{t('mm_c_waiting_meta')}</span>
              : done ? <span className="text-[hsl(152_54%_30%)]">{done}</span>
                : error ? <span className="text-destructive">{error}</span> : null}
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <button type="button" onClick={() => onOpenChange(false)} disabled={busy}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border px-3.5 text-2xs font-medium text-foreground hover:bg-[hsl(var(--secondary))]">
            {done ? t('mm_c_close') : t('mm_c_cancel')}
          </button>
          {!done && (
            <button type="button" onClick={commit} disabled={busy || !fresh || (preview?.shortfallCents ?? 0) > 0}
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-[hsl(38_92%_54%)] px-3.5 text-2xs font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)] disabled:opacity-60">
              {phase === 'committing' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}{t('mm_c_apply_change')}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* Each amount is its own bidi isolate: an he/ar currency string carries RLM marks
   that otherwise scramble "a → b" inside the LTR cell. */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end tabular-nums text-foreground" dir="ltr">{value}</dd>
    </div>
  );
}

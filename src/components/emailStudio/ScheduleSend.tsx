/*
 * EMAIL STUDIO — schedule the reviewed campaign (Find Buyers 2.0, owner 2026-10-18).
 *
 * The owner picks a date and time in their own timezone (shown), at least five minutes and at
 * most ninety days ahead. What is scheduled is the exact REVIEWED version: jobs-worker hands it
 * to the same send path as "Send" at that time, where consent, unsubscribes, suppression, the
 * daily cap and the sending switch are re-checked. A refusal at that moment (sending off, a
 * provider problem) is shown here and the schedule ends — it is never silently re-armed.
 */

import { CalendarClock, Loader2, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { isoToLocalInput, localInputToIso } from '@/crm/model';
import { cn } from '@/lib/utils';
import { emailStudio, type CampaignSchedule } from '@/services/emailStudio';
import { intlLocaleFor } from '@/components/workspace/primitives';

const BTN = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)] disabled:cursor-not-allowed disabled:opacity-60';

export function ScheduleSend({ campaignId, canSchedule, onChanged }: { campaignId: string | null; canSchedule: boolean; onChanged?: () => void }) {
  const { t, lang } = useLanguage();
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } })();
  const [schedule, setSchedule] = useState<CampaignSchedule | null>(null);
  const [at, setAt] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let on = true;
    setSchedule(null);
    if (campaignId) emailStudio.scheduleOf(campaignId).then((s) => { if (on) setSchedule(s); }).catch(() => undefined);
    return () => { on = false; };
  }, [campaignId]);

  const iso = localInputToIso(at);
  const tooSoon = iso !== null && Date.parse(iso) < Date.now() + 5 * 60_000;
  const tooLate = iso !== null && Date.parse(iso) > Date.now() + 90 * 86_400_000;
  const fmt = (v: string) => {
    try { return new Intl.DateTimeFormat(intlLocaleFor(lang), { dateStyle: 'medium', timeStyle: 'short', timeZone: schedule?.timezone ?? undefined }).format(new Date(v)); } catch { return v; }
  };

  const apply = async (value: string | null) => {
    if (!campaignId) return;
    setBusy(true);
    try {
      await emailStudio.schedule(campaignId, value, tz);
      setSchedule(await emailStudio.scheduleOf(campaignId));
      setAt('');
      toast.success(t(value ? 'es_schedule_saved' : 'es_schedule_cancelled'));
      onChanged?.();
    } catch (e) {
      toast.error(t(String((e as Error)?.message ?? '').includes('NOT_REVIEWED') ? 'es_schedule_needs_review' : String((e as Error)?.message ?? '').includes('INVALID_TIME') ? 'es_schedule_invalid' : 'es_state_error'));
    } finally {
      setBusy(false);
    }
  };

  const active = schedule?.scheduledAt && (schedule.state === 'SCHEDULED' || schedule.state === 'SENDING');
  const refused = schedule?.state && !['SCHEDULED', 'SENDING', 'SENT', 'CANCELLED'].includes(schedule.state);

  return (
    <div className="mt-4 rounded-2xl border border-[hsl(40_30%_84%)] bg-white p-4" data-testid="es-schedule">
      <p className="flex items-center gap-2 text-sm font-semibold text-[hsl(218_45%_14%)]">
        <CalendarClock className="h-4 w-4 text-[hsl(34_90%_36%)]" aria-hidden="true" />{t('es_schedule_title')}
      </p>
      {active ? (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[hsl(218_28%_30%)]" data-testid="es-schedule-active">
            {t('es_schedule_active', { date: fmt(schedule!.scheduledAt!), tz: schedule?.timezone ?? '' })}
          </p>
          <button type="button" className={cn(BTN, 'bg-white text-[hsl(218_45%_14%)] ring-1 ring-inset ring-[hsl(40_30%_78%)]')} onClick={() => void apply(null)} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}{t('es_schedule_cancel')}
          </button>
        </div>
      ) : (
        <>
          {refused ? <p className="mt-2 text-sm text-[hsl(0_55%_36%)]" data-testid="es-schedule-refused">{t('es_schedule_refused', { state: t(`es_sched_state_${schedule!.state}`) })}</p> : null}
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="grid min-w-0 flex-1 gap-1 text-xs font-semibold text-[hsl(218_28%_30%)]">
              <span>{t('es_schedule_when', { tz: tz ?? '' })}</span>
              <input type="datetime-local" className="h-11 min-w-0 rounded-xl border border-[hsl(40_30%_80%)] bg-white px-3 text-sm" value={at}
                onChange={(e) => setAt(e.target.value)} disabled={!canSchedule || busy} min={isoToLocalInput(new Date(Date.now() + 6 * 60_000).toISOString())}
                aria-invalid={tooSoon || tooLate || undefined} />
            </label>
            <button type="button" className={cn(BTN, 'bg-[hsl(218_52%_11%)] text-white')} onClick={() => void apply(iso)}
              disabled={!canSchedule || busy || !iso || tooSoon || tooLate} data-testid="es-schedule-save">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CalendarClock className="h-4 w-4" aria-hidden="true" />}{t('es_schedule_save')}
            </button>
          </div>
          {tooSoon ? <p className="mt-1 text-2xs text-[hsl(0_55%_38%)]">{t('es_schedule_too_soon')}</p> : null}
          {tooLate ? <p className="mt-1 text-2xs text-[hsl(0_55%_38%)]">{t('es_schedule_too_late')}</p> : null}
          {!canSchedule ? <p className="mt-1 text-2xs text-[hsl(218_15%_42%)]">{t('es_schedule_needs_review')}</p> : null}
        </>
      )}
      <p className="mt-2 text-2xs leading-relaxed text-[hsl(218_15%_42%)]">{t('es_schedule_note')}</p>
    </div>
  );
}

export default ScheduleSend;

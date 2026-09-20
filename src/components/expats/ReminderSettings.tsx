// HOMATCH FOR EXPATS — when we are allowed to interrupt you.
//
// §45 and §75. The controls are small and the defaults are quiet, because
// the failure mode of a reminder system is not missing a reminder — it is
// sending four and having the whole category muted, after which the one
// that mattered never arrives either.
//
// So: three lead times on by default rather than five, a daily cap, and
// channels the person picks. The cap is a real control rather than a
// reassurance; `dueReminders` enforces it, and the tick sends what that
// function returns and nothing else.

import React from 'react';
import { Bell } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { LEAD_TIMES_DAYS, REMINDER_CHANNELS } from '@/expats/plan/reminders';
import { saveReminderPreferences, type ReminderPreferenceRow } from '@/services/expats';

export function ReminderSettings({
  userId,
  preferences,
  onSaved,
}: {
  userId: string;
  preferences: ReminderPreferenceRow;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = React.useState<ReminderPreferenceRow>(preferences);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => setDraft(preferences), [preferences]);

  const commit = async (next: ReminderPreferenceRow) => {
    setDraft(next);
    setSaving(true);
    await saveReminderPreferences(userId, next);
    await onSaved();
    setSaving(false);
  };

  const toggleChannel = (channel: string) =>
    void commit({
      ...draft,
      channels: draft.channels.includes(channel)
        ? draft.channels.filter((c) => c !== channel)
        : [...draft.channels, channel],
    });

  const toggleLead = (days: number) =>
    void commit({
      ...draft,
      leadDays: draft.leadDays.includes(days)
        ? draft.leadDays.filter((d) => d !== days)
        : [...draft.leadDays, days].sort((a, b) => b - a),
    });

  return (
    <section
      data-expat-reminder-settings
      className="mt-12 rounded-2xl border border-border p-5 sm:p-6"
    >
      <div className="mb-4 flex items-center gap-2">
        <Bell className="h-4 w-4 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
        <h2 className="text-sm font-medium text-foreground">{t('expat_reminders_title')}</h2>
      </div>
      <p className="mb-5 text-2xs leading-relaxed text-muted-foreground">
        {t('expat_reminders_note')}
      </p>

      <label className="mb-5 flex items-center gap-3">
        <input
          type="checkbox"
          checked={draft.enabled}
          data-expat-reminders-enabled
          onChange={(e) => void commit({ ...draft, enabled: e.target.checked })}
          className="h-4 w-4 rounded border-border"
        />
        <span className="text-sm text-foreground">{t('expat_reminders_enable')}</span>
      </label>

      <div className={cn('space-y-5', !draft.enabled && 'pointer-events-none opacity-50')}>
        <div>
          <p className="mb-2 text-2xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
            {t('expat_reminders_channels')}
          </p>
          <div className="flex flex-wrap gap-2">
            {REMINDER_CHANNELS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={draft.channels.includes(c)}
                onClick={() => toggleChannel(c)}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-2xs transition-colors',
                  draft.channels.includes(c)
                    ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
                    : 'border-border text-muted-foreground',
                )}
              >
                {t(`expat_reminder_channel_${c.toLowerCase()}`)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-2xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
            {t('expat_reminders_lead')}
          </p>
          <div className="flex flex-wrap gap-2">
            {LEAD_TIMES_DAYS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={draft.leadDays.includes(d)}
                onClick={() => toggleLead(d)}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-2xs transition-colors',
                  draft.leadDays.includes(d)
                    ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
                    : 'border-border text-muted-foreground',
                )}
              >
                {t('expat_reminders_days_before', { n: d })}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label
            htmlFor="expat-reminder-cap"
            className="mb-2 block text-2xs font-medium uppercase tracking-[0.1em] text-muted-foreground"
          >
            {t('expat_reminders_cap')}
          </label>
          <input
            id="expat-reminder-cap"
            type="number"
            min={0}
            max={20}
            value={draft.maxPerDay}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(n) && n >= 0 && n <= 20) void commit({ ...draft, maxPerDay: n });
            }}
            className="h-9 w-20 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
          />
          <p className="mt-2 text-2xs text-muted-foreground">{t('expat_reminders_cap_note')}</p>
        </div>
      </div>

      {saving ? (
        <p className="mt-4 text-2xs text-muted-foreground">{t('expat_profile_saving')}</p>
      ) : null}
    </section>
  );
}

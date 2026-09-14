import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Bell, BellOff, Loader2, Send } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  NOTIFICATION_CATEGORIES, DEFAULT_PREFERENCES,
  getNotificationPreferences, saveNotificationPreferences,
  type NotificationPreferences, type NotificationCategory,
} from '@/services/notificationPreferences';
import {
  pushPermission, pushSupported, subscribeToPush, unsubscribeFromPush,
  hasPushSubscription, vapidPublicKey, markSoftPromptShown, dismissSoftPrompt,
  type PushPermission,
} from '@/lib/push';

/**
 * WHAT HOMATCH IS ALLOWED TO INTERRUPT YOU FOR.
 *
 * THE SOFT PROMPT, AND WHY IT IS NOT DECORATION
 *
 * `Notification.requestPermission()` can be asked once per origin, ever. A
 * refusal is permanent from the page's side — no API can ask again, and the
 * way back is a settings screen most people never open. Firing it on load
 * therefore spends the product's single chance on somebody who has not yet
 * been given a reason.
 *
 * So Homatch asks first, in its own words, next to the thing it is offering.
 * Only an explicit yes reaches the browser. "Not now" costs nothing and can
 * be offered again another day, which the native dialog cannot.
 *
 * EVERY STATE SAYS SOMETHING TRUE
 *
 *   UNSUPPORTED  the browser has no Push API. Say so; offer nothing.
 *   no VAPID key this environment has not been configured. Say that, rather
 *                than rendering a switch that fails when pressed.
 *   DENIED       the browser is blocking us and we cannot undo it. Explain
 *                where the setting is; do not re-ask.
 *   GRANTED      a real switch, and a test send, because a notification
 *                system nobody has ever seen work is a notification system
 *                nobody trusts.
 */
export function NotificationSettings() {
  const { t } = useLanguage();
  const { homatchUser } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);
  const [permission, setPermission] = useState<PushPermission>('NOT_ASKED');
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setPermission(pushPermission());
    void hasPushSubscription().then(setSubscribed);
  }, []);

  useEffect(() => {
    if (!homatchUser) return;
    void getNotificationPreferences(homatchUser.id).then((p) => {
      setPrefs(p);
      setLoaded(true);
    });
  }, [homatchUser]);

  const persist = useCallback(async (next: NotificationPreferences) => {
    setPrefs(next);
    if (!homatchUser) return;
    const ok = await saveNotificationPreferences(homatchUser.id, next);
    if (!ok) toast.error(t('notif_prefs_failed'));
  }, [homatchUser, t]);

  const configured = vapidPublicKey() !== null;

  const enablePush = async () => {
    setBusy(true);
    const result = await subscribeToPush();
    setBusy(false);
    setPermission(pushPermission());
    setSubscribed(result.ok);
    if (!result.ok && result.reason === 'denied') return;
    if (!result.ok) toast.error(t('notif_prefs_failed'));
  };

  const disablePush = async () => {
    setBusy(true);
    await unsubscribeFromPush();
    setBusy(false);
    setSubscribed(false);
  };

  const sendTest = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke('push-send', { body: { action: 'test' } });
      if (error) toast.error(t('notif_prefs_failed'));
      else toast.success(t('notif_push_test_sent'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold text-foreground">{t('notif_prefs_title')}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('notif_prefs_sub')}</p>
      </header>

      {/* ── Push ─────────────────────────────────────────────────────── */}
      <div className="border-b border-border p-5">
        {!pushSupported() ? (
          <p className="text-sm text-muted-foreground">{t('notif_push_unsupported')}</p>
        ) : !configured ? (
          <p className="text-sm text-muted-foreground">{t('notif_push_unavailable')}</p>
        ) : permission === 'DENIED' ? (
          <p className="flex items-start gap-2.5 text-sm text-muted-foreground">
            <BellOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0">{t('notif_push_denied')}</span>
          </p>
        ) : subscribed ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-foreground">
              <Bell className="h-4 w-4 shrink-0 text-gold-ink" aria-hidden="true" />
              <span className="min-w-0">{t('notif_push_on')}</span>
            </p>
            <div className="flex items-center gap-2">
              {/* A system nobody has seen work is a system nobody trusts. It
                  can only ever reach this caller's own devices. */}
              <Button variant="outline" size="sm" className="gap-1.5" disabled={busy} onClick={() => void sendTest()}>
                <Send className="h-3.5 w-3.5" /> {t('notif_push_test')}
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void disablePush()}>
                {t('notif_push_off')}
              </Button>
            </div>
          </div>
        ) : (
          /* THE SOFT PROMPT. Homatch's own words; the browser dialog is only
             reached by pressing the first button. */
          <div className="rounded-lg border border-gold/40 bg-gold-soft p-4">
            <p className="text-[15px] font-semibold text-foreground">{t('notif_push_title')}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{t('notif_push_body')}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="gap-1.5 bg-gold text-primary hover:bg-gold-hover"
                disabled={busy}
                onClick={() => { markSoftPromptShown(); void enablePush(); }}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
                {t('notif_push_enable')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { dismissSoftPrompt(); setPermission('DISMISSED'); }}>
                {t('notif_push_later')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Categories ───────────────────────────────────────────────── */}
      <div className="border-b border-border p-5">
        <p className="text-[15px] font-medium text-foreground">{t('notif_cat_title')}</p>
        <ul className="mt-3 space-y-3">
          {NOTIFICATION_CATEGORIES.map((key) => (
            <li key={key} className="flex items-center justify-between gap-4">
              <Label htmlFor={`notif-${key}`} className="min-w-0 flex-1 text-sm font-normal text-ink-soft">
                {t(`notif_cat_${key}` as Parameters<typeof t>[0])}
              </Label>
              <Switch
                id={`notif-${key}`}
                disabled={!loaded}
                /* Absent means on. A switch that renders off while the row is
                   still loading reads as "you turned this off". */
                checked={prefs.categories[key as NotificationCategory] !== false}
                onCheckedChange={(on) => void persist({
                  ...prefs,
                  categories: { ...prefs.categories, [key]: on },
                })}
              />
            </li>
          ))}
        </ul>
      </div>

      {/* ── Quiet hours ──────────────────────────────────────────────── */}
      <div className="border-b border-border p-5">
        <p className="text-[15px] font-medium text-foreground">{t('notif_quiet_title')}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t('notif_quiet_body')}</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <HourSelect
            label={t('notif_quiet_from')}
            value={prefs.quietHoursStart}
            offLabel={t('notif_quiet_off')}
            onChange={(v) => void persist({ ...prefs, quietHoursStart: v })}
          />
          <HourSelect
            label={t('notif_quiet_to')}
            value={prefs.quietHoursEnd}
            offLabel={t('notif_quiet_off')}
            onChange={(v) => void persist({ ...prefs, quietHoursEnd: v })}
          />
        </div>
      </div>

      {/* ── Marketing ────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <Label htmlFor="notif-marketing" className="text-[15px] font-medium text-foreground">
            {t('notif_marketing_title')}
          </Label>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t('notif_marketing_body')}</p>
        </div>
        <Switch
          id="notif-marketing"
          disabled={!loaded}
          checked={prefs.marketingOptIn}
          onCheckedChange={(on) => void persist({ ...prefs, marketingOptIn: on })}
        />
      </div>
    </section>
  );
}

/** An hour, or nothing. "Off" is a real value here, not an empty string. */
function HourSelect({
  label, value, offLabel, onChange,
}: {
  label: string; value: number | null; offLabel: string; onChange: (v: number | null) => void;
}) {
  return (
    <label className="min-w-0 text-sm">
      <span className="block text-muted-foreground">{label}</span>
      <select
        className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
        value={value === null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      >
        <option value="">{offLabel}</option>
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
        ))}
      </select>
    </label>
  );
}

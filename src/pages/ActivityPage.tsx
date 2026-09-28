import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { getActivityEvents } from '@/services/api';
import { activityLabelKey } from '@/lib/activityPresentation';
import { notificationAge } from '@/components/notifications/presentation';
import type { ActivityEvent } from '@/types/types';
import {
  PlusCircle, Upload, CheckCircle2, XCircle, Lock,
  Zap, PauseCircle, Trash2, Activity,
  Unlock, CreditCard, Play,
} from 'lucide-react';
import { toast } from 'sonner';

const EVENT_ICONS: Record<string, React.ElementType> = {
  PROPERTY_ADDED:          PlusCircle,
  IMPORT_STARTED:          Upload,
  IMPORT_COMPLETED:        CheckCircle2,
  IMPORT_FAILED:           XCircle,
  PRIVATE_LISTING_CREATED: Lock,
  MATCHING_STARTED:        Play,
  MATCHING_PAUSED:         PauseCircle,
  PROPERTY_DELETED:        Trash2,
  // Part 2
  MATCH_AVAILABLE:         Zap,
  MATCH_UNLOCKED:          Unlock,
  CREDITS_TOPPED_UP:       CreditCard,
  CREDITS_CHARGED:         CreditCard,
  CAMPAIGN_PAUSED:         PauseCircle,
  CAMPAIGN_RESUMED:        Play,
};

/* Tones picked for the premium-light canvas: the -400 shades this page wore
   on the dark surface all but vanish on white cards. */
const EVENT_COLOR: Record<string, string> = {
  PROPERTY_ADDED:          'text-gold-ink',
  IMPORT_STARTED:          'text-muted-foreground',
  IMPORT_COMPLETED:        'text-green-600',
  IMPORT_FAILED:           'text-destructive',
  PRIVATE_LISTING_CREATED: 'text-purple-600',
  MATCHING_STARTED:        'text-gold-ink',
  MATCHING_PAUSED:         'text-muted-foreground',
  PROPERTY_DELETED:        'text-destructive',
  // Part 2
  MATCH_AVAILABLE:         'text-gold-ink',
  MATCH_UNLOCKED:          'text-green-600',
  CREDITS_TOPPED_UP:       'text-green-600',
  CREDITS_CHARGED:         'text-muted-foreground',
  CAMPAIGN_PAUSED:         'text-muted-foreground',
  CAMPAIGN_RESUMED:        'text-gold-ink',
};

function ActivityItem({ event }: { event: ActivityEvent }) {
  const { t, lang } = useLanguage();
  const Icon = EVENT_ICONS[event.event_type] ?? Activity;
  const color = EVENT_COLOR[event.event_type] ?? 'text-muted-foreground';

  /* The shared map. The parent already filtered null rows out, so this only
     guards against being rendered outside that list. */
  const labelKey = activityLabelKey(event.event_type);
  if (!labelKey) return null;

  // Human-readable metadata summary — localized, and only for facts a
  // customer acts on. The raw signal-strength metric was an internal number
  // dressed as prose and is deliberately not shown.
  const metaSummary = (() => {
    const m = event.metadata as Record<string, unknown> | null;
    if (!m) return null;
    if (event.event_type === 'MATCH_UNLOCKED' && m.credits_charged) {
      return t('act_detail_credits_charged', { n: Number(m.credits_charged).toFixed(2) });
    }
    if (event.event_type === 'CREDITS_TOPPED_UP' && m.credits_added) {
      return t('act_detail_credits_added', {
        n: String(m.credits_added),
        balance: Number(m.new_balance ?? 0).toFixed(2),
      });
    }
    return null;
  })();

  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/50 last:border-0">
      <div className="shrink-0 w-7 h-7 rounded-full border border-gold/30 bg-gold/[0.06] flex items-center justify-center mt-0.5">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground font-medium">
          {t(labelKey)}
        </p>
        {metaSummary && (
          <p className="text-xs text-muted-foreground mt-0.5">{metaSummary}</p>
        )}
      </div>
      <span className="text-xs text-muted-foreground/60 shrink-0 mt-0.5">
        {/* The same localized relative age the notification list uses. */}
        {notificationAge(event.created_at, t, lang)}
      </span>
    </div>
  );
}

function ActivityContent() {
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!homatchUser) return;
    getActivityEvents(homatchUser.id, 50)
      .then(data => { setEvents(data); })
      .catch(() => { toast.error(t('activity_load_error')); })
      .finally(() => setLoading(false));
  }, [homatchUser, t]);

  /* Telemetry rows (page opens, per-turn counters) and event types this build
     has no words for are not feed entries — see activityLabelKey. */
  const feedEvents = events.filter(e => activityLabelKey(e.event_type) !== null);

  return (
    <AppLayout>
      {/* The shell's premium light block, worn the same way the dashboard
          wears it: white cards on the light canvas, gold accents. */}
      <div className="hm-customer -mx-4 -my-6 min-h-[calc(100dvh-4rem)] px-4 py-6 md:-mx-6 md:-my-8 md:px-6 md:py-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.015em] text-foreground">{t('activity_title')}</h1>

        <div className="rounded-[0.9rem] border border-foreground/15 bg-card shadow-card">
          {loading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-muted animate-pulse shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 bg-muted rounded animate-pulse w-1/3" />
                    <div className="h-3 bg-muted rounded animate-pulse w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : feedEvents.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <Activity className="h-8 w-8 text-muted-foreground/20 mx-auto mb-1" />
              <p className="text-sm text-muted-foreground">{t('empty_no_activity_title')}</p>
              <p className="text-xs text-muted-foreground/60">{t('empty_no_activity_desc')}</p>
            </div>
          ) : (
            <div className="p-4">
              {feedEvents.map(e => <ActivityItem key={e.id} event={e} />)}
            </div>
          )}
        </div>
      </div>
      </div>
    </AppLayout>
  );
}

export default function ActivityPage() {
  return (
    <RouteGuard>
      <ActivityContent />
    </RouteGuard>
  );
}

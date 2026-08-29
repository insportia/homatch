import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { getActivityEvents } from '@/services/api';
import type { ActivityEvent } from '@/types/types';
import {
  PlusCircle, Upload, CheckCircle2, XCircle, Lock,
  Zap, PauseCircle, Trash2, Activity,
  Unlock, CreditCard, Play,
} from 'lucide-react';

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

const EVENT_COLOR: Record<string, string> = {
  PROPERTY_ADDED:          'text-primary',
  IMPORT_STARTED:          'text-muted-foreground',
  IMPORT_COMPLETED:        'text-green-400',
  IMPORT_FAILED:           'text-destructive',
  PRIVATE_LISTING_CREATED: 'text-purple-400',
  MATCHING_STARTED:        'text-primary',
  MATCHING_PAUSED:         'text-muted-foreground',
  PROPERTY_DELETED:        'text-destructive',
  // Part 2
  MATCH_AVAILABLE:         'text-yellow-400',
  MATCH_UNLOCKED:          'text-green-400',
  CREDITS_TOPPED_UP:       'text-green-400',
  CREDITS_CHARGED:         'text-muted-foreground',
  CAMPAIGN_PAUSED:         'text-muted-foreground',
  CAMPAIGN_RESUMED:        'text-primary',
};

function ActivityItem({ event }: { event: ActivityEvent }) {
  const { t } = useLanguage();
  const Icon = EVENT_ICONS[event.event_type] ?? Activity;
  const color = EVENT_COLOR[event.event_type] ?? 'text-muted-foreground';

  const labelMap: Record<string, string> = {
    PROPERTY_ADDED:          t('activity_property_added'),
    IMPORT_STARTED:          t('activity_import_started'),
    IMPORT_COMPLETED:        t('activity_import_completed'),
    IMPORT_FAILED:           t('activity_import_failed'),
    PRIVATE_LISTING_CREATED: t('activity_private_created'),
    MATCHING_STARTED:        t('activity_matching_started'),
    MATCHING_PAUSED:         t('activity_matching_paused'),
    PROPERTY_DELETED:        t('activity_property_deleted'),
    // Part 2
    MATCH_AVAILABLE:         t('activity_match_available'),
    MATCH_UNLOCKED:          t('activity_match_unlocked'),
    CREDITS_TOPPED_UP:       t('activity_credits_topped_up'),
    CREDITS_CHARGED:         t('activity_credits_charged'),
    CAMPAIGN_PAUSED:         t('activity_campaign_paused'),
    CAMPAIGN_RESUMED:        t('activity_campaign_resumed'),
  };

  // Human-readable metadata summary
  const metaSummary = (() => {
    const m = event.metadata as Record<string, unknown> | null;
    if (!m) return null;
    if (event.event_type === 'MATCH_AVAILABLE' && m.signal_strength) {
      return `Signal: ${m.signal_strength}`;
    }
    if (event.event_type === 'MATCH_UNLOCKED' && m.credits_charged) {
      return `${Number(m.credits_charged).toFixed(2)} credits charged`;
    }
    if (event.event_type === 'CREDITS_TOPPED_UP' && m.credits_added) {
      return `+${m.credits_added} credits · Balance: ${Number(m.new_balance ?? 0).toFixed(2)}`;
    }
    return null;
  })();

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ago`;
    if (h > 0) return `${h}h ago`;
    if (m > 0) return `${m}m ago`;
    return 'just now';
  };

  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/50 last:border-0">
      <div className="shrink-0 w-7 h-7 rounded-full bg-secondary flex items-center justify-center mt-0.5">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground font-medium">
          {labelMap[event.event_type] ?? event.event_type}
        </p>
        {metaSummary && (
          <p className="text-xs text-muted-foreground mt-0.5">{metaSummary}</p>
        )}
      </div>
      <span className="text-xs text-muted-foreground/60 shrink-0 mt-0.5">
        {timeAgo(event.created_at)}
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
    getActivityEvents(homatchUser.id, 50).then(data => {
      setEvents(data);
      setLoading(false);
    });
  }, [homatchUser]);

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-xl font-semibold text-foreground">{t('activity_title')}</h1>

        <div className="rounded-xl border border-border bg-card">
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
          ) : events.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <Activity className="h-8 w-8 text-muted-foreground/20 mx-auto mb-1" />
              <p className="text-sm text-muted-foreground">{t('empty_no_activity_title')}</p>
              <p className="text-xs text-muted-foreground/60">{t('empty_no_activity_desc')}</p>
            </div>
          ) : (
            <div className="p-4">
              {events.map(e => <ActivityItem key={e.id} event={e} />)}
            </div>
          )}
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

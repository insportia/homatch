import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Button } from '@/components/ui/button';
import {
  getNotifications, markNotificationRead, markAllNotificationsRead
} from '@/services/api';
import type { Notification } from '@/types/types';
import {
  Bell, CheckCheck, Zap, Unlock, CreditCard, PauseCircle,
  MessageSquare, Eye, CheckCircle, XCircle, AlertCircle,
} from 'lucide-react';

// Notification type → icon + accent color (covers all DB enum values)
const NOTIF_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  IMPORT_COMPLETED:    { icon: Bell,          color: 'text-green-400',        bg: 'bg-green-400/10' },
  IMPORT_FAILED:       { icon: AlertCircle,   color: 'text-destructive',      bg: 'bg-destructive/10' },
  MATCHING_STARTED:    { icon: Zap,           color: 'text-primary',          bg: 'bg-primary/10' },
  MATCHING_PAUSED:     { icon: PauseCircle,   color: 'text-muted-foreground', bg: 'bg-secondary' },
  // Legacy value — kept for old rows
  MATCH_AVAILABLE:     { icon: Zap,           color: 'text-yellow-400',       bg: 'bg-yellow-400/10' },
  MATCH_FOUND:         { icon: Zap,           color: 'text-yellow-400',       bg: 'bg-yellow-400/10' },
  LOW_CREDITS:         { icon: CreditCard,    color: 'text-orange-400',       bg: 'bg-orange-400/10' },
  CREDITS_TOPPED_UP:   { icon: CreditCard,    color: 'text-green-400',        bg: 'bg-green-400/10' },
  CAMPAIGN_PAUSED:     { icon: PauseCircle,   color: 'text-muted-foreground', bg: 'bg-secondary' },
  NEW_MESSAGE:         { icon: MessageSquare, color: 'text-primary',          bg: 'bg-primary/10' },
  VIEWING_REQUEST:     { icon: Eye,           color: 'text-blue-400',         bg: 'bg-blue-400/10' },
  VIEWING_ACCEPTED:    { icon: CheckCircle,   color: 'text-green-400',        bg: 'bg-green-400/10' },
  VIEWING_DECLINED:    { icon: XCircle,       color: 'text-destructive',      bg: 'bg-destructive/10' },
  VIEWING_CANCELLED:   { icon: XCircle,       color: 'text-muted-foreground', bg: 'bg-secondary' },
  DEFAULT:             { icon: Bell,          color: 'text-muted-foreground', bg: 'bg-secondary' },
};

function NotifItem({
  notif,
  onRead,
  onClick,
}: {
  notif: Notification;
  onRead: (id: string) => void;
  onClick: (notif: Notification) => void;
}) {
  const type = notif.type ?? 'DEFAULT';
  const cfg = NOTIF_CONFIG[type] ?? NOTIF_CONFIG.DEFAULT;
  const Icon = cfg.icon;

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
    <div
      className={`flex items-start gap-3 px-4 py-3.5 border-b border-border/50 last:border-0 transition-colors cursor-pointer hover:bg-secondary/30 ${
        !notif.read ? 'bg-primary/5' : ''
      }`}
      onClick={() => {
        if (!notif.read) onRead(notif.id);
        onClick(notif);
      }}
    >
      <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${cfg.bg}`}>
        <Icon className={`h-4 w-4 ${cfg.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${notif.read ? 'text-muted-foreground' : 'text-foreground font-medium'}`}>
          {notif.title}
        </p>
        {notif.body && (
          <p className="text-xs text-muted-foreground/70 mt-0.5 line-clamp-2">{notif.body}</p>
        )}
        <p className="text-xs text-muted-foreground/40 mt-1">{timeAgo(notif.created_at)}</p>
      </div>
      {!notif.read && (
        <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
      )}
    </div>
  );
}

function NotificationsContent() {
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!homatchUser) return;
    getNotifications(homatchUser.id, 30).then(data => {
      setNotifications(data);
      setLoading(false);
    });
  }, [homatchUser]);

  const handleRead = async (id: string) => {
    await markNotificationRead(id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const handleReadAll = async () => {
    if (!homatchUser) return;
    await markAllNotificationsRead(homatchUser.id);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const handleNotifClick = (notif: Notification) => {
    const meta = notif.metadata as Record<string, unknown> | null;

    // Durable nav_path from DB (set by EF) takes precedence
    if (notif.nav_path) {
      navigate(notif.nav_path);
      return;
    }

    // Fallback routing by type
    switch (notif.type) {
      case 'MATCH_FOUND':
      case 'MATCH_AVAILABLE': {
        const propId = notif.property_id ?? meta?.property_id;
        if (propId) navigate(`/property/${propId}/matches`);
        break;
      }
      case 'NEW_MESSAGE': {
        const convId = meta?.conversation_id;
        navigate(convId ? `/chat?conv=${convId}` : '/chat');
        break;
      }
      case 'VIEWING_REQUEST':
      case 'VIEWING_ACCEPTED':
      case 'VIEWING_DECLINED':
      case 'VIEWING_CANCELLED':
        navigate('/viewings');
        break;
      case 'CREDITS_TOPPED_UP':
      case 'LOW_CREDITS':
        navigate('/credits');
        break;
      default:
        if (notif.property_id) navigate(`/property/${notif.property_id}`);
    }
  };

  const unread = notifications.filter(n => !n.read).length;

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{t('notif_title')}</h1>
            {unread > 0 && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {t('notif_unread_count').replace('{{n}}', String(unread))}
              </p>
            )}
          </div>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReadAll}
              className="gap-1.5 text-sm text-muted-foreground hover:text-foreground border border-border"
            >
              <CheckCheck className="h-4 w-4" />
              {t('notif_mark_all_read')}
            </Button>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <div className="w-8 h-8 rounded-full bg-muted shrink-0 animate-pulse" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 bg-muted rounded animate-pulse w-2/3" />
                    <div className="h-3 bg-muted rounded animate-pulse w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <Bell className="h-8 w-8 text-muted-foreground/20 mx-auto mb-1" />
              <p className="text-sm text-muted-foreground">{t('empty_no_notifications_title')}</p>
              <p className="text-xs text-muted-foreground/60">{t('empty_no_notifications_desc')}</p>
            </div>
          ) : (
            notifications.map(n => (
              <NotifItem key={n.id} notif={n} onRead={handleRead} onClick={handleNotifClick} />
            ))
          )}
        </div>
      </div>
    </AppLayout>
  );
}

export default function NotificationsPage() {
  return (
    <RouteGuard>
      <NotificationsContent />
    </RouteGuard>
  );
}

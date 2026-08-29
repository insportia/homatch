import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Button } from '@/components/ui/button';
import { getNotifications, markNotificationRead, markAllNotificationsRead } from '@/services/api';
import type { Notification } from '@/types/types';
import { Bell, CheckCheck, Zap, CreditCard, PauseCircle, MessageSquare, CalendarDays } from 'lucide-react';

const NOTIF_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  IMPORT_COMPLETED: { icon: Bell, color: 'text-green-400', bg: 'bg-green-400/10' },
  IMPORT_FAILED: { icon: Bell, color: 'text-destructive', bg: 'bg-destructive/10' },
  MATCHING_STARTED: { icon: Zap, color: 'text-primary', bg: 'bg-primary/10' },
  MATCHING_PAUSED: { icon: PauseCircle, color: 'text-muted-foreground', bg: 'bg-secondary' },
  MATCH_FOUND: { icon: Zap, color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  MATCH_AVAILABLE: { icon: Zap, color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  MATCH_UNLOCKED: { icon: Zap, color: 'text-primary', bg: 'bg-primary/10' },
  CREDITS_TOPPED_UP: { icon: CreditCard, color: 'text-green-400', bg: 'bg-green-400/10' },
  CAMPAIGN_PAUSED: { icon: PauseCircle, color: 'text-muted-foreground', bg: 'bg-secondary' },
  DEFAULT: { icon: Bell, color: 'text-muted-foreground', bg: 'bg-secondary' },
};

function NotifItem({ notif, onRead, onClick }: { notif: Notification; onRead: (id: string) => void; onClick: (notif: Notification) => void }) {
  const meta = (notif.metadata ?? {}) as Record<string, unknown>;
  const kind = typeof meta.kind === 'string' ? meta.kind : '';
  const base = NOTIF_CONFIG[notif.type ?? 'DEFAULT'] ?? NOTIF_CONFIG.DEFAULT;
  const cfg = kind === 'NEW_MESSAGE' ? { ...base, icon: MessageSquare } : kind.startsWith('VIEWING_') ? { ...base, icon: CalendarDays } : base;
  const Icon = cfg.icon;
  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d > 0) return `${d}d ago`;
    if (h > 0) return `${h}h ago`;
    if (m > 0) return `${m}m ago`;
    return 'just now';
  };
  return <button type="button" className={`w-full flex items-start gap-3 px-4 py-3.5 border-b border-border/50 last:border-0 transition-colors text-start hover:bg-secondary/30 ${!notif.read ? 'bg-primary/5' : ''}`} onClick={() => { if (!notif.read) onRead(notif.id); onClick(notif); }}>
    <span className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${cfg.bg}`}><Icon className={`h-4 w-4 ${cfg.color}`} /></span>
    <span className="flex-1 min-w-0"><span className={`block text-sm break-words ${notif.read ? 'text-muted-foreground' : 'text-foreground font-medium'}`}>{notif.title}</span>{notif.body && <span className="block text-xs text-muted-foreground/70 mt-0.5 line-clamp-2 break-words">{notif.body}</span>}<span className="block text-xs text-muted-foreground/40 mt-1">{timeAgo(notif.created_at)}</span></span>
    {!notif.read && <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
  </button>;
}

function NotificationsContent() {
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (!homatchUser) return; getNotifications(homatchUser.id, 30).then(data => { setNotifications(data); setLoading(false); }); }, [homatchUser]);
  const handleRead = async (id: string) => { await markNotificationRead(id); setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n)); };
  const handleReadAll = async () => { if (!homatchUser) return; await markAllNotificationsRead(homatchUser.id); setNotifications(prev => prev.map(n => ({ ...n, read: true }))); };

  const handleNotifClick = (notif: Notification) => {
    const meta = (notif.metadata ?? {}) as Record<string, unknown>;
    const kind = typeof meta.kind === 'string' ? meta.kind : '';
    if (kind === 'NEW_MESSAGE') {
      navigate('/chat', { state: { conversationId: typeof meta.conversation_id === 'string' ? meta.conversation_id : undefined } });
      return;
    }
    if (kind === 'VIEWING_REQUEST' || kind === 'VIEWING_UPDATE') {
      navigate('/viewings', { state: { viewingRequestId: typeof meta.viewing_request_id === 'string' ? meta.viewing_request_id : undefined } });
      return;
    }
    if (notif.type === 'MATCH_AVAILABLE' || notif.type === 'MATCH_UNLOCKED' || notif.type === 'MATCH_FOUND') {
      const propId = notif.property_id ?? (typeof meta.property_id === 'string' ? meta.property_id : undefined);
      if (propId) navigate(`/property/${propId}/matches`);
      return;
    }
    if (notif.type === 'CREDITS_TOPPED_UP' || notif.type === 'CREDITS_LOW') { navigate('/credits'); return; }
    if (notif.property_id) navigate(`/property/${notif.property_id}`);
  };

  const unread = notifications.filter(n => !n.read).length;
  return <AppLayout><div className="max-w-2xl mx-auto space-y-6">
    <div className="flex items-start justify-between gap-3 flex-wrap"><div className="min-w-0"><h1 className="text-xl font-semibold text-foreground break-words">{t('notif_title')}</h1>{unread > 0 && <p className="text-sm text-muted-foreground mt-0.5">{unread} unread</p>}</div>{unread > 0 && <Button variant="ghost" size="sm" onClick={handleReadAll} className="gap-1.5 text-sm text-muted-foreground hover:text-foreground border border-border"><CheckCheck className="h-4 w-4 shrink-0" />Mark all read</Button>}</div>
    <div className="rounded-xl border border-border bg-card overflow-hidden">{loading ? <div className="p-6 space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="flex gap-3 items-start"><div className="w-8 h-8 rounded-full bg-muted shrink-0 animate-pulse" /><div className="flex-1 space-y-1.5"><div className="h-3.5 bg-muted rounded animate-pulse w-2/3" /><div className="h-3 bg-muted rounded animate-pulse w-1/3" /></div></div>)}</div> : notifications.length === 0 ? <div className="p-12 text-center space-y-3"><Bell className="h-8 w-8 text-muted-foreground/20 mx-auto mb-1" /><p className="text-sm text-muted-foreground">{t('empty_no_notifications_title')}</p><p className="text-xs text-muted-foreground/60">{t('empty_no_notifications_desc')}</p></div> : notifications.map(n => <NotifItem key={n.id} notif={n} onRead={handleRead} onClick={handleNotifClick} />)}</div>
  </div></AppLayout>;
}

export default function NotificationsPage() { return <RouteGuard><NotificationsContent /></RouteGuard>; }

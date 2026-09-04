import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Radio, Send, Pencil, Trash2, Flag, UserX, MoreVertical, MessageCircleReply, X, Loader2, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  getMyLiveChatProfile, isNicknameAvailable, createLiveChatProfile, touchLiveChatActivity,
  getLiveChatMessages, getLiveChatProfiles, sendLiveChatMessage, editLiveChatMessage,
  deleteLiveChatMessage, reportLiveChatMessage, blockLiveChatUser, getMyBlockedUserIds,
  type LiveChatMessageRow,
} from '@/services/liveChat';
import { sendMessage as sendPrivateMessage } from '@/services/api3';
import type { LiveChatProfile } from '@/types/types';

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
const NICK_RE = /^[A-Za-z0-9_]{3,24}$/;

function initialsFor(nickname: string) {
  return nickname.slice(0, 2).toUpperCase();
}

function NicknameSetupDialog({ userId, onDone }: { userId: string; onDone: (p: LiveChatProfile) => void }) {
  const { t } = useLanguage();
  const [nickname, setNickname] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!NICK_RE.test(nickname)) { setError(t('live_chat_nickname_invalid')); return; }
    setChecking(true);
    setError(null);
    try {
      const available = await isNicknameAvailable(nickname);
      if (!available) { setError(t('live_chat_nickname_taken')); return; }
      const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
      const profile = await createLiveChatProfile(userId, nickname, color);
      onDone(profile);
    } catch {
      setError(t('live_chat_nickname_error'));
    } finally {
      setChecking(false);
    }
  };

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm" onInteractOutside={e => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Radio className="h-4 w-4 text-primary" />{t('live_chat_nickname_title')}</DialogTitle>
          <DialogDescription className="text-xs">{t('live_chat_nickname_desc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            placeholder={t('live_chat_nickname_placeholder')}
            value={nickname}
            onChange={e => setNickname(e.target.value.replace(/\s/g, ''))}
            maxLength={24}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <p className="text-[11px] text-muted-foreground">{t('live_chat_nickname_hint')}</p>
        </div>
        <DialogFooter>
          <Button className="w-full" disabled={checking || nickname.length < 3} onClick={submit}>
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : t('live_chat_nickname_continue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReportDialog({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const { t } = useLanguage();
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
        <DialogHeader><DialogTitle>{t('live_chat_report_title')}</DialogTitle></DialogHeader>
        <Input placeholder={t('live_chat_report_placeholder')} value={reason} onChange={e => setReason(e.target.value)} maxLength={280} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('live_chat_cancel')}</Button>
          <Button variant="destructive" disabled={!reason.trim()} onClick={() => { onSubmit(reason.trim()); setReason(''); }}>{t('live_chat_report_submit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function LiveChatPage() {
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<LiveChatProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [messages, setMessages] = useState<LiveChatMessageRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, LiveChatProfile>>({});
  const [blocked, setBlocked] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<LiveChatMessageRow | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadProfiles = useCallback(async (rows: LiveChatMessageRow[]) => {
    const ids = rows.map(r => r.user_id);
    const map = await getLiveChatProfiles(ids);
    setProfiles(prev => ({ ...prev, ...map }));
  }, []);

  useEffect(() => {
    if (!homatchUser) return;
    getMyLiveChatProfile(homatchUser.id)
      .then(p => { setProfile(p); })
      .catch(() => { toast.error(t('live_chat_profile_load_error')); })
      .finally(() => setProfileLoading(false));
    getMyBlockedUserIds(homatchUser.id).then(setBlocked).catch(() => { console.error('[LiveChatPage] failed to load blocked users'); });
  }, [homatchUser, t]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getLiveChatMessages();
      setMessages(rows);
      setHasMore(rows.length > 0);
      await loadProfiles(rows);
    } finally {
      setLoading(false);
    }
  }, [loadProfiles]);

  useEffect(() => { if (profile) loadInitial(); }, [profile, loadInitial]);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase.channel('live_chat_messages_stream')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_chat_messages' }, payload => {
        if (payload.eventType === 'INSERT') {
          const row = payload.new as LiveChatMessageRow;
          setMessages(prev => (prev.find(m => m.id === row.id) ? prev : [...prev, row]));
          loadProfiles([row]);
        } else if (payload.eventType === 'UPDATE') {
          const row = payload.new as LiveChatMessageRow;
          setMessages(prev => prev.map(m => (m.id === row.id ? row : m)));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile, loadProfiles]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const loadOlder = async () => {
    if (!hasMore || loadingMore || messages.length === 0) return;
    setLoadingMore(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const older = await getLiveChatMessages(messages[0].seq);
      if (older.length === 0) { setHasMore(false); return; }
      setMessages(prev => [...older, ...prev]);
      await loadProfiles(older);
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevHeight; });
    } finally {
      setLoadingMore(false);
    }
  };

  const handleSend = async () => {
    if (!text.trim() || !homatchUser) return;
    setSending(true);
    const body = text.trim();
    try {
      if (editingId) {
        await editLiveChatMessage(editingId, body);
        setMessages(prev => prev.map(m => (m.id === editingId ? { ...m, body, edited_at: new Date().toISOString() } : m)));
        setEditingId(null);
      } else {
        await sendLiveChatMessage(homatchUser.id, body, replyTo?.id ?? null);
        touchLiveChatActivity(homatchUser.id).catch(() => {});
        setReplyTo(null);
      }
      setText('');
    } catch (e: any) {
      toast.error(e?.message?.includes('violates check') ? t('live_chat_rate_limited') : t('live_chat_send_failed'));
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteLiveChatMessage(id);
    setMessages(prev => prev.map(m => (m.id === id ? { ...m, deleted_at: new Date().toISOString() } : m)));
  };

  const handleBlock = async (userId: string) => {
    if (!homatchUser) return;
    try {
      await blockLiveChatUser(homatchUser.id, userId);
      setBlocked(prev => [...prev, userId]);
      toast.success(t('live_chat_user_blocked'));
    } catch {
      toast.error(t('live_chat_action_failed'));
    }
  };

  const handleReport = async (reason: string) => {
    if (!reportTarget || !homatchUser) return;
    try {
      await reportLiveChatMessage(reportTarget, homatchUser.id, reason);
      toast.success(t('live_chat_report_sent'));
    } catch {
      toast.error(t('live_chat_action_failed'));
    } finally {
      setReportTarget(null);
    }
  };

  const handlePrivateMessage = async (userId: string) => {
    try {
      const { conversation_id } = await sendPrivateMessage(userId, t('live_chat_dm_opener'));
      navigate(`/chat?conversation=${conversation_id}`);
    } catch {
      toast.error(t('live_chat_action_failed'));
    }
  };

  if (!profileLoading && homatchUser && !profile) {
    return (
      <RouteGuard>
        <AppLayout>
          <NicknameSetupDialog userId={homatchUser.id} onDone={setProfile} />
        </AppLayout>
      </RouteGuard>
    );
  }

  const visibleMessages = messages.filter(m => !blocked.includes(m.user_id));

  return (
    <RouteGuard>
      <AppLayout noPadding>
        <div className="flex flex-col h-[calc(100dvh-3.5rem)] md:h-[calc(100vh-3.5rem)] overflow-hidden max-w-3xl mx-auto w-full">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
            <Radio className="h-5 w-5 text-primary" />
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold">{t('live_chat_title')}</h1>
              <p className="text-[11px] text-muted-foreground">{t('live_chat_subtitle')}</p>
            </div>
          </div>

          <div ref={scrollRef} onScroll={e => { if (e.currentTarget.scrollTop < 40) loadOlder(); }} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}><Skeleton className="h-10 w-48 rounded-2xl" /></div>
              ))
            ) : visibleMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-16">
                <MessageSquare className="h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">{t('live_chat_empty')}</p>
                <p className="text-xs text-muted-foreground">{t('live_chat_empty_desc')}</p>
              </div>
            ) : (
              <>
                {loadingMore && <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
                {visibleMessages.map(msg => {
                  const author = profiles[msg.user_id];
                  const isMine = msg.user_id === homatchUser?.id;
                  const isDeleted = !!msg.deleted_at;
                  const isHidden = msg.hidden_by_admin && !isMine;
                  const replySource = msg.reply_to_id ? messages.find(m => m.id === msg.reply_to_id) : null;
                  return (
                    <div key={msg.id} className={cn('flex gap-2', isMine ? 'justify-end' : 'justify-start')}>
                      {!isMine && (
                        <Avatar className="h-7 w-7 shrink-0 mt-1">
                          <AvatarFallback style={{ backgroundColor: (author?.avatar_color ?? '#6366f1') + '33', color: author?.avatar_color ?? '#6366f1' }} className="text-[10px] font-semibold">
                            {initialsFor(author?.nickname ?? '??')}
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <div className={cn('max-w-[75%] group', isMine && 'flex flex-col items-end')}>
                        {!isMine && <p className="text-[11px] font-medium text-muted-foreground mb-0.5 px-1">{author?.nickname ?? t('live_chat_unknown_user')}</p>}
                        {replySource && !isDeleted && (
                          <div className="text-[10px] text-muted-foreground border-l-2 border-primary/40 pl-1.5 mb-1 truncate max-w-[220px]">
                            {profiles[replySource.user_id]?.nickname ?? '…'}: {replySource.body.slice(0, 60)}
                          </div>
                        )}
                        <div className={cn('flex items-center gap-1', isMine ? 'flex-row-reverse' : 'flex-row')}>
                          <div className={cn(
                            'px-3.5 py-2 rounded-2xl text-sm break-words',
                            isMine ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-secondary text-foreground rounded-bl-sm',
                            (isDeleted || isHidden) && 'italic text-muted-foreground bg-transparent border border-dashed border-border',
                          )}>
                            {isDeleted ? t('live_chat_message_deleted') : isHidden ? t('live_chat_message_hidden') : msg.body}
                            {msg.edited_at && !isDeleted && <span className="text-[9px] opacity-60 ms-1.5">{t('live_chat_edited')}</span>}
                          </div>
                          {!isDeleted && !isHidden && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0">
                                  <MoreVertical className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align={isMine ? 'end' : 'start'}>
                                <DropdownMenuItem onClick={() => setReplyTo(msg)} className="gap-2"><MessageCircleReply className="h-3.5 w-3.5" />{t('live_chat_reply')}</DropdownMenuItem>
                                {isMine ? (
                                  <>
                                    <DropdownMenuItem onClick={() => { setEditingId(msg.id); setText(msg.body); }} className="gap-2"><Pencil className="h-3.5 w-3.5" />{t('live_chat_edit')}</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleDelete(msg.id)} className="gap-2 text-destructive focus:text-destructive"><Trash2 className="h-3.5 w-3.5" />{t('live_chat_delete')}</DropdownMenuItem>
                                  </>
                                ) : (
                                  <>
                                    <DropdownMenuItem onClick={() => handlePrivateMessage(msg.user_id)} className="gap-2"><MessageSquare className="h-3.5 w-3.5" />{t('live_chat_send_private')}</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setReportTarget(msg.id)} className="gap-2"><Flag className="h-3.5 w-3.5" />{t('live_chat_report')}</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleBlock(msg.user_id)} className="gap-2 text-destructive focus:text-destructive"><UserX className="h-3.5 w-3.5" />{t('live_chat_block')}</DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                        <span className="text-[9px] text-muted-foreground mt-0.5 px-1">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="px-4 py-3 border-t border-border shrink-0">
            {(replyTo || editingId) && (
              <div className="flex items-center justify-between gap-2 mb-2 px-2.5 py-1.5 rounded-lg bg-secondary/60 text-xs">
                <span className="truncate text-muted-foreground">
                  {editingId ? t('live_chat_editing') : `${t('live_chat_replying_to')} ${profiles[replyTo!.user_id]?.nickname ?? ''}`}
                </span>
                <button onClick={() => { setReplyTo(null); setEditingId(null); setText(''); }}><X className="h-3.5 w-3.5" /></button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Input
                className="flex-1"
                placeholder={t('live_chat_composer_placeholder')}
                value={text}
                onChange={e => setText(e.target.value)}
                maxLength={2000}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                disabled={sending}
              />
              <Button onClick={handleSend} disabled={sending || !text.trim()} size="icon" className="shrink-0 h-10 w-10">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
        <ReportDialog open={!!reportTarget} onClose={() => setReportTarget(null)} onSubmit={handleReport} />
      </AppLayout>
    </RouteGuard>
  );
}

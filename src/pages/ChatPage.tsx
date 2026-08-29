import React, { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  MessageSquare, Send, ArrowLeft, MoreVertical, Phone, MessageCircle,
  AlertTriangle, Volume2, VolumeX, CheckCheck, Check, Clock,
} from 'lucide-react';
import { getConversations, getMessages, sendMessage, markMessageSeen, shareContactInfo, getContactShare } from '@/services/api3';
import type { Conversation, Message } from '@/types/phase3';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ── Status Icon ──────────────────────────────────────────────
function MessageStatusIcon({ status }: { status: string }) {
  if (status === 'SEEN') return <CheckCheck className="h-3 w-3 text-primary" />;
  if (status === 'DELIVERED') return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
  if (status === 'SENT') return <Check className="h-3 w-3 text-muted-foreground" />;
  return <Clock className="h-3 w-3 text-muted-foreground" />;
}

// ── Conversation List Item ────────────────────────────────────
function ConvItem({ conv, active, onClick, myId }: { conv: Conversation; active: boolean; onClick: () => void; myId: string }) {
  const initials = (conv.other_user?.full_name ?? conv.other_user?.email ?? '?')
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const lastMsg = conv.last_message;
  const isMine = lastMsg?.sender_id === myId;

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/60',
        active && 'bg-secondary',
      )}
    >
      <div className="relative shrink-0">
        <Avatar className="h-10 w-10">
          <AvatarImage src={conv.other_user?.avatar_url} />
          <AvatarFallback className="bg-primary/20 text-primary text-xs font-semibold">{initials}</AvatarFallback>
        </Avatar>
        {(conv.unread_count ?? 0) > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
            {conv.unread_count}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {conv.other_user?.full_name ?? conv.other_user?.email ?? 'User'}
          </span>
          {lastMsg && (
            <span className="text-[10px] text-muted-foreground shrink-0">
              {new Date(lastMsg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {isMine && <span className="mr-1">You:</span>}
          {lastMsg?.body ?? 'No messages yet'}
        </p>
      </div>
    </button>
  );
}

// ── Contact Share Dialog ──────────────────────────────────────
function ShareContactDialog({
  open, onClose, conversationId, sharerId,
}: { open: boolean; onClose: () => void; conversationId: string; sharerId: string }) {
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [telegram, setTelegram] = useState('');
  const [loading, setLoading] = useState(false);

  const handleShare = async () => {
    setLoading(true);
    try {
      await shareContactInfo(conversationId, sharerId, { phone: phone || undefined, whatsapp: whatsapp || undefined, telegram: telegram || undefined });
      toast.success('Contact info shared');
      onClose();
    } catch {
      toast.error('Failed to share contact');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Contact Info</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Only share when you are ready. The other party will see what you provide.</p>
        <div className="space-y-3 mt-2">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Phone</label>
            <Input placeholder="+995 5XX XXX XXX" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">WhatsApp</label>
            <Input placeholder="+995 5XX XXX XXX" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Telegram</label>
            <Input placeholder="@username or +number" value={telegram} onChange={e => setTelegram(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleShare} disabled={loading || (!phone && !whatsapp && !telegram)}>
            {loading ? 'Sharing…' : 'Share'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Message Thread ────────────────────────────────────────────
function MessageThread({
  conv, myId, onBack,
}: { conv: Conversation; myId: string; onBack: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharedContact, setSharedContact] = useState<Record<string, string> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { t } = useLanguage();

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const msgs = await getMessages(conv.id);
      setMessages(msgs);
      // Mark received messages as seen
      for (const m of msgs) {
        if (m.sender_id !== myId && m.status !== 'SEEN') {
          markMessageSeen(m.id).catch(() => {});
        }
      }
    } finally {
      setLoading(false);
    }
  }, [conv.id, myId]);

  useEffect(() => {
    loadMessages();

    // Realtime subscription
    const channel = supabase.channel(`messages:${conv.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conv.id}`,
      }, (payload) => {
        setMessages(prev => {
          if (prev.find(m => m.id === payload.new.id)) return prev;
          const newMsg = payload.new as Message;
          if (newMsg.sender_id !== myId) markMessageSeen(newMsg.id).catch(() => {});
          return [...prev, newMsg];
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conv.id, myId, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load shared contact
  useEffect(() => {
    getContactShare(conv.id, conv.initiator_id === myId ? conv.recipient_id : conv.initiator_id)
      .then(c => {
        if (c) setSharedContact({ phone: c.phone ?? '', whatsapp: c.whatsapp ?? '', telegram: c.telegram ?? '' });
      }).catch(() => {});
  }, [conv.id, conv.initiator_id, conv.recipient_id, myId]);

  const handleSend = async () => {
    if (!text.trim()) return;
    setSending(true);
    const body = text.trim();
    setText('');
    try {
      const { message } = await sendMessage(conv.recipient_id === myId ? conv.initiator_id : conv.recipient_id, body, conv.id);
      setMessages(prev => prev.find(m => m.id === message.id) ? prev : [...prev, message]);
    } catch {
      toast.error('Failed to send message');
      setText(body);
    } finally {
      setSending(false);
    }
  };

  const otherUser = conv.other_user;
  const initials = (otherUser?.full_name ?? otherUser?.email ?? '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <Button variant="ghost" size="icon" className="md:hidden h-8 w-8 shrink-0" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarImage src={otherUser?.avatar_url} />
          <AvatarFallback className="bg-primary/20 text-primary text-xs">{initials}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{otherUser?.full_name ?? otherUser?.email}</p>
          <p className="text-xs text-muted-foreground">Homatch user</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShareOpen(true)}>
            <Phone className="h-4 w-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setShareOpen(true)}>
                <Phone className="h-4 w-4 mr-2" /> Share Contact
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive">
                <AlertTriangle className="h-4 w-4 mr-2" /> Report
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Shared contact banner */}
      {sharedContact && (sharedContact.phone || sharedContact.whatsapp || sharedContact.telegram) && (
        <div className="px-4 py-2 bg-primary/5 border-b border-primary/20 flex items-center gap-3 text-xs text-primary shrink-0">
          <Phone className="h-3 w-3 shrink-0" />
          <span className="truncate">
            Contact shared —{' '}
            {[sharedContact.phone && `📞 ${sharedContact.phone}`, sharedContact.whatsapp && `WhatsApp: ${sharedContact.whatsapp}`, sharedContact.telegram && `TG: ${sharedContact.telegram}`].filter(Boolean).join(' · ')}
          </span>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                <Skeleton className="h-10 w-48 rounded-2xl" />
              </div>
            ))
          : messages.map(msg => {
              const isMine = msg.sender_id === myId;
              return (
                <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                  <div className={cn(
                    'max-w-[75%] px-4 py-2.5 rounded-2xl text-sm',
                    isMine
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-secondary text-foreground rounded-bl-sm',
                  )}>
                    <p className="break-words leading-relaxed">{msg.body}</p>
                    <div className={`flex items-center gap-1 mt-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
                      <span className="text-[10px] opacity-70">
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {isMine && <MessageStatusIcon status={msg.status} />}
                    </div>
                  </div>
                </div>
              );
            })
        }
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-border shrink-0">
        <div className="flex items-center gap-2">
          <Input
            className="flex-1"
            placeholder={t('chat_input_placeholder')}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={sending}
          />
          <Button
            onClick={handleSend}
            disabled={sending || !text.trim()}
            size="icon"
            className="shrink-0 h-10 w-10"
          >
            {sending ? <div className="h-4 w-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
          Share contact info only when you're ready — tap <Phone className="h-3 w-3 inline" /> above
        </p>
      </div>

      <ShareContactDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        conversationId={conv.id}
        sharerId={myId}
      />
    </div>
  );
}

// ── Main Chat Page ────────────────────────────────────────────
export default function ChatPage() {
  const { homatchUser } = useAuth();
  const { t } = useLanguage();
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);

  const load = useCallback(async () => {
    if (!homatchUser) return;
    setLoading(true);
    try {
      const data = await getConversations(homatchUser.id);
      setConvs(data);
    } finally {
      setLoading(false);
    }
  }, [homatchUser]);

  useEffect(() => { load(); }, [load]);

  // Realtime: update conversation list on new messages
  useEffect(() => {
    if (!homatchUser) return;
    const channel = supabase.channel('conversations_list')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'conversations',
      }, () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [homatchUser, load]);

  const totalUnread = convs.reduce((s, c) => s + (c.unread_count ?? 0), 0);

  return (
    <RouteGuard>
      <AppLayout noPadding>
        <div className="flex h-[calc(100dvh-3.5rem)] md:h-[calc(100vh-3.5rem)] overflow-hidden">
          {/* Sidebar — conversation list */}
          <aside className={cn(
            'flex flex-col w-full md:w-80 md:border-r border-border shrink-0',
            activeConv ? 'hidden md:flex' : 'flex',
          )}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-primary" />
                <h1 className="text-base font-semibold">{t('chat_title')}</h1>
                {totalUnread > 0 && (
                  <Badge variant="default" className="h-5 px-1.5 text-[10px]">{totalUnread}</Badge>
                )}
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {loading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3 w-32" />
                        <Skeleton className="h-3 w-48" />
                      </div>
                    </div>
                  ))
                : convs.length === 0
                  ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center py-16">
                      <MessageCircle className="h-10 w-10 text-muted-foreground/40" />
                      <p className="text-sm font-medium text-foreground">{t('chat_empty')}</p>
                      <p className="text-xs text-muted-foreground">{t('chat_empty_desc')}</p>
                    </div>
                  )
                  : convs.map(c => (
                    <React.Fragment key={c.id}>
                      <ConvItem
                        conv={c}
                        active={activeConv?.id === c.id}
                        onClick={() => setActiveConv(c)}
                        myId={homatchUser?.id ?? ''}
                      />
                      <Separator className="opacity-30" />
                    </React.Fragment>
                  ))
              }
            </div>
          </aside>

          {/* Thread area */}
          <div className={cn(
            'flex-1 min-w-0',
            !activeConv ? 'hidden md:flex' : 'flex',
            'flex-col',
          )}>
            {activeConv && homatchUser
              ? (
                <MessageThread
                  conv={activeConv}
                  myId={homatchUser.id}
                  onBack={() => setActiveConv(null)}
                />
              )
              : (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
                  <MessageSquare className="h-12 w-12 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">Select a conversation to start chatting</p>
                </div>
              )
            }
          </div>
        </div>
      </AppLayout>
    </RouteGuard>
  );
}

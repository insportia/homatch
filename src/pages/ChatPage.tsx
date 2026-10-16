import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Ban, BellOff, Building2, Image as ImageIcon, MessageCircle, MessageSquare, Mic, Phone } from 'lucide-react';
import { shareContactInfo, getContactShare, reportConversation } from '@/services/api3';
import { getPropertyConversations, type ChatConversation } from '@/services/propertyChat';
import { getActiveConversation, setActiveConversation } from '@/lib/notifications/signals';
import { markConversationNotificationsRead } from '@/services/api';
import { intlLocaleFor } from '@/components/workspace/primitives';
import { PropertyConversation } from '@/components/chat/PropertyConversation';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/* ── Conversation list ──────────────────────────────────────────────────── */

function ConvItem({ conv, active, onClick, myId }: { conv: ChatConversation; active: boolean; onClick: () => void; myId: string }) {
  const { t, lang } = useLanguage();
  const name = conv.counterpart.name ?? t('pc_counterpart_fallback');
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const last = conv.last_message;
  const isMine = last?.sender_id === myId;
  const preview = !last ? t('chat_no_messages_yet')
    : last.kind === 'PHOTO' ? (last.body || t('pc_photo'))
    : last.kind === 'VOICE' ? t('pc_voice')
    : last.kind === 'PROPERTY' ? t('pc_property_card')
    : last.body;
  const KindIcon = last?.kind === 'PHOTO' ? ImageIcon : last?.kind === 'VOICE' ? Mic : last?.kind === 'PROPERTY' ? Building2 : null;
  const when = last ? new Date(last.created_at) : null;
  const sameDay = when && new Date().toDateString() === when.toDateString();
  const locale = intlLocaleFor(lang);
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'true' : undefined}
      className={cn('flex min-h-16 w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-[hsl(42_100%_97%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(38_92%_56%)]',
        active && 'bg-[hsl(42_100%_96%)] shadow-[inset_3px_0_0_hsl(38_92%_54%)] rtl:shadow-[inset_-3px_0_0_hsl(38_92%_54%)]')}>
      <div className="relative shrink-0">
        <Avatar className="h-11 w-11"><AvatarImage src={conv.counterpart.avatar_url ?? undefined} alt="" /><AvatarFallback className="border border-gold/30 bg-gold/[0.06] text-xs font-semibold text-gold-ink">{initials}</AvatarFallback></Avatar>
        {conv.unread_count > 0 && (
          <span className="absolute -end-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[hsl(38_92%_54%)] px-1 text-[12px] font-bold text-[#161309]" aria-label={t('pc_unread', { n: conv.unread_count })}>{conv.unread_count}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={cn('truncate text-sm text-[hsl(218_45%_14%)]', conv.unread_count > 0 ? 'font-bold' : 'font-semibold')}>{name}</span>
          {when && <span className="shrink-0 text-xs tabular-nums text-[hsl(218_28%_38%)]">{sameDay ? when.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : when.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}</span>}
        </div>
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-[hsl(218_28%_38%)]">
          {conv.muted_by_me && <BellOff className="h-3 w-3 shrink-0" aria-label={t('pc_muted_badge')} />}
          {conv.status === 'BLOCKED' && <Ban className="h-3 w-3 shrink-0" aria-hidden="true" />}
          {isMine && <span className="shrink-0">{t('chat_you_prefix')}</span>}
          {KindIcon && <KindIcon className="h-3 w-3 shrink-0" aria-hidden="true" />}
          <span className="truncate">{preview}</span>
        </p>
      </div>
    </button>
  );
}

/* ── Existing behaviours kept: share contact, report ────────────────────── */

function ShareContactDialog({ open, onClose, conversationId, sharerId }: { open: boolean; onClose: () => void; conversationId: string; sharerId: string }) {
  const { t } = useLanguage();
  const [phone, setPhone] = useState(''); const [whatsapp, setWhatsapp] = useState(''); const [telegram, setTelegram] = useState(''); const [loading, setLoading] = useState(false);
  const handleShare = async () => { setLoading(true); try { await shareContactInfo(conversationId, sharerId, { phone: phone || undefined, whatsapp: whatsapp || undefined, telegram: telegram || undefined }); toast.success(t('chat_contact_shared_toast')); onClose(); } catch { toast.error(t('chat_failed_share_contact')); } finally { setLoading(false); } };
  return <Dialog open={open} onOpenChange={onClose}><DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md"><DialogHeader><DialogTitle>{t('chat_share_dialog_title')}</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">{t('chat_share_dialog_desc')}</p><div className="space-y-3 mt-2"><div><label className="text-xs text-muted-foreground mb-1 block">{t('profile_field_phone')}</label><Input placeholder={t('chat_phone_ph')} value={phone} onChange={e => setPhone(e.target.value)} dir="ltr" /></div><div><label className="text-xs text-muted-foreground mb-1 block">{t('contact_whatsapp')}</label><Input placeholder={t('chat_phone_ph')} value={whatsapp} onChange={e => setWhatsapp(e.target.value)} dir="ltr" /></div><div><label className="text-xs text-muted-foreground mb-1 block">{t('contact_telegram')}</label><Input placeholder={t('chat_telegram_ph')} value={telegram} onChange={e => setTelegram(e.target.value)} dir="ltr" /></div></div><DialogFooter><Button variant="outline" className="min-h-11" onClick={onClose}>{t('general_cancel')}</Button><Button className="min-h-11" onClick={handleShare} disabled={loading || (!phone && !whatsapp && !telegram)}>{loading ? t('chat_sharing') : t('chat_share_btn')}</Button></DialogFooter></DialogContent></Dialog>;
}

const REPORT_REASONS = ['SPAM', 'HARASSMENT', 'SCAM', 'INAPPROPRIATE_CONTENT', 'OTHER'] as const;

function ReportConversationDialog({ open, onClose, conversationId, reporterId }: { open: boolean; onClose: () => void; conversationId: string; reporterId: string }) {
  const { t } = useLanguage();
  const [reason, setReason] = useState<string>('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = async () => {
    if (!reason) return;
    setSubmitting(true);
    try {
      await reportConversation(conversationId, reporterId, reason, details.trim() || undefined);
      toast.success(t('chat_report_success'));
      setReason(''); setDetails(''); onClose();
    } catch {
      toast.error(t('chat_report_error'));
    } finally { setSubmitting(false); }
  };
  return <Dialog open={open} onOpenChange={onClose}><DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md"><DialogHeader><DialogTitle>{t('pc_report')}</DialogTitle></DialogHeader><div className="space-y-3 mt-2"><div><label htmlFor="pc-report-reason" className="text-xs text-muted-foreground mb-1 block">{t('chat_report_reason_label')}</label><select id="pc-report-reason" className="min-h-11 w-full px-3 py-2 bg-white border border-border rounded-lg text-base sm:text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]" value={reason} onChange={e => setReason(e.target.value)}><option value="">{t('chat_report_reason_ph')}</option>{REPORT_REASONS.map(r => <option key={r} value={r}>{t(`chat_report_reason_${r.toLowerCase()}`)}</option>)}</select></div><div><label className="text-xs text-muted-foreground mb-1 block">{t('chat_report_details_label')}</label><Input placeholder={t('chat_report_details_ph')} value={details} onChange={e => setDetails(e.target.value)} /></div></div><DialogFooter><Button variant="outline" className="min-h-11" onClick={onClose}>{t('general_cancel')}</Button><Button variant="destructive" className="min-h-11" onClick={handleSubmit} disabled={submitting || !reason}>{submitting ? t('chat_report_submitting') : t('chat_report_submit')}</Button></DialogFooter></DialogContent></Dialog>;
}

/* ── The open thread ────────────────────────────────────────────────────── */

function ActiveThread({ conv, myId, onBack, onChanged }: { conv: ChatConversation; myId: string; onBack: () => void; onChanged: () => void }) {
  const { t } = useLanguage();
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [sharedContact, setSharedContact] = useState<Record<string, string> | null>(null);
  /* OPENING A CONVERSATION READS ITS NOTIFICATIONS. The bell must not stay lit for messages somebody is looking at. Only the notification's read flag — the messages' own SEEN receipts are mark_conversation_seen's job, a separate fact. The thread also says which conversation is on screen, so the live toast does not cover the composer to announce a message arriving in it; and it re-reads when the tab comes back into view, because a message that landed in a background tab had not been seen yet. */
  useEffect(() => { setActiveConversation(conv.id); const read = () => { if (document.visibilityState === 'visible') void markConversationNotificationsRead(conv.id, myId); }; read(); document.addEventListener('visibilitychange', read); return () => { document.removeEventListener('visibilitychange', read); if (getActiveConversation() === conv.id) setActiveConversation(null); }; }, [conv.id, myId]);
  useEffect(() => { setSharedContact(null); getContactShare(conv.id, conv.initiator_id === myId ? conv.recipient_id : conv.initiator_id).then(c => { if (c) setSharedContact({ phone: c.phone ?? '', whatsapp: c.whatsapp ?? '', telegram: c.telegram ?? '' }); }).catch(() => {}); }, [conv.id, conv.initiator_id, conv.recipient_id, myId]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {sharedContact && (sharedContact.phone || sharedContact.whatsapp || sharedContact.telegram) && (
        <div className="flex shrink-0 items-center gap-3 border-b border-gold-border bg-gold/[0.04] px-4 py-2 text-xs text-gold-ink">
          <Phone className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{t('chat_contact_shared_prefix')} {[sharedContact.phone && `${t('profile_field_phone')}: ${sharedContact.phone}`, sharedContact.whatsapp && `${t('contact_whatsapp')}: ${sharedContact.whatsapp}`, sharedContact.telegram && `${t('contact_telegram')}: ${sharedContact.telegram}`].filter(Boolean).join(' · ')}</span>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <PropertyConversation conv={conv} myId={myId} onBack={onBack} onChanged={onChanged}
          onShareContact={() => setShareOpen(true)} onReport={() => setReportOpen(true)} />
      </div>
      <ShareContactDialog open={shareOpen} onClose={() => setShareOpen(false)} conversationId={conv.id} sharerId={myId} />
      <ReportConversationDialog open={reportOpen} onClose={() => setReportOpen(false)} conversationId={conv.id} reporterId={myId} />
    </div>
  );
}

export default function ChatPage() {
  const { homatchUser } = useAuth(); const { t } = useLanguage(); const location = useLocation();
  const [convs, setConvs] = useState<ChatConversation[]>([]); const [loading, setLoading] = useState(true); const [activeId, setActiveId] = useState<string | null>(null);
  /* `conversation` is the parameter; `c` is what message notifications carried before the link was corrected, and those rows still exist. */
  const requestedConversationId = new URLSearchParams(location.search).get('conversation') ?? new URLSearchParams(location.search).get('c');
  const load = useCallback(async (quiet = false) => { if (!homatchUser) return; if (!quiet) setLoading(true); try { setConvs(await getPropertyConversations(homatchUser.id)); } catch { if (!quiet) toast.error(t('pc_err_generic')); } finally { if (!quiet) setLoading(false); } }, [homatchUser, t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!requestedConversationId || loading) return; if (convs.some(c => c.id === requestedConversationId)) setActiveId(requestedConversationId); }, [requestedConversationId, convs, loading]);
  /* The list follows new conversations, new messages (last_message_at) and read receipts, quietly. */
  useEffect(() => {
    if (!homatchUser) return;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const soon = () => { if (pending) clearTimeout(pending); pending = setTimeout(() => void load(true), 300); };
    const channel = supabase.channel('conversations_list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, soon)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, soon)
      .subscribe();
    return () => { if (pending) clearTimeout(pending); supabase.removeChannel(channel); };
  }, [homatchUser, load]);
  const activeConv = convs.find(c => c.id === activeId) ?? null;
  const totalUnread = convs.reduce((s, c) => s + (c.unread_count ?? 0), 0);
  /* hidePadding, like /ai and /live-chat: the shell is a fixed-height flex column (window minus the REAL header), so h-full is the space actually left and the shell's pb-24 mobile padding never creates a second page scroll behind the composer. */
  return <RouteGuard><AppLayout hidePadding><div className="flex h-full overflow-hidden bg-white">
    <aside className={cn('flex w-full shrink-0 flex-col border-[hsl(var(--border))] md:w-80 md:border-e lg:w-96', activeConv ? 'hidden md:flex' : 'flex')} aria-label={t('pc_conversations')}>
      <div className="flex items-center justify-between bg-[#0C1119] px-4 py-4 text-white">
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquare className="h-5 w-5 shrink-0 text-[hsl(38_92%_60%)]" aria-hidden="true" />
          <h1 className="truncate text-base font-semibold text-white">{t('pc_conversations')}</h1>
          {totalUnread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[hsl(38_92%_56%)] px-1.5 text-[13px] font-bold text-[#161309]" aria-label={t('pc_unread', { n: totalUnread })}>{totalUnread}</span>}
        </div>
      </div>
      {/* The list's last rows must clear the fixed mobile tab bar now that the page itself no longer scrolls. */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="flex items-center gap-3 px-4 py-3"><Skeleton className="h-11 w-11 rounded-full" /><div className="flex-1 space-y-1.5"><Skeleton className="h-3 w-32" /><Skeleton className="h-3 w-48" /></div></div>)
          : convs.length === 0
            ? <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-16 text-center"><span className="grid h-11 w-11 place-items-center rounded-full bg-gold/10 text-gold-ink ring-1 ring-inset ring-gold/25" aria-hidden="true"><MessageCircle className="h-5 w-5" /></span><p className="text-sm font-semibold text-foreground">{t('pc_no_conversations')}</p><p className="text-xs text-muted-foreground">{t('pc_no_conversations_desc')}</p></div>
            : <ul className="divide-y divide-[hsl(var(--border)/0.6)]">{convs.map(c => <li key={c.id}><ConvItem conv={c} active={activeConv?.id === c.id} onClick={() => setActiveId(c.id)} myId={homatchUser?.id ?? ''} /></li>)}</ul>}
      </div>
    </aside>
    <section className={cn('min-w-0 flex-1 flex-col', !activeConv ? 'hidden md:flex' : 'flex')}>
      {activeConv && homatchUser
        ? <ActiveThread conv={activeConv} myId={homatchUser.id} onBack={() => setActiveId(null)} onChanged={() => void load(true)} />
        : <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-[hsl(40_33%_98%)] px-8 text-center"><span className="grid h-12 w-12 place-items-center rounded-full bg-gold/10 text-gold-ink ring-1 ring-inset ring-gold/25" aria-hidden="true"><MessageSquare className="h-5 w-5" /></span><h2 className="font-display text-lg font-semibold text-[hsl(218_45%_14%)]">{t('pc_title')}</h2><p className="max-w-sm text-sm text-muted-foreground">{t('pc_subtitle')}</p><p className="text-sm text-muted-foreground">{t('pc_select_conversation')}</p></div>}
    </section>
  </div></AppLayout></RouteGuard>;
}

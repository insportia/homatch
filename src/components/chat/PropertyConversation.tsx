import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Ban, BellOff, Bell, Building2, MapPin, MessageCircle, MoreVertical, Phone, ShieldAlert } from 'lucide-react';
import { supabase } from '@/db/supabase';
import { useLanguage } from '@/contexts/LanguageContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { intlLocaleFor } from '@/components/workspace/primitives';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  mergeMessage, newClientMessageId, shouldBroadcastTyping, typingActive, TYPING_TTL_MS, isChatLanguage,
} from '@/chat/conversation';
import {
  blockConversationCounterpart, ChatActionError, getConversationContext, getMessageTranslations, getThreadMessages,
  markConversationSeen, sendErrorKey, sendPropertyMessage, setConversationMuted, translateDraft, unblockConversationCounterpart,
  uploadDmMedia, voiceMeta, type AttachableProperty, type CachedTranslation, type ChatConversation, type ChatMessage,
  type ConversationContext, type SendInput,
} from '@/services/propertyChat';
import { MessageBubble } from './MessageBubble';
import { Composer } from './Composer';
import { TranslationPreview, type DraftTranslationState } from './TranslationPreview';
import { AiAssistPanel } from './AiAssistPanel';
import { AttachPropertyDialog } from './AttachPropertyDialog';
import type { VoiceDraft } from './VoiceRecorder';

const ICON_BTN = 'grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[hsl(218_45%_14%)] hover:bg-[hsl(42_100%_96%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]';

/**
 * The thread of one Property Conversation: the counterpart and the property it is about,
 * the messages (text, photos, voice, property cards, replies) with honest delivery
 * states, live typing, and a composer that can translate and help write — but sends only
 * when the person presses Send.
 */
export function PropertyConversation({ conv, myId, onBack, onShareContact, onReport, onChanged }: {
  conv: ChatConversation; myId: string; onBack: () => void; onShareContact: () => void; onReport: () => void; onChanged: () => void;
}) {
  const { t, lang } = useLanguage();
  const [ctx, setCtx] = useState<ConversationContext | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cached, setCached] = useState<CachedTranslation[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [preview, setPreview] = useState<DraftTranslationState | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [theirTypingAt, setTheirTypingAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingChannel = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingSent = useRef<number | null>(null);
  const pendingBlobs = useRef(new Map<string, { blob: Blob; seconds?: number }>());
  const seenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recipientId = conv.initiator_id === myId ? conv.recipient_id : conv.initiator_id;
  const myLang = isChatLanguage(lang) ? lang : 'en';
  const name = ctx?.counterpart.displayName || conv.counterpart.name || t('pc_counterpart_fallback');

  const refreshContext = useCallback(async () => {
    try { setCtx(await getConversationContext(conv.id)); } catch { /* the thread still works without the header extras */ }
  }, [conv.id]);

  const markSeenSoon = useCallback(() => {
    if (seenTimer.current) clearTimeout(seenTimer.current);
    seenTimer.current = setTimeout(() => {
      if (document.visibilityState === 'visible') void markConversationSeen(conv.id).catch(() => undefined);
    }, 400);
  }, [conv.id]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setMessages([]); setCtx(null); setPreview(null); setReplyTo(null); setText('');
    Promise.all([getThreadMessages(conv.id), getConversationContext(conv.id).catch(() => null), getMessageTranslations(conv.id, myLang).catch(() => [])])
      .then(([msgs, context, tr]) => { if (!alive) return; setMessages(msgs); setCtx(context); setCached(tr); markSeenSoon(); })
      .catch(() => { if (alive) toast.error(t('pc_err_generic')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [conv.id, myLang, markSeenSoon, t]);

  /* Live: new messages and status changes (delivered → read) arrive without a reload. */
  useEffect(() => {
    const channel = supabase.channel(`messages:${conv.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conv.id}` }, (payload) => {
        const row = payload.new as ChatMessage;
        setMessages((prev) => mergeMessage(prev, row));
        if (row.sender_id !== myId) { markSeenSoon(); setTheirTypingAt(null); }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conv.id}` }, (payload) => {
        setMessages((prev) => mergeMessage(prev, payload.new as ChatMessage));
      })
      .subscribe();
    const onVisible = () => { if (document.visibilityState === 'visible') markSeenSoon(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { supabase.removeChannel(channel); document.removeEventListener('visibilitychange', onVisible); if (seenTimer.current) clearTimeout(seenTimer.current); };
  }, [conv.id, myId, markSeenSoon]);

  /* Typing: a broadcast on typing:{conversation}. Nothing is written to the database. */
  useEffect(() => {
    const channel = supabase.channel(`typing:${conv.id}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'typing' }, (payload) => {
        if ((payload.payload as { userId?: string } | undefined)?.userId === recipientId) setTheirTypingAt(Date.now());
      })
      .subscribe();
    typingChannel.current = channel;
    return () => { supabase.removeChannel(channel); typingChannel.current = null; };
  }, [conv.id, recipientId]);
  useEffect(() => {
    if (theirTypingAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    const stop = setTimeout(() => setTheirTypingAt(null), TYPING_TTL_MS);
    return () => { clearInterval(id); clearTimeout(stop); };
  }, [theirTypingAt]);
  const onTyping = () => {
    const at = Date.now();
    if (!typingChannel.current || !shouldBroadcastTyping(lastTypingSent.current, at)) return;
    lastTypingSent.current = at;
    void typingChannel.current.send({ type: 'broadcast', event: 'typing', payload: { userId: myId } });
  };

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    bottomRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'end' });
  }, [messages.length, theirTypingAt]);

  const canSend = ctx ? ctx.canSend : conv.status !== 'BLOCKED';
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  /* ── sending ─────────────────────────────────────────────────────────── */

  const explain = (err: unknown) => {
    const key = sendErrorKey(err);
    const wait = err instanceof ChatActionError ? err.retryAfterSeconds ?? 10 : 10;
    toast.error(t(key, { seconds: wait }));
    if (err instanceof ChatActionError && ['OFFER_CAP_REACHED', 'Cannot send message', 'RECIPIENT_NOT_ACCEPTING_OFFERS'].includes(err.code)) void refreshContext();
  };

  const deliver = async (input: SendInput, optimistic: ChatMessage) => {
    setMessages((prev) => mergeMessage(prev, optimistic));
    try {
      let ready = input;
      if ((input.kind === 'PHOTO' || input.kind === 'VOICE') && !input.mediaPath) {
        const pending = pendingBlobs.current.get(input.clientMessageId);
        if (!pending) throw new ChatActionError('MEDIA_UPLOAD_FAILED');
        const mediaPath = await uploadDmMedia(myId, conv.id, pending.blob);
        ready = { ...input, mediaPath, mediaMeta: input.kind === 'VOICE' ? voiceMeta(pending.blob, pending.seconds ?? 0) : { mime: pending.blob.type, size: pending.blob.size } };
      }
      const saved = await sendPropertyMessage(ready);
      pendingBlobs.current.delete(input.clientMessageId);
      setMessages((prev) => mergeMessage(prev, { ...saved, _localUrl: optimistic._localUrl ?? null }));
      if (saved.sender_id === myId && ctx?.awaitingFirstReply) void refreshContext();
      onChanged();
      return true;
    } catch (err) {
      setMessages((prev) => mergeMessage(prev, { ...optimistic, status: 'FAILED', _retry: input }));
      explain(err);
      return false;
    }
  };

  const optimisticOf = (input: SendInput, extra: Partial<ChatMessage> = {}): ChatMessage => ({
    id: `tmp-${input.clientMessageId}`, conversation_id: conv.id, sender_id: myId, body: input.body ?? '', status: 'SENDING',
    created_at: new Date().toISOString(), kind: input.kind ?? 'TEXT', reply_to_id: input.replyToId ?? null,
    client_message_id: input.clientMessageId, original_body: input.originalBody ?? null, original_lang: input.originalLang ?? null,
    translated_to: input.translatedTo ?? null, ...extra,
  });

  const base = (): Pick<SendInput, 'conversationId' | 'recipientId' | 'clientMessageId' | 'replyToId'> => ({
    conversationId: conv.id, recipientId, clientMessageId: newClientMessageId(), replyToId: replyTo && !replyTo.id.startsWith('tmp-') ? replyTo.id : null,
  });

  const sendText = async () => {
    const body = text.trim();
    if (!body || sending) return;
    const input: SendInput = { ...base(), kind: 'TEXT', body };
    setText(''); setReplyTo(null); setSending(true);
    const ok = await deliver(input, optimisticOf(input));
    if (!ok) setText((cur) => cur || body);
    setSending(false);
  };

  const sendTranslation = async () => {
    if (!preview) return;
    const known = preview.sourceLang && isChatLanguage(preview.sourceLang) && preview.sourceLang !== preview.targetLang;
    const input: SendInput = {
      ...base(), kind: 'TEXT', body: preview.translation,
      ...(known ? { originalBody: preview.original, originalLang: preview.sourceLang, translatedTo: preview.targetLang } : {}),
    };
    setSending(true);
    const ok = await deliver(input, optimisticOf(input));
    if (ok) { setPreview(null); setText(''); setReplyTo(null); }
    setSending(false);
  };

  const startTranslate = async () => {
    const original = text.trim();
    if (!original) return;
    setTranslating(true);
    try {
      const r = await translateDraft(original, conv.id, ctx?.counterpart.preferredLanguage ?? undefined);
      if (r.sameLanguage) toast.message(t('pc_same_language'));
      else setPreview({ original, translation: r.translation, sourceLang: r.sourceLang, targetLang: r.targetLang });
    } catch (err) {
      toast.error(err instanceof ChatActionError && err.code === 'RATE_LIMITED' ? t('pc_err_rate', { seconds: err.retryAfterSeconds ?? 60 }) : t('pc_tr_error'));
    } finally { setTranslating(false); }
  };

  const sendPhoto = async (file: File, caption: string) => {
    const input: SendInput = { ...base(), kind: 'PHOTO', body: caption };
    pendingBlobs.current.set(input.clientMessageId, { blob: file });
    setReplyTo(null); setSending(true);
    await deliver(input, optimisticOf(input, { _localUrl: URL.createObjectURL(file), media_meta: { mime: file.type, size: file.size } }));
    setSending(false);
  };

  const sendVoice = async (draft: VoiceDraft) => {
    const input: SendInput = { ...base(), kind: 'VOICE', body: '' };
    pendingBlobs.current.set(input.clientMessageId, { blob: draft.blob, seconds: draft.seconds });
    setReplyTo(null); setSending(true);
    await deliver(input, optimisticOf(input, { _localUrl: draft.url, media_meta: { duration_seconds: Math.round(draft.seconds * 10) / 10 } }));
    setSending(false);
  };

  const sendProperty = async (p: AttachableProperty) => {
    const input: SendInput = { ...base(), kind: 'PROPERTY', body: '', cardPropertyId: p.id };
    setSending(true);
    const ok = await deliver(input, optimisticOf(input, {
      property_card: { id: p.id, homatch_id: p.homatch_id, title: p.title, price: p.price, currency: p.currency, city: p.city, district: p.district, bedrooms: null, area: null, cover: p.cover },
    }));
    if (ok) setAttachOpen(false);
    setSending(false);
  };

  const retry = (m: ChatMessage) => {
    if (!m._retry) return;
    void deliver(m._retry, { ...m, status: 'SENDING', _retry: null });
  };

  /* ── recipient controls ──────────────────────────────────────────────── */

  const toggleMute = async () => {
    const next = !(ctx?.mutedByMe ?? conv.muted_by_me);
    try { await setConversationMuted(conv.id, next); toast.success(t(next ? 'pc_muted_toast' : 'pc_unmuted_toast')); await refreshContext(); onChanged(); }
    catch { toast.error(t('pc_err_generic')); }
  };
  const doBlock = async () => {
    try { await blockConversationCounterpart(conv.id); toast.success(t('pc_blocked_toast')); await refreshContext(); onChanged(); }
    catch { toast.error(t('pc_err_generic')); }
    setBlockOpen(false);
  };
  const doUnblock = async () => {
    try { await unblockConversationCounterpart(conv.id); toast.success(t('pc_unblocked_toast')); await refreshContext(); onChanged(); }
    catch { toast.error(t('pc_err_generic')); }
  };

  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const muted = ctx?.mutedByMe ?? conv.muted_by_me;
  const property = ctx?.property ?? null;
  const locale = intlLocaleFor(lang);
  const price = property?.price != null && property.currency
    ? (() => { try { return new Intl.NumberFormat(locale, { style: 'currency', currency: property.currency, maximumFractionDigits: 0 }).format(property.price); } catch { return null; } })()
    : null;
  const typing = typingActive(theirTypingAt, now);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[hsl(40_33%_98%)]">
      {/* Header: who, about what, and the controls a recipient needs. */}
      <header className="shrink-0 border-b border-[hsl(var(--border))] bg-white">
        <div className="flex items-center gap-2 px-2 py-2 sm:px-4">
          <button type="button" onClick={onBack} className={cn(ICON_BTN, 'md:hidden')} aria-label={t('pc_back')}>
            <ArrowLeft className="h-5 w-5 rtl:-scale-x-100" />
          </button>
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarImage src={ctx?.counterpart.avatarUrl ?? conv.counterpart.avatar_url ?? undefined} alt="" />
            <AvatarFallback className="border border-gold/30 bg-gold/[0.06] text-xs font-semibold text-gold-ink">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 truncate text-[15px] font-semibold text-[hsl(218_45%_14%)]">
              <span className="truncate">{name}</span>
              {muted && <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[hsl(42_60%_95%)] px-1.5 py-0.5 text-2xs font-semibold text-gold-ink"><BellOff className="h-3 w-3" aria-hidden="true" />{t('pc_muted_badge')}</span>}
            </p>
            <p className="truncate text-xs text-[hsl(218_28%_38%)]" aria-live="polite">{typing ? t('pc_typing', { name }) : t('pc_title')}</p>
          </div>
          <button type="button" className={ICON_BTN} onClick={onShareContact} aria-label={t('chat_share_contact_menu')}><Phone className="h-4 w-4" /></button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={ICON_BTN} aria-label={t('pc_more_actions')}><MoreVertical className="h-4 w-4" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[14rem]">
              <DropdownMenuItem className="min-h-11" onClick={onShareContact}><Phone className="me-2 h-4 w-4" />{t('chat_share_contact_menu')}</DropdownMenuItem>
              <DropdownMenuItem className="min-h-11" onClick={() => void toggleMute()}>
                {muted ? <Bell className="me-2 h-4 w-4" /> : <BellOff className="me-2 h-4 w-4" />}{t(muted ? 'pc_unmute' : 'pc_mute')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {ctx?.blockedByMe
                ? <DropdownMenuItem className="min-h-11" onClick={() => void doUnblock()}><Ban className="me-2 h-4 w-4" />{t('pc_unblock')}</DropdownMenuItem>
                : <DropdownMenuItem className="min-h-11 text-destructive" onClick={() => setBlockOpen(true)}><Ban className="me-2 h-4 w-4" />{t('pc_block')}</DropdownMenuItem>}
              <DropdownMenuItem className="min-h-11 text-destructive" onClick={onReport}><ShieldAlert className="me-2 h-4 w-4" />{t('pc_report')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {property && (
          <div className="flex items-center gap-3 border-t border-[hsl(var(--border))] bg-[hsl(42_100%_98.5%)] px-3 py-2 sm:px-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-gold-ink ring-1 ring-inset ring-[hsl(var(--gold-border))]" aria-hidden="true"><Building2 className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[hsl(218_45%_14%)]">{property.title ?? t('pc_property_card')}</p>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-[hsl(218_28%_38%)]">
                {property.homatchId != null && <span className="tabular-nums" dir="ltr">{t('pc_property_ref', { id: property.homatchId })}</span>}
                {(property.district || property.city) && <span className="inline-flex min-w-0 items-center gap-1"><MapPin className="h-3 w-3 shrink-0" aria-hidden="true" /><span className="truncate">{[property.district, property.city].filter(Boolean).join(', ')}</span></span>}
              </p>
            </div>
            {price && <span className="shrink-0 text-sm font-bold tabular-nums text-[hsl(218_45%_14%)]">{price}</span>}
          </div>
        )}
      </header>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 sm:px-6" role="log" aria-live="polite" aria-relevant="additions">
        {loading ? (
          <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={cn('flex', i % 2 ? 'justify-end' : 'justify-start')}><Skeleton className="h-12 w-52 rounded-2xl" /></div>
          ))}</div>
        ) : messages.length === 0 ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-12 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-gold/10 text-gold-ink ring-1 ring-inset ring-gold/25" aria-hidden="true"><MessageCircle className="h-5 w-5" /></span>
            <h2 className="font-display text-lg font-semibold text-[hsl(218_45%_14%)]">{t('pc_title')}</h2>
            <p className="text-sm text-[hsl(218_28%_38%)]">{t('pc_subtitle')}</p>
            <p className="text-sm text-[hsl(218_28%_38%)]">{t('pc_empty')}</p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {messages.map((m) => (
              <MessageBubble key={m.client_message_id ?? m.id} message={m} mine={m.sender_id === myId} myLang={myLang} counterpartName={name}
                quoted={m.reply_to_id ? byId.get(m.reply_to_id) ?? null : null}
                cached={cached.filter((c) => c.messageId === m.id)} onReply={(msg) => { setReplyTo(msg); textareaRef.current?.focus(); }} onRetry={retry} />
            ))}
            {typing && (
              <div className="flex items-center gap-2 text-xs text-[hsl(218_28%_38%)]" aria-hidden="true">
                <span className="inline-flex gap-1 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2">
                  {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-[hsl(218_28%_60%)] motion-safe:animate-bounce" style={{ animationDelay: `${i * 120}ms` }} />)}
                </span>
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer — clears the fixed mobile tab bar and the home indicator. */}
      <div className="shrink-0 border-t border-[hsl(var(--border))] bg-white px-3 pb-[calc(4.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 md:pb-3">
        <div className="mx-auto max-w-3xl space-y-2">
          {ctx?.blockedByMe && <p className="rounded-xl bg-[hsl(42_60%_96%)] px-3 py-2 text-sm text-[hsl(218_45%_14%)]">{t('pc_blocked_notice')}</p>}
          {!ctx?.blockedByMe && ctx && !ctx.canSend && !ctx.awaitingFirstReply && <p className="rounded-xl bg-[hsl(42_60%_96%)] px-3 py-2 text-sm text-[hsl(218_45%_14%)]">{t('pc_blocked_by_them')}</p>}
          {ctx?.awaitingFirstReply && ctx.offerMessagesRemaining !== null && (
            <p className="px-1 text-xs text-[hsl(218_28%_38%)]">{ctx.offerMessagesRemaining > 0 ? t('pc_awaiting_reply', { n: ctx.offerMessagesRemaining }) : t('pc_err_offer_cap')}</p>
          )}
          {preview ? (
            <TranslationPreview state={preview} sending={sending} onSend={() => void sendTranslation()}
              onEdit={() => { setText(preview.original); setPreview(null); textareaRef.current?.focus(); }} onClose={() => setPreview(null)} />
          ) : (
            <Composer
              text={text} setText={setText} canSend={canSend} sending={sending} translating={translating}
              replyTo={replyTo} replyName={replyTo ? (replyTo.sender_id === myId ? t('pc_you') : name) : ''} onCancelReply={() => setReplyTo(null)}
              onSendText={() => void sendText()} onTranslate={() => void startTranslate()}
              onSendPhoto={(f, c) => void sendPhoto(f, c)} onSendVoice={(d) => void sendVoice(d)}
              onAttachProperty={() => setAttachOpen(true)} onOpenAi={() => setAiOpen(true)} onTyping={onTyping} textareaRef={textareaRef}
            />
          )}
        </div>
      </div>

      <AiAssistPanel open={aiOpen} onOpenChange={setAiOpen} conversationId={conv.id} propertyId={property?.isMine ? property.id : null}
        canOffer={!!property?.isMine} draft={text}
        onUse={(draft, focus) => { setText(draft); if (focus) setTimeout(() => textareaRef.current?.focus(), 0); }} />
      <AttachPropertyDialog open={attachOpen} onOpenChange={setAttachOpen} myId={myId} sending={sending} onPick={(p) => void sendProperty(p)} />
      <AlertDialog open={blockOpen} onOpenChange={setBlockOpen}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('pc_block_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('pc_block_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">{t('pc_cancel')}</AlertDialogCancel>
            <AlertDialogAction className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void doBlock()}>{t('pc_block')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

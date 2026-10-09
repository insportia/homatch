// THE DEMO CONVERSATION — the owner's private channel with the DEMO buyer.
//
// /property/:id/matches/demo/:conversationId. A simulated channel, and it says so on
// every screen and on every reply: demo_send_message stores the owner's message and a
// fixed-template reply in demo_messages. Nothing reaches public.messages, send-message,
// notify() or push-send, and no credits move. History is server-side, so leaving for
// the profile and coming back shows the same thread.
//
// The bubbles and delivery ticks follow ChatPage (MessageStatusIcon is shared with it),
// on the Discovery canvas the matches page lives on.

import { ArrowLeft, FlaskConical, Loader2, Send, UserRound } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MessageStatusIcon } from '@/components/chat/MessageStatusIcon';
import { RouteGuard } from '@/components/common/RouteGuard';
import { CustomerSurface, DISCOVERY_SURFACE } from '@/components/customer/surface';
import { AppLayout } from '@/components/layouts/AppLayout';
import { MatchBadge } from '@/components/matching/internal/InternalMatchesSection';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { scoreDemoMatch, type DemoMatchPayload } from '@/matching/internalMatch';
import {
  deliveryState,
  getDemoMatch,
  listDemoMessages,
  sendDemoMessage,
  type DemoMessage,
} from '@/services/internalMatchDemo';

const NAVY = 'bg-[linear-gradient(135deg,hsl(218_52%_11%)_0%,hsl(220_48%_17%)_55%,hsl(224_44%_22%)_100%)]';
const STATUS_KEY = { SENT: 'im_chat_status_sent', DELIVERED: 'im_chat_status_delivered', SEEN: 'im_chat_status_seen' } as const;

function time(iso: string, lang: string): string {
  try {
    return new Date(iso).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

function Bubble({ message }: { message: DemoMessage }) {
  const { t, lang } = useLanguage();
  const mine = message.sender === 'OWNER';
  const status = deliveryState(message);
  return (
    <li data-testid={mine ? 'demo-msg-owner' : 'demo-msg-reply'} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm sm:max-w-[75%]',
          mine
            ? 'rounded-ee-sm bg-primary text-primary-foreground'
            : 'rounded-es-sm bg-white text-[hsl(218_45%_14%)] ring-1 ring-inset ring-[hsl(328_60%_85%)]',
        )}
      >
        {!mine ? (
          <p data-testid="simulated-label" className="mb-1 inline-flex items-center gap-1 rounded-full bg-[hsl(328_70%_95%)] px-2 py-0.5 text-2xs font-bold text-[hsl(328_70%_30%)]">
            <FlaskConical className="h-3 w-3" aria-hidden="true" />{t('im_chat_simulated_reply')}
          </p>
        ) : null}
        <p className="whitespace-pre-wrap break-words leading-relaxed" dir="auto">{message.body}</p>
        <div className={cn('mt-1 flex items-center gap-1', mine ? 'justify-end' : 'justify-start')}>
          <time dateTime={message.created_at} className="text-[13px] opacity-70">{time(message.created_at, lang)}</time>
          {mine ? (
            <span className="inline-flex items-center gap-1" data-status={status}>
              <MessageStatusIcon status={status} />
              <span className="sr-only">{t(STATUS_KEY[status])}</span>
              <span aria-hidden="true" className="text-2xs opacity-70">{t(STATUS_KEY[status])}</span>
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function DemoConversationContent() {
  const { id: propertyId, conversationId } = useParams<{ id: string; conversationId: string }>();
  const navigate = useNavigate();
  const { t, lang } = useLanguage();
  const [messages, setMessages] = useState<DemoMessage[] | null>(null);
  const [context, setContext] = useState<DemoMatchPayload | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!propertyId || !conversationId) return;
    try {
      const [thread, demo] = await Promise.all([listDemoMessages(conversationId), getDemoMatch(propertyId)]);
      if (thread.conversation.property_id !== propertyId) throw new Error('DEMO_NOT_FOUND');
      setMessages(thread.messages);
      setContext(demo);
      setLoadError(false);
    } catch {
      setLoadError(true);
      setMessages([]);
    }
  }, [propertyId, conversationId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  const scored = useMemo(() => (context ? scoreDemoMatch(context) : null), [context]);
  const backToProfile = () => navigate(`/property/${propertyId}/matches?profile=demo`);

  const send = async () => {
    const body = text.trim();
    if (!body || !conversationId) return;
    setSending(true);
    setSendError(false);
    try {
      const { message, reply } = await sendDemoMessage(conversationId, body, lang);
      setMessages((prev) => [...(prev ?? []), message, reply]);
      setText('');
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <AppLayout noPadding surfaceClass={DISCOVERY_SURFACE}>
      <CustomerSurface className="pt-4 sm:pt-5">
        <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col overflow-hidden rounded-2xl bg-[hsl(40_33%_98%)] shadow-[0_10px_28px_-18px_hsl(218_60%_15%/0.45)] ring-1 ring-inset ring-[hsl(40_70%_80%)]">
          <header className={cn('flex min-w-0 items-center gap-3 px-3 py-3 sm:px-4', NAVY)}>
            <button
              type="button"
              data-testid="back-to-profile"
              onClick={backToProfile}
              className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 text-sm font-semibold text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
            >
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
              <span className="hidden sm:inline">{t('im_chat_back')}</span>
              <span className="sr-only sm:hidden">{t('im_chat_back')}</span>
            </button>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[hsl(42_100%_94%)]">
              <UserRound className="h-4 w-4 text-[hsl(34_90%_35%)]" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-semibold text-white">{t('im_demo_name')} · {t('im_badge_demo')}</h1>
              <p className="truncate text-2xs text-white/70">
                {t('im_chat_title')}
                {context?.property.homatch_id ? <> · {t('native_property_ref')} <span dir="ltr">{context.property.homatch_id}</span></> : null}
              </p>
            </div>
            <div className="hidden shrink-0 flex-wrap items-center gap-1.5 sm:flex">
              <MatchBadge kind="INTERNAL" />
              {scored?.band === 'STRONG' ? <MatchBadge kind="STRONG" /> : scored?.band === 'POTENTIAL' ? <MatchBadge kind="POTENTIAL" /> : null}
              <MatchBadge kind="DEMO" />
            </div>
          </header>
          <p data-testid="demo-banner" className="border-b border-[hsl(328_60%_88%)] bg-[hsl(328_70%_97%)] px-4 py-2 text-2xs leading-relaxed text-[hsl(328_60%_28%)]">
            {t('im_chat_demo_banner')}
          </p>

          <div className="min-h-[18rem] flex-1 overflow-y-auto px-3 py-4 sm:px-4" style={{ maxHeight: 'calc(100dvh - 20rem)' }}>
            {messages === null ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-[hsl(218_28%_38%)]" aria-hidden="true" /></div>
            ) : loadError ? (
              <p role="alert" className="py-10 text-center text-sm text-destructive">{t('im_chat_load_error')}</p>
            ) : messages.length === 0 ? (
              <p data-testid="demo-empty" className="py-10 text-center text-sm text-[hsl(218_28%_38%)]">{t('im_chat_empty')}</p>
            ) : (
              <ol className="space-y-3" aria-label={t('im_chat_title')}>
                {messages.map((m) => <Bubble key={m.id} message={m} />)}
              </ol>
            )}
            <div ref={bottomRef} />
          </div>

          <form
            className="border-t border-[hsl(40_40%_88%)] bg-white px-3 py-3 sm:px-4"
            onSubmit={(e) => { e.preventDefault(); void send(); }}
          >
            <div className="flex min-w-0 items-end gap-2">
              <label htmlFor="demo-composer" className="sr-only">{t('im_chat_placeholder')}</label>
              <textarea
                id="demo-composer"
                data-testid="demo-composer"
                rows={1}
                value={text}
                maxLength={2000}
                dir="auto"
                disabled={sending || loadError}
                placeholder={t('im_chat_placeholder')}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                className="min-h-11 min-w-0 flex-1 resize-none rounded-xl border border-[hsl(40_40%_82%)] bg-[hsl(40_33%_99%)] px-3 py-2.5 text-[16px] leading-snug text-[hsl(218_45%_14%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_50%)]"
              />
              <button
                type="submit"
                data-testid="demo-send"
                disabled={sending || !text.trim() || loadError}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[hsl(38_92%_56%)] text-[hsl(218_52%_11%)] hover:bg-[hsl(38_92%_50%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(218_52%_20%)] disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />}
                <span className="sr-only">{t('im_chat_send')}</span>
              </button>
            </div>
            {sendError ? <p role="alert" className="mt-1.5 text-2xs text-destructive">{t('im_chat_error')}</p> : null}
          </form>
        </div>
      </CustomerSurface>
    </AppLayout>
  );
}

export default function DemoConversationPage() {
  return (
    <RouteGuard>
      <DemoConversationContent />
    </RouteGuard>
  );
}

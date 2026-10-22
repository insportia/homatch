// EMAIL INBOX — /outreach/email/inbox
//
// Replies to HOMATCH email (campaigns, Email Studio, earlier CRM replies) arrive
// through the reply routes and land here, on the owner's own conversations (RLS).
// A message is shown as text, or as sanitised HTML in a sandboxed frame with remote
// images blocked until the reader allows them. Replying sends one email in the same
// thread (In-Reply-To / References) through the email-marketing function; the row
// shows SENT only when the provider accepted it, DELIVERED only when the webhook says so.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCheck, Image as ImageIcon, Inbox, Loader2, Mail, RefreshCw, Search, Send, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { CommsWorkspace } from '@/components/communications/CommsWorkspace';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { emailFrameDocument, hasRemoteImages } from '@/emailMarketing/safeEmailHtml';
import {
  EmailMarketingError, type InboxConversation, type InboxMessage, getThread, listInbox, markRead, sendReply,
} from '@/services/emailMarketing';

const ERROR_KEY: Record<string, string> = {
  RECIPIENT_OPTED_OUT: 'emx_err_opted_out', SENDING_DISABLED: 'emx_err_sending_disabled', PROVIDER_KILL_SWITCH: 'emx_err_sending_disabled',
  RATE_LIMITED: 'emx_err_rate_limited', PROVIDER_NOT_CONFIGURED: 'emx_err_provider', PROVIDER_ERROR: 'emx_err_provider',
};

function MessageBody({ m }: { m: InboxMessage }) {
  const { t } = useLanguage();
  const [images, setImages] = useState(false);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const html = m.direction === 'INBOUND' ? m.html_body : null;
  const doc = useMemo(() => (html ? emailFrameDocument(html, { allowRemoteImages: images }) : null), [html, images]);
  const resize = () => {
    const f = frame.current;
    try { if (f?.contentDocument?.body) f.style.height = `${Math.min(f.contentDocument.body.scrollHeight + 24, 1600)}px`; } catch { /* sandboxed */ }
  };
  if (!doc) return <p dir="auto" className="whitespace-pre-wrap break-words text-sm leading-relaxed">{m.body || t('emx_empty_body')}</p>;
  return (
    <div className="space-y-2">
      {hasRemoteImages(html ?? '') && !images && (
        <button type="button" onClick={() => setImages(true)} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-2xs font-semibold ring-1 ring-inset ring-border hover:bg-muted">
          <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />{t('emx_load_images')}
        </button>
      )}
      {/* sandbox="allow-same-origin" only so the height can be measured; scripts never run (no allow-scripts) and the CSP blocks network. */}
      <iframe ref={frame} title={t('emx_message_frame')} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} onLoad={resize}
        className="h-64 w-full rounded-lg bg-white ring-1 ring-inset ring-border" referrerPolicy="no-referrer" />
    </div>
  );
}

export default function EmailInboxPage() {
  const { t, lang } = useLanguage();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('conversation');
  const [items, setItems] = useState<InboxConversation[] | null>(null);
  const [q, setQ] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [thread, setThread] = useState<InboxMessage[] | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const requestId = useRef<string>(crypto.randomUUID());

  const load = useCallback(async () => {
    try { setItems(await listInbox({ q, unreadOnly })); } catch { setItems([]); toast.error(t('emx_inbox_failed')); }
  }, [q, unreadOnly, t]);
  useEffect(() => { const id = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(id); }, [load]);

  const selected = items?.find((c) => c.id === selectedId) ?? null;
  const openThread = useCallback(async (id: string) => {
    setThread(null);
    try {
      setThread(await getThread(id));
      await markRead(id);
      setItems((all) => all?.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)) ?? all);
    } catch { setThread([]); toast.error(t('emx_thread_failed')); }
  }, [t]);
  useEffect(() => { if (selectedId) void openThread(selectedId); else setThread(null); }, [selectedId, openThread]);

  const send = async () => {
    if (!selectedId || !reply.trim()) return;
    setSending(true);
    try {
      await sendReply(selectedId, reply.trim(), requestId.current);
      requestId.current = crypto.randomUUID();
      setReply('');
      toast.success(t('emx_reply_sent'));
      await openThread(selectedId);
      void load();
    } catch (e) {
      const code = e instanceof EmailMarketingError ? e.code : '';
      toast.error(t(ERROR_KEY[code] ?? 'emx_reply_failed'));
    } finally { setSending(false); }
  };
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const statusLabel = (m: InboxMessage) => t(`emx_status_${m.status.toLowerCase()}`);

  return (
    <CommsWorkspace product="email" header={(
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold"><Inbox className="h-5 w-5 text-gold-ink" aria-hidden="true" />{t('emx_inbox_title')}</h1>
          <p className="mt-0.5 max-w-prose text-sm text-muted-foreground">{t('emx_inbox_subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="me-2 h-4 w-4" aria-hidden="true" />{t('emx_refresh')}</Button>
      </div>
    )}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <section className={cn('min-w-0 space-y-2', selectedId && 'hidden lg:block')} aria-label={t('emx_conversations')}>
          <div className="flex gap-2">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">{t('emx_search')}</span>
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('emx_search')} dir="auto"
                className="h-10 w-full rounded-xl bg-background pe-3 ps-9 text-sm ring-1 ring-inset ring-border focus:outline-none focus:ring-2 focus:ring-ring" />
            </label>
            <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly((v) => !v)}
              className={cn('min-h-10 shrink-0 rounded-xl px-3 text-2xs font-semibold ring-1 ring-inset', unreadOnly ? 'bg-foreground text-background ring-foreground' : 'ring-border hover:bg-muted')}>
              {t('emx_unread')}
            </button>
          </div>
          {items === null ? <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t('emx_loading')}</div>
            : items.length === 0 ? (
              <div className="rounded-2xl border bg-card p-6 text-center">
                <Mail className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold">{t('emx_inbox_empty')}</p>
                <p className="mt-1 text-2xs text-muted-foreground">{t('emx_inbox_empty_body')}</p>
              </div>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border bg-card">
                {items.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => setParams({ conversation: c.id })} aria-current={c.id === selectedId ? 'true' : undefined}
                      className={cn('flex w-full min-w-0 flex-col items-start gap-0.5 px-3.5 py-3 text-start hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', c.id === selectedId && 'bg-[hsl(42_100%_96%)]')}>
                      <span className="flex w-full min-w-0 items-center gap-2">
                        <span dir="auto" className={cn('min-w-0 flex-1 truncate text-sm', c.unread_count > 0 ? 'font-bold' : 'font-medium')}>{c.peer_name || c.peer_address}</span>
                        {c.unread_count > 0 && <span className="rounded-full bg-[hsl(38_92%_50%)] px-1.5 text-2xs font-bold text-black">{c.unread_count}</span>}
                      </span>
                      <span className="w-full truncate text-2xs text-muted-foreground" dir="ltr">{c.peer_address}</span>
                      <span dir="auto" className="line-clamp-2 w-full text-2xs text-muted-foreground">{c.last_message_preview}</span>
                      <span className="text-2xs text-muted-foreground">{fmt(c.last_message_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </section>

        <section className={cn('min-w-0 space-y-3', !selectedId && 'hidden lg:block')} aria-label={t('emx_thread')}>
          {!selectedId ? (
            <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">{t('emx_pick_conversation')}</div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setParams({})} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted lg:hidden" aria-label={t('emx_back')}>
                  <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                </button>
                <div className="min-w-0">
                  <h2 dir="auto" className="truncate text-base font-semibold">{selected?.peer_name || selected?.peer_address}</h2>
                  <p className="truncate text-2xs text-muted-foreground" dir="ltr">{selected?.peer_address}</p>
                </div>
              </div>
              {thread === null ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : (
                <ol className="space-y-3">
                  {thread.map((m) => {
                    const meta = (m.email_meta ?? {}) as { subject?: string; authentication?: { spf?: string; dkim?: string; dmarc?: string } | null; attachments?: Array<{ filename?: string }> };
                    const auth = meta.authentication;
                    const suspicious = m.direction === 'INBOUND' && auth && (auth.dmarc === 'fail' || (auth.spf === 'fail' && auth.dkim === 'fail'));
                    return (
                      <li key={m.id} className={cn('space-y-2 rounded-2xl border p-3.5', m.direction === 'OUTBOUND' ? 'ms-6 bg-[hsl(218_60%_97%)]' : 'me-6 bg-card')}>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-muted-foreground">
                          <span className="font-semibold text-foreground">{t(m.direction === 'OUTBOUND' ? 'emx_you' : 'emx_them')}</span>
                          <span className="flex items-center gap-1.5">
                            {m.direction === 'OUTBOUND' && (
                              <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold', m.status === 'FAILED' ? 'bg-[hsl(350_60%_95%)] text-[hsl(350_60%_35%)]' : 'bg-muted')}>
                                {m.status === 'DELIVERED' && <CheckCheck className="h-3 w-3" aria-hidden="true" />}{statusLabel(m)}
                              </span>
                            )}
                            {fmt(m.sent_at ?? m.created_at)}
                          </span>
                        </div>
                        {meta.subject ? <p dir="auto" className="text-sm font-semibold">{meta.subject}</p> : null}
                        {suspicious && (
                          <p className="flex items-center gap-1.5 rounded-lg bg-[hsl(42_100%_94%)] px-2.5 py-1.5 text-2xs text-[hsl(34_90%_28%)]">
                            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />{t('emx_auth_failed')}
                          </p>
                        )}
                        {m.direction === 'INBOUND' && auth && !suspicious && auth.dmarc === 'pass' && (
                          <p className="flex items-center gap-1 text-2xs text-[hsl(158_64%_28%)]"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{t('emx_auth_ok')}</p>
                        )}
                        <MessageBody m={m} />
                        {(meta.attachments?.length ?? 0) > 0 && (
                          <p className="text-2xs text-muted-foreground">{t('emx_attachments', { n: String(meta.attachments!.length) })}: {meta.attachments!.map((a) => a.filename).filter(Boolean).join(', ')}</p>
                        )}
                        {m.status === 'FAILED' && m.error_message ? <p className="text-2xs text-[hsl(350_60%_40%)]">{m.error_message}</p> : null}
                      </li>
                    );
                  })}
                </ol>
              )}
              <div className="space-y-2 rounded-2xl border bg-card p-3">
                <label className="block">
                  <span className="sr-only">{t('emx_reply')}</span>
                  <textarea value={reply} onChange={(e) => setReply(e.target.value.slice(0, 20000))} rows={5} dir="auto" placeholder={t('emx_reply_placeholder')}
                    className="w-full rounded-xl bg-background p-3 text-sm ring-1 ring-inset ring-border focus:outline-none focus:ring-2 focus:ring-ring" />
                </label>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-2xs text-muted-foreground">{t('emx_reply_note')}</p>
                  <Button onClick={() => void send()} disabled={sending || !reply.trim()}>
                    {sending ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="me-2 h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />}{t('emx_send_reply')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </CommsWorkspace>
  );
}

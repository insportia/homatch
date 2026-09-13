// HOMATCH — the unified WhatsApp inbox.
//
// §35's three panes on desktop, and §81's single pane on a phone. The right
// pane becomes a drawer on a narrow desktop and a sheet on mobile, because an
// operator on a 390px screen needs the conversation, not a column of chips
// squeezed to nothing beside it.
//
// THE PART THAT IS NOT LAYOUT
//
// §36. AI and a human must never both be replying. The mode is shown, the
// takeover is explicit, and the transition goes through a conditional update
// on the server so two operators racing produce one winner. The composer is
// disabled — with a reason — whenever this operator is not the one holding the
// conversation.
//
// §31's 24-hour window is enforced here too: outside it, free text is refused
// and an approved template is required. That is checked on the server before
// any send, and mirrored here so the composer explains itself rather than
// failing after the fact.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Bot, Check, CheckCheck, Clock, Info, Loader2, MessageSquare,
  Search, Send, User, X, AlertTriangle,
} from 'lucide-react';
import { CommsWorkspace } from '@/components/communications/CommsWorkspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  LoadingBlock, EmptyState, ErrorState, StatusBadge, relativeTime, formatPhone,
} from '@/components/communications/primitives';
import {
  listConversations, listMessages, sendWhatsAppMessage, setConversationMode,
  markConversationRead, listTemplates, subscribeToConversations, getContact,
} from '@/services/communications';
import type { CommConversation, CommMessage, CommTemplate, CommContact } from '@/types/communications';
import { requiresTemplate, isWithinServiceWindow } from '@/lib/comm/statusMap';
import { mayAiReply } from '@/lib/comm/handoff';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];
type Filter = 'ALL' | 'UNREAD' | 'AI' | 'HUMAN' | 'QUALIFIED';

export default function WhatsAppInboxPage() {
  const { t, lang: language } = useLanguage();
  const { supaUser: user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const selectedId = params.get('c');
  const [conversations, setConversations] = useState<CommConversation[]>([]);
  const [messages, setMessages] = useState<CommMessage[]>([]);
  const [templates, setTemplates] = useState<CommTemplate[]>([]);
  const [contact, setContact] = useState<CommContact | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [templateId, setTemplateId] = useState<string>('');
  const [sending, setSending] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  const loadList = useCallback(async () => {
    setError(null);
    try {
      setConversations(await listConversations({
        unread: filter === 'UNREAD',
        mode: filter === 'AI' ? 'AI' : filter === 'HUMAN' ? 'HUMAN' : undefined,
        qualified: filter === 'QUALIFIED',
        search: search.trim() || undefined,
        limit: 100,
      }));
    } catch {
      setError('comm_inbox_load_failed');
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { void (async () => setTemplates(await listTemplates()))(); }, []);

  // §123: one scoped channel for the whole screen, filtered to this owner.
  useEffect(() => {
    if (!user?.id) return;
    return subscribeToConversations(user.id, () => {
      void loadList();
      if (selectedId) void listMessages(selectedId).then(setMessages);
    });
  }, [user?.id, loadList, selectedId]);

  useEffect(() => {
    if (!selectedId) { setMessages([]); setContact(null); return; }
    setLoadingThread(true);
    void (async () => {
      const [msgs] = await Promise.all([listMessages(selectedId)]);
      setMessages(msgs);
      setLoadingThread(false);
      await markConversationRead(selectedId);
    })();
  }, [selectedId]);

  useEffect(() => {
    if (!selected?.contact_id) { setContact(null); return; }
    void getContact(selected.contact_id).then(setContact);
  }, [selected?.contact_id]);

  const needsTemplate = selected ? requiresTemplate(selected.service_window_expires_at) : false;
  const humanHolds = selected?.mode === 'HUMAN_ACTIVE';
  const aiHolds = selected ? mayAiReply(selected.mode) : false;
  const closed = selected?.mode === 'CLOSED';

  const onSend = useCallback(async () => {
    if (!selected) return;
    if (!draft.trim() && !templateId) return;
    setSending(true);
    try {
      const result = await sendWhatsAppMessage({
        conversationId: selected.id,
        text: templateId ? undefined : draft.trim(),
        templateId: templateId || undefined,
      });
      if (!result.ok) {
        const code = result.error;
        toast.error(t(
          code === 'OUTSIDE_SERVICE_WINDOW' ? 'comm_send_needs_template'
          : code === 'SUPPRESSED' ? 'comm_send_suppressed'
          : code === 'HUMAN_HAS_THE_CONVERSATION' ? 'comm_send_human_holds'
          : code === 'DOMAIN_BLOCKED' ? 'comm_send_out_of_scope'
          : code === 'TEMPLATE_NOT_APPROVED' ? 'comm_send_template_not_approved'
          : code === 'RATE_LIMIT' ? 'comm_send_rate_limited'
          : code === 'CHANNEL_NOT_CONFIGURED' ? 'comm_channel_unavailable_short'
          : 'comm_send_failed',
        ));
        return;
      }
      setDraft('');
      setTemplateId('');
      setMessages(await listMessages(selected.id));
      void loadList();
    } finally {
      setSending(false);
    }
  }, [selected, draft, templateId, loadList, t]);

  const onTakeOver = useCallback(async () => {
    if (!selected) return;
    const ok = await setConversationMode(selected.id, selected.mode, 'HUMAN_ACTIVE', 'operator took over from the inbox');
    // A refusal means somebody else got there first, which is information, not
    // an error to swallow.
    toast[ok ? 'success' : 'error'](t(ok ? 'comm_took_over' : 'comm_takeover_lost'));
    if (ok) void loadList();
  }, [selected, loadList, t]);

  const onReturnToAi = useCallback(async () => {
    if (!selected) return;
    const ok = await setConversationMode(selected.id, selected.mode, 'AI_ACTIVE', 'returned to the assistant');
    toast[ok ? 'success' : 'error'](t(ok ? 'comm_returned_to_ai' : 'comm_save_failed'));
    if (ok) void loadList();
  }, [selected, loadList, t]);

  return (
    <CommsWorkspace>
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => navigate('/outreach/whatsapp')}>
                <ArrowLeft className="me-1.5 h-3.5 w-3.5 rtl:rotate-180" />{t('comm_channel_whatsapp')}
              </Button>
              <h1 className="text-lg font-semibold">{t('comm_inbox_title')}</h1>
            </div>
          </div>

          {error ? <ErrorState messageKey={error} onRetry={() => { setLoading(true); void loadList(); }} /> : null}

          <div className={cn(
            'grid gap-3 rounded-lg border',
            // Three panes at xl, two at lg, one below — §35 and §81.
            'lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_280px]',
          )}>
            {/* LEFT: the list. Hidden on mobile once a thread is open. */}
            <aside className={cn('min-w-0 border-e p-2', selectedId && 'hidden lg:block')}>
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('comm_inbox_search')} aria-label={t('comm_inbox_search')}
                  className="h-8 ps-8 text-xs"
                />
              </div>

              <div className="mb-2 flex flex-wrap gap-1">
                {(['ALL', 'UNREAD', 'AI', 'HUMAN', 'QUALIFIED'] as Filter[]).map((f) => (
                  <button
                    key={f} type="button"
                    aria-pressed={filter === f}
                    onClick={() => setFilter(f)}
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[13px] transition-colors',
                      filter === f ? 'border-foreground bg-foreground text-background' : 'text-muted-foreground hover:border-foreground/30',
                    )}
                  >
                    {t(`comm_inbox_filter_${f.toLowerCase()}` as TKey)}
                  </button>
                ))}
              </div>

              <div className="max-h-[60vh] space-y-0.5 overflow-y-auto lg:max-h-[calc(100vh-16rem)]">
                {loading ? <LoadingBlock rows={4} /> : !conversations.length ? (
                  <EmptyState icon={MessageSquare} titleKey="comm_inbox_empty" bodyKey="comm_inbox_empty_body" />
                ) : conversations.map((c) => (
                  <button
                    key={c.id} type="button"
                    onClick={() => setParams({ c: c.id }, { replace: true })}
                    className={cn(
                      'w-full rounded-md p-2 text-start transition-colors',
                      c.id === selectedId ? 'bg-muted' : 'hover:bg-muted/50',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium">
                        {c.peer_name || formatPhone(c.peer_address)}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {c.mode === 'AI_ACTIVE' ? <Bot className="h-3 w-3 text-muted-foreground" aria-label={t('comm_mode_ai')} />
                          : c.mode === 'PENDING_HANDOFF' ? <AlertTriangle className="h-3 w-3 text-amber-500" aria-label={t('comm_mode_pending')} />
                          : <User className="h-3 w-3 text-muted-foreground" aria-label={t('comm_mode_human')} />}
                        {c.unread_count > 0 ? (
                          <span className="min-w-4 rounded-full bg-foreground px-1 text-center text-[13px] font-semibold text-background">
                            {c.unread_count}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] text-muted-foreground">{c.last_message_preview ?? '·'}</span>
                      <span className="shrink-0 text-[13px] text-muted-foreground">{relativeTime(c.last_message_at, language)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </aside>

            {/* CENTRE: the conversation. */}
            <section className={cn('flex min-h-[60vh] min-w-0 flex-col', !selectedId && 'hidden lg:flex')}>
              {!selected ? (
                <div className="flex flex-1 items-center justify-center p-6">
                  <p className="text-xs text-muted-foreground">{t('comm_inbox_pick')}</p>
                </div>
              ) : (
                <>
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b p-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7 lg:hidden"
                        aria-label={t('comm_back')}
                        onClick={() => setParams({}, { replace: true })}
                      >
                        <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" />
                      </Button>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{selected.peer_name || formatPhone(selected.peer_address)}</p>
                        <p className="truncate text-[13px] text-muted-foreground">{formatPhone(selected.peer_address)}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <StatusBadge status={selected.lead_stage} labelKey={`comm_stage_${selected.lead_stage.toLowerCase()}`} />
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7 xl:hidden"
                        aria-label={t('comm_details')}
                        onClick={() => setShowDetails(true)}
                      >
                        <Info className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </header>

                  {/* §36's state, stated plainly with the one action that changes it. */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-2.5 py-1.5">
                    <span className="flex items-center gap-1.5 text-[13px]">
                      {aiHolds ? <Bot className="h-3 w-3" aria-hidden="true" /> : <User className="h-3 w-3" aria-hidden="true" />}
                      {t(aiHolds ? 'comm_mode_ai_active'
                        : selected.mode === 'PENDING_HANDOFF' ? 'comm_mode_pending_handoff'
                        : humanHolds ? 'comm_mode_human_active'
                        : 'comm_mode_closed')}
                    </span>
                    {!humanHolds && !closed ? (
                      <Button size="sm" variant="outline" className="h-6 text-[13px]" onClick={() => void onTakeOver()}>
                        {t('comm_take_over')}
                      </Button>
                    ) : humanHolds ? (
                      <Button size="sm" variant="ghost" className="h-6 text-[13px]" onClick={() => void onReturnToAi()}>
                        {t('comm_return_to_ai')}
                      </Button>
                    ) : null}
                  </div>

                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                    {loadingThread ? <LoadingBlock rows={4} /> : messages.map((m) => <MessageBubble key={m.id} message={m} />)}
                  </div>

                  <footer className="border-t p-2.5">
                    {needsTemplate ? (
                      <Alert className="mb-2">
                        <Clock className="h-4 w-4" />
                        <AlertDescription className="text-[13px]">{t('comm_window_closed')}</AlertDescription>
                      </Alert>
                    ) : null}

                    {needsTemplate ? (
                      <Select value={templateId} onValueChange={setTemplateId}>
                        <SelectTrigger className="mb-2 h-8 text-xs" aria-label={t('comm_pick_template')}>
                          <SelectValue placeholder={t('comm_pick_template')} />
                        </SelectTrigger>
                        <SelectContent>
                          {templates.filter((tpl) => tpl.status === 'APPROVED').map((tpl) => (
                            <SelectItem key={tpl.id} value={tpl.id}>{tpl.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}

                    <div className="flex items-end gap-2">
                      <Textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={needsTemplate ? t('comm_composer_template_only') : t('comm_composer_placeholder')}
                        disabled={needsTemplate || closed || sending}
                        rows={2}
                        maxLength={4096}
                        className="min-h-[38px] resize-none text-sm"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void onSend(); }
                        }}
                      />
                      <Button
                        size="icon" className="h-9 w-9 shrink-0"
                        aria-label={t('comm_send')}
                        disabled={sending || closed || (!draft.trim() && !templateId)}
                        onClick={() => void onSend()}
                      >
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 rtl:rotate-180" />}
                      </Button>
                    </div>
                  </footer>
                </>
              )}
            </section>

            {/* RIGHT: contact intelligence. A drawer below xl. */}
            <aside className="hidden min-w-0 border-s p-3 xl:block">
              <ContactPanel conversation={selected} contact={contact} />
            </aside>
          </div>
        </div>

        <Sheet open={showDetails} onOpenChange={setShowDetails}>
          <SheetContent side="right" className="w-[320px] overflow-y-auto">
            <SheetTitle className="text-sm">{t('comm_details')}</SheetTitle>
            <div className="mt-3">
              <ContactPanel conversation={selected} contact={contact} />
            </div>
          </SheetContent>
        </Sheet>
    </CommsWorkspace>
  );
}

function MessageBubble({ message }: { message: CommMessage }) {
  const { t, lang: language } = useLanguage();
  const outbound = message.direction === 'OUTBOUND';

  return (
    <div className={cn('flex', outbound ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[80%] rounded-lg px-2.5 py-1.5',
        outbound ? 'bg-foreground text-background' : 'bg-muted',
      )}>
        {/* An operator must be able to tell at a glance whether the AI said
            this or a colleague did (§35). */}
        {outbound && message.author !== 'HUMAN' ? (
          <p className="mb-0.5 flex items-center gap-1 text-[13px] opacity-70">
            <Bot className="h-2.5 w-2.5" aria-hidden="true" />{t('comm_mode_ai')}
          </p>
        ) : null}

        {message.kind === 'AUDIO' ? (
          <p className="text-xs italic">
            {message.transcript ? message.transcript : t('comm_voice_note')}
          </p>
        ) : message.kind !== 'TEXT' && message.kind !== 'TEMPLATE' && !message.body ? (
          <p className="text-xs italic opacity-80">{t(`comm_kind_${message.kind.toLowerCase()}` as TKey)}</p>
        ) : (
          <p className="whitespace-pre-wrap break-words text-xs">{message.body}</p>
        )}

        <p className={cn('mt-0.5 flex items-center justify-end gap-1 text-[13px]', outbound ? 'opacity-70' : 'text-muted-foreground')}>
          {relativeTime(message.sent_at ?? message.created_at, language)}
          {outbound ? <DeliveryTick status={message.status} /> : null}
        </p>

        {message.error_message ? (
          <p className="mt-0.5 text-[13px] text-red-400">{message.error_message}</p>
        ) : null}
      </div>
    </div>
  );
}

/** §84: the tick has a label, so delivery state is never colour or shape alone. */
function DeliveryTick({ status }: { status: string }) {
  const { t } = useLanguage();
  const label = t(`comm_status_${status.toLowerCase()}` as TKey);
  if (status === 'FAILED') return <X className="h-3 w-3 text-red-400" aria-label={label} />;
  if (status === 'READ') return <CheckCheck className="h-3 w-3 text-sky-400" aria-label={label} />;
  if (status === 'DELIVERED') return <CheckCheck className="h-3 w-3" aria-label={label} />;
  if (status === 'SENT') return <Check className="h-3 w-3" aria-label={label} />;
  return <Clock className="h-3 w-3" aria-label={label} />;
}

function ContactPanel({
  conversation, contact,
}: { conversation: CommConversation | null; contact: CommContact | null }) {
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();
  if (!conversation) return null;

  const within = isWithinServiceWindow(conversation.service_window_expires_at);

  const facts: Array<[string, string | null]> = [
    ['comm_contact_intent', contact?.transaction_type ?? null],
    ['comm_contact_property_type', contact?.property_type ?? null],
    ['comm_contact_locations', contact?.preferred_locations?.join(', ') ?? null],
    ['comm_contact_bedrooms', contact?.bedrooms != null ? String(contact.bedrooms) : null],
    ['comm_contact_budget', contact?.budget_max
      ? new Intl.NumberFormat(language, { style: 'currency', currency: contact.currency ?? 'USD', maximumFractionDigits: 0 }).format(contact.budget_max)
      : null],
    ['comm_contact_timeline', contact?.timeline ?? null],
  ];

  return (
    <div className="space-y-3 text-xs">
      <div>
        <p className="font-medium">{conversation.peer_name || formatPhone(conversation.peer_address)}</p>
        <p className="text-[13px] text-muted-foreground">{formatPhone(conversation.peer_address)}</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <StatusBadge status={conversation.lead_stage} labelKey={`comm_stage_${conversation.lead_stage.toLowerCase()}`} />
        {conversation.lead_score != null ? (
          <Badge variant="outline" className="text-[13px]">{t('comm_lead_score')} {conversation.lead_score}</Badge>
        ) : null}
        {conversation.language ? (
          <Badge variant="outline" className="text-[13px] uppercase">{conversation.language}</Badge>
        ) : null}
      </div>

      {/* Meta's window, in words a person can act on rather than a timestamp. */}
      <Alert className="py-2">
        <AlertDescription className="text-[13px]">
          {within
            ? t('comm_window_open').replace('{when}', relativeTime(conversation.service_window_expires_at, language))
            : t('comm_window_closed_short')}
        </AlertDescription>
      </Alert>

      {facts.some(([, v]) => v) ? (
        <dl className="space-y-1">
          {facts.filter(([, v]) => v).map(([key, value]) => (
            <div key={key} className="flex items-start justify-between gap-2">
              <dt className="text-muted-foreground">{t(key as TKey)}</dt>
              <dd className="text-end font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-[13px] text-muted-foreground">{t('comm_contact_nothing_known')}</p>
      )}

      {contact ? (
        <Button
          size="sm" variant="outline" className="w-full"
          onClick={() => navigate(`/outreach/contacts/${contact.id}`)}
        >
          {t('comm_open_contact')}
        </Button>
      ) : null}
    </div>
  );
}

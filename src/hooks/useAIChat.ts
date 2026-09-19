import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { sendStreamRequest } from '@/lib/sse';
import { supabase } from '@/db/supabase';
import { ensureAnonymousSession } from '@/services/anonymousSession';
import { useLanguage } from '@/contexts/LanguageContext';
import { parseSuggestedReplies, type SuggestedReply } from '@/lib/ai/suggestedReplies';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

export interface AIConversation {
  id: string;
  title: string;
  updatedAt: Date;
}

export interface PageContext {
  type: 'property' | 'developer' | 'match' | 'verify' | 'general' | 'workspace';
  data?: Record<string, unknown>;
}

/** What the server says a response cost. Display only — see AJ. */
export interface ChatBilling {
  chargedCredits: number;
  remainingCredits: number;
}

export function useAIChat() {
  const { lang, t } = useLanguage();
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  /* Set only by the SERVER's refusal, never counted here. A limit the browser
   * keeps is not a limit, and the point of this one is that it costs money. */
  const [anonLimitReached, setAnonLimitReached] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [pageContext, setPageContext] = useState<PageContext>({ type: 'general' });
  /* WHAT THE PERSON MIGHT SAY NEXT.
   *
   * Cleared the moment a turn starts, so a chip from the previous
   * answer can never be pressed against the next one — the answer it
   * belonged to is already scrolling away. Repopulated only when the
   * new answer is complete. */
  const [suggestedReplies, setSuggestedReplies] = useState<SuggestedReply[]>([]);
  /* What the last answer cost, when the server chose to say. Never
     computed here: the browser is not allowed an opinion about money. */
  const [lastBilling, setLastBilling] = useState<ChatBilling | null>(null);
  const [insufficientCredits, setInsufficientCredits] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const loadConversations = useCallback(async () => {
    const { data } = await supabase.from('ai_conversations').select('id, title, updated_at').order('updated_at', { ascending: false }).limit(30);
    if (data) setConversations(data.map(c => ({ id: c.id, title: c.title, updatedAt: new Date(c.updated_at) })));
  }, []);

  const loadConversation = useCallback(async (convId: string) => {
    const { data } = await supabase.from('ai_messages').select('id, role, content, created_at').eq('conversation_id', convId).order('created_at', { ascending: true });
    if (data) {
      setMessages(data.map(m => ({
        id: m.id,
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
        createdAt: new Date(m.created_at),
      })));
      setActiveConvId(convId);
    }
  }, []);

  const newConversation = useCallback(async (context?: PageContext) => {
    const title = context?.type === 'property'
      ? `Property: ${(context.data as { title?: string })?.title ?? 'Unknown'}`
      : context?.type === 'developer'
      ? `Developer: ${(context.data as { name?: string })?.name ?? 'Unknown'}`
      : 'New Conversation';
    const { data } = await supabase.from('ai_conversations').insert({ title, context: context?.data ?? {} }).select('id').maybeSingle();
    if (data) {
      setActiveConvId(data.id);
      setMessages([]);
      if (context) setPageContext(context);
      await loadConversations();
      return data.id;
    }
    return null;
  }, [loadConversations]);

  const sendMessage = useCallback(async (userText: string) => {
    if (streaming || !userText.trim()) return;

    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.access_token;

    /* SOMEBODY WHO HAS NOT SIGNED UP YET.
     *
     * Being asked to create an account before you have seen whether the thing
     * is any good is a bad trade, so an anonymous visitor gets a real
     * conversation. It belongs to a session the server issues; the browser
     * only holds the secret that proves it, and claimAnonymousWork() hands the
     * whole thread to their account when they sign in. Nothing is copied and
     * nothing restarts.
     *
     * The conversation is created SERVER-side for them: RLS gives an anonymous
     * visitor no access to the table, which is the point. */
    const anonToken = accessToken ? null : await ensureAnonymousSession();

    let convId = activeConvId;
    if (!convId && accessToken) {
      convId = await newConversation(pageContext) ?? null;
      if (!convId) convId = 'guest';
    }

    const userMsg: AIMessage = { id: crypto.randomUUID(), role: 'user', content: userText.trim(), createdAt: new Date() };
    /*
     * ONE TURN, ONE ID, ONE POSSIBLE CHARGE.
     *
     * Minted here and sent with the request, so a network-level retry
     * of the same POST carries the same key and the server recognises
     * the reservation it already holds. Deliberately NOT derived from
     * the message text: asking the same question twice on purpose is
     * two turns and should be billed twice.
     */
    const interactionId = crypto.randomUUID();
    setMessages(prev => [...prev, userMsg]);
    setStreaming(true);
    setStreamContent('');
    // The previous answer's chips belong to the previous answer.
    setSuggestedReplies([]);
    setInsufficientCredits(false);
    abortRef.current = new AbortController();

    const allMessages = [...messages, userMsg];
    const efMessages = allMessages.map(m => ({ role: m.role, content: m.content }));
    let accumulated = '';
    /* Held until the answer is finished. Chips that appear beside a
       half-written sentence are chips for an answer nobody has read. */
    let pendingReplies: SuggestedReply[] = [];
    let pendingBilling: ChatBilling | null = null;

    await sendStreamRequest({
      functionUrl: `${SUPABASE_URL}/functions/v1/homatch-ai`,
      requestBody: {
        messages: efMessages,
        context: pageContext.type !== 'general' ? pageContext.data : undefined,
        conversationId: convId && convId !== 'guest' ? convId : undefined,
        // Proves which anonymous session this belongs to. Never an id the
        // client picked: the server decides what this token owns.
        anonSessionToken: anonToken ?? undefined,
        // Canonical locale field — forces the AI's entire answer into the
        // user's currently selected UI language, independent of whatever
        // language the message text itself happens to be typed in.
        locale: lang,
        // The idempotency key for this turn's reservation and settlement.
        interactionId,
      },
      supabaseAnonKey: SUPABASE_ANON_KEY,
      accessToken,
      onMeta: (payload) => {
        /* WHICH CONVERSATION AM I IN?
         *
         * An anonymous visitor cannot create one — RLS gives them no access to
         * the table — so the server opens it and this is how we find out which
         * one it is. Without it, the second message would start a fresh
         * conversation and the thread would quietly split in half.
         *
         * Only ever adopts an id we did not already have, so a server reply
         * can never move an account holder out of the conversation they are
         * reading. */
        const id = payload?.conversationId;
        if (typeof id === 'string' && id && !convId) {
          convId = id;
          setActiveConvId(id);
        }

        /* The chips, already validated server-side. Parsed again here
           only because the meta payload is `unknown` at this boundary
           and the parser is the one definition of the shape — it is a
           cheap no-op on a list that is already clean. */
        const replies = parseSuggestedReplies(payload?.suggestedReplies);
        if (replies.length) pendingReplies = replies;

        const billing = payload?.billing as ChatBilling | undefined;
        if (billing && typeof billing.chargedCredits === 'number') {
          pendingBilling = {
            chargedCredits: billing.chargedCredits,
            remainingCredits: Number(billing.remainingCredits ?? 0),
          };
        }
      },
      onData: (raw) => {
        try {
          const parsed = JSON.parse(raw);
          const chunk = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
          if (chunk) { accumulated += chunk; setStreamContent(accumulated); }
        } catch { /* skip incomplete frames */ }
      },
      onComplete: async () => {
        const assistantMsg: AIMessage = { id: crypto.randomUUID(), role: 'assistant', content: accumulated, createdAt: new Date() };
        setMessages(prev => [...prev, assistantMsg]);
        setStreamContent('');
        setStreaming(false);
        // Only now: the answer they belong to is on screen and finished.
        setSuggestedReplies(pendingReplies);
        if (pendingBilling) setLastBilling(pendingBilling);
        if (convId && convId !== 'guest' && allMessages.length === 1) {
          await supabase.from('ai_conversations').update({ title: userText.slice(0, 60) }).eq('id', convId);
          await loadConversations();
        }
      },
      onError: async (err) => {
        console.error('AI stream error:', err);
        setStreaming(false);
        setStreamContent('');
        // ky throws an HTTPError (with a `.response`) for any non-2xx status
        // — including our own 429 rate-limit response, whose JSON body
        // carries a real, already-localized message. Surface it instead of
        // silently swallowing the failure (a rate limit the user never sees
        // a reason for isn't a real feature, it's just a broken chat).
        let message = t('general_error');
        const httpErr = err as unknown as { response?: Response };
        if (httpErr?.response) {
          try {
            const data = await httpErr.response.clone().json();
            if (data?.error && typeof data.error === 'string') message = data.error;
            if (data?.code === 'INSUFFICIENT_CREDITS') {
              /* Not an error either, and emphatically not a toast that
                 throws away what they typed. The turn is rolled back,
                 the conversation stays exactly where it was, and the
                 panel shows a way to carry on. */
              setInsufficientCredits(true);
              setMessages(prev =>
                (prev.length && prev[prev.length - 1].id === userMsg.id) ? prev.slice(0, -1) : prev
              );
              return;
            }
            if (data?.code === 'ANON_LIMIT_REACHED') {
              // Not a failure. They have had what was offered, and signing in
              // continues the SAME conversation rather than starting one.
              setAnonLimitReached(true);
              setMessages(prev =>
                (prev.length && prev[prev.length - 1].id === userMsg.id) ? prev.slice(0, -1) : prev
              );
              return;
            }
          } catch { /* non-JSON error body — keep the generic message */ }
        }
        toast.error(message);
        // Roll back the optimistically-added user message so a failed send
        // doesn't leave a message in the transcript that was never answered.
        setMessages(prev => (prev.length && prev[prev.length - 1].id === userMsg.id) ? prev.slice(0, -1) : prev);
      },
      signal: abortRef.current.signal,
    });
  }, [streaming, activeConvId, messages, pageContext, newConversation, loadConversations, lang, t]);

  const cancelStream = useCallback(() => { abortRef.current?.abort(); setStreaming(false); setStreamContent(''); }, []);
  /* SIGNING IN MID-CONVERSATION.
   *
   * AuthContext hands the anonymous work to the new account and announces it.
   * Nothing here needs to move: the messages are on screen and activeConvId
   * still points at the same row, which is the whole promise — no restart, no
   * copy. Only the conversation LIST is stale, because it was fetched while
   * this visitor owned nothing. */
  useEffect(() => {
    const onClaimed = () => { void loadConversations(); };
    window.addEventListener('homatch:anon-claimed', onClaimed);
    return () => window.removeEventListener('homatch:anon-claimed', onClaimed);
  }, [loadConversations]);

  const resetChat = useCallback(() => {
    setMessages([]); setActiveConvId(null); setStreamContent('');
    setPageContext({ type: 'general' }); setSuggestedReplies([]);
    setInsufficientCredits(false);
  }, []);

  return {
    messages, streaming, streamContent, conversations, activeConvId, pageContext, setPageContext,
    sendMessage, cancelStream, resetChat, loadConversations, loadConversation, newConversation,
    anonLimitReached, suggestedReplies, lastBilling, insufficientCredits,
  };
}

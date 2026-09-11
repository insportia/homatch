import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { sendStreamRequest } from '@/lib/sse';
import { supabase } from '@/db/supabase';
import { ensureAnonymousSession } from '@/services/anonymousSession';
import { useLanguage } from '@/contexts/LanguageContext';

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
  type: 'property' | 'developer' | 'match' | 'verify' | 'general';
  data?: Record<string, unknown>;
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
    setMessages(prev => [...prev, userMsg]);
    setStreaming(true);
    setStreamContent('');
    abortRef.current = new AbortController();

    const allMessages = [...messages, userMsg];
    const efMessages = allMessages.map(m => ({ role: m.role, content: m.content }));
    let accumulated = '';

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

  const resetChat = useCallback(() => { setMessages([]); setActiveConvId(null); setStreamContent(''); setPageContext({ type: 'general' }); }, []);

  return { messages, streaming, streamContent, conversations, activeConvId, pageContext, setPageContext, sendMessage, cancelStream, resetChat, loadConversations, loadConversation, newConversation, anonLimitReached };
}

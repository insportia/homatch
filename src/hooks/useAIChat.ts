import { useState, useRef, useCallback } from 'react';
import { sendStreamRequest } from '@/lib/sse';
import { supabase } from '@/db/supabase';

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
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [pageContext, setPageContext] = useState<PageContext>({ type: 'general' });
  const abortRef = useRef<AbortController | null>(null);

  // Load conversation list
  const loadConversations = useCallback(async () => {
    const { data } = await supabase
      .from('ai_conversations')
      .select('id, title, updated_at')
      .order('updated_at', { ascending: false })
      .limit(30);
    if (data) {
      setConversations(data.map(c => ({
        id: c.id,
        title: c.title,
        updatedAt: new Date(c.updated_at),
      })));
    }
  }, []);

  // Load messages for a conversation
  const loadConversation = useCallback(async (convId: string) => {
    const { data } = await supabase
      .from('ai_messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });
    if (data) {
      setMessages(data.map(m => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        createdAt: new Date(m.created_at),
      })));
      setActiveConvId(convId);
    }
  }, []);

  // Create a new conversation
  const newConversation = useCallback(async (context?: PageContext) => {
    const title = context?.type === 'property'
      ? `Property: ${(context.data as { title?: string })?.title ?? 'Unknown'}`
      : context?.type === 'developer'
      ? `Developer: ${(context.data as { name?: string })?.name ?? 'Unknown'}`
      : 'New Conversation';

    const { data } = await supabase
      .from('ai_conversations')
      .insert({ title, context: context?.data ?? {} })
      .select('id')
      .maybeSingle();

    if (data) {
      setActiveConvId(data.id);
      setMessages([]);
      if (context) setPageContext(context);
      await loadConversations();
      return data.id;
    }
    return null;
  }, [loadConversations]);

  // Send message with streaming
  const sendMessage = useCallback(async (userText: string) => {
    if (streaming || !userText.trim()) return;

    // Ensure conversation exists
    let convId = activeConvId;
    if (!convId) {
      convId = await newConversation(pageContext) ?? null;
      // Guest/unauthenticated: proceed without DB persistence
      if (!convId) convId = 'guest';
    }

    const userMsg: AIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userText.trim(),
      createdAt: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setStreaming(true);
    setStreamContent('');

    abortRef.current = new AbortController();

    // Build contents array for the EF
    const allMessages = [...messages, userMsg];
    const efMessages = allMessages.map(m => ({ role: m.role, content: m.content }));

    let accumulated = '';

    await sendStreamRequest({
      functionUrl: `${SUPABASE_URL}/functions/v1/homatch-ai`,
      requestBody: {
        messages: efMessages,
        context: pageContext.type !== 'general' ? pageContext.data : undefined,
        conversationId: convId !== 'guest' ? convId : undefined,
      },
      supabaseAnonKey: SUPABASE_ANON_KEY,
      onData: (raw) => {
        try {
          const parsed = JSON.parse(raw);
          const chunk = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
          if (chunk) {
            accumulated += chunk;
            setStreamContent(accumulated);
          }
        } catch { /* skip incomplete frames */ }
      },
      onComplete: async () => {
        const assistantMsg: AIMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: accumulated,
          createdAt: new Date(),
        };
        setMessages(prev => [...prev, assistantMsg]);
        setStreamContent('');
        setStreaming(false);

        // Persist assistant message
        if (convId && convId !== 'guest') {
          await supabase.from('ai_messages').insert({
            conversation_id: convId,
            role: 'model',
            content: accumulated,
          });
          // Update title from first exchange
          if (allMessages.length === 1) {
            const titleText = userText.slice(0, 60);
            await supabase
              .from('ai_conversations')
              .update({ title: titleText })
              .eq('id', convId);
            await loadConversations();
          }
        }
      },
      onError: (err) => {
        console.error('AI stream error:', err);
        setStreaming(false);
        setStreamContent('');
      },
      signal: abortRef.current.signal,
    });
  }, [streaming, activeConvId, messages, pageContext, newConversation, loadConversations]);

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
    setStreamContent('');
  }, []);

  const resetChat = useCallback(() => {
    setMessages([]);
    setActiveConvId(null);
    setStreamContent('');
    setPageContext({ type: 'general' });
  }, []);

  return {
    messages,
    streaming,
    streamContent,
    conversations,
    activeConvId,
    pageContext,
    setPageContext,
    sendMessage,
    cancelStream,
    resetChat,
    loadConversations,
    loadConversation,
    newConversation,
  };
}

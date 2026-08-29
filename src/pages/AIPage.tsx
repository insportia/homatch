import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useAIChat, type PageContext } from '@/hooks/useAIChat';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Streamdown } from 'streamdown';
import {
  Bot, Send, StopCircle, PlusCircle, MessageSquare, Trash2,
  Loader2, Sparkles, ChevronRight, Home, Building2, Shield, Search,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { RouteGuard } from '@/components/common/RouteGuard';

const QUICK_PROMPTS = [
  { icon: Search,    label: 'Find a 2BR apartment in Vake under $150k' },
  { icon: Building2, label: 'Find buyers for my apartment' },
  { icon: Shield,    label: 'Is this developer trustworthy?' },
  { icon: Home,      label: 'Find the same property cheaper' },
];

function EmptyState({ onPrompt }: { onPrompt: (p: string) => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <Sparkles className="h-7 w-7 text-primary" />
      </div>
      <h2 className="text-lg font-semibold text-foreground mb-1">Homatch AI</h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-xs">
        Ask anything about real estate — search, match, compare, verify.
      </p>
      <div className="grid grid-cols-1 gap-2 w-full max-w-sm">
        {QUICK_PROMPTS.map(({ icon: Icon, label }) => (
          <button
            key={label}
            type="button"
            onClick={() => onPrompt(label)}
            className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-secondary/50 hover:border-primary/40 transition-colors text-left group"
          >
            <Icon className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">{label}</span>
            <ChevronRight className="h-3 w-3 text-muted-foreground/40 ml-auto shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ role, content, streaming }: { role: string; content: string; streaming?: boolean }) {
  const isUser = role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      )}
      <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
        isUser
          ? 'bg-primary text-primary-foreground rounded-tr-sm'
          : 'bg-card border border-border text-foreground rounded-tl-sm'
      }`}>
        {isUser ? (
          <span>{content}</span>
        ) : (
          <Streamdown parseIncompleteMarkdown isAnimating={streaming}>
            {content}
          </Streamdown>
        )}
      </div>
    </div>
  );
}

function AIPageInner() {
  const { session } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    messages, streaming, streamContent, conversations, activeConvId,
    sendMessage, cancelStream, resetChat, loadConversations,
    loadConversation, newConversation, setPageContext,
  } = useAIChat();

  // Inject page context if navigated with state
  useEffect(() => {
    const ctx = location.state as { context?: PageContext; prompt?: string } | undefined;
    if (ctx?.context) setPageContext(ctx.context);
    if (ctx?.prompt) {
      setInput(ctx.prompt);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
    if (session) loadConversations();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamContent]);

  const handleSend = async () => {
    if (!input.trim() || streaming) return;
    const text = input.trim();
    setInput('');
    await sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleNewChat = async () => {
    resetChat();
    if (session) await newConversation();
    setSidebarOpen(false);
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Sidebar — conversation history */}
      <aside className={`shrink-0 border-r border-border bg-card flex-col
        ${sidebarOpen ? 'flex' : 'hidden'} md:flex w-64`}>
        <div className="p-3 border-b border-border">
          <Button onClick={handleNewChat} size="sm" className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
            <PlusCircle className="h-4 w-4" />
            New Chat
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {conversations.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">No conversations yet</p>
            )}
            {conversations.map(conv => (
              <button
                key={conv.id}
                type="button"
                onClick={() => { loadConversation(conv.id); setSidebarOpen(false); }}
                className={`w-full text-left p-2.5 rounded-lg text-sm transition-colors truncate ${
                  activeConvId === conv.id
                    ? 'bg-primary/10 text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
              >
                <div className="truncate">{conv.title}</div>
                <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                  {formatDistanceToNow(conv.updatedAt, { addSuffix: true })}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
        {!session && (
          <div className="p-3 border-t border-border">
            <p className="text-xs text-muted-foreground mb-2">Sign in to save history</p>
            <Button size="sm" variant="outline" className="w-full border-border" onClick={() => navigate('/auth/login')}>
              Sign In
            </Button>
          </div>
        )}
      </aside>

      {/* Main chat area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Chat header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/95 backdrop-blur-sm shrink-0">
          <Button
            variant="ghost" size="sm"
            className="md:hidden h-8 w-8 p-0 text-muted-foreground"
            onClick={() => setSidebarOpen(v => !v)}
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Bot className="h-5 w-5 text-primary shrink-0" />
            <span className="font-semibold text-sm text-foreground truncate">Homatch AI</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">Beta</Badge>
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground" onClick={handleNewChat} title="New chat">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4">
          {messages.length === 0 && !streaming ? (
            <EmptyState onPrompt={p => { setInput(p); inputRef.current?.focus(); }} />
          ) : (
            <div className="max-w-2xl mx-auto space-y-4">
              {messages.map(m => (
                <MessageBubble key={m.id} role={m.role} content={m.content} />
              ))}
              {streaming && streamContent && (
                <MessageBubble role="assistant" content={streamContent} streaming />
              )}
              {streaming && !streamContent && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Loader2 className="h-4 w-4 text-primary animate-spin" />
                  </div>
                  <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3">
                    <div className="flex gap-1.5 items-center">
                      {[0,1,2].map(i => (
                        <div key={i} className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <Separator />

        {/* Input bar */}
        <div className="p-4 shrink-0">
          <div className="max-w-2xl mx-auto flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Homatch AI anything about real estate…"
              disabled={streaming}
              className="flex-1 bg-secondary border-border text-sm"
            />
            {streaming ? (
              <Button size="sm" variant="ghost" onClick={cancelStream}
                className="h-9 w-9 p-0 border border-border text-muted-foreground hover:text-destructive">
                <StopCircle className="h-4 w-4" />
              </Button>
            ) : (
              <Button size="sm" onClick={handleSend} disabled={!input.trim()}
                className="h-9 w-9 p-0 bg-primary text-primary-foreground hover:bg-primary/90">
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="text-center text-[10px] text-muted-foreground/50 mt-2">
            AI can make mistakes. Verify important information independently.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AIPage() {
  return (
    <AppLayout hidePadding>
      <AIPageInner />
    </AppLayout>
  );
}

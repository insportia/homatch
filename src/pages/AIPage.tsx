import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAIChat, type PageContext } from '@/hooks/useAIChat';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';
import { Streamdown } from 'streamdown';
import {
  Bot, Send, StopCircle, PlusCircle, MessageSquare, Trash2,
  Loader2, Sparkles, ChevronRight, Home, Building2, Shield, Search,
  ExternalLink, Star, AlertTriangle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { RouteGuard } from '@/components/common/RouteGuard';

// ── Evidence status badge ──────────────────────────────────────
type EvidenceStatus = 'VERIFIED' | 'HOMATCH_DATA' | 'FOUND_ONLINE' | 'CONFLICTING' | 'UNVERIFIED';
const EVIDENCE_CFG: Record<EvidenceStatus, { color: string; label: string }> = {
  VERIFIED:     { color: 'bg-green-500/15 text-green-400 border-green-500/25',   label: 'VERIFIED' },
  HOMATCH_DATA: { color: 'bg-primary/10 text-primary border-primary/20',          label: 'HOMATCH DATA' },
  FOUND_ONLINE: { color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',       label: 'FOUND ONLINE' },
  CONFLICTING:  { color: 'bg-amber-500/10 text-amber-400 border-amber-500/20',    label: 'CONFLICTING' },
  UNVERIFIED:   { color: 'bg-muted text-muted-foreground border-border',          label: 'UNVERIFIED' },
};
function EvidenceBadge({ status }: { status: EvidenceStatus }) {
  const cfg = EVIDENCE_CFG[status] ?? EVIDENCE_CFG.UNVERIFIED;
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${cfg.color}`}>{cfg.label}</span>;
}

// ── Research result card (parsed from streaming assistant message) ────────────
interface ResearchReport {
  entityName?: string;
  entityType?: string;
  confidence?: number;
  summary?: string;
  sources?: Array<{ label: string; url?: string; status: EvidenceStatus }>;
  actions?: Array<{ id: string; label: string; path?: string; type: string }>;
  warnings?: string[];
  homatchData?: Record<string, unknown>;
  publicFindings?: { riskFlags?: string[]; companyInfo?: string };
}

function ResearchCard({
  report,
  onNavigate,
}: {
  report: ResearchReport;
  onNavigate: (p: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <Card className="border-primary/20 bg-primary/5 mt-2">
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Star className="h-4 w-4 text-primary" />
          <span className="font-semibold">{report.entityName ?? t('ai_entity_default')}</span>
          {report.entityType && <Badge variant="outline" className="text-[10px]">{report.entityType}</Badge>}
          {report.confidence !== undefined && (
            <span className="text-xs text-muted-foreground ml-auto">{t('ai_confidence')}: {report.confidence}%</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        {report.summary && <p className="text-xs text-muted-foreground leading-relaxed">{report.summary}</p>}

        {(report.publicFindings?.riskFlags ?? []).length > 0 && (
          <div className="space-y-1">
            {(report.publicFindings!.riskFlags!).map((f, i) => (
              <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/5 border border-amber-500/15">
                <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0 mt-0.5" />
                <span className="text-xs text-amber-400/90">{f}</span>
              </div>
            ))}
          </div>
        )}

        {(report.sources ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {report.sources!.map((s, i) => (
              <div key={i} className="flex items-center gap-1">
                <EvidenceBadge status={s.status} />
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer"
                    className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                    {s.label} <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                ) : <span className="text-[10px] text-muted-foreground">{s.label}</span>}
              </div>
            ))}
          </div>
        )}

        {(report.actions ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {report.actions!.map(a => (
              <Button key={a.id} size="sm" variant="outline" className="h-7 text-[11px] gap-1 border-border"
                onClick={() => {
                  if (a.type === 'navigate' && a.path) onNavigate(a.path);
                  else if (a.type === 'external' && a.path) window.open(a.path, '_blank');
                }}>
                {a.type === 'external' ? <ExternalLink className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {a.label}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const QUICK_PROMPTS = [
  { icon: Search,    labelKey: 'ai_prompt_find_apartment' as const },
  { icon: Building2, labelKey: 'ai_prompt_find_buyers' as const },
  { icon: Shield,    labelKey: 'ai_prompt_verify_dev' as const },
  { icon: Home,      labelKey: 'ai_prompt_cheaper' as const },
];

function EmptyState({ onPrompt }: { onPrompt: (p: string) => void }) {
  const { t } = useLanguage();
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <Sparkles className="h-7 w-7 text-primary" />
      </div>
      <h2 className="text-lg font-semibold text-foreground mb-1">{t('ai_title')}</h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-xs">
        {t('ai_subtitle')}
      </p>
      <div className="grid grid-cols-1 gap-2 w-full max-w-sm">
        {QUICK_PROMPTS.map(({ icon: Icon, labelKey }) => {
          const label = t(labelKey);
          return (
            <button
              key={labelKey}
              type="button"
              onClick={() => onPrompt(label)}
              className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-secondary/50 hover:border-primary/40 transition-colors text-left group"
            >
              <Icon className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">{label}</span>
              <ChevronRight className="h-3 w-3 text-muted-foreground/40 ml-auto shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MessageBubble({
  role, content, streaming, onNavigate,
}: {
  role: string;
  content: string;
  streaming?: boolean;
  onNavigate?: (p: string) => void;
}) {
  const isUser = role === 'user';

  // Try to extract an embedded JSON research report from assistant messages
  // The EF may embed [[RESEARCH_JSON:...]] blocks
  let researchReport: ResearchReport | null = null;
  let displayContent = content;
  if (!isUser) {
    const jsonMatch = content.match(/\[\[RESEARCH_JSON:([\s\S]*?)\]\]/);
    if (jsonMatch) {
      try { researchReport = JSON.parse(jsonMatch[1]); } catch { /* ignore malformed */ }
      displayContent = content.replace(/\[\[RESEARCH_JSON:[\s\S]*?\]\]/, '').trim();
    }
  }

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      )}
      <div className={`max-w-[80%] ${isUser ? '' : 'flex-1 min-w-0'}`}>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-card border border-border text-foreground rounded-tl-sm'
        }`}>
          {isUser ? (
            <span>{content}</span>
          ) : (
            <Streamdown parseIncompleteMarkdown isAnimating={streaming}>
              {displayContent}
            </Streamdown>
          )}
        </div>
        {researchReport && onNavigate && (
          <ResearchCard report={researchReport} onNavigate={onNavigate} />
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
  const didAutoSend = useRef(false);

  const {
    messages, streaming, streamContent, conversations, activeConvId,
    sendMessage, cancelStream, resetChat, loadConversations,
    loadConversation, newConversation, setPageContext,
  } = useAIChat();

  // Inject page context and auto-send prompt when navigated with state
  useEffect(() => {
    const ctx = location.state as { context?: PageContext; prompt?: string } | undefined;
    if (ctx?.context) setPageContext(ctx.context);
    if (ctx?.prompt && !didAutoSend.current && session) {
      didAutoSend.current = true;
      sendMessage(ctx.prompt);
    } else if (ctx?.prompt && !session) {
      // Not signed in — pre-fill input so user sees what they asked
      setInput(ctx.prompt);
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

  // Unauthenticated gate
  if (!session) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[60vh]">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
          <Bot className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">{t('ai_sign_in_prompt')}</h2>
        <p className="text-sm text-muted-foreground mb-6 max-w-xs leading-relaxed">{t('ai_sign_in_desc')}</p>
        {input && (
          <p className="text-xs text-muted-foreground/60 mb-4 max-w-xs italic">"{input}"</p>
        )}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => navigate('/auth/signup', { state: { redirect: '/ai', prompt: input } })}>
            {t('nav_signup')}
          </Button>
          <Button variant="outline" className="border-border"
            onClick={() => navigate('/auth/login', { state: { redirect: '/ai', prompt: input } })}>
            {t('nav_login')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Sidebar — conversation history */}
      <aside className={`shrink-0 border-r border-border bg-card flex-col
        ${sidebarOpen ? 'flex' : 'hidden'} md:flex w-64`}>
        <div className="p-3 border-b border-border">
          <Button onClick={handleNewChat} size="sm" className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
            <PlusCircle className="h-4 w-4" />
            {t('ai_new_chat')}
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {conversations.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">{t('ai_history')}</p>
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
            <span className="font-semibold text-sm text-foreground truncate">{t('ai_title')}</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">{t('ai_beta_badge')}</Badge>
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              onClick={handleNewChat} title={t('ai_new_chat')}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4">
          {messages.length === 0 && !streaming ? (
            <EmptyState onPrompt={p => sendMessage(p)} />
          ) : (
            <div className="max-w-2xl mx-auto space-y-4">
              {messages.map(m => (
                <MessageBubble key={m.id} role={m.role} content={m.content} onNavigate={navigate} />
              ))}
              {streaming && streamContent && (
                <MessageBubble role="assistant" content={streamContent} streaming onNavigate={navigate} />
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
              placeholder={t('ai_input_placeholder')}
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
            {t('ai_disclaimer')}
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

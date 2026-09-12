import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
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

/*
 * The composer sits at the bottom of the window, which on a modern phone
 * is underneath the home indicator, and under the app's own tab bar.
 */
const BOTTOM_INSET = 'pb-[calc(0.75rem+env(safe-area-inset-bottom))]';
/** The same, plus the 4rem mobile tab bar, which does not exist from md. */
const NAV_CLEARANCE = 'pb-[calc(4.75rem+env(safe-area-inset-bottom))] md:pb-3';

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
  return <span className={`text-[13px] px-1.5 py-0.5 rounded border font-medium ${cfg.color}`}>{cfg.label}</span>;
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
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Star className="h-4 w-4 text-primary" />
          <span className="font-semibold">{report.entityName ?? t('ai_entity_default')}</span>
          {report.entityType && <Badge variant="outline" className="text-[13px]">{report.entityType}</Badge>}
          {report.confidence !== undefined && (
            <span className="text-xs text-muted-foreground ml-auto">{t('ai_confidence')}: {report.confidence}%</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        {report.summary && <p className="measure text-sm leading-relaxed text-foreground">{report.summary}</p>}

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
                    className="flex items-center gap-0.5 text-sm text-primary hover:underline">
                    {s.label} <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                ) : <span className="text-sm text-muted-foreground">{s.label}</span>}
              </div>
            ))}
          </div>
        )}

        {(report.actions ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {report.actions!.map(a => (
              <Button key={a.id} size="sm" variant="outline" className="h-7 text-[14px] gap-1 border-border"
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
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-start transition-colors hover:border-primary/40 hover:bg-secondary/50 group"
            >
              <Icon className="h-4 w-4 text-primary shrink-0" />
              <span className="text-base text-muted-foreground transition-colors group-hover:text-foreground">{label}</span>
              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40 ms-auto rtl:rotate-180" />
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
    /*
     * justify, not flex-row-reverse.
     *
     * row-reverse puts the user on the right in English and on the LEFT
     * in Arabic and Hebrew, because the row was already laid out
     * right-to-left and reversing it undoes that. `justify-end` means
     * "the end of the line" in whichever direction the line runs, which
     * is what "my own messages" means in every language.
     */
    <div className={`flex gap-3 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      )}
      <div className={`max-w-[80%] ${isUser ? '' : 'flex-1 min-w-0'}`}>
        {/* Logical corners: the tail belongs at the top of the side the
            bubble is aligned to, which swaps with the text direction. */}
        <div className={`prose-block rounded-2xl px-4 py-3.5 text-base leading-[1.65] ${
          isUser
            ? 'rounded-se-sm bg-primary text-primary-foreground'
            : 'rounded-ss-sm border border-border bg-card text-foreground'
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const didAutoSend = useRef(false);

  const {
    messages, streaming, streamContent, conversations, activeConvId,
    sendMessage, cancelStream, resetChat, loadConversations,
    loadConversation, newConversation, setPageContext,
    anonLimitReached,
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

  /*
   * FOLLOW THE STREAM, UNLESS SOMEBODY IS READING.
   *
   * This used to scroll to the bottom on every token. Two things went
   * wrong with that. Scrolling back to re-read an earlier answer was
   * impossible while a reply was still arriving, because the view yanked
   * itself down again several times a second. And `behavior: 'smooth'`
   * restarts its animation on every call, so it never actually settled.
   *
   * So: follow only when the reader is already at the bottom, which is
   * what following along means, and jump rather than animate while
   * tokens are still arriving.
   */
  const scroller = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    // A generous threshold: "near the bottom" is a human judgement, and
    // an exact comparison flips off the moment one line of text arrives.
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setFollowing(distance < 120);
  };

  useEffect(() => {
    if (!following) return;
    bottomRef.current?.scrollIntoView({ behavior: streaming ? 'instant' : 'smooth' });
  }, [messages, streamContent, following, streaming]);

  /*
   * GROW TO FIT WHAT WAS TYPED.
   *
   * A textarea does not resize itself. Height is cleared before it is
   * measured because scrollHeight only ever reports the CONTENT height
   * when the box is not already constraining it — without the reset the
   * field can grow but never shrink again after a deletion.
   *
   * The cap lives in CSS (max-h), so once the text passes six lines the
   * box stops growing and scrolls instead of eating the conversation.
   */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

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

  /* THE GATE MOVED.
   *
   * It used to stand in front of the assistant entirely: an anonymous visitor
   * saw a sign-up screen and nothing else. Now they get a real conversation
   * first, and the gate appears only once they have had it — at which point
   * signing in KEEPS what they have already written rather than asking them
   * to start again.
   *
   * anonLimitReached is set by the hook when the server refuses a third turn.
   * The limit is the server's: a counter the browser owns is not a limit. */
  if (!session && anonLimitReached) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[60vh]">
        <div className="mb-5 grid h-16 w-16 place-items-center rounded-[1rem] border border-foreground/15 bg-secondary">
          <Bot className="h-8 w-8 text-gold-ink" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">{t('ai_sign_in_prompt')}</h2>
        <p className="text-sm text-muted-foreground mb-6 max-w-xs leading-relaxed">{t('ai_sign_in_desc')}</p>
        {input && (
          <p className="text-xs text-muted-foreground/60 mb-4 max-w-xs italic">"{input}"</p>
        )}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button className="h-11 rounded-full px-6 font-semibold"
            onClick={() => navigate('/auth/signup', { state: { redirect: '/ai', prompt: input } })}>
            {t('nav_signup')}
          </Button>
          <Button variant="outline" className="h-11 rounded-full border-foreground/25 px-6"
            onClick={() => navigate('/auth/login', { state: { redirect: '/ai', prompt: input } })}>
            {t('nav_login')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    /*
     * h-full, not a height calculated from the viewport.
     *
     * It was 100vh minus 3.5rem. The header is 4rem, and 5rem from md, so
     * the number was wrong in both directions — and a number copied from
     * one component into another is wrong again the next time either
     * changes. The shell is now a fixed-height flex column for full-bleed
     * screens, so "the space that is left" is something the browser
     * works out rather than something this file guesses.
     *
     * It also means dvh is applied in exactly one place. 100vh on a phone
     * is the height of the viewport WITHOUT the keyboard and does not
     * change when one opens, which on a screen whose entire purpose is
     * typing put the box you type into behind the keyboard.
     */
    <div className="flex h-full overflow-hidden">
      {/* Sidebar — conversation history */}
      <aside className={`shrink-0 border-e border-border bg-card flex-col
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
                className={`w-full text-start p-2.5 rounded-lg text-sm transition-colors truncate ${
                  activeConvId === conv.id
                    ? 'bg-primary/10 text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
              >
                <div className="truncate">{conv.title}</div>
                <div className="text-[13px] text-muted-foreground/60 mt-0.5">
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
            <h1 className="truncate text-sm font-semibold text-foreground">{t('ai_title')}</h1>
            <Badge variant="secondary" className="text-[13px] px-1.5 py-0 shrink-0">{t('ai_beta_badge')}</Badge>
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              onClick={handleNewChat} title={t('ai_new_chat')}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Messages */}
        {/* overscroll-contain: without it, reaching the end of the
            conversation on a phone starts scrolling the page behind it. */}
        <div
          ref={scroller}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
        >
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
                  <div className="rounded-2xl rounded-ss-sm border border-border bg-card px-4 py-3">
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

        {/*
          * THE COMPOSER.
          *
          * A textarea, not a single-line input. Shift+Enter was already
          * bound to "new line" and the control it was bound to could not
          * hold one, so the second line of a question was invisible.
          *
          * It grows to about six lines and then scrolls, so pasting a
          * long question does not push the conversation off the screen.
          *
          * text-base is 17px. Safari zooms the whole page when a focused
          * field is smaller than 16px, and the zoom does not come back
          * when the field is blurred, so every iPhone user would be left
          * on a magnified, sideways-scrolling page after one question.
          */}
        {/*
          * The bottom inset clears two different things at once.
          *
          * On a phone the app has a fixed bottom navigation bar sitting
          * over the last 4rem of the window, so the composer has to stop
          * above it or the send button is behind a tab. From md that bar
          * is gone and so is the space. And underneath both, the home
          * indicator inset, which is 0 on hardware that has none.
          *
          * The bar only exists for somebody signed in, which is why this
          * asks rather than always reserving the room.
          */}
        <div className={`shrink-0 px-4 pt-3 ${session ? NAV_CLEARANCE : BOTTOM_INSET}`}>
          <div className="mx-auto flex max-w-2xl items-end gap-2">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('ai_input_placeholder')}
              disabled={streaming}
              aria-label={t('ai_input_placeholder')}
              className={
                'max-h-[9.5rem] min-h-[2.75rem] flex-1 resize-none rounded-[1.25rem] border '
                + 'border-border bg-secondary px-4 py-3 text-base leading-[1.5] '
                + 'placeholder:text-muted-foreground focus-visible:outline-none '
                + 'focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60'
              }
            />
            {streaming ? (
              <Button
                variant="ghost" onClick={cancelStream}
                aria-label={t('ai_stop')}
                className="h-11 w-11 shrink-0 rounded-full border border-border p-0 text-muted-foreground hover:text-destructive"
              >
                <StopCircle className="h-5 w-5" />
              </Button>
            ) : (
              <Button
                onClick={handleSend} disabled={!input.trim()}
                aria-label={t('ai_send')}
                className="h-11 w-11 shrink-0 rounded-full bg-primary p-0 text-primary-foreground hover:bg-primary/90"
              >
                {/* The paper plane points along the text direction. */}
                <Send className="h-5 w-5 rtl:-scale-x-100" />
              </Button>
            )}
          </div>
          <p className="text-center text-[13px] text-muted-foreground/50 mt-2">
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

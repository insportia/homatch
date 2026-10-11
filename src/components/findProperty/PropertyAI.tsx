import { Send, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Streamdown } from 'streamdown';
import { WebContextLine } from '@/components/ai/ServiceActions';
import { supabase } from '@/db/supabase';
import { useAIChat } from '@/hooks/useAIChat';
import type { T } from './format';

/** Same paid chat transport and conversation tables; only its scope is new. */
export function PropertyAI({ searchId, propertyKey, title, t }: { searchId: string; propertyKey: string; title: string; t: T }) {
  const chat = useAIChat();
  const [draft, setDraft] = useState('');
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const lastAssistant = useRef<string | null>(null);
  const submitting = useRef(false);
  const { setPageContext, loadConversation } = chat;
  useEffect(() => {
    let alive = true;
    setReady(false);
    setFailed(false);
    setPageContext({ type: 'property', data: { surface: 'find-property', searchId, propertyKey, title } });
    void (async () => {
      const { data, error } = await supabase.from('ai_conversations').select('id')
        .contains('context', { surface: 'find-property', searchId, propertyKey })
        .order('updated_at', { ascending: false }).limit(1).maybeSingle();
      if (!alive) return;
      if (error) { setFailed(true); return; }
      if (data) await loadConversation(data.id);
      if (alive) setReady(true);
    })().catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [searchId, propertyKey, title, setPageContext, loadConversation]);
  useEffect(() => {
    const message = chat.messages[chat.messages.length - 1];
    if (message?.role === 'assistant' && !chat.streaming && message.id !== lastAssistant.current) {
      lastAssistant.current = message.id;
      setDraft('');
    }
  }, [chat.messages, chat.streaming]);
  useEffect(() => {
    if (ready && chat.pendingPropertyQuestion) setDraft((current) => current || chat.pendingPropertyQuestion || '');
  }, [ready, chat.pendingPropertyQuestion]);
  return <section data-property-ai className="mx-auto w-full max-w-5xl overflow-hidden rounded-3xl border border-foreground/10 bg-card shadow-[0_2px_4px_rgba(12,17,25,0.06),0_24px_48px_-28px_rgba(12,17,25,0.45)]">
    <header className="relative space-y-1.5 bg-[#0C1119] px-4 py-5 text-white sm:px-6">
      <h2 className="flex items-center gap-2.5 font-display text-xl font-semibold"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[hsl(var(--gold))] text-[#0C1119]"><Sparkles className="h-[18px] w-[18px]" aria-hidden="true" /></span>{t('fpw_ai')}</h2>
      <p className="text-sm text-white/70">{t('fpw_ai_credits')}</p>
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[hsl(var(--gold)/0.7)] to-transparent" aria-hidden="true" />
    </header>
    <div className="space-y-4 p-4 sm:p-6">
    {failed ? <p role="alert">{t('mps_error_generic')}</p> : null}
    <div className="space-y-3" aria-live="polite">
      {chat.messages.map((message) => <div key={message.id} className={`min-w-0 overflow-x-auto break-words rounded-2xl p-4 text-sm leading-relaxed ${message.role === 'user' ? 'ms-auto max-w-[85%] whitespace-pre-wrap bg-[#0C1119] text-white' : 'prose prose-sm max-w-none border border-foreground/10 border-s-2 border-s-[hsl(var(--gold))] bg-background dark:prose-invert'}`} dir="auto">{message.role === 'user' ? message.content : <Streamdown>{message.content}</Streamdown>}</div>)}
      {chat.streaming ? <p dir="auto" className="whitespace-pre-wrap break-words text-sm leading-relaxed" aria-busy="true">{chat.streamContent || t('fpw_ai_working')}</p> : null}
    </div>
    {!chat.streaming && chat.lastWebChecked ? <WebContextLine webChecked={chat.lastWebChecked} sources={chat.lastSources} /> : null}
    {chat.lastBilling ? <p className="text-xs text-muted-foreground">{t('fpw_ai_usage', { used: chat.lastBilling.chargedCredits, remaining: chat.lastBilling.remainingCredits })}</p> : null}
    <div className="flex flex-wrap gap-2">
      {['value', 'risks', 'questions', 'renovation'].map((key) => <button key={key} type="button" disabled={chat.streaming || !ready} onClick={() => setDraft(t(`fpw_prompt_${key}`))} className="min-h-11 rounded-full border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold)/0.06)] px-4 text-start text-sm font-medium text-foreground transition hover:bg-[hsl(var(--gold)/0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))] disabled:opacity-50">{t(`fpw_prompt_${key}`)}</button>)}
    </div>
    {chat.insufficientCredits ? <div role="alert" className="space-y-2 text-sm"><p>{t('fpw_ai_insufficient')}</p><Link to="/credits" className="inline-flex min-h-11 items-center rounded-xl bg-[#0C1119] px-4 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold))]">{t('ai_out_of_credits_action')}</Link></div> : null}
    <form onSubmit={(event) => {
      event.preventDefault();
      if (!ready || !draft.trim() || submitting.current || chat.streaming) return;
      submitting.current = true;
      void chat.sendMessage(draft).finally(() => { submitting.current = false; });
    }} className="space-y-2">
      <label htmlFor="property-ai-message" className="text-sm font-medium">{t('fpw_ai_question')}</label>
      <textarea id="property-ai-message" value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} maxLength={6000} disabled={chat.streaming || !ready} className="w-full resize-y rounded-2xl border border-foreground/15 bg-background p-3.5 text-base shadow-inner transition focus-visible:border-[hsl(var(--gold))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold)/0.4)]" />
      <button type="submit" disabled={chat.streaming || !ready || !draft.trim()} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[hsl(var(--gold))] px-5 text-sm font-semibold text-[#0C1119] shadow-sm transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0C1119] focus-visible:ring-offset-2 disabled:opacity-50"><Send className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />{t('fpw_ai_send')}</button>
    </form>
    </div>
  </section>;
}

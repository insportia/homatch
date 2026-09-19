// HOMATCH — the assistant, over the page rather than instead of it.
//
// Desktop gets a wide right-hand drawer; a phone gets a near-full-screen
// overlay. In both cases the page underneath stays mounted, which is the whole
// point: a half-filled agent wizard is still half-filled when the drawer
// closes, because it was never unmounted.
//
// Anything the assistant writes reaches a form ONLY through an explicit
// Insert. There is no automatic fill. A model that silently rewrites the field
// you were typing in is worse than no help at all.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Send, Square, ExternalLink, CornerDownLeft, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAIChat } from '@/hooks/useAIChat';
import { useAssistant } from './AssistantContext';
import { SuggestedReplies } from '@/components/ai/SuggestedReplies';
import { cn } from '@/lib/utils';

export function AssistantDrawer() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { open, setOpen, surface } = useAssistant();
  const [input, setInput] = useState('');
  const [insertedKey, setInsertedKey] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    messages, streaming, streamContent, sendMessage, cancelStream, setPageContext,
    anonLimitReached, suggestedReplies,
  } = useAIChat();

  /* The page description travels with the question, so "what should I write
   * here?" has something to be "here" about. */
  useEffect(() => {
    if (!surface) { setPageContext({ type: 'general' }); return; }
    setPageContext({
      type: 'workspace',
      data: {
        surface: surface.surface,
        title: surface.title ?? null,
        step: surface.step ?? null,
        ...(surface.facts ?? {}),
        editableFields: surface.fields?.map((f) => f.label) ?? [],
      },
    });
  }, [surface, setPageContext]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, streamContent, open]);

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    void sendMessage(text);
  }, [input, streaming, sendMessage]);

  /* The last thing the assistant said is the only thing Insert can offer:
   * inserting an arbitrary earlier turn is a guess about which one was meant. */
  const lastAnswer = [...messages].reverse().find((m) => m.role === 'assistant')?.content ?? '';

  const insert = useCallback((key: string, apply: (v: string) => void) => {
    if (!lastAnswer) return;
    apply(lastAnswer);
    setInsertedKey(key);
    window.setTimeout(() => setInsertedKey(null), 1600);
  }, [lastAnswer]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        aria-label={t('ai_title')}
        className={cn(
          'flex w-full flex-col gap-0 p-0',
          // A phone gets essentially the whole screen; a desktop gets a real
          // working column rather than the 384px the default sheet allows.
          'sm:max-w-[min(34rem,92vw)] lg:max-w-[38rem]',
        )}
      >
        <header className="flex items-start justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Bot className="h-4 w-4 shrink-0 text-gold-ink" aria-hidden="true" />
              {t('ai_title')}
            </p>
            {surface?.title ? (
              <p className="mt-0.5 text-2xs uppercase tracking-wide text-muted-foreground [overflow-wrap:anywhere]">
                {t('assist_context_label')} · {surface.title}
                {surface.step ? ` · ${surface.step}` : ''}
              </p>
            ) : null}
          </div>
          <Button
            variant="ghost" size="sm"
            className="me-6 h-7 shrink-0 gap-1 text-2xs"
            onClick={() => { setOpen(false); navigate('/ai'); }}
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            {t('assist_open_full')}
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {messages.length === 0 && !streaming ? (
            <p className="text-[13px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
              {t('ai_subtitle')}
            </p>
          ) : null}

          {messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                'rounded-xl px-3 py-2 text-[13px] leading-relaxed [overflow-wrap:anywhere]',
                m.role === 'user' ? 'ms-6 bg-muted/70' : 'me-2 border bg-card',
              )}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          ))}

          {streaming ? (
            <div className="me-2 rounded-xl border bg-card px-3 py-2 text-[13px] leading-relaxed [overflow-wrap:anywhere]">
              <p className="whitespace-pre-wrap">{streamContent}</p>
            </div>
          ) : null}

          {anonLimitReached ? (
            <p className="text-[13px] text-muted-foreground">{t('ai_sign_in_prompt')}</p>
          ) : null}

          {/* Insert is offered only when there is both an answer to insert and
              a field that asked to receive one. */}
          {!streaming && lastAnswer && surface?.fields?.length ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {surface.fields.map((f) => (
                <Button
                  key={f.key} variant="outline" size="sm"
                  className="h-7 gap-1 text-2xs"
                  onClick={() => insert(f.key, f.apply)}
                >
                  {insertedKey === f.key ? (
                    <>
                      <Check className="h-3 w-3" aria-hidden="true" />
                      {t('assist_inserted')}
                    </>
                  ) : (
                    <>
                      <CornerDownLeft className="h-3 w-3" aria-hidden="true" />
                      {t('assist_insert').replace('{field}', f.label)}
                    </>
                  )}
                </Button>
              ))}
            </div>
          ) : null}

          {/* The same chips as every other Homatch conversation. */}
          {!streaming && suggestedReplies.length > 0 ? (
            <SuggestedReplies
              replies={suggestedReplies}
              onSelect={(text) => { void sendMessage(text); }}
            />
          ) : null}

          <div ref={bottomRef} />
        </div>

        <div className="flex items-end gap-2 border-t px-4 py-3">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
            placeholder={t('ai_input_placeholder')}
            aria-label={t('ai_input_placeholder')}
            rows={2}
            className="max-h-32 min-h-[2.5rem] flex-1 resize-none text-[13px]"
          />
          {streaming ? (
            <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={cancelStream} aria-label={t('ai_stop')}>
              <Square className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          ) : (
            <Button size="sm" className="h-9 shrink-0" onClick={submit} disabled={!input.trim()} aria-label={t('ai_send')}>
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

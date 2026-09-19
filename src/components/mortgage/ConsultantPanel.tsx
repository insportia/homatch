// THE CONSULTANT. The part of this product that is not a calculator.
//
// WHAT IT KNOWS, AND HOW
//
// Before a question leaves the page, the scenario on screen has already
// been run through the deterministic engines across the variations
// people ask about — a term ladder, a deposit ladder, a rate ladder,
// extra monthly payments, the effective-rate decomposition, PTI/LTV
// against the published limits, any offers entered. See
// src/mortgage/consultantBrief.ts. All of that travels with the
// question, so "what if I put another 20,000 down?" is answered from a
// figure this product computed, not one a language model produced.
//
// Nobody retypes their scenario to ask about it.
//
// WHY IT IS HERE AND NOT THE FLOATING DRAWER
//
// The drawer is mounted only inside the authenticated shell. Mortgage is
// a public page and the consultant IS the product, so a signed-out
// visitor has to be able to use it. The hook underneath is the same one
// the drawer and /ai use, anonymous sessions included — this is a
// surface for it, not a second assistant.

import React, { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, Square } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAIChat } from '@/hooks/useAIChat';
import { cn } from '@/lib/utils';
import type { ConsultantBrief } from '@/mortgage/consultantBrief';

/** The questions the product was designed around, in the user's language. */
const SUGGESTIONS = [
  'mortgage_ask_more_down',
  'mortgage_ask_shorter_term',
  'mortgage_ask_pay_extra',
  'mortgage_ask_explain_effective',
];

export function ConsultantPanel({ brief }: { brief: ConsultantBrief | null }) {
  const { t } = useLanguage();
  const [value, setValue] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const {
    messages, streaming, streamContent, sendMessage, cancelStream, setPageContext, anonLimitReached,
  } = useAIChat();

  /* The scenario travels with every question. Re-registered whenever a
     figure changes, so an answer is never about the loan they had two
     edits ago. */
  useEffect(() => {
    setPageContext(
      brief
        ? { type: 'workspace', data: { surface: 'mortgage-consultant', mortgage: brief } }
        : { type: 'workspace', data: { surface: 'mortgage-consultant', mortgage: null } },
    );
  }, [brief, setPageContext]);

  useEffect(() => {
    if (messages.length) bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length, streamContent]);

  const ask = (text: string) => {
    const question = text.trim();
    if (!question || streaming) return;
    setValue('');
    void sendMessage(question);
  };

  return (
    <section id="consultant" className="hm-workspace-panel p-5 sm:p-7">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 shrink-0 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
        <h2 className="font-display text-lg font-semibold text-foreground">
          {t('mortgage_consultant_title')}
        </h2>
      </div>
      <p className="mt-1.5 max-w-[60ch] text-sm text-muted-foreground">
        {brief ? t('mortgage_consultant_sub') : t('mortgage_consultant_sub_no_scenario')}
      </p>

      {messages.length || streaming ? (
        <div className="mt-5 max-h-[26rem] space-y-4 overflow-y-auto pe-1">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                'max-w-[46ch] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-relaxed',
                message.role === 'user'
                  ? 'ms-auto bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
                  : 'bg-[hsl(var(--secondary))] text-foreground',
              )}
            >
              {message.content}
            </div>
          ))}
          {streaming ? (
            <div className="max-w-[46ch] whitespace-pre-wrap break-words rounded-2xl bg-[hsl(var(--secondary))] px-4 py-3 text-sm leading-relaxed text-foreground">
              {streamContent || t('mortgage_consultant_thinking')}
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap gap-2">
          {SUGGESTIONS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => ask(t(key))}
              className="min-h-11 rounded-full border border-border px-4 text-start text-xs text-muted-foreground transition-colors hover:border-[hsl(var(--gold-border))] hover:text-foreground"
            >
              {t(key)}
            </button>
          ))}
        </div>
      )}

      {anonLimitReached ? (
        <p className="mt-4 rounded-xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
          {t('mortgage_consultant_limit')}
        </p>
      ) : null}

      <form
        className="mt-5 flex items-stretch gap-2"
        onSubmit={(event) => { event.preventDefault(); ask(value); }}
      >
        <input
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t('mortgage_consultant_placeholder')}
          aria-label={t('mortgage_consultant_placeholder')}
          className="min-h-12 w-full min-w-0 rounded-xl border border-border bg-[hsl(var(--input))] px-4 text-base text-foreground outline-none transition-colors focus:border-[hsl(var(--gold-border))]"
        />
        {streaming ? (
          <button
            type="button"
            onClick={cancelStream}
            aria-label={t('mortgage_consultant_stop')}
            className="flex min-h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground"
          >
            <Square className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label={t('mortgage_consultant_send')}
            className="flex min-h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--gold))] text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--gold-hover))]"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </form>
    </section>
  );
}

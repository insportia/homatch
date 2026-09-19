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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Sparkles, Square } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAIChat } from '@/hooks/useAIChat';
import { cn } from '@/lib/utils';
import { SuggestedReplies } from '@/components/ai/SuggestedReplies';
import { useMortgageAsk } from './askConsultant';
import type { ConsultantBrief } from '@/mortgage/consultantBrief';

/**
 * THE OPENERS, WHICH ARE DELIBERATELY NOT FROM THE MODEL.
 *
 * Everything after the first answer is generated: the model reads the
 * conversation and proposes what the person might say next. These four
 * cannot be, because there is no conversation yet — and the moment
 * after a calculation is exactly the moment somebody does not know
 * what to ask. They are the four things the scenario makes worth
 * asking, in the person's own words, and they hand over to the dynamic
 * chips as soon as one of them is pressed.
 *
 * THE TERM ONE IS COMPUTED, BECAUSE IT WAS A CONSTANT.
 *
 * "What changes if I choose 15 years?" was hard-coded, and somebody who
 * has already typed 15 years is being offered their own scenario back.
 * It names a rung of the term ladder the engines already computed,
 * preferring a shorter one and falling back to the next longer, and the
 * wording claims nothing about which direction saves money — a longer
 * term lowers the monthly payment and raises the total, and which of
 * those a person wants is not something this page knows.
 */
const STARTERS = [
  'mortgage_ask_more_down',
  'mortgage_ask_pay_extra',
  'mortgage_ask_explain_effective',
];

export function ConsultantPanel({ brief }: { brief: ConsultantBrief | null }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  const { register } = useMortgageAsk();
  const {
    messages, streaming, streamContent, sendMessage, cancelStream, setPageContext, anonLimitReached,
    suggestedReplies, insufficientCredits,
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

  /*
   * THE REST OF THE PAGE ASKS THROUGH HERE.
   *
   * A checklist card, a finding in the financing picture, a government
   * condition — each ends in a question, and pressing it fills THIS
   * composer rather than opening a second conversation somewhere else.
   * See askConsultant.tsx for why it fills instead of sending.
   */
  useEffect(() => register((question: string) => {
    setValue(question);
    const panel = document.getElementById('consultant');
    panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    /* After the scroll, not during it: focusing first makes the browser
       jump the field into view and fight the smooth scroll. */
    window.setTimeout(() => composerRef.current?.focus({ preventScroll: true }), 400);
  }), [register]);

  /* Only offered once there is a scenario to ask about: "shorten the
     term" means nothing before a term exists. */
  const starters = useMemo(() => {
    if (!brief) return [];
    const current = brief.scenario.termMonths;
    const rungs = brief.ifTermWere
      .map((row) => row.termMonths)
      .filter((months): months is number => typeof months === 'number' && months !== current);
    const shorter = rungs.filter((m) => m < current).sort((a, b) => b - a);
    const longer = rungs.filter((m) => m > current).sort((a, b) => a - b);
    const other = shorter.length ? shorter[0] : (longer.length ? longer[0] : null);

    const keys = other === null ? STARTERS : ['mortgage_ask_shorter_term', ...STARTERS];
    return keys.map((key, i) => {
      const text = key === 'mortgage_ask_shorter_term' && other !== null
        ? t(key, { years: Math.round(other / 12) })
        : t(key);
      return { id: `starter${i}`, label: text, value: text };
    });
  }, [brief, t]);

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
      ) : null}

      {/* The chips. Deterministic openers until the first answer, then
          whatever the model thinks this person would say next — the same
          component either way, so they look and behave identically and
          nobody has to learn that one kind is special. */}
      <SuggestedReplies
        replies={messages.length ? suggestedReplies : starters}
        onSelect={(text) => ask(text)}
        disabled={streaming}
        className="mt-5"
      />

      {insufficientCredits ? (
        <div className="mt-4 rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-4 py-3.5">
          <p className="text-sm leading-relaxed text-[hsl(var(--gold-ink))]">
            {t('ai_out_of_credits')}
          </p>
          <button
            type="button"
            onClick={() => navigate('/credits')}
            className="mt-3 min-h-11 rounded-full bg-[hsl(var(--gold))] px-4 text-xs font-medium text-[hsl(var(--primary-foreground))]"
          >
            {t('ai_out_of_credits_action')}
          </button>
        </div>
      ) : null}

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
          ref={composerRef}
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

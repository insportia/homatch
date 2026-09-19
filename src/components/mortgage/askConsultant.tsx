/*
 * ONE CONSULTANT, REACHED FROM ANYWHERE ON THE PAGE.
 *
 * The checklist, the financing picture and the government programme all
 * end in the same place: a question worth putting to somebody. Until now
 * they printed that question as a sentence and left the reader to scroll
 * back up and retype it, which almost nobody does.
 *
 * WHAT THIS IS NOT
 *
 * It is not a second chat. There is exactly one useAIChat instance on
 * this page, inside ConsultantPanel, and it already carries the scenario
 * brief and the conversation so far. A second one would bill separately,
 * answer without the earlier turns, and give two different answers to
 * the same question. So the panel REGISTERS itself here and everything
 * else calls through — the question lands in the composer of the
 * conversation that is already running.
 *
 * WHY IT PRE-FILLS RATHER THAN SENDS
 *
 * A button that silently spends a credit and starts generating is a
 * surprise, and the question is a starting point people edit — "what
 * should I check about early repayment" becomes "...if I want to close
 * it in year three". The composer is filled, scrolled to and focused;
 * pressing send is still the person's decision.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { MessageCircleQuestion } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

export type AskHandler = (question: string) => void;

interface MortgageAskValue {
  /** Put a question to the consultant already on this page. */
  ask: AskHandler;
  /** False until a consultant has registered — no dead buttons. */
  available: boolean;
  /** Called by ConsultantPanel; returns the unsubscribe. */
  register: (handler: AskHandler) => () => void;
}

const MortgageAskContext = createContext<MortgageAskValue | null>(null);

export function MortgageAskProvider({ children }: { children: React.ReactNode }) {
  const [handler, setHandler] = useState<AskHandler | null>(null);

  const register = useCallback((next: AskHandler) => {
    setHandler(() => next);
    return () => setHandler((current: AskHandler | null) => (current === next ? null : current));
  }, []);

  const value = useMemo<MortgageAskValue>(
    () => ({
      available: handler !== null,
      ask: (question: string) => handler?.(question),
      register,
    }),
    [handler, register],
  );

  return <MortgageAskContext.Provider value={value}>{children}</MortgageAskContext.Provider>;
}

/**
 * Safe outside the provider on purpose.
 *
 * Several of these components are rendered by tests and by the Studio
 * preview with no consultant anywhere. Throwing would make a missing
 * chat break a checklist; instead `available` is false and the buttons
 * simply do not render.
 */
export function useMortgageAsk(): MortgageAskValue {
  return (
    useContext(MortgageAskContext) ?? { available: false, ask: () => {}, register: () => () => {} }
  );
}

/**
 * "Ask Homatch" — the same control everywhere it appears.
 *
 * Renders nothing when there is no consultant to reach, and nothing when
 * the question is empty, because a button that does nothing when pressed
 * is worse than one that is not there.
 */
export function AskHomatch({
  question,
  className,
  label,
}: {
  question: string;
  className?: string;
  /** Overrides the default "Ask Homatch" wording where a specific one reads better. */
  label?: string;
}) {
  const { t } = useLanguage();
  const { ask, available } = useMortgageAsk();
  const text = question.trim();
  if (!available || !text) return null;
  return (
    <button
      type="button"
      data-ask-homatch=""
      onClick={() => ask(text)}
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[hsl(var(--gold-border))] ' +
          'bg-[hsl(var(--gold-soft))] px-3.5 text-xs font-medium text-[hsl(var(--gold-ink))] ' +
          'transition-colors hover:bg-[hsl(var(--gold))] hover:text-[hsl(var(--primary-foreground))]',
        className,
      )}
    >
      <MessageCircleQuestion className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="text-start">{label ?? t('mortgage_ask_homatch')}</span>
    </button>
  );
}

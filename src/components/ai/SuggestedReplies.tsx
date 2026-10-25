// THE CHIPS UNDER AN ANSWER — one component, every Homatch conversation.
//
// WHY ONE
//
// The mortgage consultant and /ai both need this, and two copies would
// have diverged on the first bug: one would get the double-send guard,
// the other would keep sending twice. The chips are also the product's
// main claim — that a person can get through a conversation by
// pressing things — so they are worth building once and properly.
//
// SUBORDINATE, ON PURPOSE
//
// They sit under the answer, quieter than it, and they never compete
// with the composer. Typing is always available; clicking is merely
// easier. A chip that looked like the primary action would turn a
// conversation into a menu.
//
// THE DOUBLE-SEND GUARD IS NOT COSMETIC
//
// Every assistant response is a billable interaction. Two clicks on
// one chip must not become two turns, so the component latches on the
// first press and stays latched until the parent hands it a different
// set — which only happens when the next answer arrives.

import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { SuggestedReply } from '@/lib/ai/suggestedReplies';

export function SuggestedReplies({
  replies,
  onSelect,
  disabled = false,
  className,
}: {
  replies: SuggestedReply[];
  /** Called once per set, with the value that should be sent. */
  onSelect: (value: string, reply: SuggestedReply) => void;
  /** The conversation is busy; nothing may be sent. */
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useLanguage();
  const [chosen, setChosen] = useState<string | null>(null);

  /* A new set means a new turn, so the latch is released. Keyed on the
     ids and values rather than the array identity, which a parent
     re-render would change on its own. */
  const signature = replies.map((r) => `${r.id}:${r.value}`).join('|');
  const previous = useRef(signature);
  useEffect(() => {
    if (previous.current !== signature) {
      previous.current = signature;
      setChosen(null);
    }
  }, [signature]);

  if (!replies.length) return null;

  const locked = disabled || chosen !== null;

  return (
    <div
      className={cn('flex flex-wrap gap-2', className)}
      role="group"
      aria-label={t('ai_suggested_replies_label')}
    >
      {replies.map((reply, index) => {
        const isChosen = chosen === reply.id;
        return (
          <button
            key={reply.id}
            type="button"
            disabled={locked}
            aria-disabled={locked}
            onClick={() => {
              if (locked) return;
              setChosen(reply.id);
              onSelect(reply.value, reply);
            }}
            style={{ animationDelay: `${index * 60}ms` }}
            className={cn(
              /* 44px, wrapping, and a start-aligned label so a long
                 Georgian phrase breaks instead of pushing the row.
                 A real framed chip (gold hairline, card ground, a lift),
                 never plain text pretending to be a control. */
              'group inline-flex min-h-11 max-w-full items-center gap-2 rounded-2xl border px-4 py-2.5 text-start text-[15px] font-medium leading-snug',
              'shadow-sm transition-[transform,box-shadow,border-color,background-color] duration-200',
              'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:fill-mode-both',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]',
              isChosen
                ? 'border-[hsl(38_92%_56%)] bg-[hsl(var(--gold)/0.14)] text-foreground'
                : 'border-[hsl(var(--gold-border))] bg-card text-foreground',
              locked
                ? 'cursor-default opacity-60'
                : 'hover:-translate-y-0.5 hover:border-[hsl(38_92%_56%)] hover:shadow-card motion-reduce:hover:translate-y-0',
            )}
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(38_92%_56%)]" />
            <span className="block min-w-0 break-words">{reply.label}</span>
          </button>
        );
      })}
    </div>
  );
}

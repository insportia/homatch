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
      {replies.map((reply) => {
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
            className={cn(
              /* 44px, wrapping, and a start-aligned label so a long
                 Georgian phrase breaks instead of pushing the row. */
              'min-h-11 max-w-full rounded-full border px-4 py-2 text-start text-sm',
              'transition-colors',
              isChosen
                ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]'
                : 'border-border text-muted-foreground',
              locked
                ? 'cursor-default opacity-60'
                : 'hover:border-[hsl(var(--primary)/0.5)] hover:text-foreground',
            )}
          >
            <span className="block break-words">{reply.label}</span>
          </button>
        );
      })}
    </div>
  );
}

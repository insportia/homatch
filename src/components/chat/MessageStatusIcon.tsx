import { Check, CheckCheck, Clock } from 'lucide-react';

/**
 * A message's delivery state as ticks. Extracted unchanged from ChatPage so the demo
 * conversation shows SENT / DELIVERED / SEEN exactly as the real one does.
 *
 * These render inside the OUTBOUND bubble (strong ink fill), so they must read against
 * `bg-primary`: gold for seen (8:1 on the dark fill), the bubble's own light foreground
 * for the rest. `text-primary`/muted ink here was invisible on the dark bubble.
 */
export function MessageStatusIcon({ status }: { status: string }) {
  if (status === 'SEEN') return <CheckCheck className="h-3 w-3 text-gold" />;
  if (status === 'DELIVERED') return <CheckCheck className="h-3 w-3 text-primary-foreground/70" />;
  if (status === 'SENT') return <Check className="h-3 w-3 text-primary-foreground/70" />;
  return <Clock className="h-3 w-3 text-primary-foreground/70" />;
}

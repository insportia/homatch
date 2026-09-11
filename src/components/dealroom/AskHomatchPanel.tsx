// HOMATCH — Ask Homatch AI, inside the Deal Room it belongs to.
//
// The grounding label is the point of this component. Every assistant reply
// arrives with the refs it was grounded in, and:
//
//   * a NON-EMPTY grounding set  -> "based on the evidence found"
//   * an EMPTY grounding set     -> "general explanation, not verified here"
//
// The second label is not a disclaimer bolted on for safety; it is the honest
// description of what the reply actually is, and it is why the edge function
// stores an empty array rather than nothing.
import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Send } from 'lucide-react';

export interface AskMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  grounded: string[];
}

export function AskHomatchPanel({
  messages,
  onAsk,
  busy,
  error,
}: {
  messages: AskMessage[];
  onAsk: (question: string) => void;
  busy?: boolean;
  error?: string | null;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, busy]);

  const submit = () => {
    const q = draft.trim();
    if (!q || busy) return;
    onAsk(q);
    setDraft('');
  };

  return (
    <div className="space-y-4">
      {messages.length === 0 && !busy ? (
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <Sparkles className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
              <p className="text-sm text-muted-foreground leading-relaxed">{t('dr_ask_empty')}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-3">
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5">
                <p className="text-sm whitespace-pre-wrap break-words">{m.content}</p>
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex justify-start">
              <div className="max-w-[92%] sm:max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-4 py-3 space-y-2">
                <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{m.content}</p>
                <Badge variant={m.grounded.length ? 'secondary' : 'outline'} className="text-[13px] font-normal">
                  {m.grounded.length ? t('dr_ask_grounded') : t('dr_ask_general')}
                </Badge>
              </div>
            </div>
          )
        )}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-3">
              <p className="text-sm text-muted-foreground">{t('dr_loading')}</p>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-col sm:flex-row gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter makes a new line — but only on a
            // pointer-ish device; on mobile the on-screen Enter should insert
            // a newline, so the send button stays the reliable path.
            if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 640px)').matches) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t('dr_ask_placeholder')}
          rows={2}
          className="flex-1 text-sm"
          aria-label={t('dr_ask_placeholder')}
        />
        <Button onClick={submit} disabled={busy || !draft.trim()} className="gap-2 sm:self-end">
          <Send className="h-4 w-4" />
          {t('dr_ask_send')}
        </Button>
      </div>
    </div>
  );
}

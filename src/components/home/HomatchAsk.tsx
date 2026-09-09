import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { rememberPendingAsk } from '@/lib/pendingAsk';

/**
 * The Homatch AI entry point, shared by the Main Page hero panel and the
 * Dashboard's assistant card.
 *
 * It is a real entry into the real assistant, not a decorative chat mock: the
 * text is handed to /ai, which opens a conversation against the ai-chat edge
 * function through useAIChat(). Nothing is streamed or answered here — this
 * component's whole job is to carry the question to the page that can answer
 * it, which is why it is safe to render on the public landing page.
 *
 * SIGNED-OUT VISITORS
 *
 * /ai is an authenticated route, so a signed-out visitor is sent to sign-in
 * with the question parked by rememberPendingAsk(). All three auth entry
 * points replay it into the assistant afterwards, so the question a visitor
 * typed on the landing page is not lost at the door.
 */
interface HomatchAskProps {
  placeholder: string;
  suggestions: { key: string; label: string }[];
  /** Rendered above the input; the panel's own heading block. */
  header?: React.ReactNode;
  /** Compact spacing for the Dashboard card; roomy for the Main Page panel. */
  variant?: 'panel' | 'card';
  className?: string;
}

export function HomatchAsk({ placeholder, suggestions, header, variant = 'panel', className = '' }: HomatchAskProps) {
  const [value, setValue] = useState('');
  const { session } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  const submit = (text: string) => {
    const prompt = text.trim();
    if (!prompt) return;
    if (!session) {
      rememberPendingAsk(prompt);
      navigate('/auth/login');
      return;
    }
    navigate('/ai', { state: { prompt } });
  };

  const roomy = variant === 'panel';

  return (
    <div className={className}>
      {header}

      <form
        onSubmit={e => {
          e.preventDefault();
          submit(value);
        }}
        className={`relative flex items-center gap-2 rounded-2xl border border-border bg-background shadow-card transition-shadow focus-within:border-ring/50 focus-within:shadow-hover ${
          roomy ? 'p-2 pl-4' : 'p-1.5 pl-3'
        }`}
      >
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label={t('mp_ai_send')}
          className={`min-w-0 flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/70 focus:outline-none ${
            roomy ? 'py-2.5 text-sm md:text-base' : 'py-2 text-sm'
          }`}
        />
        <button
          type="submit"
          aria-label={t('mp_ai_send')}
          className={`grid shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:hover:scale-100 ${
            roomy ? 'h-11 w-11' : 'h-9 w-9'
          }`}
        >
          <ArrowRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </form>

      <div className={`flex flex-wrap gap-2 ${roomy ? 'mt-4' : 'mt-3'}`}>
        {suggestions.map(s => (
          <button
            key={s.key}
            type="button"
            onClick={() => submit(s.label)}
            className="rounded-full border border-border bg-card px-3.5 py-2 text-xs text-ink-soft transition-colors hover:border-ring/45 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {s.label}
          </button>
        ))}
      </div>

      {!session && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-gold" aria-hidden="true" />
          {t('mp_ai_signin_note')}
        </p>
      )}
    </div>
  );
}

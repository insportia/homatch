import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { rememberPendingAsk } from '@/lib/pendingAsk';

/**
 * The Homatch AI console — the Main Page hero's primary interaction, and the
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
export interface AskAction {
  key: string;
  label: string;
  /** Optional thin-stroke glyph. Given one, the action renders icon-led. */
  icon?: React.ElementType;
  /** What is actually sent to the assistant, when it differs from the label. */
  prompt?: string;
}

interface HomatchAskProps {
  placeholder: string;
  actions: AskAction[];
  /** 'console' is the hero's full-width intelligence bar; 'card' is compact. */
  variant?: 'console' | 'card';
  /** Renders the ✦ HOMATCH AI label above the field. */
  heading?: string;
  /** Which ground this is sitting on. 'dark' is the black hero and the black
      assistant region; 'light' is white cards. */
  tone?: 'light' | 'dark';
  className?: string;
}

export function HomatchAsk({
  placeholder, actions, variant = 'card', heading, tone = 'light', className = '',
}: HomatchAskProps) {
  const [value, setValue] = useState('');
  const { session } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();

  /* Everyone goes to the assistant, signed in or not.
   *
   * /ai renders for a signed-out visitor: it pre-fills the question, shows a
   * sign-in panel, and carries the question onward to sign-up or login. So
   * sending them to /auth/login first, as this used to, put a form between a
   * person and the thing they just asked for, for no gain. Signed in, AIPage
   * auto-sends the prompt, which is what makes a starter question feel like
   * one click rather than two.
   *
   * rememberPendingAsk still runs for the signed-out case, so the question
   * survives whichever auth entry point they end up using. */
  const submit = (text: string) => {
    const prompt = text.trim();
    if (!prompt) return;
    if (!session) rememberPendingAsk(prompt);
    navigate('/ai', { state: { prompt } });
  };

  const console_ = variant === 'console';
  const dark = tone === 'dark';

  return (
    <div className={className}>
      {heading && (
        <p className={`mb-3.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] ${dark ? 'text-gold' : 'text-gold-ink'}`}>
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          {heading}
        </p>
      )}

      <form
        onSubmit={e => {
          e.preventDefault();
          submit(value);
        }}
        // A hairline that warms to gold on focus. The whole console is the
        // affordance; there is no heavy chrome anywhere on it.
        className={`group/field relative flex items-center gap-2 border transition-[border-color,box-shadow] duration-300 motion-reduce:transition-none ${
          dark
            ? 'border-white/25 bg-white/[0.06] focus-within:border-gold focus-within:bg-white/[0.09]'
            : 'border-foreground/20 bg-card focus-within:border-gold focus-within:shadow-hover'
        } ${console_ ? 'rounded-[0.9rem] p-2 ps-4 sm:ps-5' : 'rounded-[0.75rem] p-1.5 ps-3'}`}
      >
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label={t('mp_ai_send')}
          className={`min-w-0 flex-1 bg-transparent focus:outline-none ${
            dark ? 'text-white placeholder:text-white/50' : 'text-foreground placeholder:text-muted-foreground/80'
          } ${console_ ? 'py-3 text-[15px] sm:text-base' : 'py-2 text-sm'}`}
        />
        <button
          type="submit"
          aria-label={t('mp_ai_send')}
          className={`grid shrink-0 place-items-center rounded-[0.6rem] transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none ${
            dark
              ? 'bg-gold text-[#0A0A0A] hover:bg-white focus-visible:ring-offset-[#0A0A0A]'
              : 'bg-primary text-primary-foreground hover:bg-gold-ink focus-visible:ring-offset-background'
          } ${console_ ? 'h-11 w-11' : 'h-9 w-9'}`}
        >
          <ArrowRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </form>

      {/* Prepared intelligence actions. Icon-led and hairline-bounded rather
          than filled buttons — they are shortcuts into the assistant, not
          four more calls to action competing with it. */}
      <div className={`flex flex-wrap gap-2 ${actions.length === 0 ? 'hidden' : ''} ${console_ ? 'mt-4' : 'mt-3'}`}>
        {actions.map(action => (
          <button
            key={action.key}
            type="button"
            onClick={() => submit(action.prompt ?? action.label)}
            className={`group inline-flex items-center gap-2.5 rounded-full border py-2 pe-3.5 ps-3 text-xs transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${
              dark
                ? 'border-white/[0.22] text-white/80 hover:border-gold hover:text-white'
                : 'border-foreground/[0.18] bg-card text-ink-soft hover:border-foreground hover:text-foreground'
            }`}
          >
            {action.icon && (
              <action.icon
                className={`h-[15px] w-[15px] shrink-0 transition-colors duration-300 motion-reduce:transition-none ${
                  dark ? 'text-gold' : 'text-muted-foreground group-hover:text-gold-ink'
                }`}
                strokeWidth={1.75}
                aria-hidden="true"
              />
            )}
            {action.label}
          </button>
        ))}
      </div>

      {!session && (
        <p className={`mt-3.5 text-xs leading-relaxed ${dark ? 'text-white/55' : 'text-muted-foreground'}`}>
          {t('mp_ai_signin_note')}
        </p>
      )}
    </div>
  );
}

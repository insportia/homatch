import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { rememberPendingAsk } from '@/lib/pendingAsk';
import { FeatureGlyph, type GlyphName } from '@/components/home/FeatureGlyph';

/**
 * THE STARTER QUESTIONS
 *
 * A blank assistant field asks a visitor to invent the question, and most
 * people cannot, because they do not yet know what the thing is capable of.
 * These are the questions instead: written as a person would actually say
 * them, not as feature names with a question mark on the end.
 *
 * WHY THEY ARE NOT QUICK REPLIES
 *
 * A row of grey chat pills reads as a chatbot. Each of these is a card with
 * the glyph of the capability the question lands in, so the set doubles as
 * an answer to "what else can this do" — a visitor who reads eight of them
 * has learned the product without being sold it.
 *
 * WHAT HAPPENS ON CLICK
 *
 * One click, not two. The question is carried into /ai, which auto-sends it
 * when the visitor is signed in and pre-fills it with a sign-in panel when
 * they are not, carrying it onward through sign-up. Nothing here needs a
 * second Send.
 *
 * The spread is deliberate. Cadastral checks are one of eight, because a
 * page where every suggestion is a verification teaches a visitor that
 * verification is all there is.
 */

export interface Intent {
  key: string;
  glyph: GlyphName;
  /** Translation key for the question, which is also what gets sent. */
  prompt: string;
}

export const INTENTS: Intent[] = [
  { key: 'buy', glyph: 'verify', prompt: 'mp_intent_buy' },
  { key: 'price', glyph: 'property', prompt: 'mp_intent_price' },
  { key: 'contract', glyph: 'contract', prompt: 'mp_intent_contract' },
  { key: 'sell', glyph: 'matching', prompt: 'mp_intent_sell' },
  { key: 'finance', glyph: 'mortgage', prompt: 'mp_intent_finance' },
  { key: 'district', glyph: 'property', prompt: 'mp_intent_district' },
  { key: 'rent', glyph: 'email', prompt: 'mp_intent_rent' },
  { key: 'platform', glyph: 'ai', prompt: 'mp_intent_platform' },
];

/** Ask the assistant a question, from anywhere on the public page. */
export function useAskHomatch() {
  const { session } = useAuth();
  const navigate = useNavigate();

  return (prompt: string) => {
    const text = prompt.trim();
    if (!text) return;
    if (!session) rememberPendingAsk(text);
    navigate('/ai', { state: { prompt: text } });
  };
}

/** The full grid: eight questions, two columns from sm. */
export function IntentCards({ intents = INTENTS, className = '' }: { intents?: Intent[]; className?: string }) {
  const { t, isRTL } = useLanguage();
  const ask = useAskHomatch();

  return (
    <div className={`grid gap-2.5 sm:grid-cols-2 ${className}`}>
      {intents.map(intent => (
        <button
          key={intent.key}
          type="button"
          onClick={() => ask(t(intent.prompt))}
          className="group flex items-center gap-3 rounded-[0.8rem] border border-foreground/[0.14] bg-card p-3 text-start transition-[border-color,box-shadow] duration-300 hover:border-foreground/45 hover:shadow-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none sm:p-3.5"
        >
          <FeatureGlyph
            name={intent.glyph}
            size={34}
            className="transition-transform duration-300 group-hover:scale-[1.06] motion-reduce:transform-none"
          />
          <span className="min-w-0 flex-1 text-pretty text-[16px] leading-snug text-foreground sm:text-sm">
            {t(intent.prompt)}
          </span>
          <ArrowRight
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-[transform,color] duration-300 group-hover:text-gold-ink motion-reduce:transform-none ${
              isRTL ? 'rotate-180 group-hover:-translate-x-1' : 'group-hover:translate-x-1'
            }`}
            strokeWidth={2}
            aria-hidden="true"
          />
        </button>
      ))}
    </div>
  );
}

/**
 * The hero's compact form: three questions as gold-edged chips on black.
 * Same behaviour, less furniture, because the hero has one job and it is not
 * to list eight things.
 */
export function IntentChips({ keys, className = '' }: { keys: string[]; className?: string }) {
  const { t } = useLanguage();
  const ask = useAskHomatch();
  const picked = INTENTS.filter(i => keys.includes(i.key));

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {picked.map(intent => (
        <button
          key={intent.key}
          type="button"
          onClick={() => ask(t(intent.prompt))}
          className="inline-flex items-center gap-2.5 rounded-full border border-white/25 py-2 pe-4 ps-2.5 text-start text-xs leading-snug text-white/80 transition-colors duration-300 hover:border-gold hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold motion-reduce:transition-none"
        >
          <FeatureGlyph name={intent.glyph} size={22} tone="dark" />
          {t(intent.prompt)}
        </button>
      ))}
    </div>
  );
}

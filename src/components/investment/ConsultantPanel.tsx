// HOMATCH INVESTMENT INTELLIGENCE — the Consultant.
//
// THIS IS THE PRODUCT, NOT A SIDEBAR ON IT.
//
// The entry state is a conversation and nothing else: no calculator, no
// grid of empty cards, no twenty fields to fill before anything happens.
// Somebody types a sentence about a flat and the workspace assembles itself
// around the answer. The analytical modules are what the Consultant
// produced, not a toolbox it happens to sit next to.
//
// WHY THE INPUT IS A TEXTAREA AND NOT A FORM
//
// "$100,000-იანი ბინაა, $500-ად ქირავდება, 35% მაქვს საკუთარი ფული" is one
// sentence and four fields. A form asks for the four fields; a consultant
// reads the sentence. The fields still exist — the assumptions panel is
// right there and every value in it is editable — but they are the
// CORRECTION surface, not the entry one.
//
// SIGNED OUT
//
// Everything deterministic works. The Consultant does not, because fair
// use is counted per person, and that is said in one line at the point it
// matters rather than as a wall in front of the page.

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, Sparkles, RotateCcw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import type { ConsultantMessage } from './useInvestmentSession';

const EXAMPLE_KEYS = [
  'inv_example_1',
  'inv_example_2',
  'inv_example_3',
  'inv_example_4',
] as const;

export function ConsultantPanel({
  messages,
  busy,
  error,
  questions,
  onSend,
  onReset,
  compact,
  hasScenario,
}: {
  messages: ConsultantMessage[];
  busy: boolean;
  error: string | null;
  questions: string[];
  onSend: (message: string) => void;
  onReset: () => void;
  /** The side-rail form, once a scenario exists. */
  compact: boolean;
  hasScenario: boolean;
}) {
  const { t, isRTL } = useLanguage();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!compact) return;
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length, busy, compact]);

  const submit = () => {
    const value = draft.trim();
    if (!value || busy) return;
    setDraft('');
    onSend(value);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter breaks a line. A multi-paragraph description
    // of a deal is rare; sending is what happens every turn.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const composer = (
    <div className="rounded-2xl border border-border bg-[hsl(var(--secondary))] p-2 focus-within:border-[hsl(var(--gold-border))]">
      <textarea
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        rows={compact ? 2 : 3}
        maxLength={2000}
        dir="auto"
        placeholder={t('inv_composer_placeholder')}
        aria-label={t('inv_composer_label')}
        className="block max-h-40 w-full resize-none bg-transparent px-3 py-2 text-base text-foreground outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center justify-between gap-2 px-1 pb-0.5">
        <p className="text-2xs text-muted-foreground">{t('inv_composer_hint')}</p>
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim() || busy}
          aria-label={t('inv_composer_send')}
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
            draft.trim() && !busy
              ? 'bg-[hsl(var(--gold))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--gold-hover))]'
              : 'bg-[hsl(var(--muted))] text-muted-foreground',
          )}
        >
          <ArrowUp className={cn('h-5 w-5', isRTL && 'scale-x-[-1]')} aria-hidden="true" />
        </button>
      </div>
    </div>
  );

  /* ── The entry state ───────────────────────────────────────────── */

  if (!compact) {
    return (
      <div className="mx-auto w-full max-w-[52rem] px-5 py-16 text-center sm:py-24">
        <div className="mx-auto mb-7 flex h-12 w-12 items-center justify-center rounded-2xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]">
          <Sparkles className="h-6 w-6 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
        </div>
        <p className="mb-3 text-2xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--gold-ink))]">
          {t('inv_product_eyebrow')}
        </p>
        <h1 className="font-display text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
          {t('inv_entry_title')}
        </h1>
        <p className="mx-auto mt-4 max-w-[46ch] text-base text-muted-foreground">
          {t('inv_entry_body')}
        </p>

        <div className="mt-9 text-start">{composer}</div>

        {error ? (
          <ConsultantNotice
            messageKey={error}
            onSignIn={error === 'inv_consultant_sign_in' ? () => navigate('/auth/login') : undefined}
          />
        ) : null}

        <div className="mt-8">
          <p className="mb-3 text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t('inv_entry_examples')}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {EXAMPLE_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setDraft(t(key));
                  inputRef.current?.focus();
                }}
                dir="auto"
                className="rounded-full border border-border px-4 py-2 text-start text-xs text-muted-foreground transition-colors hover:border-[hsl(var(--gold-border))] hover:text-foreground"
              >
                {t(key)}
              </button>
            ))}
          </div>
        </div>

        <p className="mx-auto mt-10 max-w-[52ch] text-2xs leading-relaxed text-muted-foreground">
          {t('inv_entry_honesty')}
        </p>
      </div>
    );
  }

  /* ── The working state ─────────────────────────────────────────── */

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[hsl(var(--gold-ink))]" aria-hidden="true" />
          <h2 className="font-display text-base font-semibold text-foreground">
            {t('inv_consultant_title')}
          </h2>
        </div>
        {hasScenario ? (
          <button
            type="button"
            onClick={onReset}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-2xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            {t('inv_reset')}
          </button>
        ) : null}
      </div>

      <div className="mb-3 min-h-0 flex-1 space-y-3 overflow-y-auto pe-1">
        {messages.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
            {t('inv_consultant_idle')}
          </p>
        ) : null}
        {messages.map((message) => (
          <div
            key={message.id}
            dir="auto"
            className={cn(
              'rounded-2xl px-4 py-3 text-sm leading-relaxed',
              message.role === 'user'
                ? 'ms-6 bg-[hsl(var(--secondary))] text-foreground'
                : 'border border-border bg-[hsl(var(--card))] text-foreground',
            )}
          >
            <p className="whitespace-pre-wrap">{message.content}</p>
            {message.applied?.length ? (
              <p className="mt-2 text-2xs text-[hsl(var(--gold-ink))]">
                {t('inv_consultant_understood', { fields: message.applied.length })}
              </p>
            ) : null}
          </div>
        ))}
        {busy ? (
          <div className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(var(--gold))]" />
            {t('inv_consultant_thinking')}
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {questions.length ? (
        <div className="mb-3">
          <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t('inv_consultant_next')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {questions.slice(0, 3).map((key) => (
              <span
                key={key}
                className="rounded-full border border-border px-2.5 py-1 text-2xs text-muted-foreground"
              >
                {t(key)}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {error ? (
        <ConsultantNotice
          messageKey={error}
          onSignIn={error === 'inv_consultant_sign_in' ? () => navigate('/auth/login') : undefined}
        />
      ) : null}

      {composer}

      {!session ? (
        <p className="mt-2 text-2xs text-muted-foreground">{t('inv_consultant_anon_note')}</p>
      ) : null}
    </div>
  );
}

function ConsultantNotice({
  messageKey,
  onSignIn,
}: {
  messageKey: string;
  onSignIn?: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="my-3 rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] px-4 py-3 text-start text-sm text-foreground">
      <p>{t(messageKey)}</p>
      {onSignIn ? (
        <button
          type="button"
          onClick={onSignIn}
          className="mt-2 rounded-full bg-[hsl(var(--gold))] px-4 py-1.5 text-2xs font-medium text-[hsl(var(--primary-foreground))]"
        >
          {t('inv_sign_in')}
        </button>
      ) : null}
    </div>
  );
}

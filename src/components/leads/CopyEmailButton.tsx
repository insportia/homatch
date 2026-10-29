// COPY EMAIL — the lead flow after Email Marketing was hidden (owner, 2026-10-29):
// find a match → view the authorised lead → COPY the email → write to them from your own
// mailbox. HOMATCH sends nothing here and queues nothing.
//
// The address is only ever one the server returned for this viewer (the caller passes the
// field it got from the authorised contact read); nothing is derived, guessed or masked
// back in. An empty address renders nothing.

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

/** Clipboard API first; the hidden-textarea fallback covers older in-app browsers. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the fallback */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    area.style.insetInlineStart = '-9999px';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

const COPIED_MS = 2_000;

export function CopyEmailButton({
  email, size = 'md', className, testId = 'copy-email',
}: {
  email: string | null | undefined;
  /** md: a full-width-capable button (drawers, cards); sm: an inline chip (list rows). */
  size?: 'sm' | 'md';
  className?: string;
  testId?: string;
}) {
  const { t } = useLanguage();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const address = typeof email === 'string' ? email.trim() : '';
  if (!address) return null;

  const onCopy = async () => {
    const ok = await copyText(address);
    setState(ok ? 'copied' : 'failed');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), ok ? COPIED_MS : COPIED_MS * 2);
  };

  const copied = state === 'copied';
  return (
    <span className={cn('inline-flex min-w-0 flex-col gap-1', className)}>
      <button
        type="button"
        onClick={() => void onCopy()}
        data-testid={testId}
        data-state={state}
        aria-label={t('lead_copy_email_aria', { email: address })}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 rounded-xl border font-semibold',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1',
          'motion-safe:transition-colors motion-safe:duration-150',
          size === 'sm' ? 'min-h-10 px-3 text-xs' : 'min-h-11 px-4 text-sm',
          copied
            ? 'border-emerald-600/40 bg-emerald-50 text-emerald-800'
            : 'border-[hsl(var(--gold-border))] bg-[hsl(42_100%_97%)] text-[hsl(var(--gold-ink))] hover:bg-[hsl(42_100%_94%)]',
        )}
      >
        {copied ? <Check className="h-4 w-4 shrink-0" aria-hidden="true" /> : <Copy className="h-4 w-4 shrink-0" aria-hidden="true" />}
        <span>{t(copied ? 'lead_email_copied' : 'lead_copy_email')}</span>
      </button>
      {/* Announced once per outcome; the visible label above already changes. */}
      <span className="sr-only" role="status" aria-live="polite">{copied ? t('lead_email_copied') : ''}</span>
      {state === 'failed' ? (
        <span role="alert" className="text-2xs leading-snug text-[hsl(0_55%_38%)]" data-testid={`${testId}-failed`}>{t('lead_copy_email_failed')}</span>
      ) : null}
    </span>
  );
}

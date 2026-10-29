import { useEffect, useRef } from 'react';
import { supabase } from '@/db/supabase';
import { isImpersonating } from '@/lib/impersonation';
import { languageToPersist } from '@/lib/notifications/preferredLanguage';

/*
 * Keep users.preferred_language equal to the language the signed-in person uses, so
 * transactional email and notification text reach them in it (rule:
 * src/lib/notifications/preferredLanguage.ts). Mounted once from AuthProvider.
 *
 * Waits for the interface to settle first: right after sign-in the account's saved
 * language may still be loading (LanguageContext.applyProfileLanguage), and writing the
 * pre-load language would overwrite the very choice being applied. Never writes while an
 * administrator is viewing as somebody. A failed write is retried on the next change.
 */
const SETTLE_MS = 1500;

export function usePersistPreferredLanguage(
  userId: string | null | undefined,
  stored: string | null | undefined,
  current: string,
): void {
  const baseline = useRef<{ userId: string; lang: string } | null>(null);
  const lastWritten = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) { baseline.current = null; lastWritten.current = null; return; }
    const timer = setTimeout(() => {
      let base = baseline.current;
      if (base?.userId !== userId) {
        base = { userId, lang: current };
        baseline.current = base;
        lastWritten.current = null;
      }
      const next = languageToPersist({ userId, stored, current, baseline: base.lang, lastWritten: lastWritten.current });
      if (!next || isImpersonating()) return;
      lastWritten.current = next;
      void supabase.from('users').update({ preferred_language: next }).eq('id', userId)
        .then(({ error }) => { if (error) lastWritten.current = null; });
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [userId, stored, current]);
}

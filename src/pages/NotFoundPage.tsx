import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { SmartBack } from '@/components/common/SmartBack';

/**
 * A PAGE THAT IS NOT THERE.
 *
 * The router used to answer every unknown URL with `<Navigate to="/" replace/>`.
 * Three things were wrong with that, and all of them are worse for the person
 * it happens to than a plain "not found" would have been:
 *
 *   - It says nothing. A stale bookmark, a renamed route or a typo landed on
 *     the marketing home page, which looks like the product working, so there
 *     is nothing to tell anyone their link was wrong.
 *   - `replace` DESTROYED the history entry, so the back button could not
 *     undo it. The page they came from was gone.
 *   - A signed-in customer following a broken internal link was dropped onto
 *     the public front page rather than anywhere in the product.
 *
 * So: say what happened, keep the history entry, and offer the two places
 * that are actually useful — back to where they were, and the top of whatever
 * they are signed in to.
 */
export default function NotFoundPage() {
  const { t } = useLanguage();
  const { session } = useAuth();
  const { pathname } = useLocation();

  return (
    <AppLayout>
      <div className="mx-auto flex max-w-lg flex-col items-center gap-5 py-16 text-center sm:py-24">
        <div className="grid h-16 w-16 place-items-center rounded-[1.1rem] border border-border bg-secondary">
          <Compass className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        </div>

        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold tracking-[-0.02em]">{t('notfound_title')}</h1>
          <p className="measure text-base leading-relaxed text-ink-soft">{t('notfound_body')}</p>
        </div>

        {/* The address itself, so somebody reporting the problem has something
            to report. Breaks anywhere, because a long URL must not widen the
            page on a phone. */}
        <code className="max-w-full break-all rounded-md bg-secondary px-3 py-1.5 text-sm text-muted-foreground">
          {pathname}
        </code>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild>
            <Link to={session ? '/dashboard' : '/'}>
              {session ? t('notfound_to_dashboard') : t('notfound_to_home')}
            </Link>
          </Button>
          <SmartBack />
        </div>
      </div>
    </AppLayout>
  );
}

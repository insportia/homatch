import React, { Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * §26: "Do not ship editor libraries to ordinary visitors. Lazy-load Site
 * Studio code."
 *
 * The split point is here rather than in routes.tsx so that the route entry
 * stays an ordinary static import like every other admin page, while the
 * editor itself — the inspector, the translation review, the device frame and
 * everything they pull in — lands in its own chunk that only loads when an
 * admin opens this page. A visitor reading the homepage never downloads any
 * of it.
 */
const StudioShell = lazy(() => import('@/components/studio/StudioShell'));

export default function SiteStudioPage() {
  const { t } = useLanguage();

  return (
    <Suspense
      fallback={(
        <div className="flex h-[60vh] items-center justify-center gap-2 text-[16px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('studio_loading')}
        </div>
      )}
    >
      <StudioShell />
    </Suspense>
  );
}

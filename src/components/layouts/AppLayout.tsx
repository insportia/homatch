import React from 'react';
import { AppHeader } from './AppHeader';
import { MobileBottomNav } from './MobileBottomNav';
import { AIFloatingButton } from '@/components/common/AIFloatingButton';
import { useAuth } from '@/contexts/AuthContext';

interface AppLayoutProps {
  children: React.ReactNode;
  noPadding?: boolean;
  /** Removes all px/py padding — used for full-bleed pages like the AI chat */
  hidePadding?: boolean;
}

// DashboardIntentPaths used to render here for /dashboard only. The
// redesigned dashboard has its own shell (HomatchShell) and does not use
// AppLayout at all, and its "Find a client" / "Find a property" quick actions
// carry the same two intents — so the block would never mount, and rendering
// it would duplicate the actions. The component file is left dormant rather
// than deleted, the same way CasesPage was.
export function AppLayout({ children, noPadding = false, hidePadding = false }: AppLayoutProps) {
  const { session } = useAuth();

  return (
    <div className="flex min-h-screen w-full flex-col bg-background overflow-x-hidden">
      <AppHeader />
      {/* pb-20 md:pb-8 ensures content is not hidden behind fixed bottom nav on mobile */}
      <main
        className={[
          'flex-1 min-w-0 overflow-x-hidden',
          !noPadding && !hidePadding ? 'px-4 py-6 md:px-6 md:py-8' : '',
          session ? 'pb-24 md:pb-8' : '',
        ].join(' ')}
      >
        {children}
      </main>
      {session && <MobileBottomNav />}
      {session && <AIFloatingButton />}
    </div>
  );
}
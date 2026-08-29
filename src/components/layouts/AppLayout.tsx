import React from 'react';
import { useLocation } from 'react-router-dom';
import { AppHeader } from './AppHeader';
import { MobileBottomNav } from './MobileBottomNav';
import { AIFloatingButton } from '@/components/common/AIFloatingButton';
import { DashboardIntentPaths } from '@/components/dashboard/DashboardIntentPaths';
import { useAuth } from '@/contexts/AuthContext';

interface AppLayoutProps {
  children: React.ReactNode;
  noPadding?: boolean;
  /** Removes all px/py padding — used for full-bleed pages like the AI chat */
  hidePadding?: boolean;
}

export function AppLayout({ children, noPadding = false, hidePadding = false }: AppLayoutProps) {
  const { session } = useAuth();
  const location = useLocation();
  const showDashboardIntentPaths = session && location.pathname === '/dashboard';

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
        {showDashboardIntentPaths && <DashboardIntentPaths />}
        {children}
      </main>
      {session && <MobileBottomNav />}
      {session && <AIFloatingButton />}
    </div>
  );
}
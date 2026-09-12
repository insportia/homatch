import React from 'react';
import { useLocation } from 'react-router-dom';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { SmartBack } from '@/components/common/SmartBack';
import { parentRouteFor } from '@/lib/backNavigation';
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
  /*
   * THE SURFACE BELONGS TO THE SHELL, NOT TO EACH PAGE.
   *
   * This was a per-page opt-in, and only 13 of 40 customer pages had opted
   * in. Every other one — AI, Chat, Live Chat, Credits, Profile, Activity,
   * Viewings, the property flows, the whole of Outreach, the verification
   * case — rendered on the DARK root palette, which is exactly why opening a
   * product from the new home page felt like arriving at a different, older
   * website.
   *
   * Making it the shell's business fixes all of them at once and means a new
   * page is correct by existing rather than by remembering a hook. The hook
   * counts claimants, so the pages that still call it themselves are
   * harmless; a screen that genuinely wants the dark palette opts out by not
   * using this shell.
   */
  useSurfaceTheme('light');
  const { session } = useAuth();
  const { pathname } = useLocation();

  /*
   * ONE BACK BUTTON, DECIDED ONCE.
   *
   * Mounted by the shell rather than by each screen, for the same reason the
   * surface is: 25 pages cannot be relied on to each remember, and the ones
   * that forgot are exactly the deep-linkable ones where being stranded
   * hurts most. A route with no parent in the table (the dashboard, the
   * hubs) renders nothing, so this adds chrome only where there is somewhere
   * to go back TO.
   *
   * Full-bleed screens opt out: the AI chat fills the viewport and owns its
   * own header, so a bar above it would eat the height the conversation
   * needs.
   */
  const showBack = !hidePadding && parentRouteFor(pathname) !== null;

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
        {showBack && (
          <div className={noPadding ? 'px-4 pb-4 pt-4 md:px-6' : 'pb-4'}>
            <SmartBack />
          </div>
        )}
        {children}
      </main>
      {session && <MobileBottomNav />}
      {session && <AIFloatingButton />}
    </div>
  );
}
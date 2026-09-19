import React from 'react';
import { useLocation } from 'react-router-dom';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { SmartBack } from '@/components/common/SmartBack';
import { parentRouteFor } from '@/lib/backNavigation';
import { AppHeader } from './AppHeader';
import { HomatchShell } from './HomatchShell';
import { MobileBottomNav } from './MobileBottomNav';
import { AIFloatingButton } from '@/components/common/AIFloatingButton';
import { AssistantProvider } from '@/components/assistant/AssistantContext';
import { AssistantDrawer } from '@/components/assistant/AssistantDrawer';
import { useAuth } from '@/contexts/AuthContext';

interface AppLayoutProps {
  children: React.ReactNode;
  noPadding?: boolean;
  /**
   * A screen that fills the window and manages its own scrolling — the
   * assistant. Removes the shell's padding AND makes the shell a fixed
   * height, so `h-full` inside it means the space that is actually left.
   */
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
  const { session, status } = useAuth();
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

  /*
   * A FULL-HEIGHT SCREEN IS A DIFFERENT SHELL, NOT THE SAME ONE WITHOUT
   * PADDING.
   *
   * The bottom padding below exists to keep content clear of the fixed
   * mobile nav, and on an ordinary scrolling page that is exactly right.
   * On a screen that has already sized itself to the window it is 96px of
   * pure overflow: measured at 390x844, the assistant's document was 933px
   * tall against an 844px viewport, so the whole page scrolled. On a chat
   * screen that means the header scrolls away while you are typing and the
   * composer will not stay put.
   *
   * So a full-bleed screen gets a shell that is exactly the window, with
   * no scroll of its own, and owns its bottom spacing — which is how it
   * can also use h-full instead of guessing at the header height.
   */
  const body = (
    <>
      {showBack && (
        <div className={noPadding ? 'px-4 pb-4 pt-4 md:px-6' : 'pb-4'}>
          <SmartBack />
        </div>
      )}
      {children}
    </>
  );

  /*
   * ── ONE SHELL FOR THE SIGNED-IN PRODUCT ──────────────────────────────
   *
   * This is the fix for "some authenticated pages suddenly show a top
   * navigation instead of the sidebar". They all did. HomatchShell was
   * written to be reusable and then used by exactly one page — the dashboard
   * — while the other twenty-six authenticated screens came through here and
   * got AppHeader, which is a second complete navigation with ten links of
   * its own. Verify, Mortgage, Profile, Credits, Activity, the property
   * flows, the whole of Communications: rail gone, horizontal menu instead.
   *
   * Routing the choice through the SESSION rather than through each page
   * means a screen cannot get it wrong by forgetting, and a new screen is
   * correct by existing. AppHeader keeps its job for signed-out visitors,
   * because several of these routes are deliberately public — a visitor can
   * run a verification or a mortgage calculation without an account, and a
   * sidebar full of tools they cannot open is not navigation.
   *
   * The assistant, the floating button and the mobile bottom nav are fixed
   * chrome and sit outside the shell's scroll container in both branches.
   */
  /*
   * ── BEFORE WE KNOW ───────────────────────────────────────────────────
   *
   * `session` is null both when nobody is signed in and when supabase-js has
   * not finished restoring, and this branch used to treat those as the same
   * thing. On every mobile refresh an authenticated customer got the guest
   * header — Login, Register — and then watched the entire shell be replaced
   * by the signed-in one. Not a style glitch: two different navigations, one
   * swapped for the other, plus a Register button offered to somebody with an
   * account.
   *
   * While the answer is genuinely UNKNOWN this renders neither. It is the
   * signed-in shell's geometry with nothing in it: the same h-16 md:h-20 bar,
   * the same lg:ps-[18rem] rail inset, the same main padding. So the page
   * beneath does not move when the answer arrives, and nothing on screen
   * claims anything about who the visitor is.
   *
   * A visitor with no persisted token never reaches this state at all —
   * authStatus resolves them to UNAUTHENTICATED synchronously, so a real
   * guest still gets the real guest header on the first frame.
   */
  if (status === 'UNKNOWN') {
    return (
      <div className={hidePadding
        ? 'flex h-[100dvh] w-full flex-col overflow-hidden bg-background'
        : 'min-h-screen w-full bg-background'}
      >
        <aside className="fixed inset-y-0 start-0 z-40 hidden h-[100dvh] w-[18rem] border-e border-sidebar-border bg-sidebar lg:block" aria-hidden="true" />
        <div className={`min-w-0 lg:ps-[18rem] ${hidePadding ? 'flex h-[100dvh] flex-col' : ''}`}>
          <header
            className={`z-30 border-b border-border bg-background/95 ${hidePadding ? 'shrink-0' : 'sticky top-0'}`}
            aria-hidden="true"
          >
            <div className="flex h-16 items-center gap-2 px-3 sm:gap-3 sm:px-4 md:h-20 md:px-6 lg:px-8" />
          </header>
          <main
            className={[
              'min-w-0 flex-1 overflow-x-hidden',
              hidePadding ? 'min-h-0' : '',
              !noPadding && !hidePadding ? 'px-4 py-6 md:px-6 md:py-8' : '',
            ].join(' ')}
            /* Announced once, rather than a spinner that says nothing and a
               screen reader that says nothing either. */
            aria-busy="true"
          >
            {body}
          </main>
        </div>
      </div>
    );
  }

  if (status === 'AUTHENTICATED') {
    return (
      <AssistantProvider>
        <HomatchShell noPadding={noPadding} hidePadding={hidePadding}>
          {body}
        </HomatchShell>
        <MobileBottomNav />
        <AIFloatingButton />
        <AssistantDrawer />
      </AssistantProvider>
    );
  }

  return (
    /* The provider wraps the whole shell so the floating button, the drawer and
     * whatever page is mounted in <main> all share one assistant. */
    <AssistantProvider>
    <div
      className={hidePadding
        ? 'flex h-[100dvh] w-full flex-col overflow-hidden bg-background'
        : 'flex min-h-screen w-full flex-col bg-background overflow-x-hidden'}
    >
      <AppHeader />
      <main
        className={[
          'min-w-0 flex-1 overflow-x-hidden',
          hidePadding ? 'min-h-0' : '',
          !noPadding && !hidePadding ? 'px-4 py-6 md:px-6 md:py-8' : '',
        ].join(' ')}
      >
        {body}
      </main>
    </div>
    </AssistantProvider>
  );
}
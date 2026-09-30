// HOMATCH — the one authenticated application shell.
//
// WHAT CHANGED, AND WHY IT MATTERED
//
// This file used to be "the shell the redesigned Dashboard uses". One page
// used it. The other twenty-six authenticated screens used AppLayout, which
// renders AppHeader — a complete second navigation system with ten of its own
// links. So opening Verify, or Mortgage, or Profile, or anything in
// Communications made the left rail vanish and a horizontal menu take its
// place, and the product appeared to change shape depending on where you
// stood in it.
//
// AppLayout now delegates here for every signed-in visitor, so this is the
// single authenticated chrome. AppHeader remains for signed-out visitors on
// pages that are public (Verify and Mortgage can both be used without an
// account) — one shell for the app, one for the public site, and no screen
// that switches between them while you are logged in.
//
// RESPONSIVE BEHAVIOUR
//
// Below lg the rail becomes an off-canvas drawer over a scrim, and the topbar
// grows a menu button. That is a recomposition, not a shrink — a rail this
// tall squeezed into 360px would be unusable — and the same grouping and the
// same items appear in both, so there is one taxonomy rather than two.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight, Bell, CreditCard, LogOut, Menu, Search,
  Settings, User as UserIcon, X, Activity,
  Coins as CoinsIcon,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNotificationCount } from '@/hooks/useNotificationCount';
import { getCreditAccount } from '@/services/api';
import { Button } from '@/components/ui/button';
import { HomatchLogo } from '@/components/common/HomatchLogo';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import { NavGlyph, type NavGlyphName } from './NavGlyph';
import { InstallApp } from '@/components/common/InstallApp';
import { UnreadBadge } from '@/components/common/UnreadBadge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { designStudioEnabled } from '@/lib/designStudio/access';

interface NavItem {
  key: string;
  path: string;
  /* The item's glyph in the customer navigation's own drawn family — one
     unified navy/gold language for the rail (see NavGlyph.tsx). */
  glyph: NavGlyphName;
  /* Presented only while this product is switched on for the viewer (see
     src/lib/designStudio/access.ts). Absent = always presented. */
  gate?: 'designStudio';
  /* Shown only to broker and agency accounts (users.account_type). */
  professional?: boolean;
}

interface NavGroup {
  /** The heading above the group. */
  key: string;
  items: NavItem[];
}

/*
 * THE PRODUCT NAVIGATION, IN THREE NAMED GROUPS.
 *
 * ONE DESTINATION PER PRODUCT
 *
 * The Communications group used to lead with "AI Communications" (/outreach),
 * a hub page that contained calls, WhatsApp, email, contacts, campaigns and
 * analytics — every one of which is also a destination in its own right. A
 * customer looking for WhatsApp had to decide whether WhatsApp lived under
 * "AI Communications" or under "AI Call Center", and the honest answer was
 * "both, differently". That hub is no longer a menu entry.
 *
 * What the group exposes instead is the three products themselves:
 *
 *   AI Call Center   telephony. Calls, and only calls.
 *   WhatsApp         two-way WhatsApp messaging, campaigns and automation.
 *   Email Campaigns  two-way email, campaigns and automation.
 *
 * plus the two conversation surfaces, Live Chat and Messages. "Communications"
 * survives as the group HEADING — an organising word, not a page.
 *
 * The /outreach route still resolves, because it has been linked and
 * bookmarked; it is simply no longer something the navigation sends anybody
 * to.
 *
 * ALSO GONE
 *
 *   Viewings (/viewings). Removed from customer-facing navigation at the
 *   owner's request — in every language, not by deleting the Georgian string
 *   and leaving "Viewings" in English. The route, the data and the viewing
 *   requests themselves are untouched.
 *
 *   Brokers & developers (/partners). A public marketing page, not a tool;
 *   it belongs in the public site's navigation, which still carries it.
 *
 * The account block is NOT in this list. It renders separately, below.
 */
export const NAV: NavGroup[] = [
  {
    key: 'nav_group_workspace',
    items: [
      { key: 'nav_dashboard', path: '/dashboard', glyph: 'dashboard' },
      /*
       * ONE OWNER WORKSPACE, WHERE THERE WERE TWO DESTINATIONS FOR ONE JOURNEY.
       *
       * This rail used to carry BOTH "My Properties" (/property) and "Find a buyer"
       * (dnav_find_client), and the second pointed at /property/add -- an ADD FORM
       * labelled as a buyer search. So an owner looking for buyers was sent to upload
       * another property, and the product appeared to have two competing answers to
       * one question.
       *
       * There is one. Buyer and tenant discovery starts FROM a property: the workspace
       * lists them, Property Details opens one, and the campaign panel already living
       * on Property Details is the real matching entry point. Nothing was deleted to
       * achieve that -- /property/add is still a route and is reached from the
       * workspace header, where adding a property belongs.
       *
       * THE LABEL IS LONG ON PURPOSE. It names all three jobs -- manage my properties,
       * find a buyer, find a tenant -- and the length is a design problem solved by
       * letting the row wrap to two lines, not by weakening the meaning to fit.
       *
       * The glyph is a house carrying a gold check (NavGlyph 'properties'): the
       * directive for this icon is property PLUS matching, and a building alone
       * is the portfolio without the product while a people glyph alone is a
       * CRM. The gold accent marks the outcome these properties exist to reach,
       * and it is unmistakable against the search lens one line below at 18px.
       */
      { key: 'nav_owner_workspace', path: '/property', glyph: 'properties' },
      /*
       * FIND PROPERTY: the other journey, and deliberately not this one.
       *
       * I HAVE A PROPERTY -> the workspace above. I NEED A PROPERTY -> here. It pointed
       * at /ai for a long time, which could not show a search plan, could not record
       * whether a requirement was REQUIRED or merely PREFERRED, and could not return a
       * result.
       *
       * A bare magnifying glass is gone and is not coming back: a loupe alone means
       * "search this text", which is the one thing this destination is not. NavGlyph
       * 'find_property' draws a house with a gold lens over it -- property discovery
       * specifically, from the same drawn family, and legible at 18px. Search (lucide)
       * is still imported and still used, on the dashboard's actual text search box,
       * which is what a bare magnifier is for.
       */
      { key: 'dnav_find_property', path: '/find-property', glyph: 'find_property' },
      /*
       * THE BROKER DIRECTORY, previously reachable only through the public
       * site. It is a working tool — find a professional for your market and
       * language — and a signed-in customer had no way to discover it existed.
       * This is /brokers the directory, not /partners the marketing page,
       * which stays public-only (see ALSO GONE above).
       */
      { key: 'pub_nav_brokers', path: '/brokers', glyph: 'brokers' },
      /* THE BROKER DESK: a professional's profile, verification, leads and
         client searches. Only a broker or agency account sees it. */
      { key: 'nav_broker_desk', path: '/broker', glyph: 'brokers', professional: true },
    ],
  },
  /*
   * FOR EXPATS sits between the workspace and the intelligence tools.
   *
   * It used to sit at the very top, above everything, on the reasoning that
   * filing it under Intelligence would make it read as a fifth analysis
   * tool. That reasoning still holds and this is not a demotion: it keeps
   * its own group and its own heading.
   *
   * What changed is what comes FIRST. Opening the product on a relocation
   * guide told every signed-in owner, buyer and broker that the thing
   * Homatch does is explain Georgia to foreigners. The workspace is what
   * they came for; Expat is what they reach for when a question about the
   * country gets in the way of it, which is exactly here -- after the work,
   * before the tools that assume you already know the ground rules.
   */
  {
    key: 'nav_group_expats',
    items: [{ key: 'nav_for_expats', path: '/for-expats/georgia', glyph: 'expats' }],
  },
  /*
   * HOMATCH DESIGN STUDIO, directly below For Expats and above the
   * intelligence tools. Its own group because it is its own kind of work:
   * not analysing a property, but designing the inside of one. Gated while
   * it is being built; the group disappears entirely when its item is hidden.
   */
  {
    key: 'nav_group_design',
    items: [{ key: 'nav_design_studio', path: '/design-studio', glyph: 'design_studio', gate: 'designStudio' }],
  },
  {
    key: 'nav_group_intelligence',
    items: [
      { key: 'nav_verify', path: '/verify', glyph: 'verify' },
      { key: 'nav_contracts', path: '/contracts', glyph: 'contracts' },
      { key: 'nav_mortgage', path: '/mortgage', glyph: 'mortgage' },
      { key: 'nav_investment', path: '/investment', glyph: 'investment' },
    ],
  },
  {
    key: 'nav_group_comms',
    items: [
      { key: 'call_center_title', path: '/outreach/calls', glyph: 'calls' },
      { key: 'comm_channel_whatsapp', path: '/outreach/whatsapp', glyph: 'whatsapp' },
      { key: 'nav_meta_ads', path: '/outreach/meta', glyph: 'meta_ads' },
      { key: 'dnav_email', path: '/outreach/email', glyph: 'email' },
      { key: 'nav_live_chat', path: '/live-chat', glyph: 'live_chat' },
      { key: 'nav_chat', path: '/chat', glyph: 'chat' },
    ],
  },
];

interface HomatchShellProps {
  children: React.ReactNode;
  /** The page owns its horizontal padding (full-bleed boards, workspaces). */
  noPadding?: boolean;
  /** The page is exactly the window and scrolls inside itself (the assistant). */
  hidePadding?: boolean;
}

export function HomatchShell({ children, noPadding = false, hidePadding = false }: HomatchShellProps) {
  // Same reason as AppLayout: the surface is the shell's job. The dashboard
  // happened to look right only because DashboardPage claimed it itself.
  useSurfaceTheme('light');
  const { homatchUser, signOut } = useAuth();
  const { t, isRTL } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const unread = useNotificationCount();
  const isProfessional = homatchUser?.account_type === 'BROKER' || homatchUser?.account_type === 'AGENCY';
  const [drawerOpen, setDrawerOpen] = useState(false);

  /* THE CREDIT BALANCE
   *
   * Read from credit_accounts through the same getCreditAccount() the
   * Credits page uses — one billing source, no second state, and no
   * hardcoded number anywhere near it. `null` means "not loaded yet or no
   * account row"; the indicator renders a placeholder rather than a zero,
   * because showing 0.0 to someone whose account simply has not loaded is a
   * lie about their balance. */
  const [credits, setCredits] = useState<number | null>(null);

  const loadCredits = useCallback(async () => {
    if (!homatchUser) return;
    try {
      const account = await getCreditAccount(homatchUser.id);
      setCredits(account ? Number(account.balance) : 0);
    } catch {
      /* A failed balance read must not take the whole shell down. */
    }
  }, [homatchUser]);

  useEffect(() => {
    void loadCredits();
  }, [loadCredits]);

  // The balance changes when the customer spends or tops up, both of which
  // happen on another route; re-reading on navigation keeps it honest
  // without polling.
  useEffect(() => {
    void loadCredits();
  }, [location.pathname, loadCredits]);

  // Any navigation closes the drawer — otherwise tapping a rail item on a
  // phone leaves the menu sitting over the page it just opened.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [drawerOpen]);

  const showDesignStudio = designStudioEnabled(homatchUser);
  const nav = NAV
    .map(group => ({
      ...group,
      items: group.items.filter(item => item.gate !== 'designStudio' || showDesignStudio),
    }))
    .filter(group => group.items.length > 0);

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`);

  const name = homatchUser?.full_name || homatchUser?.email || '';
  const initials = (name || '?').trim().charAt(0).toUpperCase();

  const rail = (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-5 md:h-20">
        <Link to="/" className="min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <HomatchLogo size="sm" withTagline />
        </Link>
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          aria-label={t('dnav_close')}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-foreground lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/*
        * A WIDER RAIL, READ AT ARM'S LENGTH.
        *
        * 15px text in taller rows inside an 18rem rail, rather than 14px
        * inside 16rem. Georgian is the reason the numbers moved: its words
        * for these concepts are long — "სამუშაო სივრცე", "AI კომუნიკაციები" —
        * and the previous rail truncated several of them, which turns
        * navigation into guesswork in the product's first language. Labels
        * wrap now instead of being cut.
        */}
      <nav aria-label={t('dnav_aria')} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {nav.map((group, gi) => (
          <div key={group.key} className={gi ? 'mt-5' : ''}>
            {/* A section label, at the weight of a label. tracking-[0.14em] on Georgian
                small caps was spacing a script that does not have small caps; 0.08em
                still separates the group without stretching the word. */}
            <p className="px-3 pb-1 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/90">
              {t(group.key)}
            </p>
            {group.items.filter(item => !item.professional || isProfessional).map(item => {
              const active = isActive(item.path);
              return (
                <Link
                  key={item.key}
                  to={item.path}
                  aria-current={active ? 'page' : undefined}
                  /*
                   * 14px AND gap-2.5, so the one long label wraps to TWO lines
                   * rather than three. The owner workspace is named explicitly --
                   * manage my properties, find a buyer, find a tenant -- and at
                   * 15px with gap-3 the Georgian broke after the slash and left
                   * a third line carrying one word, which reads as an accident.
                   * 14px is a normal navigation size and nothing here is truncated.
                   */
                  className={`group relative mt-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    active
                      /*
                       * QUIET GOLD, NOT SATURATED GOLD.
                       *
                       * This was `bg-gold` with black semibold text — the brand's primary
                       * CTA treatment, spent on a navigation state. Next to the rebuilt
                       * customer pages it became the highest-contrast object on the
                       * screen, which is the rail shouting over the results.
                       *
                       * Four agreeing signals carry it instead: the bar, the ground, the
                       * ink and the weight. None of them alone, all of them together.
                       */
                      ? 'bg-gold-soft font-semibold text-[hsl(var(--gold-ink))]'
                      : 'text-ink-soft hover:bg-gold-soft/60 hover:text-foreground'
                  }`}
                >
                  {/* The marker the eye actually finds. Gold now rather than black,
                      because the ground it sits on is quiet and a black bar on a pale
                      gold ground reads as a defect rather than as emphasis. */}
                  {active && (
                    <span
                      className="absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-[hsl(var(--gold))]"
                      aria-hidden="true"
                    />
                  )}
                  <NavGlyph name={item.glyph} active={active} />
                  {/*
                    text-wrap: balance, because the owner workspace label is long by
                    design and the browser distributes it better than a hard break can.
                    Without it the Georgian broke after the slash and left a single word
                    alone on a third line, which reads as an accident rather than a
                    composition. Widening the rail would have fixed it too and would have
                    changed the PROTECTED dashboard's content width, so it is not on the
                    table.
                  */}
                  <span className="min-w-0 flex-1 break-words [text-wrap:balance]">{t(item.key)}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/*
        * ── THE ACCOUNT CARD ────────────────────────────────────────
        *
        * Credits, plan, billing, activity and profile are not product tools,
        * and while they were rail items they read as though they were: a
        * customer scanning for "Verify" had to scan past "Credits" to get
        * there. They are now one bounded card, below a hairline, carrying the
        * four facts about the account — who you are, what plan you are on,
        * what you have left, and how to get more — and a menu for the rest.
        *
        * Deliberately ONE place. The balance also appears in the topbar
        * because it is commercially important and the topbar is visible while
        * the rail is a drawer; nothing else here is duplicated.
        */}
      <div className="shrink-0 border-t border-sidebar-border bg-sidebar p-3">
        <div className="rounded-[0.9rem] border border-border bg-card p-3 shadow-sm">
          <div className="flex items-center gap-2.5">
            {homatchUser?.avatar_url ? (
              <img src={homatchUser.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gold text-sm font-bold text-primary" aria-hidden="true">
                {initials}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-foreground">{name}</span>
              <span className="block truncate text-[13px] text-muted-foreground">{homatchUser?.email}</span>
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t('nav_account_section')}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Settings className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => navigate('/profile')} className="cursor-pointer gap-2">
                  <UserIcon className="h-4 w-4" /> {t('nav_profile')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/credits')} className="cursor-pointer gap-2">
                  <CreditCard className="h-4 w-4" /> {t('nav_account_billing')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/activity')} className="cursor-pointer gap-2">
                  <Activity className="h-4 w-4" /> {t('nav_activity')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={async () => {
                    await signOut();
                    navigate('/');
                  }}
                  className="cursor-pointer gap-2"
                >
                  <LogOut className="h-4 w-4" /> {t('nav_logout')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/*
            This was a two-up: a tile reading "Plan — FREE" beside the credit
            balance, under a gold "Upgrade" button pointing at the plan grid.
            There are no plans to be on and nothing to upgrade to, so the
            balance takes the whole row and the button does the only thing
            a customer can actually do with money here.
          */}
          <dl className="mt-3 text-[13px]">
            <button
              type="button"
              onClick={() => navigate('/credits')}
              className="w-full min-w-0 rounded-[0.5rem] bg-secondary px-2.5 py-1.5 text-start transition-colors hover:bg-gold-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="block truncate text-muted-foreground">{t('nav_credits')}</span>
              <span className="block truncate font-semibold tabular-nums text-foreground">
                {credits === null ? '—' : credits.toFixed(1)}
              </span>
            </button>
          </dl>

          <Button
            size="sm"
            className="mt-2.5 h-9 w-full gap-1.5 rounded-[0.5rem] bg-gold text-primary hover:bg-gold-hover"
            onClick={() => navigate('/credits')}
          >
            {t('cta_top_up')} <ArrowRight className={`h-3.5 w-3.5 ${isRTL ? 'rotate-180' : ''}`} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className={`bg-background ${hidePadding ? 'h-[100dvh] overflow-hidden' : 'min-h-screen'}`}>
      {/* Fixed rail on lg+ */}
      <aside className="fixed inset-y-0 start-0 z-40 hidden h-[100dvh] w-[18rem] border-e border-sidebar-border lg:block">{rail}</aside>

      {/* Off-canvas drawer below lg */}
      {drawerOpen && (
        <>
          <button
            type="button"
            aria-label={t('dnav_close')}
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 z-40 bg-[hsl(214_40%_12%/0.45)] lg:hidden"
          />
          <aside className="fixed inset-y-0 start-0 z-50 h-[100dvh] w-[18rem] max-w-[88vw] border-e border-sidebar-border shadow-hover lg:hidden">
            {rail}
          </aside>
        </>
      )}

      <div className={`min-w-0 lg:ps-[18rem] ${hidePadding ? 'flex h-[100dvh] flex-col' : ''}`}>
        {/*
          * THE TOPBAR IS A UTILITY BAR, NOT A SECOND NAVIGATION.
          *
          * Search, language, notifications, credits, add-property, install.
          * No product links: those live in the rail, once.
          */}
        {/* THE SHELL'S OWN NAVY. The pages' structural bands (PageHero, the
            dashboard welcome, the comms frames) established deep navy as the
            product's structure colour; the chrome now speaks the same
            language instead of sitting above it as a pale legacy strip.
            White carries the content, gold marks the one high-value action. */}
        <header
          className={`z-30 border-b border-white/10 bg-[#0C1119]/[0.97] text-white backdrop-blur-md ${
            hidePadding ? 'shrink-0' : 'sticky top-0'
          }`}
        >
          <div className="flex h-16 items-center gap-2 px-3 sm:gap-3 sm:px-4 md:h-20 md:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label={t('dnav_open')}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/25 text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]/60 lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>

            {/* The reference's wide topbar search is a real assistant prompt:
                it opens /ai with what was typed, rather than a search box that
                filters nothing. Hidden on the narrowest phones, where the
                dashboard's own AI card is a tap away. */}
            <div className="hidden min-w-0 flex-1 sm:block">
              <TopbarAsk />
            </div>
            <div className="flex-1 sm:hidden" />

            <div className="flex min-w-0 shrink items-center gap-1 sm:gap-1.5">
              {/* Available balance. Commercially important, so it is a
                  first-class control in the header rather than something
                  buried in a menu. */}
              <button
                type="button"
                onClick={() => navigate('/credits')}
                aria-label={t('db_credits_aria')}
                className="flex h-10 min-w-0 shrink items-center gap-1.5 rounded-full border border-white/25 px-2.5 text-white transition-colors hover:border-[hsl(38_92%_56%)]/70 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]/60 sm:gap-2 sm:px-3"
              >
                <CoinsIcon className="h-4 w-4 shrink-0 text-[hsl(38_92%_60%)]" strokeWidth={1.75} aria-hidden="true" />
                <span className="min-w-0 truncate text-sm font-semibold tabular-nums leading-none">
                  {credits === null ? '—' : credits.toFixed(1)}
                </span>
                <span className="hidden text-[13px] text-white/60 lg:inline">{t('nav_credits')}</span>
              </button>

              <div className="hidden sm:block"><InstallApp compact tone="dark" /></div>
              <LanguageSwitcher showGlobe triggerClassName="h-10 rounded-full border border-white/25 px-2.5 text-white/85 hover:bg-white/10 hover:text-white" />

              <button
                type="button"
                onClick={() => navigate('/notifications')}
                aria-label={t('notif_title')}
                className="relative grid h-10 w-10 place-items-center rounded-full border border-white/25 text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]/60"
              >
                <Bell className="h-4 w-4" aria-hidden="true" />
                <UnreadBadge
                  count={unread}
                  className="absolute -end-0.5 -top-0.5"
                  label={t('notif_unread_count', { n: unread })}
                />
              </button>

              <Button className="hidden h-10 gap-2 rounded-full bg-[hsl(38_92%_54%)] px-4 text-sm font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)] sm:inline-flex" onClick={() => navigate('/property/add')}>
                <span className="text-base leading-none" aria-hidden="true">+</span>
                <span className="hidden md:inline">{t('nav_add_property')}</span>
              </Button>
              <Button size="icon" className="h-10 w-10 rounded-full bg-[hsl(38_92%_54%)] font-bold text-[#161309] hover:bg-[hsl(38_92%_60%)] sm:hidden" onClick={() => navigate('/property/add')} aria-label={t('nav_add_property')}>
                <span className="text-lg leading-none" aria-hidden="true">+</span>
              </Button>
            </div>
          </div>
        </header>

        {/*
          * Three main shapes, for the three kinds of screen this shell now
          * carries. A full-height screen (the assistant) is the window minus
          * the topbar and scrolls inside itself; a full-bleed screen owns its
          * own horizontal padding; everything else gets the standard gutter
          * plus room for the mobile bottom nav.
          */}
        <main
          className={
            hidePadding
              ? 'min-h-0 flex-1 overflow-hidden'
              : noPadding
                ? 'mx-auto w-full min-w-0 max-w-[1600px] pb-24 md:pb-8'
                : 'mx-auto min-w-0 max-w-[1600px] px-4 py-6 pb-24 md:px-6 md:py-8 md:pb-8 lg:px-8'
          }
        >
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * The topbar prompt. It opens the real assistant with whatever was typed;
 * the suggestion chips that accompany this on the Main Page belong on the
 * dashboard's own AI card, not in the chrome. No signed-out branch is needed
 * here — the shell only ever renders for a signed-in visitor.
 */
function TopbarAsk() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [value, setValue] = useState('');

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        const prompt = value.trim();
        if (prompt) navigate('/ai', { state: { prompt } });
      }}
      className="relative flex items-center"
    >
      <Search className="pointer-events-none absolute start-4 h-4 w-4 text-white/55" aria-hidden="true" />
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={t('db_search_placeholder')}
        aria-label={t('db_search_submit')}
        className="h-11 w-full rounded-full border border-white/[0.16] bg-white/[0.07] ps-11 pe-4 text-sm text-white placeholder:text-white/55 focus:border-[hsl(38_92%_56%)]/60 focus:outline-none focus:ring-2 focus:ring-[hsl(38_92%_56%)]/25"
      />
    </form>
  );
}

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
  ArrowRight, Bell, CalendarDays, CreditCard, LayoutDashboard,
  LogOut, Menu, MessageSquare, PhoneCall, Radio, Search, Settings,
  ShieldCheck, Sparkles, User as UserIcon, UserSearch, X, Activity,
  CircleDollarSign, Megaphone, Coins as CoinsIcon,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNotificationCount } from '@/hooks/useNotificationCount';
import { getCreditAccount } from '@/services/api';
import { Button } from '@/components/ui/button';
import { HomatchLogo } from '@/components/common/HomatchLogo';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import { InstallApp } from '@/components/common/InstallApp';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';

interface NavItem {
  key: string;
  path: string;
  icon: React.ElementType;
}

interface NavGroup {
  /** The heading above the group. */
  key: string;
  items: NavItem[];
}

/*
 * THE PRODUCT NAVIGATION, IN THREE NAMED GROUPS.
 *
 * The rail was fifteen flat links separated only by extra whitespace, which
 * is a list, not a structure: "Alerts" sat between "Find a property" and
 * "Verify" with nothing saying why, and Credits and Activity sat as equal
 * siblings of Verify and Mortgage even though one pair is the product and the
 * other is the customer's own account.
 *
 * Two entries are deliberately gone:
 *
 *   Email campaigns (/outreach/email). Communications already contains
 *   campaigns, contacts, WhatsApp, calls, inbox and analytics. Two doors to
 *   the same room, differently named, is a decision the customer should never
 *   have been asked to make.
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
      { key: 'nav_dashboard', path: '/dashboard', icon: LayoutDashboard },
      { key: 'dnav_find_property', path: '/ai', icon: Search },
      { key: 'dnav_find_client', path: '/property/add', icon: UserSearch },
      { key: 'nav_active_search', path: '/active-search', icon: Radio },
    ],
  },
  {
    key: 'nav_group_intelligence',
    items: [
      { key: 'nav_verify', path: '/verify', icon: ShieldCheck },
      { key: 'nav_mortgage', path: '/mortgage', icon: CircleDollarSign },
      { key: 'nav_viewings', path: '/viewings', icon: CalendarDays },
    ],
  },
  {
    key: 'nav_group_comms',
    items: [
      { key: 'nav_ai_comms', path: '/outreach', icon: Megaphone },
      { key: 'call_center_title', path: '/outreach/calls', icon: PhoneCall },
      { key: 'nav_chat', path: '/chat', icon: MessageSquare },
      { key: 'nav_live_chat', path: '/live-chat', icon: Sparkles },
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
        {NAV.map((group, gi) => (
          <div key={group.key} className={gi ? 'mt-5' : ''}>
            <p className="px-3 pb-1.5 text-[13px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t(group.key)}
            </p>
            {group.items.map(item => {
              const active = isActive(item.path);
              return (
                <Link
                  key={item.key}
                  to={item.path}
                  aria-current={active ? 'page' : undefined}
                  className={`relative mt-0.5 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    active
                      // Strong gold with black text. A selected row should be
                      // the most certain thing on the rail, not a tint you
                      // have to look for.
                      ? 'bg-gold font-semibold text-primary'
                      : 'text-ink-soft hover:bg-gold-soft hover:text-foreground'
                  }`}
                >
                  {/* The active marker is a full-height gold bar rather than a
                      2px hairline: at a glance the eye finds the bar, not a
                      faint tint difference between two greys. */}
                  {active && (
                    <span
                      className="absolute inset-y-1.5 start-0 w-1 rounded-full bg-primary"
                      aria-hidden="true"
                    />
                  )}
                  <item.icon
                    className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`}
                    strokeWidth={active ? 2.25 : 1.75}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 break-words">{t(item.key)}</span>
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

          <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
            <div className="min-w-0 rounded-[0.5rem] bg-secondary px-2.5 py-1.5">
              <dt className="truncate text-muted-foreground">{t('db_plan_title')}</dt>
              <dd className="truncate font-semibold uppercase text-foreground">{homatchUser?.plan || 'FREE'}</dd>
            </div>
            <button
              type="button"
              onClick={() => navigate('/credits')}
              className="min-w-0 rounded-[0.5rem] bg-secondary px-2.5 py-1.5 text-start transition-colors hover:bg-gold-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            onClick={() => navigate('/pricing')}
          >
            {t('db_plan_upgrade')} <ArrowRight className={`h-3.5 w-3.5 ${isRTL ? 'rotate-180' : ''}`} aria-hidden="true" />
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
        <header
          className={`z-30 border-b border-border bg-background/[0.92] backdrop-blur-md ${
            hidePadding ? 'shrink-0' : 'sticky top-0'
          }`}
        >
          <div className="flex h-16 items-center gap-2 px-3 sm:gap-3 sm:px-4 md:h-20 md:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label={t('dnav_open')}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border text-foreground lg:hidden"
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
                className="flex h-10 min-w-0 shrink items-center gap-1.5 rounded-full border border-foreground/20 px-2.5 text-foreground transition-colors hover:border-gold hover:bg-gold-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-2 sm:px-3"
              >
                <CoinsIcon className="h-4 w-4 shrink-0 text-gold-ink" strokeWidth={1.75} aria-hidden="true" />
                <span className="min-w-0 truncate text-sm font-semibold tabular-nums leading-none">
                  {credits === null ? '—' : credits.toFixed(1)}
                </span>
                <span className="hidden text-[13px] text-muted-foreground lg:inline">{t('nav_credits')}</span>
              </button>

              <div className="hidden sm:block"><InstallApp compact /></div>
              <LanguageSwitcher showGlobe triggerClassName="h-10 rounded-full px-2.5" />

              <button
                type="button"
                onClick={() => navigate('/notifications')}
                aria-label={t('notif_title')}
                className="relative grid h-10 w-10 place-items-center rounded-full border border-foreground/20 text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Bell className="h-4 w-4" aria-hidden="true" />
                {unread > 0 && (
                  <span className="absolute -end-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-destructive px-1 text-[13px] font-bold text-destructive-foreground">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </button>

              <Button className="hidden h-10 gap-2 rounded-full px-4 text-sm sm:inline-flex" onClick={() => navigate('/property/add')}>
                <span className="text-base leading-none" aria-hidden="true">+</span>
                <span className="hidden md:inline">{t('nav_add_property')}</span>
              </Button>
              <Button size="icon" className="h-10 w-10 rounded-full sm:hidden" onClick={() => navigate('/property/add')} aria-label={t('nav_add_property')}>
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
      <Search className="pointer-events-none absolute start-4 h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={t('db_search_placeholder')}
        aria-label={t('db_search_submit')}
        className="h-11 w-full rounded-full border border-foreground/[0.18] bg-card ps-11 pe-4 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-ring/50 focus:outline-none focus:ring-2 focus:ring-ring/25"
      />
    </form>
  );
}

// HOMATCH — the sidebar application shell used by the redesigned Dashboard.
//
// The design reference replaces the app's topbar-only chrome with a fixed
// left rail plus a slim topbar. This component owns that chrome and nothing
// else: it takes no data of its own, so it can later wrap other authenticated
// screens without dragging dashboard concerns along with it.
//
// RESPONSIVE BEHAVIOUR
//
// Below lg the rail becomes an off-canvas drawer over a scrim, and the topbar
// grows a menu button. That is a recomposition, not a shrink — a 14-item rail
// squeezed into 360px would be unusable, and the reference gives no mobile
// treatment to copy, so the rule applied here is that navigation is one tap
// away and never covers the content it navigates to.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight, Bell, Building2, CalendarDays, Coins, Crown, LayoutDashboard,
  LogOut, Mail, Megaphone, Menu, MessageSquare, PhoneCall, Radio, Search,
  ShieldCheck, Sparkles, User as UserIcon, UserSearch, X, Activity, CircleDollarSign,
  Coins as CoinsIcon,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNotificationCount } from '@/hooks/useNotificationCount';
import { getCreditAccount } from '@/services/api';
import { Button } from '@/components/ui/button';
import { HomatchLogo } from '@/components/common/HomatchLogo';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface NavItem {
  key: string;
  path: string;
  icon: React.ElementType;
  /** Starts a visual group; rendered as extra space, matching the reference's
      ungrouped-but-spaced rail rather than adding section headings. */
  gap?: boolean;
}

const NAV: NavItem[] = [
  { key: 'nav_dashboard', path: '/dashboard', icon: LayoutDashboard },

  { key: 'dnav_find_client', path: '/property/add', icon: UserSearch, gap: true },
  { key: 'dnav_find_property', path: '/ai', icon: Search },
  { key: 'nav_active_search', path: '/active-search', icon: Radio },

  { key: 'nav_verify', path: '/verify', icon: ShieldCheck, gap: true },
  { key: 'nav_mortgage', path: '/mortgage', icon: CircleDollarSign },

  { key: 'nav_chat', path: '/chat', icon: MessageSquare, gap: true },
  { key: 'nav_live_chat', path: '/live-chat', icon: Sparkles },
  { key: 'nav_viewings', path: '/viewings', icon: CalendarDays },

  { key: 'dnav_email', path: '/outreach/email', icon: Mail, gap: true },
  { key: 'call_center_title', path: '/outreach/calls', icon: PhoneCall },
  { key: 'nav_outreach', path: '/outreach', icon: Megaphone },
  { key: 'dnav_partners', path: '/partners', icon: Building2 },

  { key: 'nav_activity', path: '/activity', icon: Activity, gap: true },
  { key: 'nav_credits', path: '/credits', icon: Coins },
];

interface HomatchShellProps {
  children: React.ReactNode;
}

export function HomatchShell({ children }: HomatchShellProps) {
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
   * lie about their balance. Clicking it goes to /credits, the top-up
   * destination that already exists. */
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

  const initials = (homatchUser?.full_name || homatchUser?.email || '?').trim().charAt(0).toUpperCase();

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
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-foreground lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav aria-label={t('dnav_aria')} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {NAV.map(item => {
          const active = isActive(item.path);
          return (
            <Link
              key={item.key}
              to={item.path}
              aria-current={active ? 'page' : undefined}
              className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                item.gap ? 'mt-2' : 'mt-0.5'
              } ${
                active
                  ? 'bg-secondary font-semibold text-foreground'
                  : 'text-ink-soft hover:bg-sidebar-accent/70 hover:text-foreground'
              }`}
            >
              {active && (
                <span
                  className="absolute inset-y-2 start-0 w-0.5 rounded-full bg-gold"
                  aria-hidden="true"
                />
              )}
              <item.icon className={`h-4 w-4 shrink-0 ${active ? 'text-gold-ink' : 'text-muted-foreground'}`} strokeWidth={1.75} aria-hidden="true" />
              <span className="min-w-0 truncate">{t(item.key)}</span>
            </Link>
          );
        })}
      </nav>

      {/* ── The sidebar's bottom block ──────────────────────────────
          Plan card and account, in ONE shrink-0 region with a hairline above
          it. The rail is `flex h-full flex-col` and the nav above is
          `min-h-0 flex-1 overflow-y-auto`, so this sits at the bottom at
          every viewport height and the nav scrolls behind its own edge
          rather than disappearing under a floating card. Nothing here is
          absolutely positioned. */}
      <div className="shrink-0 border-t border-sidebar-border bg-sidebar px-3 pt-3">
        <div className="rounded-[0.8rem] bg-primary p-4 text-primary-foreground">
          <div className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-gold" aria-hidden="true" />
            <p className="min-w-0 truncate text-sm font-semibold">
              {homatchUser?.plan ? `${t('db_plan_title')} · ${homatchUser.plan}` : t('db_plan_title')}
            </p>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-primary-foreground/70">{t('db_plan_body')}</p>
          <Button
            size="sm"
            className="mt-3 h-9 w-full gap-1.5 rounded-[0.5rem] bg-gold text-primary hover:bg-gold/90"
            onClick={() => navigate('/credits')}
          >
            {t('db_plan_upgrade')} <ArrowRight className={`h-3.5 w-3.5 ${isRTL ? 'rotate-180' : ''}`} aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="shrink-0 px-3 pb-3 pt-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-start transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {homatchUser?.avatar_url ? (
                <img src={homatchUser.avatar_url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sand text-sm font-semibold text-foreground" aria-hidden="true">
                  {initials}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {homatchUser?.full_name || homatchUser?.email || ''}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{homatchUser?.email}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={() => navigate('/profile')} className="cursor-pointer gap-2">
              <UserIcon className="h-4 w-4" /> {t('nav_profile')}
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
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Fixed rail on lg+ */}
      <aside className="fixed inset-y-0 start-0 z-40 hidden h-[100dvh] w-64 border-e border-sidebar-border lg:block">{rail}</aside>

      {/* Off-canvas drawer below lg */}
      {drawerOpen && (
        <>
          <button
            type="button"
            aria-label={t('dnav_close')}
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 z-40 bg-[hsl(214_40%_12%/0.45)] lg:hidden"
          />
          <aside className="fixed inset-y-0 start-0 z-50 h-[100dvh] w-[17rem] max-w-[85vw] border-e border-sidebar-border shadow-hover lg:hidden">
            {rail}
          </aside>
        </>
      )}

      <div className="min-w-0 lg:ps-64">
        <header className="sticky top-0 z-30 border-b border-border bg-background/[0.92] backdrop-blur-md">
          <div className="flex h-16 items-center gap-3 px-4 md:h-20 md:px-6 lg:px-8">
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

            <div className="flex shrink-0 items-center gap-1.5">
              {/* Available balance. Commercially important, so it is a
                  first-class control in the header rather than something
                  buried in a menu. */}
              <button
                type="button"
                onClick={() => navigate('/credits')}
                aria-label={t('db_credits_aria')}
                className="flex h-10 items-center gap-2 rounded-full border border-foreground/20 px-3 text-foreground transition-colors hover:border-gold hover:bg-gold-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CoinsIcon className="h-4 w-4 shrink-0 text-gold-ink" strokeWidth={1.75} aria-hidden="true" />
                <span className="text-sm font-semibold tabular-nums leading-none">
                  {credits === null ? '—' : credits.toFixed(1)}
                </span>
                <span className="hidden text-xs text-muted-foreground lg:inline">{t('nav_credits')}</span>
              </button>

              <LanguageSwitcher showGlobe triggerClassName="h-10 rounded-full px-2.5" />

              <button
                type="button"
                onClick={() => navigate('/notifications')}
                aria-label={t('notif_title')}
                className="relative grid h-10 w-10 place-items-center rounded-full border border-foreground/20 text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Bell className="h-4 w-4" aria-hidden="true" />
                {unread > 0 && (
                  <span className="absolute -end-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-destructive px-1 text-[12px] font-bold text-destructive-foreground">
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

        <main className="mx-auto max-w-[1600px] px-4 py-6 md:px-6 md:py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

/**
 * The topbar prompt. It opens the real assistant with whatever was typed;
 * the suggestion chips that accompany this on the Main Page belong on the
 * dashboard's own AI card, not in the chrome. No signed-out branch is needed
 * here — the shell only ever renders behind RouteGuard.
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

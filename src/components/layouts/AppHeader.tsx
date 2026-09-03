import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { HomatchLogo } from '@/components/common/HomatchLogo';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import {
  LayoutDashboard,
  Coins,
  Activity,
  PlusCircle,
  User,
  LogOut,
  Menu,
  Bell,
  ChevronDown,
  MessageSquare,
  CalendarDays,
  Search,
  Bot,
  Shield,
  Building2,
  Megaphone,
  Radio,
} from 'lucide-react';
import { useNotificationCount } from '@/hooks/useNotificationCount';

const navItems = [
  { key: 'nav_dashboard',     path: '/dashboard',      icon: LayoutDashboard },
  { key: 'nav_ai',            path: '/ai',             icon: Bot,         highlight: true },
  { key: 'nav_chat',          path: '/chat',           icon: MessageSquare },
  { key: 'nav_live_chat',     path: '/live-chat',      icon: Radio },
  { key: 'nav_viewings',      path: '/viewings',       icon: CalendarDays },
  { key: 'nav_active_search', path: '/active-search',  icon: Search },
  { key: 'nav_outreach',      path: '/outreach',       icon: Megaphone },
  { key: 'nav_verify',        path: '/verify',         icon: Shield },
  { key: 'nav_credits',       path: '/credits',        icon: Coins },
];

export function AppHeader() {
  const { session, homatchUser, signOut } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const unreadCount = useNotificationCount();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="flex items-center h-14 px-4 md:px-6 gap-4 max-w-screen overflow-x-hidden">
        {/* Logo — always goes to the public home page, regardless of auth state */}
        <Link to="/" className="shrink-0">
          <HomatchLogo size="sm" />
        </Link>

        {/* Desktop Nav */}
        {session && (
          <nav className="hidden md:flex items-center gap-1 flex-1">
            {navItems.map(item => (
              <Link key={item.path} to={item.path}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`gap-2 text-sm ${
                    isActive(item.path)
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {t(item.key)}
                </Button>
              </Link>
            ))}
          </nav>
        )}

        <div className="flex-1 md:flex-none" />

        {/* Right side */}
        <div className="flex items-center gap-1 shrink-0">
          <LanguageSwitcher />

          {session ? (
            <>
              {/* Notifications */}
              <Button
                variant="ghost"
                size="sm"
                className="relative h-8 w-8 p-0"
                onClick={() => navigate('/notifications')}
                aria-label={t('notif_title')}
              >
                <Bell className="h-4 w-4 text-muted-foreground" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-primary text-primary-foreground text-[9px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Button>

              {/* Ask AI shortcut */}
              <Button
                variant="ghost"
                size="sm"
                className="hidden md:flex gap-1.5 text-primary hover:text-primary h-8"
                onClick={() => navigate('/ai')}
              >
                <Bot className="h-4 w-4" />
                <span className="text-xs font-medium">{t('nav_ask_ai_short')}</span>
              </Button>

              {/* Add property */}
              <Button
                variant="ghost"
                size="sm"
                className="hidden md:flex gap-1.5 text-muted-foreground hover:text-foreground h-8"
                onClick={() => navigate('/property/add')}
              >
                <PlusCircle className="h-4 w-4" />
                <span className="text-xs font-medium">{t('nav_add')}</span>
              </Button>

              {/* Profile menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="hidden md:flex gap-1.5 h-8 px-2 text-muted-foreground hover:text-foreground"
                  >
                    <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center">
                      <User className="h-3 w-3 text-muted-foreground" />
                    </div>
                    <ChevronDown className="h-3 w-3 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align={isRTL ? 'start' : 'end'} className="w-48 bg-card border-border">
                  <div className="px-3 py-2">
                    <p className="text-xs font-medium text-foreground truncate">
                      {homatchUser?.full_name ?? homatchUser?.email ?? t('header_account_fallback')}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{homatchUser?.email}</p>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/profile')} className="gap-2 cursor-pointer">
                    <User className="h-4 w-4" />
                    {t('nav_profile')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut} className="gap-2 cursor-pointer text-destructive focus:text-destructive">
                    <LogOut className="h-4 w-4" />
                    {t('nav_logout')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Mobile hamburger */}
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="sm" className="md:hidden h-8 w-8 p-0">
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side={isRTL ? 'right' : 'left'} className="w-64 bg-sidebar border-sidebar-border p-0">
                  <div className="flex flex-col h-full">
                    <div className="p-4 border-b border-sidebar-border">
                      <HomatchLogo size="sm" />
                    </div>
                    <nav className="flex-1 p-3 space-y-1">
                      {navItems.map(item => {
                        const highlight = item.key === 'nav_ai';
                        return (
                          <Link
                            key={item.path}
                            to={item.path}
                            onClick={() => setMobileOpen(false)}
                          >
                            <div
                              className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm min-h-12 ${
                                isActive(item.path)
                                  ? 'bg-secondary text-foreground font-medium'
                                  : highlight
                                  ? 'text-primary font-medium hover:bg-sidebar-accent'
                                  : 'text-sidebar-foreground hover:bg-sidebar-accent'
                              }`}
                            >
                              <item.icon className={`h-4 w-4 shrink-0 ${highlight ? 'text-primary' : ''}`} />
                              {t(item.key)}
                            </div>
                          </Link>
                        );
                      })}
                      <Link to="/property/add" onClick={() => setMobileOpen(false)}>
                        <div className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm min-h-12 text-muted-foreground hover:bg-sidebar-accent">
                          <PlusCircle className="h-4 w-4 shrink-0" />
                          {t('nav_add_property')}
                        </div>
                      </Link>
                      <Link to="/verify" onClick={() => setMobileOpen(false)}>
                        <div className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm min-h-12 text-muted-foreground hover:bg-sidebar-accent">
                          <Shield className="h-4 w-4 shrink-0" />
                          {t('nav_verify')}
                        </div>
                      </Link>
                      <Link to="/profile" onClick={() => setMobileOpen(false)}>
                        <div className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm min-h-12 text-muted-foreground hover:bg-sidebar-accent">
                          <User className="h-4 w-4 shrink-0" />
                          {t('nav_profile')}
                        </div>
                      </Link>
                    </nav>
                    <div className="p-4 border-t border-sidebar-border space-y-2">
                      <div className="px-3 py-2">
                        <p className="text-xs text-muted-foreground truncate">{homatchUser?.email}</p>
                      </div>
                      <button
                        onClick={() => { setMobileOpen(false); handleSignOut(); }}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-destructive hover:bg-sidebar-accent w-full"
                      >
                        <LogOut className="h-4 w-4 shrink-0" />
                        {t('nav_logout')}
                      </button>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </>
          ) : (
            <>
              <Link to="/auth/login">
                <Button variant="ghost" size="sm" className="text-sm text-muted-foreground hover:text-foreground h-8">
                  {t('auth_signin')}
                </Button>
              </Link>
              <Link to="/auth/signup">
                <Button size="sm" className="h-8 text-sm bg-primary text-primary-foreground hover:bg-primary/90">
                  {t('nav_signup')}
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

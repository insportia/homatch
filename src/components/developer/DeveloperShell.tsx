import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Building2, TrendingUp, Users, Megaphone, FileText,
  BarChart3, Settings, Menu, X, ChevronDown, Check, Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { rememberPendingPath } from '@/services/returnTo';
import type { DevCapability } from '@/services/developer/types';
import { LoadingRows, EmptyState } from './primitives';
import { NotificationBell } from './NotificationBell';

/**
 * THE WORKSPACE SHELL.
 *
 * EIGHT DESTINATIONS, NOT TWENTY-FIVE (§9).
 *
 * The admin area next door has twenty-six top-level items, and it is a tool
 * for four people who use it every day. This is for a sales floor: a manager
 * opening it between two phone calls has to find the buyer they were just
 * talking to without reading a list. Everything else is sub-navigation inside
 * one of these eight, where it has context.
 *
 * NAVIGATION IS FILTERED BY ROLE, NOT DISABLED BY IT. A finance controller
 * has no use for a Marketing tab that greys out when pressed; they have use
 * for a product that appears to be about their job. The server decides the
 * same thing again for every row behind each of these.
 */

interface NavItem {
  path: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Hidden entirely when the role lacks this. */
  capability?: DevCapability;
  /** Match child routes as well as the exact path. */
  prefix?: string;
}

export const DEVELOPER_NAV: NavItem[] = [
  { path: '/developers/home', labelKey: 'dev_nav_home', icon: LayoutDashboard },
  { path: '/developers/projects', labelKey: 'dev_nav_projects', icon: Building2, prefix: '/developers/projects' },
  { path: '/developers/sales', labelKey: 'dev_nav_sales', icon: TrendingUp, prefix: '/developers/sales' },
  { path: '/developers/contacts', labelKey: 'dev_nav_contacts', icon: Users, capability: 'crm', prefix: '/developers/contacts' },
  { path: '/developers/marketing', labelKey: 'dev_nav_marketing', icon: Megaphone, capability: 'marketing', prefix: '/developers/marketing' },
  { path: '/developers/documents', labelKey: 'dev_nav_documents', icon: FileText, capability: 'documents', prefix: '/developers/documents' },
  { path: '/developers/insights', labelKey: 'dev_nav_insights', icon: BarChart3, prefix: '/developers/insights' },
  { path: '/developers/settings', labelKey: 'dev_nav_settings', icon: Settings, prefix: '/developers/settings' },
];

function WorkspaceSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { workspace, memberships, selectWorkspace, role } = useDeveloperWorkspace();

  if (!workspace) return null;

  const roleLabel = t(`dev_role_${role?.toLowerCase() ?? 'viewer'}`);

  // One workspace is the common case and a menu that only ever shows the
  // thing you are already looking at is noise.
  if (memberships.length <= 1) {
    return (
      <div className="min-w-0 px-1">
        <p className="truncate text-sm font-semibold tracking-tight">{workspace.name}</p>
        <p className="truncate text-2xs text-muted-foreground">{roleLabel}</p>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold tracking-tight">{workspace.name}</span>
            <span className="block truncate text-2xs text-muted-foreground">{roleLabel}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-2xs uppercase tracking-wider text-muted-foreground">
          {t('dev_switch_workspace')}
        </DropdownMenuLabel>
        {memberships.map((m) => (
          <DropdownMenuItem
            key={m.workspace.id}
            onSelect={() => { selectWorkspace(m.workspace.id); onNavigate?.(); }}
            className="gap-2"
          >
            <Check className={cn(
              'h-4 w-4 shrink-0',
              m.workspace.id === workspace.id ? 'text-gold-ink' : 'opacity-0',
            )} />
            <span className="min-w-0 flex-1 truncate">{m.workspace.name}</span>
            <span className="shrink-0 text-2xs text-muted-foreground">
              {t(`dev_role_${m.role.toLowerCase()}`)}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => { navigate('/developers/start'); onNavigate?.(); }}>
          <Plus className="mr-2 h-4 w-4" />
          {t('dev_add_workspace')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useLanguage();
  const location = useLocation();
  const { can } = useDeveloperWorkspace();

  const visible = DEVELOPER_NAV.filter((item) => !item.capability || can(item.capability));

  return (
    <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label={t('dev_nav_label')}>
      <ul className="space-y-0.5">
        {visible.map((item) => {
          const active = item.prefix
            ? location.pathname === item.path || location.pathname.startsWith(`${item.prefix}/`)
            : location.pathname === item.path;
          const Icon = item.icon;
          return (
            <li key={item.path}>
              <Link
                to={item.path}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-muted font-semibold text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                {/* The selected state is a gold rule, not a gold panel. */}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-gold"
                  />
                )}
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{t(item.labelKey)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="flex h-full flex-col bg-card">
      <div className="shrink-0 border-b border-border px-3 py-3.5">
        {/* nowrap on both halves, and the badge truncates rather than wrapping.
            The document sets `overflow-wrap: break-word` globally so long
            Georgian compounds cannot overflow — which, without this, breaks
            the wordmark itself. The first end-to-end run rendered "HOMATC / H"
            stacked over two lines. */}
        <Link
          to="/developers/home"
          onClick={onNavigate}
          className="mb-3 flex items-baseline gap-1.5 px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="shrink-0 whitespace-nowrap text-sm font-bold tracking-tight">HOMATCH</span>
          <span className="min-w-0 truncate whitespace-nowrap rounded border border-gold-border/70 px-1.5 py-px text-2xs font-semibold uppercase tracking-wider text-gold-ink">
            {t('dev_badge')}
          </span>
        </Link>
        <WorkspaceSwitcher onNavigate={onNavigate} />
      </div>
      <NavList onNavigate={onNavigate} />
      <div className="shrink-0 border-t border-border px-4 py-3">
        <Link
          to="/dashboard"
          onClick={onNavigate}
          className="text-2xs text-muted-foreground underline-offset-4 hover:underline"
        >
          {t('dev_back_to_homatch')}
        </Link>
      </div>
    </div>
  );
}

export interface DeveloperShellProps {
  children: React.ReactNode;
  /** Page title, rendered as the h1 of the main region. */
  title: string;
  description?: string;
  /**
   * Set when the page draws its own headline — the project workspace opens on
   * a header carrying the development's name, and a second h1 above it would
   * say the same thing twice and leave the page with two of them. The title
   * is still required: the mobile bar and the document use it.
   */
  ownHeading?: boolean;
  actions?: React.ReactNode;
  /** Sub-navigation for the current section. */
  tabs?: React.ReactNode;
  /** Required capability; a role without it gets an explanation, not a blank page. */
  requires?: DevCapability;
}

export function DeveloperShell({
  children, title, description, actions, tabs, requires, ownHeading = false,
}: DeveloperShellProps) {
  useSurfaceTheme('light');
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { homatchUser, loading: authLoading } = useAuth();
  const { loading, workspace, can, needsOnboarding } = useDeveloperWorkspace();
  const shellLocation = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && !homatchUser) {
      // Where they were, not where we guess: a link to a contract should come
      // back to that contract. Remembered in sessionStorage because that is
      // what LoginPage reads and what survives the Google round trip.
      rememberPendingPath(`${shellLocation.pathname}${shellLocation.search}`);
      navigate('/auth/login', { replace: true });
    }
  }, [authLoading, homatchUser, navigate, shellLocation]);

  useEffect(() => {
    if (needsOnboarding) navigate('/developers/start', { replace: true });
  }, [needsOnboarding, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <LoadingRows rows={8} className="mx-auto max-w-4xl pt-24" />
      </div>
    );
  }

  if (!workspace) {
    // The redirect above handles the real case; this is the frame that shows
    // for the one render before it fires, rather than a flash of empty chrome.
    return (
      <div className="min-h-screen bg-background">
        <LoadingRows rows={4} className="mx-auto max-w-4xl pt-24" />
      </div>
    );
  }

  const allowed = !requires || can(requires);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex">
        {/* Desktop rail */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-border lg:block">
          <SidebarContent />
        </aside>

        <div className="min-w-0 flex-1">
          {/* Mobile bar */}
          <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-2 backdrop-blur lg:hidden">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('dev_open_menu')}>
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0">
                <div className="flex items-center justify-end p-2">
                  <Button
                    variant="ghost" size="icon"
                    onClick={() => setMobileOpen(false)}
                    aria-label={t('dev_close_menu')}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <SidebarContent onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
            <NotificationBell />
          </div>

          <main className="mx-auto w-full max-w-[1400px] px-3 pb-20 pt-4 sm:px-5 lg:px-8 lg:pt-8">
            <header className={ownHeading ? 'mb-4' : 'mb-5'}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  {ownHeading ? (
                    <span className="sr-only">{title}</span>
                  ) : (
                    <>
                      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
                      {description && (
                        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
                      )}
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {actions}
                  {/* Desktop only: the mobile bar above already carries one. */}
                  <span className="hidden lg:inline-flex"><NotificationBell /></span>
                </div>
              </div>
              {tabs && <div className="mt-4">{tabs}</div>}
            </header>

            {allowed ? children : (
              <EmptyState
                title={t('dev_no_permission_title')}
                description={t('dev_no_permission_body')}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

/** Sub-navigation inside one section. Scrolls sideways on a phone rather than wrapping. */
export function SubNav({
  items,
}: { items: Array<{ path: string; labelKey: string; hidden?: boolean }> }) {
  const { t } = useLanguage();
  const location = useLocation();
  const visible = items.filter((i) => !i.hidden);
  if (visible.length <= 1) return null;

  return (
    <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      <nav className="flex min-w-max items-center gap-1 border-b border-border">
        {visible.map((item) => {
          const active = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative whitespace-nowrap px-3 py-2 text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'font-semibold text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(item.labelKey)}
              {active && (
                <span aria-hidden="true" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gold" />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

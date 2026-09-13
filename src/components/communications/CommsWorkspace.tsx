// The Communications workspace shell.
//
// WHY A SHELL AND NOT NINE MORE HEADER LINKS
//
// Communications is nine screens that belong together — a call centre, a
// WhatsApp product, agents, contacts, campaigns, an inbox, analytics and
// billing. Hanging all nine off the global header would drown the six other
// Homatch products it sits beside, and hanging only one there (as it was)
// left the other eight reachable only by knowing a URL.
//
// So the global header keeps exactly one entry, and entering it opens a
// workspace with its own navigation. That is the same shape every serious
// multi-screen product uses, and it is what makes the difference between "a
// page exists at this route" and "this is one product".
//
// WHAT THIS FIXES ABOUT THE OLD SCREENS
//
// They were `max-w-6xl` centred columns. On a 1920px monitor that is a narrow
// strip of content with a third of the screen empty on either side — a
// marketing page's proportions on an operations tool. The workspace is a
// two-column layout that actually uses the width, and the rail costs nothing
// because it replaces the "where am I / where else can I go" question the old
// pages answered with nothing at all.

import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, PhoneCall, MessageCircle, Bot, Users, Megaphone,
  Inbox as InboxIcon, BarChart3, Wallet, Menu, X,
} from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

/**
 * The workspace's own navigation.
 *
 * Ordered by how a day actually goes rather than alphabetically: where am I
 * (Overview), the two things that talk to people (Calls, WhatsApp), the three
 * things they need (Agents, Contacts, Campaigns), then what came back (Inbox,
 * Analytics, Billing).
 *
 * `match` exists because a NavLink on /outreach would otherwise light up for
 * every child route beneath it.
 */
const NAV: Array<{
  to: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  /** Extra paths that should also light this entry. */
  also?: string[];
}> = [
  { to: '/outreach',            labelKey: 'comms_nav_overview',  icon: LayoutDashboard, exact: true },
  { to: '/outreach/calls',      labelKey: 'comms_nav_calls',     icon: PhoneCall },
  { to: '/outreach/whatsapp',   labelKey: 'comms_nav_whatsapp',  icon: MessageCircle },
  { to: '/outreach/agents',     labelKey: 'comms_nav_agents',    icon: Bot },
  { to: '/outreach/contacts',   labelKey: 'comms_nav_contacts',  icon: Users },
  { to: '/outreach/campaigns',  labelKey: 'comms_nav_campaigns', icon: Megaphone },
  { to: '/outreach/whatsapp/inbox', labelKey: 'comms_nav_inbox', icon: InboxIcon },
  { to: '/outreach/analytics',  labelKey: 'comms_nav_analytics', icon: BarChart3 },
  { to: '/outreach/billing',    labelKey: 'comms_nav_billing',   icon: Wallet },
];

function isActive(pathname: string, item: (typeof NAV)[number]): boolean {
  if (item.exact) return pathname === item.to;
  // The inbox lives under /outreach/whatsapp, so WhatsApp must not claim it.
  if (item.to === '/outreach/whatsapp') {
    return pathname === '/outreach/whatsapp'
      || (pathname.startsWith('/outreach/whatsapp/') && !pathname.startsWith('/outreach/whatsapp/inbox'));
  }
  return pathname === item.to || pathname.startsWith(item.to + '/');
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useLanguage();
  const { pathname } = useLocation();
  return (
    <>
      {NAV.map((item) => {
        const active = isActive(pathname, item);
        return (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
              // Motion is a fade of colour only. A dashboard rail that slides
              // or scales on every hover is noise on a screen people keep open.
              active
                ? 'bg-foreground/[0.06] font-medium text-foreground'
                : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
            )}
          >
            <item.icon className={cn('h-4 w-4 shrink-0', active ? 'text-gold-ink' : 'opacity-70')} aria-hidden="true" />
            {/* No truncate. A Georgian label is longer than its English
                source and wrapping it is correct; cutting it is not. */}
            <span className="min-w-0 leading-snug">{t(item.labelKey as TKey)}</span>
          </NavLink>
        );
      })}
    </>
  );
}

export interface CommsWorkspaceProps {
  children: React.ReactNode;
  /** Rendered above the content, full width of the content column. */
  header?: React.ReactNode;
  /**
   * A screen that manages its own scrolling and height — the Inbox. It gets
   * the rail and nothing else: no page padding, no max width.
   */
  bleed?: boolean;
}

export function CommsWorkspace({ children, header, bleed = false }: CommsWorkspaceProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <RouteGuard>
      <AppLayout noPadding>
        <div className="mx-auto flex w-full max-w-[1680px] gap-0 px-3 py-4 sm:px-4 md:gap-6 md:px-6 md:py-6">
          {/* ── The rail, from md up ─────────────────────────────────────── */}
          <aside className="hidden w-52 shrink-0 md:block lg:w-56">
            <div className="sticky top-20">
              <p className="px-3 pb-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {t('comms_workspace')}
              </p>
              <nav className="flex flex-col gap-0.5" aria-label={t('comms_workspace')}>
                <NavItems />
              </nav>
            </div>
          </aside>

          <div className="min-w-0 flex-1">
            {/* ── Mobile: one button, one drawer ───────────────────────── */}
            <div className="mb-3 flex items-center gap-2 md:hidden">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-label={t('comms_workspace')}
              >
                {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                <span className="text-xs font-medium">{t('comms_workspace')}</span>
              </Button>
              <Badge variant="outline" className="text-[13px] font-normal text-muted-foreground">
                {t(NAV.find((n) => isActive(location.pathname, n))?.labelKey as TKey ?? 'comms_nav_overview')}
              </Badge>
            </div>
            {open ? (
              <nav className="mb-4 grid grid-cols-2 gap-1 rounded-xl border bg-card p-2 md:hidden" aria-label={t('comms_workspace')}>
                <NavItems onNavigate={() => setOpen(false)} />
              </nav>
            ) : null}

            {header}
            <div className={cn(bleed ? '' : 'mt-4 space-y-4 md:space-y-5')}>{children}</div>
          </div>
        </div>
      </AppLayout>
    </RouteGuard>
  );
}

/**
 * A section heading inside the workspace.
 *
 * Exists so every dashboard block is introduced the same way and the eye can
 * find the next one. `action` is the block's own escape hatch — "see all",
 * "manage" — kept at the heading rather than buried at the bottom of a list
 * where it is only found by people who already know it is there.
 */
export function Section({
  titleKey, sub, action, children, className,
}: {
  titleKey: string;
  sub?: string | null;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
  className?: string;
}) {
  const { t } = useLanguage();
  return (
    <section className={cn('min-w-0', className)}>
      <div className="mb-2.5 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-snug">{t(titleKey as TKey)}</h2>
          {sub ? <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{sub}</p> : null}
        </div>
        {action ? (
          <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={action.onClick}>
            {action.label}
          </Button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

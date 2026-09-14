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
  Inbox as InboxIcon, BarChart3, Wallet, Menu, X, Hash, Mail, FileText, ListChecks,
} from 'lucide-react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

type TKey = Parameters<ReturnType<typeof useLanguage>['t']>[0];

/**
 * ONE RAIL PER PRODUCT, NOT ONE RAIL PER CATEGORY.
 *
 * This used to be a single ten-item list shown identically on every screen
 * underneath /outreach. Three products share that prefix and they do not
 * share a workflow, so the rail was wrong nearly everywhere it appeared:
 *
 *   In the AI Call Center it offered WhatsApp, WhatsApp templates and the
 *   WhatsApp inbox. Nothing about a call involves any of them.
 *
 *   In WhatsApp it offered Calls, AI agents and Billing, and spent 208px of
 *   the left edge doing it -- on a messaging screen, where that column is
 *   where the conversation list belongs.
 *
 *   Email did not use this shell at all, so the one product that shares most
 *   of its vocabulary with the other two looked like a different application.
 *
 * "Belongs to the same category" is not a reason to show somebody the same
 * menu. What a rail is for is the next thing you need WHILE DOING THIS JOB,
 * so each product now names its own, and a surface appears in a product's
 * rail only where it genuinely serves that product's work. Contacts is in all
 * three because every channel reaches a person; Templates is only in
 * WhatsApp, because that is the only channel whose provider requires one.
 *
 * `exact` exists because a NavLink on /outreach would otherwise light up for
 * every child route beneath it.
 */
export type CommsProduct = 'hub' | 'calls' | 'whatsapp' | 'email' | 'contacts';

interface NavEntry {
  to: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}

/** The heading above each rail: the product you are in, not the category. */
const PRODUCT_TITLE: Record<CommsProduct, string> = {
  hub: 'comms_workspace',
  calls: 'comms_nav_calls',
  whatsapp: 'comms_nav_whatsapp',
  email: 'dnav_email',
  contacts: 'comms_nav_contacts',
};

const PRODUCT_NAV: Record<CommsProduct, NavEntry[]> = {
  /* The hub is the one place that IS about all the channels at once, so it
     keeps the cross-channel view. It is not in the global navigation; it is
     reached deliberately. */
  hub: [
    { to: '/outreach', labelKey: 'comms_nav_overview', icon: LayoutDashboard, exact: true },
    { to: '/outreach/calls', labelKey: 'comms_nav_calls', icon: PhoneCall },
    { to: '/outreach/whatsapp', labelKey: 'comms_nav_whatsapp', icon: MessageCircle },
    { to: '/outreach/email', labelKey: 'dnav_email', icon: Mail },
    { to: '/outreach/analytics', labelKey: 'comms_nav_analytics', icon: BarChart3 },
    { to: '/outreach/billing', labelKey: 'comms_nav_billing', icon: Wallet },
  ],
  /* Telephony. What a call operator needs: the calls, the campaigns that
     place them, the agent that speaks, the number it speaks from, and who is
     being called. No WhatsApp anywhere. */
  calls: [
    { to: '/outreach/calls', labelKey: 'comms_nav_overview', icon: PhoneCall, exact: true },
    { to: '/outreach/campaigns', labelKey: 'comms_nav_campaigns', icon: Megaphone },
    { to: '/outreach/agents', labelKey: 'comms_nav_agents', icon: Bot },
    { to: '/outreach/numbers', labelKey: 'comm_numbers_title', icon: Hash },
    { to: '/outreach/contacts', labelKey: 'comms_nav_contacts', icon: Users },
  ],
  /* Messaging. The conversation list is the product, so the rail is short on
     purpose -- and on the conversations screen itself it is not rendered at
     all, because that column is the inbox. */
  whatsapp: [
    { to: '/outreach/whatsapp', labelKey: 'comms_nav_overview', icon: MessageCircle, exact: true },
    { to: '/outreach/whatsapp/inbox', labelKey: 'comms_nav_inbox', icon: InboxIcon },
    { to: '/outreach/whatsapp/templates', labelKey: 'comm_templates_title', icon: FileText },
    { to: '/outreach/numbers', labelKey: 'comm_numbers_title', icon: Hash },
    { to: '/outreach/contacts', labelKey: 'comms_nav_contacts', icon: Users },
  ],
  /* Email. Campaigns, what came back, and who it goes to. */
  email: [
    { to: '/outreach/email', labelKey: 'comms_nav_overview', icon: Mail, exact: true },
    { to: '/outreach/contact-lists', labelKey: 'comm_contact_lists', icon: ListChecks },
    { to: '/outreach/contacts', labelKey: 'comms_nav_contacts', icon: Users },
    { to: '/outreach/analytics', labelKey: 'comms_nav_analytics', icon: BarChart3 },
  ],
  /* The audience surfaces are shared by all three channels and belong to
     none, so they carry the neutral rail rather than pretending to be part
     of whichever product you arrived from. */
  contacts: [
    { to: '/outreach/contacts', labelKey: 'comms_nav_contacts', icon: Users, exact: true },
    { to: '/outreach/contact-lists', labelKey: 'comm_contact_lists', icon: ListChecks },
    { to: '/outreach/calls', labelKey: 'comms_nav_calls', icon: PhoneCall },
    { to: '/outreach/whatsapp', labelKey: 'comms_nav_whatsapp', icon: MessageCircle },
    { to: '/outreach/email', labelKey: 'dnav_email', icon: Mail },
  ],
};

function isActive(pathname: string, item: NavEntry): boolean {
  if (item.exact) return pathname === item.to;
  // The inbox and templates live under /outreach/whatsapp, so the WhatsApp
  // entry must not claim them.
  if (item.to === '/outreach/whatsapp') {
    return pathname === '/outreach/whatsapp'
      || (pathname.startsWith('/outreach/whatsapp/') && !pathname.startsWith('/outreach/whatsapp/inbox')
          && !pathname.startsWith('/outreach/whatsapp/templates'));
  }
  return pathname === item.to || pathname.startsWith(item.to + '/');
}

function NavItems({ product, onNavigate }: { product: CommsProduct; onNavigate?: () => void }) {
  const { t } = useLanguage();
  const { pathname } = useLocation();
  return (
    <>
      {PRODUCT_NAV[product].map((item) => {
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
  /**
   * Which product this screen belongs to. Decides the rail, and the word
   * above it. Defaults to the cross-channel hub, which is the only surface
   * that is genuinely about all of them.
   */
  product?: CommsProduct;
  /** Rendered above the content, full width of the content column. */
  header?: React.ReactNode;
  /**
   * A screen that manages its own scrolling and height — the Inbox. It gets
   * the rail and nothing else: no page padding, no max width.
   */
  bleed?: boolean;
  /**
   * Drop the rail entirely on this screen.
   *
   * For the conversation list, where the left column IS the product. A
   * messaging screen that spends its left edge on a menu has put a menu where
   * the inbox goes, and no amount of styling makes that the right layout. The
   * product is still reachable: the global shell carries all three channels,
   * and the screen's own header carries the rest.
   */
  railless?: boolean;
}

export function CommsWorkspace({
  children, header, product = 'hub', bleed = false, railless = false,
}: CommsWorkspaceProps) {
  const { t } = useLanguage();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const title = t(PRODUCT_TITLE[product] as TKey);
  const current = PRODUCT_NAV[product].find((n) => isActive(pathname, n));

  return (
    <RouteGuard>
      <AppLayout noPadding>
        <div className="mx-auto flex w-full max-w-[1680px] gap-0 px-3 py-4 sm:px-4 md:gap-6 md:px-6 md:py-6">
          {/* ── The rail, from md up ─────────────────────────────────────── */}
          {railless ? null : (
            <aside className="hidden w-52 shrink-0 md:block lg:w-56">
              <div className="sticky top-20">
                <p className="px-3 pb-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {title}
                </p>
                <nav className="flex flex-col gap-0.5" aria-label={title}>
                  <NavItems product={product} />
                </nav>
              </div>
            </aside>
          )}

          <div className="min-w-0 flex-1">
            {/* ── Mobile: one button, one drawer ───────────────────────── */}
            {railless ? null : (
              <>
                <div className="mb-3 flex items-center gap-2 md:hidden">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => setOpen((v) => !v)}
                    aria-expanded={open}
                    aria-label={title}
                  >
                    {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                    <span className="text-xs font-medium">{title}</span>
                  </Button>
                  {current ? (
                    <Badge variant="outline" className="text-[13px] font-normal text-muted-foreground">
                      {t(current.labelKey as TKey)}
                    </Badge>
                  ) : null}
                </div>
                {open ? (
                  <nav className="mb-4 grid grid-cols-2 gap-1 rounded-xl border bg-card p-2 md:hidden" aria-label={title}>
                    <NavItems product={product} onNavigate={() => setOpen(false)} />
                  </nav>
                ) : null}
              </>
            )}

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

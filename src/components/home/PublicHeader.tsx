import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight, Building2, ChevronDown, ChevronRight, Home, Menu, Search, ShieldCheck, X,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { HomatchLogo } from '@/components/common/HomatchLogo';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import { InstallApp } from '@/components/common/InstallApp';
import { PAGE } from '@/components/home/sections/primitives';
import { useFieldProps, useNotEditable, useSectionField } from '@/site/content';
import { ShellScope } from '@/site/render/ShellScope';
import { updateMyProfile } from '@/services/api';
import { SUPPORTED_LANGUAGES } from '@/types/types';
import type { TranslationKey } from '@/i18n/translations';

/**
 * THE PUBLIC HEADER.
 *
 * One header for every public page — home, About, Pricing, Partners,
 * Developers, the legal pages, the Expat guide, the two product entry pages,
 * and (through AppLayout) the public tools a signed-out visitor can use.
 *
 * WHAT CHANGED, AND WHY
 *
 * The header used to be transparent over a black hero and flip to white on
 * scroll. The home page is white now, so there is one tone, and the whole
 * `onDark` machinery — which threaded a colour decision through every
 * control — is gone. `solid` is still accepted so no page has to change, and
 * means what it always meant: the header is opaque from the top.
 *
 * At 1440px the desktop row used to render eight links, an install chip,
 * a language control and two account buttons in one line, and in Georgian
 * the labels ran into each other. The navigation is now three links and three
 * groups (src/site/publicNav.ts), and the full row appears only from 1280px,
 * where it fits in every language. Below that the menu button opens a sheet.
 *
 * THE MOBILE MENU IS A DIALOG
 *
 * It was a panel that pushed down under the bar. It is now a modal sheet:
 * role="dialog" with aria-modal, labelled, focus moved into it on open,
 * trapped while open, returned to the menu button on close; Escape, the
 * scrim and the close button all dismiss it; the page behind does not
 * scroll; the safe-area insets are respected. It is portalled out of the
 * header because the header's backdrop blur makes it the containing block
 * for anything `position: fixed` inside it, which is how a full-screen sheet
 * ends up the height of a 64px bar.
 */
export interface HeaderLink {
  key: string;
  label: string;
  /** In-page region id, or a router path when it starts with '/'. Public. */
  target: string;
  /** Where a signed-in visitor goes instead. See src/site/publicNav.ts. */
  signedInTarget?: string;
  /** One line under the label inside a group. */
  description?: string;
  /** A group. Not itself a destination. */
  children?: HeaderLink[];
}

/**
 * THE NAVIGATION LABELS AN ADMIN MAY REWRITE.
 *
 * Keyed by link key; the value is the translation key the label falls back
 * to. The Site Studio field for a link is `nav_<key>`, and the `site_header`
 * block in src/site/registry.ts declares exactly these — the test beside that
 * file checks that the two agree. (The previous version read the field under
 * the TRANSLATION key, so an admin's rewrite of "Find a property" was stored
 * under nav_find_property and read back under dnav_find_property: saved, and
 * never shown.)
 */
const NAV_FIELDS: Readonly<Record<string, TranslationKey>> = {
  find_property: 'dnav_find_property',
  find_client: 'pub_nav_find_client',
  verify: 'nav_verify',
  services: 'pub_nav_services',
  intelligence: 'pub_nav_how',
  mortgage: 'nav_mortgage',
  investment: 'nav_investment',
  expat: 'nav_for_expats',
  professional: 'nav_professional',
  brokers: 'pub_nav_brokers',
  developers: 'mp_nav_developers',
  partners: 'home_nav_partners',
  company: 'nav_company',
  about: 'nav_about',
  pricing: 'nav_pricing',
};

/** The icons of the three primary rows in the mobile menu. */
const PRIMARY_ICON: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  find_property: Search,
  find_client: Home,
  verify: ShieldCheck,
};

/** The header, wrapped in whatever the site has stored for its chrome. */
export function PublicHeader(props: {
  links: HeaderLink[];
  /** Accepted for compatibility; the header is always opaque now. */
  solid?: boolean;
  /**
   * `sticky` inside AppLayout, whose pages lay themselves out below the bar;
   * `fixed` (the default) on the public pages, which add a HeaderSpacer.
   */
  position?: 'fixed' | 'sticky';
}) {
  return <ShellScope part="site_header"><HeaderBody {...props} /></ShellScope>;
}

/* ------------------------------------------------------------------ *
 * Desktop: a group that opens onto its destinations                   *
 * ------------------------------------------------------------------ */

/**
 * A disclosure, not an ARIA menu. A menu promises arrow-key roving and
 * type-ahead; this is a short list of links, and links are what assistive
 * technology should announce. It closes on Escape (focus returns to the
 * button), on a click outside, and on choosing something.
 */
function NavGroup({
  sections, label, labelMark, go, align = 'start',
}: {
  /** One or more headed lists. "More" holds two: professional and company. */
  sections: { key: string; label: string; links: HeaderLink[] }[];
  label: string;
  labelMark: object;
  go: (link: HeaderLink) => void;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const doc = wrap.current?.ownerDocument ?? document;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); button.current?.focus(); }
    };
    const onFocus = (e: FocusEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    doc.addEventListener('mousedown', onDown);
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('focusin', onFocus);
    return () => {
      doc.removeEventListener('mousedown', onDown);
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('focusin', onFocus);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(v => !v)}
        className={`inline-flex h-10 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 text-[15px] font-medium transition-colors hm-pub-focus ${
          open ? 'bg-secondary text-foreground' : 'text-ink-soft hover:bg-secondary hover:text-foreground'
        }`}
      >
        <span {...labelMark}>{label}</span>
        <ChevronDown
          className={`h-4 w-4 opacity-70 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div
          id={panelId}
          className={`absolute top-full z-50 mt-2 w-[21rem] rounded-2xl border border-border bg-card p-2 shadow-[var(--pub-shadow-lg)] ${
            align === 'end' ? 'end-0' : 'start-0'
          }`}
        >
          {sections.map((section, i) => (
            <div key={section.key} className={i > 0 ? 'mt-1 border-t border-border pt-1' : ''}>
              <p className="hm-pub-label px-3 pb-1 pt-2">{section.label}</p>
              <ul>
                {section.links.map(child => (
                  <li key={child.key}>
                    <button
                      type="button"
                      onClick={() => { setOpen(false); go(child); }}
                      className="group flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-start transition-colors hover:bg-secondary hm-pub-focus"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold text-foreground">{child.label}</span>
                        {child.description && (
                          <span className="mt-0.5 block text-[13.5px] leading-snug text-muted-foreground">{child.description}</span>
                        )}
                      </span>
                      <ArrowRight className="hm-pub-arrow mt-1 text-muted-foreground group-hover:text-gold-ink" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Mobile: the language, chosen in place                               *
 * ------------------------------------------------------------------ */

/**
 * The six languages as buttons rather than a dropdown.
 *
 * A dropdown inside a modal sheet is a second layer of overlay with its own
 * focus rules, portalled outside the trap; six buttons are one tap and are
 * all visible at once, which is the point of a language control somebody
 * opened a menu to find.
 */
function LanguageGrid() {
  const { lang, setLang, t } = useLanguage();
  const { homatchUser } = useAuth();
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-semibold text-muted-foreground">{t('nav_language')}</legend>
      <div className="grid grid-cols-3 gap-2">
        {SUPPORTED_LANGUAGES.map(l => {
          const active = l.code === lang;
          return (
            <button
              key={l.code}
              type="button"
              lang={l.code}
              aria-pressed={active}
              onClick={() => {
                setLang(l.code);
                if (homatchUser?.id && homatchUser.preferred_language !== l.code) {
                  void updateMyProfile(homatchUser.id, { preferred_language: l.code });
                }
              }}
              className={`min-h-[2.75rem] rounded-xl border px-2 text-[14px] font-medium transition-colors hm-pub-focus ${
                active
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-card text-foreground hover:border-foreground/40'
              }`}
            >
              {l.nativeLabel}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/* ------------------------------------------------------------------ *
 * The bar                                                             *
 * ------------------------------------------------------------------ */

function HeaderBody({
  links, position = 'fixed',
}: { links: HeaderLink[]; solid?: boolean; position?: 'fixed' | 'sticky' }) {
  const { status } = useAuth();
  /*
   * While the answer is UNKNOWN this header shows neither the account button
   * nor Login/Register. `session` alone cannot tell "nobody is signed in"
   * from "we have not looked yet", and offering Register to somebody with an
   * account is the worse of the two mistakes. A visitor with no persisted
   * token resolves to UNAUTHENTICATED on the first frame, so a real guest
   * still sees the real buttons immediately.
   */
  const authResolved = status !== 'UNKNOWN';
  const signedIn = status === 'AUTHENTICATED';
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* Leaving the page closes the menu, whichever way it was left. */
  useEffect(() => { setOpen(false); }, [location.pathname]);

  const sf = useSectionField();
  const fp = useFieldProps();
  const notEditable = useNotEditable();
  /*
   * A label the admin has rewritten, else the reviewed copy for that key,
   * else whatever the page passed.
   */
  const labelFor = (link: HeaderLink) => {
    const fallback = NAV_FIELDS[link.key];
    return fallback ? sf(`nav_${link.key}`, fallback) : link.label;
  };
  const markFor = (link: HeaderLink) => (NAV_FIELDS[link.key] ? fp(`nav_${link.key}`) : {});

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => toggle.current?.focus());
  }, []);

  const goTo = (target: string) => {
    setOpen(false);
    if (target.startsWith('/')) {
      const [path, hash] = target.split('#');
      navigate(target);
      if (hash && (path === '' || path === '/' || path === location.pathname)) {
        window.setTimeout(() => {
          document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 60);
      }
      return;
    }
    document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const go = (link: HeaderLink) => goTo(signedIn && link.signedInTarget ? link.signedInTarget : link.target);
  const hrefFor = (link: HeaderLink) => {
    const target = signedIn && link.signedInTarget ? link.signedInTarget : link.target;
    return target.startsWith('/') ? target : `/#${target}`;
  };

  const primary = links.filter(l => !l.children?.length);
  const groups = links.filter(l => l.children?.length);

  const isFixed = position === 'fixed';

  return (
    <header
      ref={headerRef}
      className={`hm-public ${isFixed ? 'fixed inset-x-0 top-0' : 'sticky top-0'} z-50 border-b transition-[border-color,box-shadow,background-color] duration-200 motion-reduce:transition-none ${
        scrolled || !isFixed
          ? 'border-border bg-background/95 shadow-[0_1px_0_hsl(var(--border)),0_8px_24px_-20px_hsl(224_30%_10%/0.35)] backdrop-blur-md'
          : 'border-transparent bg-background'
      }`}
    >
      <div className={`${PAGE} flex h-16 items-center gap-3 xl:h-[4.5rem] xl:gap-6`}>
        <Link
          to="/"
          onClick={() => { setOpen(false); if (location.pathname === '/') window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          className="min-w-0 shrink rounded-lg hm-pub-focus"
          aria-label={t('home_nav_home_aria')}
        >
          <HomatchLogo size="md" withTagline={false} tone="dark" />
        </Link>

        <nav aria-label={t('pub_nav_aria')} className="mx-auto hidden items-center gap-0.5 xl:flex">
          {primary.map(link => (
            <Link
              key={link.key}
              to={hrefFor(link)}
              onClick={(e) => { e.preventDefault(); go(link); }}
              aria-current={location.pathname === hrefFor(link) ? 'page' : undefined}
              className="inline-flex h-10 items-center whitespace-nowrap rounded-lg px-2.5 text-[15px] font-medium text-ink-soft transition-colors hover:bg-secondary hover:text-foreground aria-[current=page]:text-foreground hm-pub-focus"
            >
              <span {...markFor(link)}>{labelFor(link)}</span>
            </Link>
          ))}
          {/*
            * Services opens on its own; the professional and company groups
            * share one "More" control on a desktop row. Six languages
            * disagree about how long a word is, and in Georgian and Russian
            * six controls did not fit beside the account buttons at 1440px.
            * The mobile sheet has the room, and lists each group under its
            * own heading.
            */}
          {groups.filter(g => g.key === 'services').map(group => (
            <NavGroup
              key={group.key}
              sections={[{ key: group.key, label: labelFor(group), links: (group.children ?? []).map(c => ({ ...c, label: labelFor(c) })) }]}
              label={labelFor(group)}
              labelMark={markFor(group)}
              go={go}
            />
          ))}
          {groups.some(g => g.key !== 'services') && (
            <NavGroup
              sections={groups.filter(g => g.key !== 'services').map(group => ({
                key: group.key,
                label: labelFor(group),
                links: (group.children ?? []).map(c => ({ ...c, label: labelFor(c) })),
              }))}
              label={sf('nav_more', 'pub_nav_more')}
              labelMark={fp('nav_more')}
              go={go}
              align="end"
            />
          )}
        </nav>

        <div className="ms-auto flex items-center gap-2 xl:ms-0">
          {/*
            * Neither of these is copy. Install names what the BROWSER is
            * offering, and the language control shows the locale the reader
            * is in. An admin rewriting either would be writing over a fact.
            */}
          <div className="flex shrink-0 items-center gap-1" {...notEditable('SYSTEM_GENERATED')}>
            <LanguageSwitcher showGlobe compact triggerClassName="h-10 min-w-[2.75rem] shrink-0 whitespace-nowrap px-2.5 text-[13px] text-ink-soft" />
          </div>

          {signedIn ? (
            <Link
              to="/dashboard"
              className="hm-pub-btn hm-pub-btn--primary hidden whitespace-nowrap !min-h-[2.5rem] !py-2 sm:inline-flex"
            >
              <span {...fp('cta_dashboard')}>{sf('cta_dashboard', 'nav_dashboard')}</span>
            </Link>
          ) : !authResolved ? (
            /* Not yet known. A same-sized placeholder holds the row open so
               nothing shifts when the answer lands. */
            <div className="hidden h-10 w-[9rem] shrink-0 sm:block" aria-hidden="true" />
          ) : (
            <>
              <Link
                to="/auth/login"
                className="hidden h-10 items-center whitespace-nowrap rounded-lg px-3 text-[15px] font-medium text-foreground transition-colors hover:bg-secondary xl:inline-flex hm-pub-focus"
              >
                <span {...fp('cta_login')}>{sf('cta_login', 'nav_login')}</span>
              </Link>
              <Link
                to="/auth/signup"
                className="hm-pub-btn hm-pub-btn--primary hidden whitespace-nowrap !min-h-[2.5rem] !py-2 sm:inline-flex"
              >
                <span {...fp('cta_signup')}>{sf('cta_signup', 'nav_signup')}</span>
              </Link>
            </>
          )}

          <button
            ref={toggle}
            type="button"
            data-hm-menu-toggle
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label={t('mp_nav_menu_open')}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-card text-foreground transition-colors hover:border-foreground/40 xl:hidden hm-pub-focus"
          >
            <Menu className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>
      </div>

      {open && (
        <MenuSheet
          host={headerRef.current?.ownerDocument?.body ?? null}
          onClose={close}
          primary={primary}
          groups={groups}
          labelFor={labelFor}
          markFor={markFor}
          hrefFor={hrefFor}
          go={go}
          authResolved={authResolved}
          status={status}
          goTo={goTo}
        />
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ *
 * The sheet                                                           *
 * ------------------------------------------------------------------ */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function MenuSheet({
  host, onClose, primary, groups, labelFor, markFor, hrefFor, go, authResolved, status, goTo,
}: {
  host: HTMLElement | null;
  onClose: (restoreFocus?: boolean) => void;
  primary: HeaderLink[];
  groups: HeaderLink[];
  labelFor: (link: HeaderLink) => string;
  markFor: (link: HeaderLink) => object;
  hrefFor: (link: HeaderLink) => string;
  go: (link: HeaderLink) => void;
  authResolved: boolean;
  status: string;
  goTo: (target: string) => void;
}) {
  const { t } = useLanguage();
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const sf = useSectionField();
  const fp = useFieldProps();
  const notEditable = useNotEditable();

  /* Initial focus, scroll lock, Escape, the focus trap and the breakpoint. */
  useEffect(() => {
    const doc = panel.current?.ownerDocument ?? document;
    const win = doc.defaultView ?? window;
    closeButton.current?.focus();

    const html = doc.documentElement;
    const previous = { body: doc.body.style.overflow, html: html.style.overflow };
    doc.body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose(true);
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const active = doc.activeElement as HTMLElement | null;
      /* Another dialog (the install instructions) may be on top of this
         one; its focus is its own business. */
      if (active && !panel.current.contains(active) && active.closest('[role="dialog"]')) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter(el => el.offsetParent !== null || el === doc.activeElement);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!active || !panel.current.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    /* The sheet is a phone-and-tablet control; at the desktop breakpoint the
       full navigation is back in the bar and the sheet has no reason to be. */
    const wide = win.matchMedia('(min-width: 1280px)');
    const onWide = () => { if (wide.matches) onClose(false); };
    doc.addEventListener('keydown', onKey);
    wide.addEventListener?.('change', onWide);
    return () => {
      doc.body.style.overflow = previous.body;
      html.style.overflow = previous.html;
      doc.removeEventListener('keydown', onKey);
      wide.removeEventListener?.('change', onWide);
    };
  }, [onClose]);

  if (!host) return null;

  const signedIn = status === 'AUTHENTICATED';

  return createPortal(
    <div className="hm-public fixed inset-0 z-[55] xl:hidden" style={{ background: 'transparent' }}>
      <div
        className="hm-pub-scrim absolute inset-0 bg-[hsl(224_30%_8%/0.42)] backdrop-blur-[2px]"
        onClick={() => onClose(true)}
        aria-hidden="true"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="hm-pub-sheet absolute inset-y-0 end-0 flex w-full max-w-[26rem] flex-col bg-background shadow-[var(--pub-shadow-lg)] sm:border-s sm:border-border"
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border px-5">
          <h2 id={titleId} className="text-[15px] font-semibold text-foreground">{t('pub_menu_title')}</h2>
          <button
            ref={closeButton}
            type="button"
            onClick={() => onClose(true)}
            aria-label={t('mp_nav_menu_close')}
            className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-card text-foreground transition-colors hover:border-foreground/40 hm-pub-focus"
          >
            <X className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>

        <nav aria-label={t('pub_nav_aria')} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-4">
          {/* The three things a visitor came to do, as rows big enough to be
              the first thing a thumb finds. */}
          <ul className="space-y-2">
            {primary.map(link => {
              const Glyph = PRIMARY_ICON[link.key] ?? Building2;
              return (
                <li key={link.key}>
                  <Link
                    to={hrefFor(link)}
                    onClick={(e) => { e.preventDefault(); go(link); }}
                    className="group flex min-h-[3.5rem] items-center gap-3.5 rounded-2xl border border-border bg-card px-3.5 py-2.5 text-start transition-colors hover:border-foreground/35 hm-pub-focus"
                  >
                    <span className="hm-pub-icon h-10 w-10" aria-hidden="true">
                      <Glyph className="h-[18px] w-[18px]" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1 text-[16.5px] font-semibold leading-snug text-foreground" {...markFor(link)}>
                      {labelFor(link)}
                    </span>
                    <ChevronRight className="hm-pub-arrow text-muted-foreground" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* A group is a HEADING with its items under it, not a second menu
              to open: there is already a menu open. */}
          {groups.map(group => (
            <section key={group.key} className="mt-6" aria-labelledby={`${titleId}-${group.key}`}>
              <h3
                id={`${titleId}-${group.key}`}
                className="hm-pub-label px-1"
                {...markFor(group)}
              >
                {labelFor(group)}
              </h3>
              <ul className="mt-1.5 divide-y divide-border rounded-2xl border border-border bg-card">
                {group.children?.map(child => (
                  <li key={child.key}>
                    <Link
                      to={hrefFor(child)}
                      onClick={(e) => { e.preventDefault(); go(child); }}
                      className="group flex min-h-[3.25rem] items-center gap-3 px-4 py-2.5 text-start transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-secondary hm-pub-focus"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15.5px] font-medium leading-snug text-foreground" {...markFor(child)}>
                          {labelFor(child)}
                        </span>
                        {child.description && (
                          <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{child.description}</span>
                        )}
                      </span>
                      <ChevronRight className="hm-pub-arrow h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <div className="mt-7 space-y-4" {...notEditable('SYSTEM_GENERATED')}>
            <LanguageGrid />
            <InstallApp variant="block" />
          </div>
        </nav>

        {/* THE ACCOUNT. Pinned to the bottom so it is never scrolled away,
            and exactly one pair of actions for whichever state is true. */}
        {authResolved && (
          <div className="shrink-0 border-t border-border bg-background px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
            {authResolved && status === 'UNAUTHENTICATED' && (
              <div className="grid gap-2.5 min-[30rem]:grid-cols-2">
                <button type="button" className="hm-pub-btn hm-pub-btn--secondary w-full" onClick={() => goTo('/auth/login')}>
                  <span {...fp('cta_login')}>{sf('cta_login', 'nav_login')}</span>
                </button>
                <button type="button" className="hm-pub-btn hm-pub-btn--primary w-full" onClick={() => goTo('/auth/signup')}>
                  <span {...fp('cta_signup')}>{sf('cta_signup', 'nav_signup')}</span>
                </button>
              </div>
            )}
            {signedIn && (
              <div className="grid gap-2.5 min-[30rem]:grid-cols-2">
                <button type="button" className="hm-pub-btn hm-pub-btn--secondary w-full" onClick={() => goTo('/profile')}>
                  {t('nav_profile')}
                </button>
                <button type="button" className="hm-pub-btn hm-pub-btn--primary w-full" onClick={() => goTo('/dashboard')}>
                  <span {...fp('cta_dashboard')}>{sf('cta_dashboard', 'nav_dashboard')}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    host,
  );
}

/**
 * The room the fixed header occupies, given back to the page.
 *
 * The header is `position: fixed`, so every page's first element starts at
 * y=0 underneath it. A page with a fixed header gets a spacer the height of
 * the bar; the bar is 64px, and 72px from the desktop breakpoint.
 */
export function HeaderSpacer() {
  return <div className="h-16 xl:h-[4.5rem]" aria-hidden="true" />;
}

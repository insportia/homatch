import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Menu, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { HomatchLogo } from '@/components/common/HomatchLogo';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import { InstallApp, useInstallState, hasInstallAction } from '@/components/common/InstallApp';
import { PAGE } from '@/components/home/sections/primitives';
import { useFieldProps, useNotEditable, useSectionField } from '@/site/content';
import { ShellScope } from '@/site/render/ShellScope';
import type { TranslationKey } from '@/i18n/translations';

/**
 * REGION 01 — the header.
 *
 * Quiet by design: no border and no background at the top of the page, so the
 * hero reads as one uninterrupted composition; a hairline and a white wash
 * fade in only once the page has scrolled under it.
 *
 * IT SITS ON BLACK UNTIL IT DOESN'T
 *
 * The hero is a black band, so at the top of the page every control here is
 * white-on-transparent. Past the hero the header becomes a white bar and the
 * same controls flip to near-black. One `scrolled` flag drives both, which is
 * why the tone is threaded through rather than set per element.
 *
 * Spacing and type carry
 * the hierarchy — the navigation has no pills, and there is exactly one
 * filled control.
 *
 * Every destination is a route that exists: the reference's six centre links
 * map onto three in-page regions and three real pages.
 */
export interface HeaderLink {
  key: string;
  label: string;
  /** In-page region id, or a router path when it starts with '/'. */
  target: string;
  /**
   * A group. Present only on the two secondary headings, which are not
   * themselves destinations: seven flat links is what made this header
   * crowd, and hierarchy is the fix that smaller text was standing in for.
   */
  children?: HeaderLink[];
}

/**
 * @param solid  Forces the opaque white bar from the top of the page. The
 *               transparent state only works over a full-bleed black hero;
 *               on a page that opens on white it renders the logo and the
 *               navigation white on white, which is how a header disappears.
 */
/**
 * THE NAVIGATION LABELS AN ADMIN MAY REWRITE.
 *
 * Keyed by the link key the pages already use, and valued with the
 * translation key that link already falls back to. A key that is not here --
 * the About page's in-page anchors, say -- simply keeps the label the page
 * passed, which is why adding a link in code needs no edit here to work.
 *
 * Must stay in step with the `site_header` fields in src/site/registry.ts;
 * the test beside that file checks that it does.
 */
const NAV_FIELDS: Readonly<Record<string, TranslationKey>> = {
  start: 'mp_nav_start',
  home: 'mp_nav_start',
  expat: 'nav_for_expats',
  intelligence: 'mp_nav_capabilities',
  verify: 'nav_verify',
  investment: 'nav_investment',
  mortgage: 'nav_mortgage',
  professional: 'nav_professional',
  developers: 'mp_nav_developers',
  partners: 'home_nav_partners',
  company: 'nav_company',
  about: 'nav_about',
  pricing: 'nav_pricing',
};

/** The header, wrapped in whatever the site has stored for its chrome. */
export function PublicHeader(props: { links: HeaderLink[]; solid?: boolean }) {
  return <ShellScope part="site_header"><HeaderBody {...props} /></ShellScope>;
}

/**
 * A secondary heading that opens onto its destinations.
 *
 * Not a mega-menu: two items, no columns, no imagery. It exists so that
 * About, Pricing, For developers and Partners stop competing with the product
 * for the widest row in the header, and it closes on Escape, on outside
 * click and on choosing something — the three ways a person expects to get
 * out of an open menu.
 */
function NavGroup({
  link, onDark, go, label,
}: { link: HeaderLink; onDark: boolean; go: (target: string) => void; label: string }) {
  const [open, setOpen] = React.useState(false);
  const wrap = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(v => !v)}
        className={`relative inline-flex items-center gap-1 whitespace-nowrap [overflow-wrap:normal] text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
          onDark ? 'text-white/75 hover:text-white' : 'text-ink-soft hover:text-foreground'
        }`}
      >
        {label}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full z-50 mt-2 min-w-[11rem] overflow-hidden rounded-xl border border-border bg-background py-1 shadow-lg ltr:start-0 rtl:end-0"
        >
          {link.children?.map(child => (
            <button
              key={child.key}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); go(child.target); }}
              className="block w-full whitespace-nowrap px-4 py-2.5 text-start text-sm text-foreground transition-colors hover:bg-muted"
            >
              {child.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HeaderBody({ links, solid = false }: { links: HeaderLink[]; solid?: boolean }) {
  /* Read BEFORE laying out, so the strip never reserves room for a control
     that is about to render nothing. See useInstallState. */
  const installState = useInstallState();
  const canOfferApp = hasInstallAction(installState);
  const { session, status } = useAuth();
  /*
   * Same rule as AppLayout: while the answer is UNKNOWN this header shows
   * neither the account button nor Login/Register. `session` alone cannot
   * tell "nobody is signed in" from "we have not looked yet", and offering
   * Register to somebody with an account is the worse of the two mistakes.
   * A visitor with no persisted token resolves to UNAUTHENTICATED on the
   * first frame, so a real guest still sees the real buttons immediately.
   */
  const authResolved = status !== 'UNKNOWN';
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // The mobile panel is a full-height overlay; leaving the page scrollable
  // behind it lets a touch drag move the page under the menu.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /*
   * A label the admin has rewritten, else the reviewed copy for that key,
   * else whatever the page passed.
   *
   * `sf` cannot return undefined -- with no override it returns t(key) -- so
   * the third branch exists only for the links this block does not declare.
   */
  const sf = useSectionField();
  const fp = useFieldProps();
  const notEditable = useNotEditable();
  const labelFor = (link: HeaderLink) => {
    const field = NAV_FIELDS[link.key];
    return field ? sf(field, field) : link.label;
  };
  const markFor = (link: HeaderLink) => (NAV_FIELDS[link.key] ? fp(NAV_FIELDS[link.key]) : {});

  const go = (target: string) => {
    setOpen(false);
    if (target.startsWith('/')) {
      navigate(target);
      return;
    }
    document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* Inverted while the header is still over the hero. */
  const onDark = !solid && !scrolled && !open;

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 motion-reduce:transition-none ${
        onDark ? 'border-b border-transparent bg-transparent' : 'border-b border-border bg-background/95 backdrop-blur-md'
      }`}
    >
      <div className={`${PAGE} flex h-[4.5rem] items-center gap-3 sm:gap-6 md:h-[5.5rem]`}>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            navigate('/');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="min-w-0 shrink rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
          aria-label={t('home_nav_home_aria')}
        >
          <HomatchLogo size="md" withTagline={false} tone={onDark ? 'light' : 'dark'} className="sm:hidden" />
          <HomatchLogo size="md" withTagline tone={onDark ? 'light' : 'dark'} className="hidden sm:flex" />
        </button>

        <nav className="mx-auto hidden items-center gap-5 lg:flex xl:gap-7">
          {links.map(link => (link.children && link.children.length > 0 ? (
            <NavGroup key={link.key} link={link} onDark={onDark} go={go} label={labelFor(link)} />
          ) : (
            <button
              key={link.key}
              type="button"
              onClick={() => go(link.target)}
              className={`relative whitespace-nowrap [overflow-wrap:normal] text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                onDark ? 'text-white/75 hover:text-white' : 'text-ink-soft hover:text-foreground'
              }`}
              {...markFor(link)}
            >
              {labelFor(link)}
            </button>
          )))}
        </nav>

        {/*
          * TWO GROUPS, NOT ONE ROW OF LEFTOVERS.
          *
          * Install and language are utilities; sign in and sign up are the
          * account. They used to share one gap, so the eye read five
          * equally weighted controls and the row sprawled. A hairline
          * between the groups costs one pixel and does the work that
          * spacing alone could not.
          */}
        <div className="ms-auto flex items-center gap-2.5 lg:ms-0">
          {/*
            * Neither of these is copy.
            *
            * Install names what the BROWSER is offering — install it, or open
            * the copy already installed, or nothing at all — and the language
            * control shows the locale the reader is currently in. An admin
            * rewriting either would be writing over a fact.
            */}
          <div
            className="hidden items-center gap-1.5 sm:flex"
            {...notEditable('SYSTEM_GENERATED')}
          >
            <InstallApp tone={onDark ? 'dark' : 'auto'} />
            <LanguageSwitcher showGlobe triggerClassName={`h-10 px-2.5 ${onDark ? 'text-white hover:bg-white/10' : ''}`} />
          </div>

          {/*
            * No language control in the phone BAR.
            *
            * It used to sit here as well, which left the bar carrying a
            * wordmark, a language code and a menu button in 320px — the
            * squeeze this header was accused of. The utility strip below
            * owns language now, at a comfortable size, beside Install.
            */}

          <span
            className={`hidden h-6 w-px sm:block ${onDark ? 'bg-white/20' : 'bg-border'}`}
            aria-hidden="true"
          />

          {status === 'AUTHENTICATED' ? (
            <Button
              size="sm"
              className={`h-10 whitespace-nowrap rounded-full px-5 text-[16px] font-semibold ${
                onDark ? 'bg-gold text-[#0D0D0D] hover:bg-white' : ''
              }`}
              onClick={() => navigate('/dashboard')}
            >
              <span {...fp('cta_dashboard')}>{sf('cta_dashboard', 'nav_dashboard')}</span>
            </Button>
          ) : !authResolved ? (
            /* Not yet known. A same-sized placeholder holds the row open so
               nothing shifts when the answer lands, and no call to action is
               offered to somebody who may already have an account. */
            <div className="h-10 w-[7.5rem] shrink-0" aria-hidden="true" />
          ) : (
            <>
              <button
                type="button"
                onClick={() => navigate('/auth/login')}
                className={`hidden whitespace-nowrap text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:inline ${
                  onDark ? 'text-white/75 hover:text-white' : 'text-ink-soft hover:text-foreground'
                }`}
              >
                {t('nav_login')}
              </button>
              <Button
                size="sm"
                className={`hidden h-10 whitespace-nowrap rounded-full px-5 text-[16px] font-semibold sm:inline-flex ${
                  onDark ? 'bg-gold text-[#0D0D0D] hover:bg-white' : ''
                }`}
                onClick={() => navigate('/auth/signup')}
              >
                {t('nav_signup')}
              </Button>
            </>
          )}

          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            aria-label={open ? t('mp_nav_menu_close') : t('mp_nav_menu_open')}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border lg:hidden ${
              onDark ? 'border-white/35 text-white' : 'border-foreground/25 text-foreground'
            }`}
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Scroll-safe: five links plus the utility area is taller than a
          320x568 screen, and the panel must not trap what it cannot show.
          The inset clears the home indicator on a modern phone. */}
      {open && (
        <div
          className="max-h-[calc(100dvh-4.5rem)] overflow-y-auto overscroll-contain border-t border-border bg-background md:max-h-[calc(100dvh-5.5rem)] lg:hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <nav className={`${PAGE} flex flex-col py-3`}>
            {/*
              * A group is a HEADING with its items under it, not a second
              * menu to open. There is already a menu open; making somebody
              * tap twice to reach About is the crowding problem moved
              * rather than solved, and the sheet has room a header does not.
              */}
            {links.map(link => (link.children && link.children.length > 0 ? (
              <div key={link.key} className="mt-2 border-t border-border pt-2">
                <p className="px-1 py-1 text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
                  {labelFor(link)}
                </p>
                {link.children.map(child => (
                  <button
                    key={child.key}
                    type="button"
                    onClick={() => go(child.target)}
                    className="block w-full rounded-xl py-3.5 text-start text-[17px] text-foreground transition-colors hover:text-gold"
                  >
                    {child.label}
                  </button>
                ))}
              </div>
            ) : (
              <button
                key={link.key}
                type="button"
                onClick={() => go(link.target)}
                className="rounded-xl py-3.5 text-start text-[17px] text-foreground transition-colors hover:text-gold"
                {...markFor(link)}
              >
                {labelFor(link)}
              </button>
            )))}
            {authResolved && status === 'UNAUTHENTICATED' && (
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:hidden">
                <Button variant="outline" className="h-11 rounded-full border-border bg-transparent" onClick={() => go('/auth/login')}>
                  {t('nav_login')}
                </Button>
                <Button className="h-11 rounded-full" onClick={() => go('/auth/signup')}>
                  {t('nav_signup')}
                </Button>
              </div>
            )}

            {/*
              * THE UTILITY AREA.
              *
              * Install used to be `hidden sm:block` and appeared nowhere in
              * this menu, so on a phone there was no way to install the app
              * at all — the one place it matters most. It is a filled block
              * here rather than a pill, because it is the only action in
              * this area and should look like one.
              *
              * The language switcher repeats here deliberately. It is in the
              * bar too, but somebody who has opened the menu is looking for
              * settings, and this is where they will look.
              */}
            <div className="mt-4 space-y-3 border-t border-border pt-4" {...notEditable('SYSTEM_GENERATED')}>
              <InstallApp variant="block" />
              <div className="flex items-center justify-between gap-3 rounded-[0.9rem] border border-border px-4 py-2.5">
                <span className="text-[15px] font-medium text-ink-soft">{t('nav_language')}</span>
                <LanguageSwitcher showGlobe triggerClassName="h-9 px-2.5" />
              </div>
            </div>
          </nav>
        </div>
      )}

      {/*
        * THE MOBILE UTILITY STRIP.
        *
        * Language and Install/Open, as ONE component rather than two controls
        * pushed to opposite edges of a bar. It sits under the header on a
        * phone, where the bar itself has room for the logo, the language code
        * and the menu and nothing more.
        *
        * Hidden while the menu is open, because the menu carries its own copy
        * of both and two live install buttons on one screen is a question
        * about which one is real.
        */}
      {!open && (
        <div className={`${PAGE} lg:hidden`}>
          {/*
            * `inline-flex`, not a full-width row.
            *
            * When the app control has nothing to offer -- an unsupported
            * browser, already running as the installed app, or an explicit
            * "don't show me this again" -- it renders nothing, and a
            * full-width strip was left drawing a divider and a wide empty
            * rectangle next to the language chip. That is the blank field.
            * Sized to its contents, the strip is simply a language control
            * when that is all there is.
            */}
          <div
            {...notEditable('SYSTEM_GENERATED')}
            className={`mb-2 inline-flex max-w-full items-center gap-2 rounded-[0.9rem] border p-1.5 ${
              canOfferApp ? 'flex w-full' : ''
            } ${
              onDark
                ? 'border-white/15 bg-white/[0.07] backdrop-blur-sm'
                : 'border-border bg-card/95 backdrop-blur-sm'
            }`}
          >
            <LanguageSwitcher
              showGlobe
              compact
              triggerClassName={`h-10 shrink-0 px-3 ${onDark ? 'text-white hover:bg-white/10' : ''}`}
            />
            {canOfferApp && (
              <>
                <span
                  className={`h-5 w-px shrink-0 ${onDark ? 'bg-white/20' : 'bg-border'}`}
                  aria-hidden="true"
                />
                {/* Takes the rest of the row, so a long Georgian or Russian
                    label has somewhere to go instead of squeezing the code. */}
                <InstallApp tone={onDark ? 'dark' : 'auto'} className="min-w-0 flex-1" />
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

/**
 * The room the fixed header occupies, given back to the page.
 *
 * The header is `position: fixed`, so every page's first element starts at
 * y=0 underneath it — measured at 390px, `<main>` on both the home page and
 * Pricing began at 0 under a 73px bar. The hero gets away with it because it
 * is a full-bleed black band designed to sit behind a transparent header; a
 * white page does not, and its first heading was partly covered.
 *
 * So a page with a solid header gets a spacer the height of the header. Pages
 * with a transparent header over a hero deliberately get none.
 */
export function HeaderSpacer() {
  return <div className="h-[8.5rem] md:h-[9.5rem] lg:h-[5.5rem]" aria-hidden="true" />;
}

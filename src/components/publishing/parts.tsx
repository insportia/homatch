// THE PUBLISHING WORKSPACE'S PRESENTATION PARTS.
//
// Written against the owner surface's gold/navy grammar (OWNER_SURFACE tokens,
// PageHero's near-black band, gold accents) rather than shadcn's neutral one — the
// same reasoning as src/components/customer/surface.tsx. Status is a dot and a word,
// never a capsule the size of a button.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Check, ExternalLink, Minus } from 'lucide-react';
import { JOURNEY, type JourneyStep, type PortalInfo, type PublicationStatus, type StepState, type Tone, toneOf } from '@/publishing/model';

const DOT: Record<Tone, string> = {
  live: 'bg-[hsl(var(--gold))]',
  pending: 'bg-sky-500',
  problem: 'bg-red-500',
  quiet: 'bg-muted-foreground/45',
};
const INK: Record<Tone, string> = {
  live: 'text-[hsl(var(--gold-ink))]',
  pending: 'text-sky-700',
  problem: 'text-red-700',
  quiet: 'text-muted-foreground',
};

/** A publication's state (or "not published" when there is none), as a dot and a word. */
export function PublicationMark({ status, className }: { status: PublicationStatus | null; className?: string }) {
  const { t } = useLanguage();
  const tone = toneOf(status);
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[tone])} />
      <span className={cn('text-2xs font-semibold break-words', INK[tone])}>
        {t(status ? `pubw_status_${status.toLowerCase()}` : 'pubw_status_not_started')}
      </span>
    </span>
  );
}

/** The listing's own state: draft, ready, archived. */
export function ListingMark({ ready, archived }: { ready: boolean; archived: boolean }) {
  const { t } = useLanguage();
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', archived ? 'bg-muted-foreground/40' : ready ? 'bg-emerald-500' : 'bg-amber-500')} />
      <span className="text-2xs font-semibold text-muted-foreground">
        {t(archived ? 'pubw_listing_archived' : ready ? 'pubw_listing_ready' : 'pubw_listing_draft')}
      </span>
    </span>
  );
}

/** A white working panel with an optional quiet heading. */
export function Panel({ title, aside, children, className, id }: {
  title?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string; id?: string;
}) {
  return (
    <section id={id} className={cn('min-w-0 rounded-2xl border border-border bg-[hsl(var(--card))] p-4 shadow-card sm:p-5', className)}>
      {title || aside ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="min-w-0 font-display text-base font-semibold text-foreground break-words">{title}</h2> : <span />}
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** One overview number. A zero is shown as a zero; nothing is estimated. */
export function Kpi({ label, value, tone = 'quiet', onClick, active }: {
  label: string; value: number; tone?: Tone; onClick?: () => void; active?: boolean;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-pressed={onClick ? !!active : undefined}
      className={cn(
        'min-w-0 rounded-xl border bg-[hsl(var(--card))] px-3 py-2.5 text-start transition-colors',
        active ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]' : 'border-border',
        onClick && 'hover:border-[hsl(var(--gold-border))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
      )}
    >
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[tone])} />
        <span className="min-w-0 text-2xs font-medium text-muted-foreground break-words">{label}</span>
      </span>
      <span className="mt-0.5 block font-display text-2xl font-bold tabular-nums text-foreground">{value}</span>
    </Tag>
  );
}

/** A server error code, explained. Unknown codes fall back to a generic sentence, never the raw code alone. */
export function useErrorText() {
  const { t } = useLanguage();
  return (code: string | null | undefined) => {
    if (!code) return '';
    const key = `pubw_err_${code.toLowerCase()}`;
    const text = t(key);
    return text === key ? t('pubw_err_generic', { code }) : text;
  };
}

export function dateTime(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

/* ── Portal identity ─────────────────────────────────────────────────────
 * A portal's logo is the file an admin configured (Admin → Integrations →
 * Property portals). Until then, and whenever that image fails to load, the
 * portal is shown as a monogram in its brand colour — never a broken image and
 * never a logo fetched from a third-party favicon service.
 */
export function PortalLogo({ portal, size = 'md', className }: { portal: Pick<PortalInfo, 'name' | 'logoUrl' | 'color'>; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { setFailed(false); }, [portal.logoUrl]);
  const box = size === 'sm' ? 'h-7 w-7 text-2xs' : size === 'lg' ? 'h-14 w-14 text-base' : 'h-10 w-10 text-xs';
  const letters = portal.name.replace(/\.ge$/i, '').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || portal.name.slice(0, 2);
  return (
    <span aria-hidden="true" className={cn('relative grid shrink-0 place-items-center overflow-hidden rounded-xl border border-black/5 font-display font-bold tracking-tight text-white shadow-sm', box, className)} style={{ backgroundColor: portal.logoUrl && !failed ? '#fff' : portal.color }}>
      {portal.logoUrl && !failed
        ? <img src={portal.logoUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-contain p-1" />
        : letters}
    </span>
  );
}

/* ── Honest portal capabilities ──────────────────────────────────────────
 * What each portal actually offers, stated as facts rather than implied by
 * buttons. None of the eight portals publishes an account-linking (OAuth) flow
 * or a listing-submission API, so there is NO "Connect" button: an owner signs
 * in on the portal's own site. HOMATCH prepares the copy and, where the portal's
 * rules allow it, verifies the public page afterwards. See
 * supabase/functions/publishing-engine/providers.ts.
 */

function Fact({ ok, label, value }: { ok: boolean | null; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span aria-hidden="true" className={cn('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full',
        ok === true ? 'bg-emerald-100 text-emerald-700' : ok === false ? 'bg-[hsl(var(--secondary))] text-muted-foreground' : 'bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]')}>
        {ok === false ? <Minus className="h-3 w-3" /> : <Check className="h-3 w-3" />}
      </span>
      <span className="min-w-0">
        <span className="block text-2xs font-semibold text-foreground">{label}</span>
        <span className="block text-2xs text-muted-foreground break-words">{value}</span>
      </span>
    </div>
  );
}

/** One portal's capabilities, as four facts and the real link to its site. */
export function PortalCapabilities({ portal, compact = false }: { portal: PortalInfo; compact?: boolean }) {
  const { t } = useLanguage();
  const ownerConfirmed = portal.verification === 'OWNER_CONFIRMED';
  return (
    <div className={cn('min-w-0 rounded-xl border border-border bg-[hsl(var(--card))]', compact ? 'p-3' : 'p-4')} data-testid={`pubw-capabilities-${portal.id}`}>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        {compact ? <span /> : <span className="flex min-w-0 items-center gap-2"><PortalLogo portal={portal} size="sm" /><span className="font-display text-sm font-semibold text-foreground">{portal.name}</span></span>}
        <span className="rounded-full bg-[hsl(var(--gold-soft))] px-2 py-0.5 text-2xs font-semibold text-[hsl(var(--gold-ink))]">{t('pubw_cap_badge_manual')}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Fact ok={false} label={t('pubw_cap_account')} value={t('pubw_cap_account_value', { portal: portal.name })} />
        <Fact ok={false} label={t('pubw_cap_auto')} value={t('pubw_cap_auto_value')} />
        <Fact ok={true} label={t('pubw_cap_prepare')} value={t('pubw_cap_prepare_value')} />
        <Fact ok={ownerConfirmed ? null : true} label={t('pubw_cap_verify')} value={ownerConfirmed ? t('pubw_cap_verify_owner_value', { portal: portal.name }) : t('pubw_cap_verify_value')} />
      </div>
      {portal.maxPhotos ? <p className="mt-2 text-2xs text-muted-foreground">{t('pubw_photos_portal_max', { portal: portal.name, n: portal.maxPhotos })}</p> : null}
      {!compact ? (
        <a href={portal.createUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-2xs font-semibold text-[hsl(var(--gold-ink))] hover:underline">
          {t('pubw_open_portal', { portal: portal.name })}<ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      ) : null}
      {!portal.createUrlVerified ? <p className="mt-1.5 text-2xs text-muted-foreground">{t('pubw_create_url_home', { portal: portal.name })}</p> : null}
    </div>
  );
}

/** Choose one or several portals. Disabled portals are shown, explained, and not selectable. */
export function PortalPicker({ portals, selected, onToggle, disabled, problems }: {
  portals: PortalInfo[]; selected: string[]; onToggle: (id: PortalInfo['id']) => void; disabled?: boolean;
  /** Per-portal open problems, so a card can say exactly what that portal still needs. */
  problems?: Record<string, { field: string }[]>;
}) {
  const { t } = useLanguage();
  return (
    <ul className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 lg:grid-cols-4" data-testid="pubw-portal-picker">
      {portals.map((p) => {
        const on = selected.includes(p.id);
        const open = problems?.[p.id]?.length ?? 0;
        return (
          <li key={p.id} className="min-w-0">
            <button
              type="button"
              aria-pressed={on}
              disabled={disabled || !p.enabled}
              onClick={() => onToggle(p.id)}
              data-testid={`pubw-pick-${p.id}`}
              className={cn('group relative flex h-full w-full min-w-0 items-center gap-3 rounded-xl border p-3 text-start transition-all duration-200 motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0',
                on ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] shadow-card' : 'border-border bg-[hsl(var(--card))] hover:border-[hsl(var(--gold-border))]')}
            >
              <PortalLogo portal={p} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{p.name}</span>
                <span className="block text-2xs text-muted-foreground break-words">
                  {!p.enabled ? t('pubw_portal_unavailable')
                    : on && open ? t('pubw_portal_needs', { n: open })
                      : p.verification === 'OWNER_CONFIRMED' ? t('pubw_portal_mode_owner') : t('pubw_portal_mode_check')}
                </span>
              </span>
              <span aria-hidden="true" className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors', on ? 'border-transparent bg-[#0C1119] text-white' : 'border-border text-transparent')}>
                <Check className="h-3 w-3" />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The subtle mark on a required field: an asterisk for the eye, a word for a screen reader. */
export function RequiredMark() {
  const { t } = useLanguage();
  return <><span aria-hidden="true" className="ms-0.5 text-[hsl(var(--gold-ink))]">*</span><span className="sr-only"> ({t('pubw_required')})</span></>;
}

/** The fourteen-step journey, each step ticked only by server state (see model.ts `journey`). */
export function JourneySteps({ steps, onSelect }: { steps: Record<JourneyStep, StepState>; onSelect?: (step: JourneyStep) => void }) {
  const { t } = useLanguage();
  return (
    <nav aria-label={t('pubw_journey_title')} className="min-w-0 rounded-xl border border-border bg-[hsl(var(--card))] p-3">
      <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('pubw_journey_title')}</p>
      <ol className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {JOURNEY.map((step, i) => {
          const s = steps[step];
          return (
            <li key={step} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect?.(step)}
                aria-current={s === 'current' ? 'step' : undefined}
                data-state={s}
                className={cn('flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-2xs font-semibold whitespace-nowrap transition-colors',
                  s === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : s === 'current' ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
                      : 'border-border text-muted-foreground')}
              >
                <span aria-hidden="true" className={cn('grid h-4 w-4 place-items-center rounded-full text-[10px]', s === 'done' ? 'bg-emerald-600 text-white' : s === 'current' ? 'bg-[#0C1119] text-white' : 'bg-[hsl(var(--secondary))]')}>
                  {s === 'done' ? '✓' : i + 1}
                </span>
                {t(`pubw_journey_${step}`)}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

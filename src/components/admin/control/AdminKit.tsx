/*
 * The small pieces every Admin control-centre page is built from.
 *
 * Deliberately plain: a header, a filter bar that collapses behind "More
 * filters" on a phone, a pager that says where you are, an error that says
 * the query failed (never an empty list pretending nothing exists), and a
 * confirmation dialog for anything that changes state. They follow the
 * existing Admin visual language — Card, muted headings, 2xs metadata — and
 * add no new look of their own.
 */
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Copy, Loader2 } from 'lucide-react';
import React from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

export function PageHeader({ title, subtitle, actions }: {
  title: string; subtitle?: string; actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-foreground">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Primary filters always visible; the rest behind a toggle below `sm`.
 * On a wide screen everything is shown, because there is room.
 */
export function FilterBar({ primary, more, onApply, onReset, busy }: {
  primary: React.ReactNode;
  more?: React.ReactNode;
  onApply: () => void;
  onReset?: () => void;
  busy?: boolean;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = React.useState(false);
  return (
    <form
      className="space-y-3 rounded-lg border border-border bg-card p-3"
      onSubmit={(e) => { e.preventDefault(); onApply(); }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{primary}</div>
      {more && (
        <>
          <button
            type="button"
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground sm:hidden"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !open && '-rotate-90 rtl:rotate-90')} aria-hidden="true" />
            {t('admin_cc_more_filters')}
          </button>
          <div className={cn('grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4', open ? 'grid' : 'hidden sm:grid')}>{more}</div>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          {t('admin_cc_apply')}
        </Button>
        {onReset && (
          <Button type="button" size="sm" variant="ghost" onClick={onReset} disabled={busy}>
            {t('admin_cc_reset')}
          </Button>
        )}
      </div>
    </form>
  );
}

export function Field({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1" htmlFor={htmlFor}>
      <span className="text-2xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export const inputClass = 'h-9 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function TextFilter({ label, value, onChange, placeholder, inputMode }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  return (
    <Field label={label}>
      <input className={inputClass} value={value} placeholder={placeholder} inputMode={inputMode}
             onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function DateFilter({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <input type="date" className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function SelectFilter({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const { t } = useLanguage();
  return (
    <Field label={label}>
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('admin_cc_any')}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

/** A date input's value as the start of that day, and the day after for "to". */
export const dayStart = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : '');
export const dayAfter = (d: string) => {
  if (!d) return '';
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + 1);
  return x.toISOString();
};

export function Pager({ offset, limit, total, count, onChange }: {
  offset: number; limit: number; total: number; count: number; onChange: (offset: number) => void;
}) {
  const { t } = useLanguage();
  if (total === 0 && offset === 0) return null;
  const from = count === 0 ? 0 : offset + 1;
  const to = offset + count;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>{t('admin_cc_showing', { from, to, total })}</span>
      <div className="flex gap-1">
        <Button type="button" size="sm" variant="outline" className="h-8" disabled={offset === 0}
                onClick={() => onChange(Math.max(0, offset - limit))} aria-label={t('admin_cc_prev')}>
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8" disabled={to >= total}
                onClick={() => onChange(offset + limit)} aria-label={t('admin_cc_next')}>
          <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  const { t } = useLanguage();
  return (
    <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t('admin_cc_load_failed')}
      </p>
      <p dir="ltr" className="mt-1 break-words text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

/** An id, shortened, with the whole value one tap away. */
export function IdChip({ id, label }: { id: string | null | undefined; label?: string }) {
  const { t } = useLanguage();
  if (!id) return <span className="text-muted-foreground">—</span>;
  return (
    <button
      type="button"
      title={id}
      onClick={() => { void navigator.clipboard?.writeText(id); }}
      className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground hover:text-foreground"
      aria-label={t('admin_cc_copy_id', { id: label ?? id })}
      dir="ltr"
    >
      <span className="truncate">{label ?? id.slice(0, 8)}</span>
      <Copy className="h-3 w-3 shrink-0" aria-hidden="true" />
    </button>
  );
}

export function When({ at }: { at: string | null | undefined }) {
  if (!at) return <span className="text-muted-foreground">—</span>;
  const d = new Date(at);
  return <time dateTime={at} title={d.toISOString()} className="whitespace-nowrap tabular-nums">{d.toLocaleString()}</time>;
}

export function KV({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-2xs font-medium uppercase tracking-wide text-muted-foreground sm:pt-0.5">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/**
 * The one way a control-centre page asks "are you sure".
 * The confirm button stays disabled while `confirmDisabled`, so a required
 * reason cannot be skipped by pressing Enter.
 */
export function Confirm({ open, onOpenChange, title, description, confirmLabel, onConfirm, busy, destructive, children, confirmDisabled }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  destructive?: boolean;
  children?: React.ReactNode;
  confirmDisabled?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t('admin_cc_cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || confirmDisabled}
            onClick={(e) => { e.preventDefault(); onConfirm(); }}
            className={cn(destructive && 'bg-destructive text-destructive-foreground hover:bg-destructive/90')}
          >
            {busy && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** A user as a line: name or email, and the email under it. */
export function UserLine({ user, link = true }: { user: { id: string; email: string | null; full_name?: string | null } | null; link?: boolean }) {
  if (!user) return <span className="text-muted-foreground">—</span>;
  const main = user.full_name || user.email || user.id;
  const body = (
    <span className="block min-w-0">
      <span className="block truncate font-medium">{main}</span>
      {user.full_name && user.email && <span className="block truncate text-2xs text-muted-foreground">{user.email}</span>}
    </span>
  );
  return link
    ? <a href={`/admin/user360?user=${user.id}`} className="block min-w-0 hover:underline">{body}</a>
    : body;
}

/** Read and write a page's filters in the URL, so a filtered view can be linked. */
export function useQueryState<T extends Record<string, string>>(defaults: T): [T, (next: T) => void] {
  const read = React.useCallback((): T => {
    const params = new URLSearchParams(window.location.search);
    const out = { ...defaults };
    for (const k of Object.keys(defaults)) {
      const v = params.get(k);
      if (v !== null) (out as Record<string, string>)[k] = v;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [state, setState] = React.useState<T>(read);
  const write = React.useCallback((next: T) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
    const qs = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    setState(next);
  }, []);
  return [state, write];
}

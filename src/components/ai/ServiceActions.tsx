// THE OTHER KIND OF CHIP, DRESSED SO NOBODY CONFUSES THEM.
//
// A suggested reply (SuggestedReplies.tsx) is a quiet bordered round: it
// SAYS something. A service action is a solid navy pill with the gold
// arrow: it GOES somewhere — one of the real HOMATCH products, validated
// against the catalogue in src/lib/ai/serviceActions.ts. It never sends a
// message and never spends anything: the product's own screen states any
// price and asks its own confirmation (§64/§65 of the master mandate).

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { ServiceAction } from '@/lib/ai/serviceActions';

export function ServiceActions({ actions, className }: { actions: ServiceAction[]; className?: string }) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  if (actions.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="w-full text-2xs font-semibold uppercase tracking-[0.1em] text-muted-foreground sm:w-auto">
        {t('ai_actions_label')}
      </span>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={() => navigate(action.route)}
          className="group inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-full bg-[#0C1119] px-4 py-2 text-start text-sm font-semibold text-white shadow-card transition-colors hover:bg-[#1a2231] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2"
        >
          <span className="block break-words">{t(action.labelKey as never)}</span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[hsl(38_92%_60%)] transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
        </button>
      ))}
    </div>
  );
}

/** The honest freshness line + compact source list for a turn that really
 *  did check the web. Renders nothing otherwise — freshness is never
 *  claimed, it is reported. */
export function WebContextLine({
  webChecked,
  sources,
  className,
}: {
  webChecked: boolean;
  sources: Array<{ title: string; url: string }>;
  className?: string;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = React.useState(false);
  if (!webChecked) return null;
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--gold))]" />
          {t('ai_web_checked')}
        </span>
        {sources.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            className="rounded-full border border-[hsl(var(--border))] bg-card px-2 py-0.5 font-medium text-foreground transition-colors hover:border-[hsl(var(--gold-border))]"
          >
            {t('ai_sources_toggle', { count: String(sources.length) })}
          </button>
        )}
      </div>
      {open && sources.length > 0 && (
        <ul className="space-y-1">
          {sources.map((s) => (
            <li key={s.url} className="min-w-0">
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="block truncate text-2xs text-[hsl(var(--gold-ink))] hover:underline"
                dir="ltr"
              >
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// EXPLORE MORE — five tools, none of them in the way.
//
// This is what is left of the nine-topic chooser, and the change is not
// cosmetic. Choosing between nine questions BEFORE a calculation is a
// toll gate on the thing everybody came for. Choosing between five
// AFTER one is an offer, and an offer can be declined by scrolling
// past it.
//
// One opens at a time. Two open tools is a dashboard again.

import React from 'react';
import { ChevronDown, Columns3, FastForward, Landmark, Repeat, Scale, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { TOOL_ORDER, TOPICS, missingRequirements, type TopicId, type WorkspaceState } from '@/mortgage/topics';

const ICONS: Record<string, React.ElementType> = {
  'fast-forward': FastForward,
  columns: Columns3,
  scale: Scale,
  repeat: Repeat,
  landmark: Landmark,
};

export function ToolShelf({
  open,
  onOpen,
  state,
  children,
}: {
  open: TopicId | null;
  onOpen: (topic: TopicId | null) => void;
  state: WorkspaceState;
  /** The open tool's own view, rendered by the page. */
  children: React.ReactNode;
}) {
  const { t } = useLanguage();

  return (
    <section id="tools">
      <h2 className="font-display text-lg font-semibold text-foreground">
        {t('mortgage_tools_title')}
      </h2>
      <p className="mt-1.5 max-w-[60ch] text-sm text-muted-foreground">{t('mortgage_tools_sub')}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {TOOL_ORDER.map((id) => {
          const definition = TOPICS[id];
          const Icon = ICONS[definition.icon] ?? Scale;
          const active = open === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onOpen(active ? null : id)}
              aria-expanded={active}
              aria-controls="tool-panel"
              className={cn(
                'flex min-h-12 items-center gap-2 rounded-xl border px-4 text-sm transition-colors',
                active
                  ? 'border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] text-[hsl(var(--gold-ink))]'
                  : 'border-border text-muted-foreground hover:border-[hsl(var(--gold-border))] hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="text-start">{t(definition.titleKey)}</span>
              <ChevronDown
                className={cn('h-3.5 w-3.5 shrink-0 transition-transform', active && 'rotate-180')}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>

      {open ? (
        <div id="tool-panel" className="mt-4 space-y-4">
          {/* What this tool still needs, by name. A tool that opens and
              shows nothing is worse than one that says what is missing. */}
          {missingRequirements(TOPICS[open], state).length ? (
            <p className="hm-workspace-panel px-5 py-6 text-sm text-muted-foreground">
              {t('mortgage_topic_needs')}{' '}
              <span className="text-foreground">
                {missingRequirements(TOPICS[open], state).map((key) => t(key)).join(', ')}
              </span>
            </p>
          ) : null}

          {children}

          <button
            type="button"
            onClick={() => onOpen(null)}
            className="flex min-h-11 items-center gap-1.5 rounded-full border border-border px-4 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            {t('mortgage_tools_close')}
          </button>
        </div>
      ) : null}
    </section>
  );
}

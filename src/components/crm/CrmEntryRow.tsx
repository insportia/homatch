import { CalendarClock, ChevronRight, NotebookPen } from 'lucide-react';
import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { isFollowUpDue } from '@/crm/model';
import { cn } from '@/lib/utils';
import type { CrmListItem } from '@/services/leadsCrm';
import { CrmStatusPill, useCrmDateFormat } from './ui';

/**
 * One relationship in the list. The selection checkbox and the row's open button are
 * siblings, never nested, so each is its own control for a keyboard and a screen reader.
 * A due follow-up wears the gold edge — the one thing on this list that wants the owner.
 */
export function CrmEntryRow({
  item,
  selected,
  onToggle,
  onOpen,
  now,
}: {
  item: CrmListItem;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  now: number;
}) {
  const { t } = useLanguage();
  const fmt = useCrmDateFormat();
  const due = isFollowUpDue(item.followUpAt, now);
  const name = item.displayName || t('crm_anonymous');
  const checkboxId = `crm-sel-${item.entryId}`;

  return (
    <li
      data-crm-due={due ? 'true' : undefined}
      className={cn(
        'relative flex items-stretch gap-1 rounded-2xl border bg-white transition-shadow motion-reduce:transition-none',
        due
          ? 'border-[hsl(38_60%_72%)] shadow-[inset_3px_0_0_hsl(38_88%_54%)] rtl:shadow-[inset_-3px_0_0_hsl(38_88%_54%)]'
          : 'border-[hsl(40_12%_86%)] hover:shadow-[0_6px_20px_hsl(35_25%_15%/0.07)]',
      )}
    >
      <div className="flex shrink-0 items-center ps-2 sm:ps-3">
        <label htmlFor={checkboxId} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl focus-within:ring-2 focus-within:ring-[hsl(38_92%_50%)]">
          <input
            id={checkboxId}
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="h-5 w-5 cursor-pointer accent-[hsl(218_45%_14%)] focus:outline-none"
          />
          <span className="sr-only">{t('crm_select_entry', { name })}</span>
        </label>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-[4.5rem] min-w-0 flex-1 items-center gap-3 rounded-e-2xl py-3 pe-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(38_92%_50%)] sm:pe-4"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 break-words font-display text-[15px] font-semibold text-[hsl(218_45%_14%)]">{name}</span>
            <CrmStatusPill status={item.status} />
            {due ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[hsl(38_60%_70%)] bg-[hsl(41_88%_94%)] px-2 py-0.5 text-2xs font-semibold text-[hsl(34_90%_28%)]">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> {t('crm_follow_up_due')}
              </span>
            ) : null}
          </div>
          {item.propertyTitle || item.homatchId ? (
            <p className="mt-1 truncate text-sm text-[hsl(218_28%_34%)]">
              {item.propertyTitle ?? ''}
              {item.homatchId ? <span dir="ltr" className="ms-1.5 tabular-nums text-[hsl(218_15%_44%)]">#{item.homatchId}</span> : null}
            </p>
          ) : null}
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-[hsl(218_15%_40%)]">
            <span>{t('crm_last_activity', { date: fmt.dateTime(item.lastActivityAt) })}</span>
            {item.followUpAt && !due ? <span>{t('crm_follow_up_on', { date: fmt.dateTime(item.followUpAt) })}</span> : null}
            {item.noteCount > 0 ? (
              <span className="inline-flex items-center gap-1">
                <NotebookPen className="h-3 w-3" aria-hidden="true" />
                {t('crm_note_count', { n: item.noteCount })}
              </span>
            ) : null}
          </p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-[hsl(218_15%_50%)] rtl:rotate-180" aria-hidden="true" />
      </button>
    </li>
  );
}

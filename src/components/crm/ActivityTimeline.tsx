import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { describeEvent } from '@/crm/model';
import type { CrmEvent } from '@/services/leadsCrm';
import { useCrmDateFormat } from './ui';

/**
 * Every recorded event, newest first. Kinds this build does not know (Email Studio may
 * add more) render as a generic line instead of disappearing or breaking the list.
 */
export function ActivityTimeline({ events }: { events: CrmEvent[] }) {
  const { t } = useLanguage();
  const fmt = useCrmDateFormat();
  if (events.length === 0) {
    return <p className="text-sm text-[hsl(218_15%_40%)]">{t('crm_activity_empty')}</p>;
  }
  return (
    <ol className="relative space-y-3 border-s border-[hsl(40_12%_86%)] ps-4">
      {events.map((event, i) => {
        const d = describeEvent(event);
        const vars: Record<string, string> = { ...d.vars };
        if (vars.fromKey) vars.from = t(vars.fromKey);
        if (vars.toKey) vars.to = t(vars.toKey);
        return (
          <li key={`${event.createdAt}-${i}`} className="relative">
            <span
              aria-hidden="true"
              className="absolute -start-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-[hsl(38_88%_54%)] ring-2 ring-white"
            />
            <p className="break-words text-sm text-[hsl(218_45%_14%)]">
              {t(d.key, vars)}
              {d.at ? <span className="text-[hsl(218_28%_38%)]"> · {fmt.dateTime(d.at)}</span> : null}
            </p>
            <p className="mt-0.5 text-2xs text-[hsl(218_15%_42%)]">
              <time dateTime={event.createdAt}>{fmt.dateTime(event.createdAt)}</time>
              {d.automatic ? <span> · {t('crm_event_automatic')}</span> : null}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

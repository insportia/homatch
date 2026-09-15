import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Clock, AlertTriangle, KeySquare, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import {
  listNotifications, markNotificationRead, markAllNotificationsRead,
  generateNotifications, notificationTarget,
} from '@/services/developer/dashboard';
import { relativeTime } from './primitives';
import type { DevNotification, NotificationKind } from '@/services/developer/types';

/**
 * WHAT NEEDS DOING, DERIVED RATHER THAN STORED SEPARATELY.
 *
 * Every row behind this comes from state that already exists: a reservation
 * whose date is inside a week, an instalment that is past due, a follow-up
 * somebody set and did not come back to, a handover whose target has passed.
 * Nothing here is a second copy of the truth that could drift from the first.
 *
 * GENERATED WHEN SOMEBODY LOOKS, NOT ON A SCHEDULE. dev_generate_notifications
 * is idempotent and deduplicated on a key, so calling it when the workspace
 * opens produces one row per real situation however many times it runs. That
 * is why there is no cron job here to keep alive, and nothing to go quietly
 * stale when one stops.
 *
 * THE COUNT IS UNREAD, NOT TOTAL. A badge that shows forty because forty
 * things happened last month is a badge people learn to ignore.
 */
const KIND_ICON: Record<NotificationKind, React.ComponentType<{ className?: string }>> = {
  RESERVATION_EXPIRING: Clock,
  RESERVATION_EXPIRED: AlertTriangle,
  PAYMENT_DUE: Clock,
  PAYMENT_OVERDUE: AlertTriangle,
  PAYMENT_TO_CONFIRM: Clock,
  FOLLOW_UP_DUE: UserRound,
  HANDOVER_DUE: KeySquare,
  OFFER_EXPIRING: Clock,
  DOCUMENT_TO_REVIEW: Clock,
  UNIT_SOLD: CheckCheck,
};

/** Kinds that mean somebody is about to lose something. */
const URGENT: NotificationKind[] = [
  'RESERVATION_EXPIRED', 'PAYMENT_OVERDUE', 'HANDOVER_DUE',
];

export function NotificationBell() {
  const { t, lang: language } = useLanguage();
  const navigate = useNavigate();
  const { workspace } = useDeveloperWorkspace();

  const [rows, setRows] = useState<DevNotification[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!workspace) return;
    try {
      // Generate then read. A failure to generate is not a reason to show
      // nothing — the rows already stored are still true.
      try {
        await generateNotifications(workspace.id);
      } catch {
        // Reported by the service layer; the read below still runs.
      }
      setRows(await listNotifications(workspace.id, { limit: 30 }));
    } catch {
      // A bell that cannot load must not take the page down with it. The
      // error is already in the log via the service layer.
      setRows([]);
    }
  }, [workspace]);

  useEffect(() => { void load(); }, [load]);

  const unread = rows.filter((r) => r.read_at === null);

  async function openOne(row: DevNotification) {
    setOpen(false);
    if (row.read_at === null) {
      try {
        await markNotificationRead(row.id);
        setRows((prev) => prev.map((r) => (
          r.id === row.id ? { ...r, read_at: new Date().toISOString() } : r
        )));
      } catch {
        // Navigating matters more than the read receipt.
      }
    }
    navigate(notificationTarget(row));
  }

  async function clearAll() {
    if (!workspace) return;
    try {
      await markAllNotificationsRead(workspace.id);
      const now = new Date().toISOString();
      setRows((prev) => prev.map((r) => (r.read_at ? r : { ...r, read_at: now })));
    } catch {
      // Same: the list is still correct, it just still shows unread.
    }
  }

  if (!workspace) return null;

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) void load(); }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative shrink-0"
          aria-label={
            unread.length > 0
              ? t('dev_notifications_unread').replace('{n}', String(unread.length))
              : t('dev_notifications')
          }
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {unread.length > 0 && (
            <span
              className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-semibold leading-none text-gold-ink"
              aria-hidden="true"
            >
              {unread.length > 9 ? '9+' : unread.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-sm font-semibold tracking-tight">{t('dev_notifications')}</p>
          {unread.length > 0 && (
            <button
              type="button"
              onClick={() => void clearAll()}
              className="text-2xs text-muted-foreground underline-offset-4 hover:underline"
            >
              {t('dev_notifications_mark_all')}
            </button>
          )}
        </div>

        {rows.length === 0 ? (
          /* An empty inbox is good news, and says so rather than looking broken. */
          <div className="px-4 py-8 text-center">
            <CheckCheck className="mx-auto h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium">{t('dev_notifications_clear_title')}</p>
            <p className="mt-0.5 text-2xs text-muted-foreground">
              {t('dev_notifications_clear_body')}
            </p>
          </div>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
            {rows.map((row) => {
              const Icon = KIND_ICON[row.kind] ?? Bell;
              const urgent = URGENT.includes(row.kind);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => void openOne(row)}
                    className={cn(
                      'flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/50',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      row.read_at === null && 'bg-gold/[0.04]',
                    )}
                  >
                    <Icon
                      className={cn(
                        'mt-0.5 h-4 w-4 shrink-0',
                        urgent ? 'text-amber-600' : 'text-muted-foreground',
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn(
                        'block truncate text-sm',
                        row.read_at === null && 'font-medium',
                      )}>
                        {row.title}
                      </span>
                      {row.body && (
                        <span className="block truncate text-2xs text-muted-foreground">
                          {row.body}
                        </span>
                      )}
                      <span className="mt-0.5 block text-2xs text-muted-foreground">
                        {relativeTime(row.created_at, language)}
                      </span>
                    </span>
                    {row.read_at === null && (
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

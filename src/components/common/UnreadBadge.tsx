import React from 'react';

/**
 * ONE UNREAD BADGE, IN HOMATCH GOLD.
 *
 * WHAT IT REPLACED
 *
 * Three implementations that had drifted: the app shell's bell, the public
 * header's bell and the WhatsApp overview each drew their own, all of them
 * `bg-destructive` — a red dot. Red is the product's colour for something
 * being WRONG, and "you have four unread messages" is not wrong, it is the
 * product working. Gold is the accent that means "here, this one", which is
 * exactly what an unread marker is for.
 *
 * WHY THE NUMBER STOPS
 *
 * A badge is a hint, not a report. Past a point the exact figure changes
 * nothing about what you do next, and an unbounded number is a layout bug
 * waiting for a busy account: at four digits it is wider than the icon it
 * sits on. The cap is per-surface, because the two cases are different —
 * a bell over a personal feed tops out at 9+, and a shared inbox that can
 * genuinely hold hundreds gets 99+.
 *
 * CONTRAST
 *
 * Black on --gold is 14.6:1. The previous white-on-red was 4.0:1, which is
 * under the floor for text this small, on the one element in the chrome that
 * has to be readable at a glance and at arm's length.
 */
export function UnreadBadge({
  count, cap = 9, className = '', label,
}: {
  count: number;
  /** Highest number shown before it becomes "N+". 9 for a bell, 99 for an inbox. */
  cap?: 9 | 99;
  className?: string;
  /** What a screen reader should say. The digits alone mean nothing. */
  label?: string;
}) {
  if (!Number.isFinite(count) || count <= 0) return null;

  const shown = count > cap ? `${cap}+` : String(Math.floor(count));

  return (
    <span
      /* min-w rather than a fixed width: a single digit is a circle and "99+"
         is a lozenge, and neither may clip. */
      className={`grid h-[18px] min-w-[18px] place-items-center rounded-full bg-gold px-1
        text-[13px] font-bold leading-none text-primary tabular-nums ${className}`}
      aria-label={label}
      /* The count is already announced by the label; without this a screen
         reader reads the digits twice. */
      role={label ? 'status' : undefined}
    >
      <span aria-hidden={label ? 'true' : undefined}>{shown}</span>
    </span>
  );
}

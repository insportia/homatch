// TURNING A WINDOW INTO A CONTINUOUS SERIES.
//
// timeBounds() in ./community-evidence.ts answers "which instants does LAST_7D
// cover". This answers the next question: "which buckets does that window contain,
// including the empty ones".
//
// WHY THE EMPTY ONES ARE THE POINT
//
// `date_trunc(...) ... GROUP BY 1` returns only buckets that have rows. That is
// correct SQL and a misleading series: four scattered points drawn as a line
// assert a continuity nobody observed, and a week with two quiet days looks
// identical to a week that was never collected. What the store does NOT hold is
// usually the most useful thing a report says, and it is only visible if the zero
// buckets exist.
//
// WHY THIS IS IN THE CORE AND NOT IN THE EDGE FUNCTION THAT NEEDED IT
//
// Because it has to agree with Postgres EXACTLY, and "exactly" is a testable
// claim only if there is one copy of the rule.
//
// The series is assembled by matching generated bucket starts against date_trunc
// output as strings. If the two truncate differently -- one to the minute and one
// to the hour, or a week to Sunday instead of Monday -- then every real value is
// orphaned, every bucket renders as zero beside its own data, and NOTHING THROWS.
// A report full of zeroes is not obviously wrong to anyone looking at it.
//
// So the truncation lives here, next to the window it has to agree with, where a
// test can hold it against the database's behaviour rather than against a
// reimplementation of itself.

import { truncUnit, type TimeBounds, type TimeBucket } from './community-evidence.ts';

/** The Postgres `date_trunc` units this module handles. */
export type TruncUnit = 'hour' | 'day' | 'week' | 'month';

/**
 * Truncate an instant to the start of its bucket, the way `date_trunc` does.
 *
 * UTC throughout. A calendar window's local boundary is timeBounds()' decision and
 * it has already been made by the time bounds exist; buckets inside those bounds
 * are aligned to the same grid the database groups on, which is UTC.
 */
export function truncateTo(at: Date, unit: TruncUnit): Date {
  const d = new Date(at.getTime());
  d.setUTCMilliseconds(0);
  d.setUTCSeconds(0);
  d.setUTCMinutes(0);
  if (unit === 'hour') return d;

  d.setUTCHours(0);
  if (unit === 'day') return d;

  if (unit === 'week') {
    /*
     * Postgres truncates a week to MONDAY. getUTCDay() makes Sunday 0, so a naive
     * subtraction puts Sunday at the start of the FOLLOWING week and shifts one
     * seventh of every weekly series by six days.
     */
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d;
  }

  d.setUTCDate(1);
  return d;
}

/** The instant one bucket after this one. */
export function nextBucket(at: Date, unit: TruncUnit): Date {
  const d = new Date(at.getTime());
  switch (unit) {
    case 'hour':
      d.setUTCHours(d.getUTCHours() + 1);
      return d;
    case 'day':
      d.setUTCDate(d.getUTCDate() + 1);
      return d;
    case 'week':
      d.setUTCDate(d.getUTCDate() + 7);
      return d;
    case 'month':
      /*
       * Stepped through the calendar, because a month has no fixed length. Adding
       * 30 days to 31 January lands on 2 March and every later bucket drifts
       * further out of alignment with the ones the database returns.
       */
      d.setUTCMonth(d.getUTCMonth() + 1);
      return d;
    default:
      throw new Error(`unknown trunc unit: ${String(unit)}`);
  }
}

/**
 * Every bucket start in the window, including the ones with no evidence.
 *
 * `limit` bounds the result so a calendar-stepping mistake cannot become an
 * unbounded loop in a request handler. It is a safety rail rather than the product
 * rule: the caller refuses an over-large request up front with bucketCount(), and
 * this exists so that a disagreement between the two truncates the answer instead
 * of hanging the process.
 */
export function bucketStarts(
  bounds: Pick<TimeBounds, 'from' | 'to'>,
  bucket: TimeBucket,
  limit = 10_000,
): string[] {
  const unit = truncUnit(bucket);
  const end = Date.parse(bounds.to);
  const begin = Date.parse(bounds.from);
  if (!Number.isFinite(begin) || !Number.isFinite(end)) {
    throw new Error('bucketStarts needs two parseable bounds');
  }

  const starts: string[] = [];
  let cursor = truncateTo(new Date(begin), unit);

  /*
   * `cursor < end`, so a window ending exactly on a boundary does not gain an
   * empty trailing bucket -- and a window SHORTER than one bucket still yields the
   * one bucket that contains it, because the truncated start is always at or
   * before `from`. LAST_HOUR bucketed by DAY is one day, not zero days, and an
   * empty series there would read as "no data" for a window that simply has no
   * whole bucket in it.
   */
  while (cursor.getTime() < end && starts.length < limit) {
    starts.push(cursor.toISOString());
    const next = nextBucket(cursor, unit);
    /* A unit that failed to advance would loop forever on the same instant. */
    if (next.getTime() <= cursor.getTime()) break;
    cursor = next;
  }
  return starts;
}

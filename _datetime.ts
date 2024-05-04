import { assertUnreachable } from "./_misc.ts";

export type Unit =
  | "hours"
  | "days"
  | "weeks"
  | "months"
  | "quarters"
  | "years";

const SECOND = 1000,
  MINUTE = SECOND * 60,
  HOUR = MINUTE * 60,
  DAY = HOUR * 24,
  WEEK = DAY * 7;

export function getUtcTimeSinceMidnight(date: Date): number {
  return date.getUTCHours() * HOUR + date.getUTCMinutes() * MINUTE +
    date.getUTCSeconds() * SECOND + date.getUTCMilliseconds();
}

// Deno std lib has a difference() function that almost does what we need,
// except that it rounds dates to midnight local time when calculating month
// difference. We use UTC time, so we need to explicitly account for time since
// midnight. We only need/support single-unit periods, so we only need to
// calculate difference for one unit.

/** Get the difference between two dates in the given time unit.
 *
 * @returns The integer number of units difference, negative if to < from.
 */
export function utcDifference(
  { from, to, unit }: { from: Date; to: Date; unit: Unit },
): number {
  switch (unit) {
    case "hours":
      return Math.trunc((to.getTime() - from.getTime()) / HOUR);
    case "days":
      return Math.trunc((to.getTime() - from.getTime()) / DAY);
    case "weeks":
      return Math.trunc((to.getTime() - from.getTime()) / WEEK);
    case "months":
      return getUtcMonthDifference(from, to);
    case "quarters":
      return Math.trunc(getUtcMonthDifference(from, to) / 3);
    case "years":
      return Math.trunc(getUtcMonthDifference(from, to) / 12);
  }
  assertUnreachable(unit);
}

function getUtcMonthDifference(from: Date, to: Date): number {
  let monthDelta = (to.getUTCFullYear() - from.getUTCFullYear()) * 12;
  monthDelta += to.getUTCMonth() - from.getUTCMonth();
  if (monthDelta === 0) return 0;
  // If `to` has not passed `from` within the month, not a full month has passed
  let delta = to.getUTCDate() - from.getUTCDate();
  if (delta === 0) { // same day, so find the exact difference in milliseconds
    delta = getUtcTimeSinceMidnight(to) - getUtcTimeSinceMidnight(from);
  }
  if (monthDelta < 0 && delta > 0) return monthDelta + 1;
  if (monthDelta > 0 && delta < 0) return monthDelta - 1;
  return monthDelta;
}

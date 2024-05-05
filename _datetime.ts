import { assertUnreachable } from "./_misc.ts";

export type Unit =
  | "milliseconds"
  | "seconds"
  | "minutes"
  | "hours"
  | "days"
  | "weeks"
  | "months"
  | "quarters"
  | "years";

export const SECOND = 1000,
  MINUTE = SECOND * 60,
  HOUR = MINUTE * 60,
  DAY = HOUR * 24,
  WEEK = DAY * 7;

/** The number of milliseconds since midnight in UTC.
 *
 * i.e. the time contribution to the date's timestamp.
 */
export function timeSinceMidnightUtc(date: Date): number {
  return date.getTime() -
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

// Deno std lib has a difference() function that almost does what we need,
// except that it rounds dates to midnight local time when calculating month
// difference. We use UTC time, so we need to explicitly account for time since
// midnight. We only need/support single-unit periods, so we only need to
// calculate difference for one unit.

/** Get the fractional difference between dates two dates in the given `unit`.
 *
 * When `to` is before `from`, the difference is negative. When the dates are
 * exact multiples of `unit` apart, the result is an exact integer, otherwise
 * it's a fractional value.
 *
 * The weeks, days and hours units are linear time units as you'd expect. The
 * month and up units are a little unusual in that months vary in length, so the
 * fractions vary according to the month(s) they bridge.
 *
 * Month fractions work by placing the `from` day & time in each month, and
 * finding the relative position of `to` (in linear time) between the two
 * surrounding points.
 */
export function differenceUtc(from: Date, to: Date, unit: Unit): number {
  switch (unit) {
    case "milliseconds":
      return (to.getTime() - from.getTime());
    case "seconds":
      return (to.getTime() - from.getTime()) / SECOND;
    case "minutes":
      return (to.getTime() - from.getTime()) / MINUTE;
    case "hours":
      return (to.getTime() - from.getTime()) / HOUR;
    case "days":
      return (to.getTime() - from.getTime()) / DAY;
    case "weeks":
      return (to.getTime() - from.getTime()) / WEEK;
    case "months":
      return monthDifferenceUtc(from, to);
    case "quarters":
      return monthDifferenceUtc(from, to) / 3;
    case "years":
      return monthDifferenceUtc(from, to) / 12;
  }
  assertUnreachable(unit);
}

/**
 * Get the fractional number of months between from and to.
 *
 * The value is negative when `to` is before `from`. The fractional component is
 * the relative position of `to` between the `from` month boundaries either side
 * of it, with millisecond precision.
 */
export function monthDifferenceUtc(from: Date, to: Date): number {
  const toY = to.getUTCFullYear(),
    toM = to.getUTCMonth(),
    fromY = from.getUTCFullYear(),
    fromM = from.getUTCMonth(),
    fromD = from.getUTCDate(),
    toTime = to.getTime(),
    fromTimeInDay = timeSinceMidnightUtc(from);

  const wholeMonths = (toY - fromY) * 12 + (toM - fromM);

  // We calculate fractional months by finding two points on either side of `to`
  // at the same day/time in the month as `from`. We then calculate a 0..1 value
  // representing the position of `to` between the two boundaries.

  // If the from day does not occur in a month, the boundary will be in the
  // month above. In this case we treat the boundary as occurring in imaginary
  // space after the end of the lower month and before the start of the upper
  // month.
  //
  // For example, from 2024-01-31 counting forward, Feb 29th is the last day
  // before March 1st. Clearly a month has not passed by Feb 29th, but has by
  // March 1st.  [02-01, 02-29][...02-31...][03-01, 03-31]
  //                             boundary

  // Get the `from` time within 1 month of `to` to use as one of the boundaries.
  const boundary = Date.UTC(toY, toM, fromD) + fromTimeInDay;

  let lowerBoundary: number, upperBoundary: number;

  if (boundary <= toTime) {
    lowerBoundary = boundary;
    upperBoundary = clampImaginaryDays(
      Date.UTC(toY, toM + 1, fromD) + fromTimeInDay,
      toY,
      toM + 1,
      "up",
    );
  } else {
    upperBoundary = clampImaginaryDays(boundary, toY, toM, "up");
    lowerBoundary = clampImaginaryDays(
      Date.UTC(toY, toM - 1, fromD) + fromTimeInDay,
      toY,
      toM - 1,
      "down",
    );
  }

  const monthLength = upperBoundary - lowerBoundary;
  let relativePosition = (toTime - lowerBoundary) / monthLength;

  // If the boundary (which wholeMonths is based on) is after the toTime, we've
  // completed less than `wholeMonths`, so we're subtracting the relative
  // position rather than adding it, so we invert it.
  if (boundary > toTime) relativePosition = -(1 - relativePosition);

  return wholeMonths + relativePosition;
}

/** Constrain a timestamp to not exceed the upper end of a month.
 *
 * `time` is a timestamp calculated with a day-in-month value that may exceed
 * the number of days in the month specified by `year` and `month`. If it does,
 * it's clamped to be the first ms of the month above when rounding up, or the
 * last ms in `month` when rounding down.
 *
 * Note that `month` is zero-indexed, i.e. Jan is 0.
 * @return `time` unless clamped a described above.
 */
function clampImaginaryDays(
  time: number,
  year: number,
  month: number,
  round: "up" | "down",
): number {
  const nextMonth = Date.UTC(year, month + 1, 1);
  if (time < nextMonth) return time;
  return round === "up" ? nextMonth : nextMonth - 1;
}

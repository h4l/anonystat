import { getUtcTimeSinceMidnight, Unit, utcDifference } from "./_datetime.ts";
import { date } from "./_testing.ts";
import { assertEquals } from "./dev_deps.ts";

Deno.test("getUTCTimeSinceMidnight()", () => {
  const time = "13:14:15.678Z";
  const epoch = new Date(Date.parse(`1970-01-01T${time}`));
  const later = new Date(Date.parse(`2000-01-01T${time}`));

  assertEquals(epoch.getTime(), getUtcTimeSinceMidnight(epoch));
  assertEquals(epoch.getTime(), getUtcTimeSinceMidnight(later));
});

Deno.test("utcUnitDifference()", async (t) => {
  const checks: Record<Unit, [string, string, number][]> = {
    months: [
      ["2001-02-03T04:05:06.000Z", "2001-02-03T04:05:06.000Z", 0],
      // Same time next/prev year
      ["2001-02-03T04:05:06.000Z", "2002-02-03T04:05:06.000Z", 12],
      ["2001-02-03T04:05:06.000Z", "2000-02-03T04:05:06.000Z", -12],
      // Same time next/prev day
      ["2001-02-03T04:05:06.000Z", "2001-03-03T04:05:06.000Z", 1],
      ["2001-02-03T04:05:06.000Z", "2001-01-03T04:05:06.000Z", -1],
      // 1 calendar month, but to is 1ms before from time
      ["2001-02-03T04:05:06.500Z", "2001-03-03T04:05:06.499Z", 0],
      ["2001-02-03T04:05:06.500Z", "2001-01-03T04:05:06.501Z", 0],
      // 1 calendar month, same time
      ["2001-02-03T04:05:06.500Z", "2001-03-03T04:05:06.500Z", 1],
      ["2001-02-03T04:05:06.500Z", "2001-01-03T04:05:06.500Z", -1],
      // 14 calendar month, but to is 1ms before from time
      ["2001-06-03T04:05:06.500Z", "2002-08-03T04:05:06.499Z", 13],
      ["2001-06-03T04:05:06.500Z", "2000-04-03T04:05:06.501Z", -13],
      // 14 calendar month, same time
      ["2001-06-03T04:05:06.500Z", "2002-08-03T04:05:06.500Z", 14],
      ["2001-06-03T04:05:06.500Z", "2000-04-03T04:05:06.500Z", -14],
      // from day not in to month
      ["2001-01-31T04:05:06.500Z", "2001-03-01T04:05:06.500Z", 1],
      ["2001-03-31T04:05:06.500Z", "2001-02-28T04:05:06.500Z", -1],
    ],
    quarters: [
      // same time
      ["2001-02-03T04:05:06.000Z", "2001-02-03T04:05:06.000Z", 0],
      // month before/after
      ["2001-02-03T04:05:06.000Z", "2001-03-03T04:05:06.000Z", 0],
      ["2001-02-03T04:05:06.000Z", "2001-01-03T04:05:06.000Z", 0],
      // exactly 3 months before/after
      ["2001-02-03T04:05:06.000Z", "2001-05-03T04:05:06.000Z", 1],
      ["2001-02-03T04:05:06.000Z", "2000-11-03T04:05:06.000Z", -1],
      // 1ms off 3 months before/after
      ["2001-02-03T04:05:06.500Z", "2001-05-03T04:05:06.499Z", 0],
      ["2001-02-03T04:05:06.500Z", "2000-11-03T04:05:06.501Z", 0],
      // exactly 15 months before/after
      ["2001-02-03T04:05:06.000Z", "2002-05-03T04:05:06.000Z", 5],
      ["2001-02-03T04:05:06.000Z", "1999-11-03T04:05:06.000Z", -5],
      // 1ms off 15 months before/after
      ["2001-02-03T04:05:06.500Z", "2002-05-03T04:05:06.499Z", 4],
      ["2001-02-03T04:05:06.500Z", "1999-11-03T04:05:06.501Z", -4],
    ],
    years: [
      // same time
      ["2001-02-03T04:05:06.000Z", "2001-02-03T04:05:06.000Z", 0],
      // exactly 1 year before/after
      ["2001-02-03T04:05:06.000Z", "2002-02-03T04:05:06.000Z", 1],
      ["2001-02-03T04:05:06.000Z", "2000-02-03T04:05:06.000Z", -1],
      // 1ms off exactly 1 year before/after
      ["2001-02-03T04:05:06.500Z", "2002-02-03T04:05:06.499Z", 0],
      ["2001-02-03T04:05:06.500Z", "2000-02-03T04:05:06.501Z", 0],
    ],

    days: [
      ["2001-02-03T04:05:06.500Z", "2001-02-04T04:05:06.499Z", 0],
      ["2001-02-03T04:05:06.500Z", "2001-02-02T06:05:06.501Z", 0],
      ["2001-02-03T04:05:06Z", "2001-02-05T04:05:06Z", 2],
      ["2001-02-03T04:05:06Z", "2001-02-01T04:05:06Z", -2],
    ],
    hours: [
      ["2001-02-03T04:05:06.500Z", "2001-02-03T05:05:06.499Z", 0],
      ["2001-02-03T04:05:06.500Z", "2001-02-03T03:05:06.501Z", 0],
      ["2001-02-03T04:05:06Z", "2001-02-03T06:05:06Z", 2],
      ["2001-02-03T04:05:06Z", "2001-02-03T02:05:06Z", -2],
    ],
    weeks: [
      ["2001-02-03T04:05:06.500Z", "2001-02-10T04:05:06.499Z", 0],
      ["2001-02-10T04:05:06.500Z", "2001-02-03T04:05:06.501Z", 0],
      ["2001-02-03T04:05:06Z", "2001-02-17T04:05:06Z", 2],
      ["2001-02-17T04:05:06Z", "2001-02-03T04:05:06Z", -2],
    ],
  };

  const params = Object.entries(checks).flatMap(([unit, checks]) =>
    checks.map((check, i) => [unit as Unit, i, check] as const)
  );

  for (const [unit, i, check] of params) {
    await t.step(`${unit}[${i}]`, () => {
      const [from, to, count] = check;
      const diff = utcDifference({
        from: date(from),
        to: date(to),
        unit,
      });
      assertEquals(diff, count);
    });
  }
});

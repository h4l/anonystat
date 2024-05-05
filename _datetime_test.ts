import {
  differenceUtc,
  monthDifferenceUtc,
  timeSinceMidnightUtc,
  Unit,
} from "./_datetime.ts";
import { date } from "./_testing.ts";
import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertGreater,
  assertLess,
} from "./dev_deps.ts";
import { assertUnreachable } from "./_misc.ts";

Deno.test("timeSinceMidnightUtc()", () => {
  const time = "13:14:15.678Z";
  const epoch = new Date(Date.parse(`1970-01-01T${time}`));
  const later = new Date(Date.parse(`2000-01-01T${time}`));

  assertEquals(epoch.getTime(), timeSinceMidnightUtc(epoch));
  assertEquals(epoch.getTime(), timeSinceMidnightUtc(later));
});

interface Matcher<T> {
  assertMatches(value: T): void;
}

class BoundaryCondition implements Matcher<number> {
  constructor(
    readonly target: number,
    readonly direction: "lt" | "gt",
    readonly tolerance: number,
  ) {
    if (tolerance <= 0) throw new Error("tolerance must be positive");
  }

  assertMatches(value: number) {
    const distance = Math.abs(this.target - value);
    switch (this.direction) {
      case "lt": {
        assertLess(value, this.target);
        assertLess(distance, this.tolerance);
        break;
      }
      case "gt": {
        assertGreater(value, this.target);
        assertLess(distance, this.tolerance);
        break;
      }
      default:
        assertUnreachable(this.direction);
    }
  }
}

function lt(target: number, distance: number = 0.01): BoundaryCondition {
  return new BoundaryCondition(target, "lt", distance);
}

function gt(target: number, distance: number = 0.01): BoundaryCondition {
  return new BoundaryCondition(target, "gt", distance);
}

class ApproximatelyEqualMatcher implements Matcher<number> {
  constructor(readonly expected: number, readonly tolerance?: number) {}
  assertMatches(value: number): void {
    assertAlmostEquals(value, this.expected, this.tolerance);
  }
}

function approx(
  target: number,
  tolerance: number | undefined = 0.01,
): ApproximatelyEqualMatcher {
  return new ApproximatelyEqualMatcher(target, tolerance);
}

Deno.test("differenceUtc()", async (t) => {
  const checks: Record<Unit, [string, string, number | Matcher<number>][]> = {
    months: [
      // almost equal
      ["2001-02-03T04:05:06.500Z", "2001-02-03T04:05:06.499Z", lt(0)],
      ["2001-02-03T04:05:06.500Z", "2001-02-03T04:05:06.500Z", 0],
      ["2001-02-03T04:05:06.500Z", "2001-02-03T04:05:06.501Z", gt(0)],
      // Partial month
      ["2001-02-03T04:05:06.500Z", "2001-02-17T04:05:06.500Z", approx(0.5)],
      ["2001-03-03T04:05:06.500Z", "2001-02-17T04:05:06.500Z", approx(-0.5)],
      // several months, same year
      ["2001-02-03T04:05:06.500Z", "2001-05-03T04:05:06.499Z", lt(3)],
      ["2001-02-03T04:05:06.500Z", "2001-05-03T04:05:06.500Z", 3],
      ["2001-02-03T04:05:06.500Z", "2001-05-03T04:05:06.501Z", gt(3)],
      ["2001-05-03T04:05:06.500Z", "2001-02-03T04:05:06.499Z", lt(-3)],
      ["2001-05-03T04:05:06.500Z", "2001-02-03T04:05:06.500Z", -3],
      ["2001-05-03T04:05:06.500Z", "2001-02-03T04:05:06.501Z", gt(-3)],
      // different year
      ["2001-02-03T04:05:06.500Z", "2003-02-03T04:05:06.499Z", lt(24)],
      ["2001-02-03T04:05:06.500Z", "2003-02-03T04:05:06.500Z", 24],
      ["2001-02-03T04:05:06.500Z", "2003-02-03T04:05:06.501Z", gt(24)],
      ["2002-02-03T04:05:06.500Z", "2000-02-03T04:05:06.499Z", lt(-24)],
      ["2002-02-03T04:05:06.500Z", "2000-02-03T04:05:06.500Z", -24],
      ["2002-02-03T04:05:06.500Z", "2000-02-03T04:05:06.501Z", gt(-24)],
      // from day not in to month
      ["2001-01-31T04:05:06.500Z", "2001-03-01T00:00:00.000Z", gt(1)],
      ["2001-01-31T04:05:06.500Z", "2001-02-28T23:59:59.999Z", lt(1)],
      ["2001-03-31T04:05:06.500Z", "2001-03-01T00:00:00.000Z", gt(-1)],
      ["2001-03-31T04:05:06.500Z", "2001-02-28T23:59:59.999Z", lt(-1)],
    ],
    quarters: [
      // same time
      ["2001-02-03T04:05:06.000Z", "2001-02-03T04:05:06.000Z", 0],
      // month before/after
      ["2001-02-03T04:05:06.000Z", "2001-03-03T04:05:06.000Z", approx(1 / 3)],
      ["2001-02-03T04:05:06.000Z", "2001-01-03T04:05:06.000Z", approx(-1 / 3)],
      // exactly 3 months before/after
      ["2001-02-03T04:05:06.000Z", "2001-05-03T04:05:06.000Z", 1],
      ["2001-02-03T04:05:06.000Z", "2000-11-03T04:05:06.000Z", -1],
      // 1ms off 3 months before/after
      ["2001-02-03T04:05:06.500Z", "2001-05-03T04:05:06.501Z", gt(1)],
      ["2001-02-03T04:05:06.500Z", "2001-05-03T04:05:06.499Z", lt(1)],
      ["2001-02-03T04:05:06.500Z", "2000-11-03T04:05:06.501Z", gt(-1)],
      ["2001-02-03T04:05:06.500Z", "2000-11-03T04:05:06.499Z", lt(-1)],
      // exactly 15 months before/after
      ["2001-02-03T04:05:06.000Z", "2002-05-03T04:05:06.000Z", 5],
      ["2001-02-03T04:05:06.000Z", "1999-11-03T04:05:06.000Z", -5],
      // 1ms off 15 months before/after
      ["2001-02-03T04:05:06.500Z", "2002-05-03T04:05:06.501Z", gt(5)],
      ["2001-02-03T04:05:06.500Z", "2002-05-03T04:05:06.499Z", lt(5)],
      ["2001-02-03T04:05:06.500Z", "1999-11-03T04:05:06.501Z", gt(-5)],
      ["2001-02-03T04:05:06.500Z", "1999-11-03T04:05:06.499Z", lt(-5)],
    ],
    years: [
      // same time
      ["2001-02-03T04:05:06.000Z", "2001-02-03T04:05:06.000Z", 0],
      // exactly 1 year before/after
      ["2001-02-03T04:05:06.000Z", "2002-02-03T04:05:06.000Z", 1],
      ["2001-02-03T04:05:06.000Z", "2000-02-03T04:05:06.000Z", -1],
      // 1ms off exactly 1 year before/after
      ["2001-02-03T04:05:06.500Z", "2002-02-03T04:05:06.501Z", gt(1)],
      ["2001-02-03T04:05:06.500Z", "2002-02-03T04:05:06.499Z", lt(1)],
      ["2001-02-03T04:05:06.500Z", "2000-02-03T04:05:06.501Z", gt(-1)],
      ["2001-02-03T04:05:06.500Z", "2000-02-03T04:05:06.499Z", lt(-1)],
    ],

    days: [
      // 0 days
      ["2001-02-03T04:05:06.500Z", "2001-02-03T04:05:06.499Z", lt(0)],
      ["2001-02-03T04:05:06.500Z", "2001-02-03T04:05:06.500Z", 0],
      ["2001-02-03T04:05:06.500Z", "2001-02-03T04:05:06.501Z", gt(0)],
      // 1 day
      ["2001-02-03T04:05:06.500Z", "2001-02-04T04:05:06.499Z", lt(1)],
      ["2001-02-03T04:05:06.500Z", "2001-02-04T04:05:06.500Z", 1],
      ["2001-02-03T04:05:06.500Z", "2001-02-04T04:05:06.501Z", gt(1)],
      // -1 day
      ["2001-02-04T04:05:06.499Z", "2001-02-03T04:05:06.500Z", gt(-1)],
      ["2001-02-04T04:05:06.500Z", "2001-02-03T04:05:06.500Z", -1],
      ["2001-02-04T04:05:06.501Z", "2001-02-03T04:05:06.500Z", lt(-1)],
      // lots
      ["2001-02-03T04:05:06Z", "2002-02-05T04:05:06Z", 367],
      ["2002-02-05T04:05:06Z", "2001-02-03T04:05:06Z", -367],
    ],
    weeks: [
      ["2001-02-03T04:05:06.500Z", "2001-02-17T04:05:06.499Z", lt(2)],
      ["2001-02-03T04:05:06.500Z", "2001-02-17T04:05:06.500Z", 2],
      ["2001-02-03T04:05:06.500Z", "2001-02-17T04:05:06.501Z", gt(2)],
    ],
    hours: [
      ["2001-02-03T04:05:06.500Z", "2001-02-03T02:05:06.499Z", lt(-2)],
      ["2001-02-03T04:05:06.500Z", "2001-02-03T02:05:06.500Z", -2],
      ["2001-02-03T04:05:06.500Z", "2001-02-03T02:05:06.501Z", gt(-2)],
    ],
    minutes: [
      ["2001-02-03T04:05:06.500Z", "2001-02-03T04:03:06.499Z", lt(-2)],
      ["2001-02-03T04:05:06.500Z", "2001-02-03T04:03:06.500Z", -2],
      ["2001-02-03T04:05:06.500Z", "2001-02-03T04:03:06.501Z", gt(-2)],
    ],
    seconds: [
      ["2001-02-03T04:05:06.500Z", "2001-02-03T04:05:04.499Z", lt(-2)],
      ["2001-02-03T04:05:06.500Z", "2001-02-03T04:05:04.500Z", -2],
      ["2001-02-03T04:05:06.500Z", "2001-02-03T04:05:04.501Z", gt(-2)],
    ],
    milliseconds: [
      ["2001-02-03T04:05:06.500Z", "2001-02-03T04:05:06.499Z", -1],
      ["2001-02-03T04:05:06.500Z", "2001-02-03T04:05:06.500Z", 0],
      ["2001-02-03T04:05:06.500Z", "2001-02-03T04:05:06.502Z", 2],
    ],
  };

  const params = Object.entries(checks).flatMap(([unit, checks]) =>
    checks.map((check, i) => [unit as Unit, i, check] as const)
  );

  for (const [unit, i, check] of params) {
    await t.step(`${unit}[${i}]`, () => {
      const [from, to, expected] = check;
      const diff = differenceUtc(date(from), date(to), unit);
      if (typeof expected === "number") assertEquals(diff, expected);
      else expected.assertMatches(diff);
    });
  }
});

Deno.test("monthDifferenceUtc()", async (t) => {
  await t.step("positive 1 month imaginary boundary", () => {
    const from = date("2024-01-31T12:00:00Z");
    const distBefore = monthDifferenceUtc(
      from,
      date("2024-02-29T23:59:59.999Z"),
    );
    assert(distBefore > 0.99);
    assert(distBefore < 1);

    const distOn = monthDifferenceUtc(
      from,
      date("2024-03-01T00:00:00Z"),
    );
    assert(distOn > 1);
    assert(distOn < 1.01);

    const distAfter = monthDifferenceUtc(
      from,
      date("2024-03-01T00:00:00.001Z"),
    );
    assert(distAfter > 1);
    assert(distAfter < 1.01);
  });

  await t.step("negative 1 month imaginary boundary", () => {
    const from = date("2024-03-31T12:00:00Z");

    const distBefore = monthDifferenceUtc(
      from,
      date("2024-03-01T00:00:00Z"),
    );
    assert(distBefore < -0.99);
    assert(distBefore > -1);

    const distOn = monthDifferenceUtc(
      from,
      date("2024-02-29T23:59:59.999Z"),
    );
    // Maybe this should be < -1, but then there wouldn't be a reverse mapping
    // for -1 to a ms value.
    // assertEquals(distOn, -1.0);
    // Actually let's make this < -1.0. This seems more natural, the boundary
    // can be made the first ms of march, which is outside feb, which makes sense
    assert(distOn < -1);
    assert(distOn > -1.01);

    const distAfter = monthDifferenceUtc(
      from,
      date("2024-02-29T23:59:59.998Z"),
    );
    assert(distAfter < -1);
    assert(distAfter > -1.01);

    assert(distAfter < distOn);
  });

  await t.step("positive 1 month boundary ", () => {
    const from = date("2024-01-12T12:00:00.500Z");

    const distBefore = monthDifferenceUtc(
      from,
      date("2024-02-12T12:00:00.499Z"),
    );
    assert(distBefore > 0.99);
    assert(distBefore < 1);

    const distOn = monthDifferenceUtc(
      from,
      date("2024-02-12T12:00:00.500Z"),
    );
    assertEquals(distOn, 1);

    const distAfter = monthDifferenceUtc(
      from,
      date("2024-02-12T12:00:00.501Z"),
    );
    assert(distAfter > 1);
    assert(distAfter < 1.01);
  });

  await t.step("negative 1 month boundary ", () => {
    const from = date("2024-02-12T12:00:00.500Z");

    const distBefore = monthDifferenceUtc(
      from,
      date("2024-01-12T12:00:00.501Z"),
    );
    assert(distBefore < -0.99);
    assert(distBefore > -1);

    const distOn = monthDifferenceUtc(
      from,
      date("2024-01-12T12:00:00.500Z"),
    );
    assertEquals(distOn, -1);

    const distAfter = monthDifferenceUtc(
      from,
      date("2024-01-12T12:00:00.499Z"),
    );
    assert(distAfter < -1);
    assert(distAfter > -1.01);
  });

  await t.step("clamped upper", () => {
    const from = date("2024-01-31T12:00:00.500Z");

    // The lower bound will be 2024-03-31T12:00:00.501Z
    // The upper bound will be 2024-04-31T12:00:00.501Z which is out of range,
    // and thus will be clamped to 2024-05-01T00:00:00Z
    const distAtStart = monthDifferenceUtc(
      from,
      date("2024-03-31T12:00:00.500Z"),
    );
    assertEquals(distAtStart, 2);

    const distAfterStart = monthDifferenceUtc(
      from,
      date("2024-03-31T12:00:00.501Z"),
    );
    assert(distAfterStart > 2);
    assert(distAfterStart < 2.01);

    const distBeforeEnd = monthDifferenceUtc(
      from,
      date("2024-04-30T23:59:59.999Z"),
    );
    assert(distBeforeEnd < 3);
    assert(distBeforeEnd > 2.99);
  });
});

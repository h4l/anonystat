import { assertSuccessful, assertUnsuccessful, date } from "../_testing.ts";
import { z } from "../deps.ts";
import { assert, assertEquals, assertSnapshot } from "../dev_deps.ts";

import {
  EvaluatedDisambiguatedLifetimeExpression,
  formatCompactIsoDateTime,
  formatIsoInterval,
  ParsedIsoIntervalLifetime,
  ValidatedDisambiguatedLifetimeExpression,
} from "./lifetimes.ts";

Deno.test("IsoIntervalLifetime", async (t) => {
  const IsoIntervalLifetime = ParsedIsoIntervalLifetime.transform((arg) =>
    arg.lifetime
  );
  await t.step("optional infinite recurring prefix", () => {
    [
      "R/2001-02-03T04:05:06Z/P1Y",
      "r/2001-02-03T04:05:06Z/P1Y",
      "2001-02-03 04:05:06Z/P1Y",
    ].forEach((interval) => {
      assertEquals(
        IsoIntervalLifetime.parse(interval),
        { unit: "years", count: 1, from: date("2001-02-03T04:05:06Z") },
      );
    });
  });

  await t.step("from milliseconds", () => {
    assertEquals(
      IsoIntervalLifetime.parse("R/2001-02-03T04:05:06.45Z/P1Y"),
      { unit: "years", count: 1, from: date("2001-02-03T04:05:06.45Z") },
    );
  });

  await t.step("from without time", () => {
    assertEquals(
      IsoIntervalLifetime.parse("R/2001-02-03/P1Y"),
      { unit: "years", count: 1, from: date("2001-02-03T00:00:00Z") },
    );
  });

  await t.step("units & durations", () => {
    assertEquals(
      IsoIntervalLifetime.parse("R/2001-02-03T04:05:06Z/P2Y"),
      { unit: "years", count: 2, from: date("2001-02-03T04:05:06Z") },
    );

    assertEquals(
      IsoIntervalLifetime.parse("R/2001-02-03T04:05:06Z/P2M"),
      { unit: "months", count: 2, from: date("2001-02-03T04:05:06Z") },
    );

    assertEquals(
      IsoIntervalLifetime.parse("R/2001-02-03T04:05:06Z/P12W"),
      { unit: "weeks", count: 12, from: date("2001-02-03T04:05:06Z") },
    );

    assertEquals(
      IsoIntervalLifetime.parse("R/2001-02-03T04:05:06Z/P100D"),
      { unit: "days", count: 100, from: date("2001-02-03T04:05:06Z") },
    );

    assertEquals(
      IsoIntervalLifetime.parse("R/2001-02-03T04:05:06Z/PT2H"),
      { unit: "hours", count: 2, from: date("2001-02-03T04:05:06Z") },
    );
  });

  await t.step("multiple periods not supported", () => {
    assert(
      !IsoIntervalLifetime.safeParse("R/2001-02-03T04:05:06Z/P2M1W").success,
    );
    assert(
      !IsoIntervalLifetime.safeParse("R/2001-02-03T04:05:06Z/P2MT1H").success,
    );
  });
});

function joinedErrorMessages(error: z.ZodError): string {
  return error.issues.map((i) => i.message).join("; ");
}

Deno.test("ValidatedDisambiguatedLifetimeExpression", async (t) => {
  await t.step("accepts valid input", () => {
    assertSuccessful(
      ValidatedDisambiguatedLifetimeExpression.safeParse("1 month"),
    );
    assertSuccessful(
      ValidatedDisambiguatedLifetimeExpression.safeParse("R/2024-01-01/P1M"),
    );
  });

  await t.step(
    "rejects invalid simple period with appropriate message",
    async (t) => {
      const result = ValidatedDisambiguatedLifetimeExpression.safeParse(
        "3 seconds",
      );
      assertUnsuccessful(result);
      await assertSnapshot(t, joinedErrorMessages(result.error));
    },
  );

  await t.step(
    "rejects invalid non-simple period with appropriate message",
    async (t) => {
      const result = ValidatedDisambiguatedLifetimeExpression.safeParse(
        "abc/123",
      );
      assertUnsuccessful(result);
      await assertSnapshot(t, joinedErrorMessages(result.error));
    },
  );
});

Deno.test("formatCompactIsoDateTime()", () => {
  assertEquals(
    formatCompactIsoDateTime(date("2024-02-03T00:00:00Z")),
    "2024-02-03",
  );
  assertEquals(
    formatCompactIsoDateTime(date("2024-02-03T00:00:00.500Z")),
    "2024-02-03T00:00:00.500Z",
  );
});

Deno.test("formatIsoInterval()", () => {
  assertEquals(
    formatIsoInterval({ from: 0, unit: "hours", count: 2 }),
    "R/1970-01-01/PT2H",
  );
  assertEquals(
    formatIsoInterval({ unit: "hours", count: 2 }),
    "R/1970-01-01/PT2H",
  );
  assertEquals(
    formatIsoInterval({
      from: date("2024-02-03T04:05:06.500Z"),
      unit: "weeks",
      count: 2,
    }),
    "R/2024-02-03T04:05:06.500Z/P2W",
  );
});

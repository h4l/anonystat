import { assert, z } from "../deps.ts";
import { Lifetime, TimeUnit } from "../anonymisation.ts";

const UtcDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: "Not a YYYY-MM-DD date",
}).transform((dt, ctx) => {
  const timestamp = Date.parse(`${dt}T00:00:00Z`);
  if (Number.isNaN(timestamp)) {
    ctx.addIssue({ code: "invalid_date", message: "Not a YYYY-MM-DD date" });
    return z.NEVER;
  }
  return new Date(timestamp);
});

const UtcDateTime = z.string().datetime().pipe(z.coerce.date());

const UtcDateOrDateTime = z.string().transform((arg, ctx) => {
  // Manually union UtcDateTime and UtcDate because getting good error messages
  // out of z.union is somewhere between too much effort and impossible.
  for (const fmt of [UtcDate, UtcDateTime]) {
    const result = fmt.safeParse(arg);
    if (result.success) return result.data;
  }
  ctx.addIssue({
    code: "invalid_date",
    message: "Not a YYYY-MM-DD date or a YYYY-MM-DDTHH:MM:SSZ date",
  });
  return z.NEVER;
});

const possibleTimeUnitMessage = Object.values(TimeUnit.Enum).join(", ");

function parseLaxTimeUnit(value: string): TimeUnit | undefined {
  const match = /^(second|minute|hour|day|week|month|quarter|year)s?$/i.exec(
    value,
  );
  if (!match) return undefined;
  return `${match[1].toLowerCase()}s` as TimeUnit;
}

const LaxTimeUnit = z.string().transform((s, ctx) => {
  const timeUnit = parseLaxTimeUnit(s);
  if (!timeUnit) {
    ctx.addIssue({
      code: "invalid_string",
      message:
        `Value must be one of ${possibleTimeUnitMessage} (ignoring case, with or without 's')`,
      validation: "regex",
    });
    return z.NEVER;
  }
  return timeUnit;
});

export const DEFAULT_LIFETIME_COUNT = 1;
export const LifetimeObject = z.object({
  count: z.number().int().nonnegative().default(DEFAULT_LIFETIME_COUNT),
  unit: LaxTimeUnit,
  from: UtcDateOrDateTime.optional(),
});
export type LifetimeObject = z.infer<typeof LifetimeObject>;

type ParsedLifetimeExpression = {
  expr: string;
  lifetime: z.infer<typeof LifetimeObject>;
};

export const ParsedIsoIntervalLifetime = z.string().transform(
  (val, ctx): ParsedLifetimeExpression => {
    const match =
      /^(?:R\/)?(\d{4}-\d{2}-\d{2})([T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?\/P(?:(?:([1-9]\d*)([YMWD]))|(?:T([1-9]\d*)H))$/i
        .exec(val);
    if (!match) {
      ctx.addIssue({
        code: "invalid_string",
        validation: "regex",
        message: `Value is not an ISO 8601 interval with a single period`,
      });
      return z.NEVER;
    }
    assert(match.length === 6);
    const [_, date, time, calCount, calUnit, timeCount] = match;

    const from = Date.parse(`${date}${time || "T00:00:00Z"}`);
    if (Number.isNaN(from)) {
      ctx.addIssue({
        code: "invalid_date",
        "message": "Interval's date/time is invalid",
      });
      return z.NEVER;
    }

    let unit: TimeUnit;
    let count: number;
    if (calCount && timeCount) {
      ctx.addIssue({
        code: "invalid_string",
        validation: "regex",
        message: `Value is not an ISO 8601 interval with a single period`,
      });
      return z.NEVER;
    } else if (calCount) {
      const units = { Y: "years", M: "months", W: "weeks", D: "days" } as const;
      unit = units[calUnit.toUpperCase() as keyof typeof units];
      assert(unit);
      count = Number.parseInt(calCount);
    } else {
      assert(timeCount);
      count = Number.parseInt(timeCount);
      unit = "hours";
    }
    return { expr: val, lifetime: { unit, count, from: new Date(from) } };
  },
);

/** A string that parses to a Lifetime, like "day" "1 month", or "2 quarters". */
export const ParsedSimpleLifetimeExpression = z.string().transform(
  (expr, ctx): ParsedLifetimeExpression => {
    const match = /^(?:([1-9]\d*)\s*)?([a-zA-Z]+)$/.exec(expr.trim());
    if (match) {
      const count = Number.parseInt(match[1] || "1");
      const unit = parseLaxTimeUnit(match[2]);
      if (unit) {
        const lifetime: z.infer<typeof LifetimeObject> = { count, unit };
        return { expr, lifetime };
      }
    }
    ctx.addIssue({
      code: "invalid_string",
      validation: "regex",
      message:
        `Value must be "[<number>] <unit>" where number is 1+ and unit is one of ${possibleTimeUnitMessage} (ignoring case, with or without 's')`,
    });
    return z.NEVER;
  },
);

export const ParsedDisambiguatedLifetimeExpression = z.string().transform(
  (arg, ctx): ParsedLifetimeExpression => {
    if (/^\s*\d*\s*\w+\s*$/.test(arg)) {
      const result = ParsedSimpleLifetimeExpression.safeParse(arg, ctx);
      if (!result.success) {
        for (const issue of result.error.issues) ctx.addIssue(issue);
      } else {
        return result.data;
      }
    } else {
      const result = ParsedIsoIntervalLifetime.safeParse(arg, ctx);
      if (!result.success) {
        for (const issue of result.error.issues) ctx.addIssue(issue);
      } else {
        return result.data;
      }
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'Value must be an interval like "2 weeks" or an ISO interval with a start time, like "R/2024-01-01/P2W"',
    });
    return z.NEVER;
  },
);

export const EvaluatedDisambiguatedLifetimeExpression =
  ParsedDisambiguatedLifetimeExpression
    .transform(
      (r) => r.lifetime,
    );
export const ValidatedDisambiguatedLifetimeExpression =
  ParsedDisambiguatedLifetimeExpression
    .transform(
      (r) => r.expr,
    );

/** Format a Date in ISO format a a date-only if it's midnight UTC, otherwise a datetime. */
export function formatCompactIsoDateTime(value: Date): string {
  const datetime = value.toISOString();
  const date = datetime.split(/[ T]/)[0];
  const isMidnightUtc = Date.parse(date) === value.getTime();
  return isMidnightUtc ? date : datetime;
}

/** Get the ISO interval representation of a Lifetime. */
export function formatIsoInterval(
  lifetime: Lifetime,
): string {
  const fromDate = lifetime.from instanceof Date
    ? lifetime.from
    : new Date(lifetime.from ?? 0);
  const from = formatCompactIsoDateTime(fromDate);

  let period: string;
  if (lifetime.unit === "hours") period = `PT${lifetime.count}H`;
  else {
    const isoUnit = lifetime.unit.substring(0, 1).toUpperCase();
    period = `P${lifetime.count}${isoUnit}`;
  }

  return `R/${from}/${period}`;
}

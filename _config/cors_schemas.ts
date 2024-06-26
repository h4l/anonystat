import { Wildcard } from "../_cors.ts";
import { hasMessage, Result } from "../_misc.ts";
import { z } from "../deps.ts";
import { ParsedSimpleLifetimeExpression } from "./lifetimes.ts";

const MaxAgeSeconds = z.number().int().nonnegative();
const MaxAgeExpression = ParsedSimpleLifetimeExpression.transform(
  (arg, ctx): number => {
    switch (arg.lifetime.unit) {
      case "hours":
        return arg.lifetime.count * 60 * 60;
      case "minutes":
        return arg.lifetime.count * 60;
      case "seconds":
        return arg.lifetime.count;
      default:
        ctx.addIssue({
          code: "custom",
          message: "Unit must be hours, minutes or seconds",
        });
        return z.NEVER;
    }
  },
);

export const MaxAge = MaxAgeSeconds.or(MaxAgeExpression);

type SlashDelimitedRegexStringParseError = { code: "bad-delimeter" } | {
  code: "invalid-regex";
  reason: string;
};

export function formatSlashDelimitedRegexString(regexp: RegExp): string {
  // Unlike javascript regexp literals, we don't escape / inside the regex.
  // Maybe we should for consistency? We only use the slashes to disambiguate
  // regexp from literal strings, not to parse them from a larger text, so we
  // can rely on the slashes being at the start & end of a known string.
  return `/${regexp.source}/`;
}

/** Parse a regex delimited by `/`, e.g. `/^foo$/`.*/
function parseSlashDelimitedRegexString(
  val: string,
): Result<
  RegExp,
  SlashDelimitedRegexStringParseError
> {
  if (!(val.at(0) === "/" && val.at(-1) === "/")) {
    return { success: false, error: { code: "bad-delimeter" } };
  }
  try {
    return {
      success: true,
      data: new RegExp(val.substring(1, val.length - 1)),
    };
  } catch (e) {
    const reason = hasMessage(e) ? e.message : String(e);
    return { success: false, error: { code: "invalid-regex", reason } };
  }
}

function formatSlashDelimitedRegexStringParseError(
  error: SlashDelimitedRegexStringParseError,
): string {
  return error.code === "bad-delimeter"
    ? "Regular expressions must start and end with '/'"
    : error.reason;
}

export const SlashDelimitedRegexString = z.string().transform(
  (val, ctx): RegExp => {
    const result = parseSlashDelimitedRegexString(val);
    if (result.success) return result.data;
    ctx.addIssue({
      code: "custom",
      message: formatSlashDelimitedRegexStringParseError(result.error),
    });
    return z.NEVER;
  },
);

function parseOriginShorthand(val: string): Result<string, "invalid-origin"> {
  // allow https:// to be omitted
  const resolvedVal = /^https?:\/\//i.test(val) ? val : `https://${val}`;

  let url: URL | undefined;
  try {
    url = new URL(resolvedVal);
  } catch (_) {
    url = undefined;
  }

  // Value is a valid origin if the parsed URL's origin is equal to the val.
  // i.e. the value does not contain anything beyond the origin component.
  if (!url || url.origin !== resolvedVal) {
    return { success: false, error: "invalid-origin" };
  }
  return { success: true, data: resolvedVal };
}

type ParsedOriginsExpression = { expr: string; origins: RegExp | string[] };

function formatOriginShorthandError(origin: string): string {
  return `Origin values must be of the form [https?://]host.name, ${
    JSON.stringify(origin)
  } is not valid.`;
}

export const OriginsExpression = z.string().transform(
  (val, ctx): ParsedOriginsExpression => {
    if (val.startsWith("/")) {
      const result = parseSlashDelimitedRegexString(val);
      if (result.success) return { expr: val, origins: result.data };
      ctx.addIssue({
        code: "custom",
        message: formatSlashDelimitedRegexStringParseError(result.error),
      });
      return z.NEVER;
    }

    // We use an empty list of origins to disable CORS, so we need to treat the
    // empty string  as an empty list, not [""].
    if (val === "") return { expr: val, origins: [] };

    const results = val.split(",").map((o) =>
      [o, parseOriginShorthand(o)] as const
    );
    const parsedOrigins: string[] = [];
    for (const [origin, result] of results) {
      if (!result.success) {
        ctx.addIssue({
          code: "custom",
          message: formatOriginShorthandError(origin),
        });
        return z.NEVER;
      }
      parsedOrigins.push(result.data);
    }
    return { expr: val, origins: parsedOrigins };
  },
);

export const EvaluatedOriginsExpression = OriginsExpression.transform((val) =>
  val.origins
);

export const OriginShorthand = z.string().transform((arg, ctx): string => {
  const result = parseOriginShorthand(arg);
  if (!result.success) {
    ctx.addIssue({ code: "custom", message: formatOriginShorthandError(arg) });
    return z.NEVER;
  }
  return result.data;
});

export const WildcardSchema = z.literal("*").transform((): Wildcard =>
  Wildcard
);

import { Wildcard } from "../_cors.ts";
import { GA4MP_URL } from "../constants.ts";
import { equal, z } from "../deps.ts";
import { formatSlashDelimitedRegexString } from "./cors_schemas.ts";
import {
  Config,
  Cors,
  DataStreamInOut,
  DataStreamInOutShorthand,
  DEFAULT_CORS_MAX_AGE,
  DEFAULT_EXISTING_POLICY,
  DEFAULT_HOSTNAME,
  DEFAULT_LIFETIME_UNIT,
  DEFAULT_PORT,
  ForwarderConfig,
  UserIdConfig,
} from "./json_schema.ts";
import {
  DEFAULT_LIFETIME_COUNT,
  formatCompactIsoDateTime,
  LifetimeObject,
} from "./lifetimes.ts";

function omitDefault<T>(value: T, default_: T): T | undefined {
  return value === default_ ? undefined : value;
}

function simplifyCors(
  value: Cors = {},
  base: Cors = {},
): z.input<typeof Cors> | undefined {
  const result: z.input<typeof Cors> = {};

  if (
    !equal(value.allow_origin, base.allow_origin) &&
    value.allow_origin !== undefined
  ) {
    result.allow_origin = value.allow_origin === Wildcard
      ? "*"
      : value.allow_origin instanceof RegExp
      ? formatSlashDelimitedRegexString(value.allow_origin)
      : Array.isArray(value.allow_origin)
      ? value.allow_origin.map((o) =>
        o.startsWith("https://") ? o.substring(8) : o
      )
      : value.allow_origin;
  }

  if (
    value.max_age !== (base.max_age ?? DEFAULT_CORS_MAX_AGE) &&
    value.max_age !== undefined
  ) {
    result.max_age = value.max_age;
  }

  return result.allow_origin === undefined && result.max_age === undefined
    ? undefined
    : result;
}

function simplifyDataStreamConfig(
  value: z.infer<typeof DataStreamInOut>,
  base: { cors?: Cors },
): z.input<typeof DataStreamInOutShorthand> {
  const cors = simplifyCors(value.in.cors, base.cors);
  if (
    value.in.api_secret === value.out.api_secret &&
    value.in.measurement_id === value.out.measurement_id
  ) {
    return {
      api_secret: value.in.api_secret,
      measurement_id: value.in.measurement_id,
      ...(cors && { cors }),
    };
  }
  return {
    in: {
      api_secret: value.in.api_secret,
      measurement_id: value.in.measurement_id,
      ...(cors && { cors }),
    },
    out: { ...value.out },
  };
}

function simplifyLifetimeObject(
  value: z.infer<typeof LifetimeObject>,
): z.input<typeof LifetimeObject> | string | undefined {
  let from: string | undefined;
  if (value.from !== undefined && value.from.getTime() !== 0) {
    from = formatCompactIsoDateTime(value.from);
  }

  const count = omitDefault(value.count, DEFAULT_LIFETIME_COUNT);
  const countIsPlural = value.count > 1;
  const unit: string = countIsPlural
    ? value.unit
    : value.unit.substring(0, value.unit.length - 1); // remove plural 's'

  if (value.unit === DEFAULT_LIFETIME_UNIT && !from && !count) return undefined;
  else if (from) return { count, unit, from };
  // prefer "1 month" over "month"
  return `${count || DEFAULT_LIFETIME_COUNT} ${unit}`;
}

function simplifyUserIdConfig(
  value: z.infer<typeof UserIdConfig>,
): z.input<typeof UserIdConfig> | undefined {
  const lifetime = simplifyLifetimeObject(value.lifetime);

  const existing = omitDefault(value.existing, DEFAULT_EXISTING_POLICY);
  if (lifetime || value.scrambling_secret || existing) {
    return { existing, lifetime, scrambling_secret: value.scrambling_secret };
  }
  return undefined;
}

function mergeOverrides<T extends unknown>(
  base: T | undefined,
  overrides: Array<T | undefined>,
): T | undefined {
  const allOverridesEqual = overrides.every((o) =>
    equal(o ?? base, overrides[0] ?? base)
  );
  if (allOverridesEqual) return overrides[0] ?? base;

  const anyOverrideDependsOnBase = overrides.some((o) =>
    equal(base, o ?? base)
  );
  if (anyOverrideDependsOnBase) return base;
  return undefined;
}

/** Get the base cors value to use, given the data_stream cors overrides.
 *
 * - If all the overrides resolve to the same value, the value is propagated up
 *    to the base cors so that the duplicate values in each data stream will be
 *    eliminated when simplifying.
 * - If all data_stream values override the base value, we drop the base value
 *    (as it has no effect)
 * -
 */
function mergeCorsOverrides(
  baseCors: Cors = {},
  dataStreamInCors: Array<Cors | undefined>,
): Cors {
  return {
    allow_origin: mergeOverrides(
      baseCors.allow_origin,
      dataStreamInCors.map((c) => c?.allow_origin),
    ),
    max_age: mergeOverrides(
      baseCors.max_age,
      dataStreamInCors.map((c) => c?.max_age),
    ),
  };
}

function simplifyForwarderConfig(
  value: z.infer<typeof ForwarderConfig>,
): z.input<typeof ForwarderConfig> {
  const mergedCors = mergeCorsOverrides(
    value.cors,
    value.data_stream.map((ds) => ds.in.cors),
  );

  const cors = simplifyCors(mergedCors);
  const data_stream = value.data_stream.map((ds) =>
    simplifyDataStreamConfig(ds, { cors: mergedCors })
  );
  return {
    data_stream: data_stream.length === 1 ? data_stream[0] : data_stream,
    user_id: value.user_id ? simplifyUserIdConfig(value.user_id) : undefined,
    allow_debug: omitDefault(value.allow_debug, false),
    destination: omitDefault(value.destination, GA4MP_URL),
    ...(cors && { cors }),
  };
}

function simplifyListen(
  value: Config["listen"],
): z.input<typeof Config>["listen"] {
  const hostname = omitDefault(value.hostname, DEFAULT_HOSTNAME);
  const port = omitDefault(value.port, DEFAULT_PORT);
  if (hostname === undefined && port === undefined) {
    return undefined;
  }
  return { hostname, port };
}

/** Get a simplified representation of a config.
 *
 * Lists and default values are removed where possible.
 */
export function simplifyConfig(
  config: Config,
): z.input<typeof Config> {
  const forward = config.forward.map(simplifyForwarderConfig);
  return {
    forward: forward.length === 1 ? forward[0] : forward,
    listen: simplifyListen(config.listen),
  };
}

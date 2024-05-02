import { GA4MP_URL } from "../constants.ts";
import { z } from "../deps.ts";
import {
  Config,
  DataStreamInOut,
  DataStreamInOutShorthand,
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

function simplifyDataStreamConfig(
  value: z.infer<typeof DataStreamInOut>,
): z.input<typeof DataStreamInOutShorthand> {
  if (
    value.in.api_secret === value.out.api_secret &&
    value.in.measurement_id === value.out.measurement_id
  ) {
    return {
      api_secret: value.in.api_secret,
      measurement_id: value.in.measurement_id,
    };
  }
  return { in: { ...value.in }, out: { ...value.out } };
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

function simplifyForwarderConfig(
  value: z.infer<typeof ForwarderConfig>,
): z.input<typeof ForwarderConfig> {
  const data_stream = value.data_stream.map(simplifyDataStreamConfig);
  return {
    data_stream: data_stream.length === 1 ? data_stream[0] : data_stream,
    user_id: value.user_id ? simplifyUserIdConfig(value.user_id) : undefined,
    allow_debug: omitDefault(value.allow_debug, false),
    destination: omitDefault(value.destination, GA4MP_URL),
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

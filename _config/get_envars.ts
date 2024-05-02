import { type Error, type Result } from "../_misc.ts";
import { Config } from "./json_schema.ts";
import { simplifyConfig } from "./simplify.ts";
import { ConfigEnv } from "./env_schema.ts";
import { formatIsoInterval } from "./lifetimes.ts";

export type GetEnvarsError =
  | Error<"multiple-forward">
  | Error<"multiple-data-stream">;

/** Get the environment variable representation of a config, if possible. */
export function getEnvars(config: Config): Result<ConfigEnv, GetEnvarsError> {
  const simplified = simplifyConfig(config);
  if (Array.isArray(simplified.forward)) {
    return { success: false, error: { name: "multiple-forward" } };
  }
  const forward = simplified.forward;
  if (Array.isArray(forward.data_stream)) {
    return { success: false, error: { name: "multiple-data-stream" } };
  }
  const data_stream = forward.data_stream;

  // Lifetimes with from dates are kept as objects for JSON output, but we
  // need a string, so we format them as an ISO interval.
  const lifetime = typeof forward.user_id?.lifetime === "object"
    ? formatIsoInterval(config.forward[0].user_id.lifetime)
    : forward.user_id?.lifetime;

  const env: ConfigEnv = {
    ANONYSTAT_USER_ID_LIFETIME: lifetime,
    ANONYSTAT_USER_ID_EXISTING: forward.user_id?.existing,
    ANONYSTAT_USER_ID_SCRAMBLING_SECRET: forward.user_id?.scrambling_secret ??
      undefined,
    ANONYSTAT_ALLOW_DEBUG: forward.allow_debug,
    ANONYSTAT_DESTINATION: forward.destination,
    ANONYSTAT_LISTEN_HOSTNAME: simplified.listen?.hostname,
    ANONYSTAT_LISTEN_PORT: simplified.listen?.port,
  };

  if ("measurement_id" in data_stream) {
    env.ANONYSTAT_DATA_STREAM_MEASUREMENT_ID = data_stream.measurement_id;
    env.ANONYSTAT_DATA_STREAM_API_SECRET = data_stream.api_secret;
  } else {
    env.ANONYSTAT_DATA_STREAM_IN_MEASUREMENT_ID = data_stream.in.measurement_id;
    env.ANONYSTAT_DATA_STREAM_IN_API_SECRET = data_stream.in.api_secret;
    env.ANONYSTAT_DATA_STREAM_OUT_MEASUREMENT_ID =
      data_stream.out.measurement_id;
    env.ANONYSTAT_DATA_STREAM_OUT_API_SECRET = data_stream.out.api_secret;
  }

  return { success: true, data: env };
}

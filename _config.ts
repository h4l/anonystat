import { HandlerRequest, Matcher, Responder } from "./requests.ts";
import {
  createCollectRequestMatcher,
  DefaultCollectRequestForwardingRule,
  MeasurementIdCollectRequestMatcher,
} from "./rules.ts";
import { oneOrMore } from "./_zod.ts";

import { JsonValue, parseJsonc, z } from "./deps.ts";
import { DefaultRequestForwarder, RequestMatchError } from "./proxy.ts";
import { defaultProxyOptions } from "./default.ts";
import { assertUnreachable, type Error, type Result } from "./_misc.ts";
import { assert } from "./dev_deps.ts";

const NonEmptyString = z.string().min(1);
const DestinationUrl = z.string().url();
const DomainName = z.string().regex(
  /^(([a-z0-9]|[a-z0-9][a-z0-9\-]*[a-z0-9])\.)*([a-z0-9]|[a-z0-9][a-z0-9\-]*[a-z0-9])$/i,
  { message: "Not a valid hostname" },
);
const Host = z.string().ip().or(DomainName);
const Port = z.number().int().nonnegative();
const ScramblerKey = z.string().min(12, {
  message:
    "Scrambler key must be at least 12 characters, ideally more like 48+. (To protect users' privacy it must provide enough randomness to not be brute-force guessable.)",
});

const DataStreamCredentials = z.object({
  measurement_id: NonEmptyString,
  api_secret: NonEmptyString,
});

const DataStreamInOut = z.object({
  in: DataStreamCredentials,
  out: DataStreamCredentials,
});
type DataStreamInOut = z.infer<typeof DataStreamInOut>;

export const DataStreamInOutShorthand = DataStreamCredentials.transform((
  ds,
): DataStreamInOut => ({ in: { ...ds }, out: { ...ds } })).or(DataStreamInOut);

export const ForwarderConfig = z.object({
  data_stream: oneOrMore(DataStreamInOutShorthand),
  destination: DestinationUrl.optional(),
  allow_debug: z.boolean().optional().default(false),
  secret_scrambler_key: ScramblerKey,
});
type ForwarderConfig = z.infer<typeof ForwarderConfig>;

const ListenConfig = z.object({
  port: Port.optional(),
  hostname: Host.optional(),
});

export const Config = z.object({
  forward: oneOrMore(ForwarderConfig),
  listen: ListenConfig.optional(),
});
export type Config = z.infer<typeof Config>;
type ConfigInput = z.input<typeof Config>;

export function createForwarder(
  config: Config,
): Matcher<HandlerRequest, RequestMatchError, Responder> {
  const rules = config.forward.flatMap((forwarder) => {
    const requestForwarder = new DefaultRequestForwarder(defaultProxyOptions);
    return forwarder.data_stream.map((data_stream) => {
      const rule = DefaultCollectRequestForwardingRule.create({
        allowedApiSecret: data_stream.in.api_secret,
        destination: {
          measurement_id: data_stream.out.measurement_id,
          api_secret: data_stream.out.api_secret,
          endpoint: forwarder.destination,
        },
        allowDebug: forwarder.allow_debug,
        forwarder: requestForwarder,
      });
      return [data_stream.in.measurement_id, rule] as const;
    });
  });

  return createCollectRequestMatcher(
    new MeasurementIdCollectRequestMatcher(rules),
  );
}

function isTrue(value: string): boolean {
  return value.toLowerCase() === "true";
}

const EmptyStringAsUndefined = z.string().transform((s) => s ? s : undefined);
export const EnvBool = z.string().transform(isTrue);

/** The symbolic names of locations a config can be loaded from. */
export const ConfigSource = z.enum(["env", "json", "file"]);
export type ConfigSource = z.infer<typeof ConfigSource>;
const EnvConfigSource = EmptyStringAsUndefined.pipe(ConfigSource.optional())
  .optional();

const DecimalIntFromString = z.string().regex(/^(0|[1-9][0-9]*)$/, {
  message: "Not a decimal integer",
}).transform(
  (i) => parseInt(i),
);

/** Names of config envars used individually. */
export enum ConfigEnvars {
  show_config = "ANONYSTAT_SHOW_CONFIG",
  config_source = "ANONYSTAT_CONFIG_SOURCE",
  config = "ANONYSTAT_CONFIG",
  config_file = "ANONYSTAT_CONFIG_FILE",
}

const _ConfigEnv = z.object({
  ANONYSTAT_DATA_STREAM_MEASUREMENT_ID: EmptyStringAsUndefined.optional(),
  ANONYSTAT_DATA_STREAM_IN_MEASUREMENT_ID: EmptyStringAsUndefined.optional(),
  ANONYSTAT_DATA_STREAM_OUT_MEASUREMENT_ID: EmptyStringAsUndefined.optional(),
  ANONYSTAT_DATA_STREAM_API_SECRET: EmptyStringAsUndefined.optional(),
  ANONYSTAT_DATA_STREAM_IN_API_SECRET: EmptyStringAsUndefined.optional(),
  ANONYSTAT_DATA_STREAM_OUT_API_SECRET: EmptyStringAsUndefined.optional(),
  ANONYSTAT_DESTINATION: EmptyStringAsUndefined.pipe(DestinationUrl).optional(),
  ANONYSTAT_ALLOW_DEBUG: EmptyStringAsUndefined.pipe(EnvBool).optional(),
  ANONYSTAT_SECRET_SCRAMBLER_KEY: EmptyStringAsUndefined.pipe(ScramblerKey),
  ANONYSTAT_LISTEN_PORT: EmptyStringAsUndefined.pipe(DecimalIntFromString).pipe(
    Port,
  ).optional(),
  ANONYSTAT_LISTEN_HOSTNAME: EmptyStringAsUndefined.pipe(Host).optional(),
});
type ConfigEnvName = keyof typeof _ConfigEnv.shape;
const ConfigEnv = _ConfigEnv.superRefine((val, ctx) => {
  const ensurePresent = (name: keyof typeof val, other: keyof typeof val) => {
    if (val[other] !== undefined || val[name] !== undefined) return;
    ctx.addIssue({
      code: z.ZodIssueCode.invalid_type,
      expected: "string",
      received: "undefined",
      path: [name],
      message: `Required because ${other} is not set`,
    });
  };
  ensurePresent(
    "ANONYSTAT_DATA_STREAM_IN_MEASUREMENT_ID",
    "ANONYSTAT_DATA_STREAM_MEASUREMENT_ID",
  );
  ensurePresent(
    "ANONYSTAT_DATA_STREAM_OUT_MEASUREMENT_ID",
    "ANONYSTAT_DATA_STREAM_MEASUREMENT_ID",
  );
  ensurePresent(
    "ANONYSTAT_DATA_STREAM_IN_API_SECRET",
    "ANONYSTAT_DATA_STREAM_API_SECRET",
  );
  ensurePresent(
    "ANONYSTAT_DATA_STREAM_OUT_API_SECRET",
    "ANONYSTAT_DATA_STREAM_API_SECRET",
  );
});
export type ConfigEnv = z.infer<typeof ConfigEnv>;

/** Where a config was loaded from. */
export type Source =
  | { source: typeof ConfigSource.Enum.env }
  | { source: typeof ConfigSource.Enum.json }
  | { source: typeof ConfigSource.Enum.file; path: string };
export type LoadConfigError =
  | Error<"config-jsonc-invalid", { message: string } & Source>
  | Error<"config-file-unreadable", { message: string } & Source>
  | Error<"config-value-invalid", { zodError: z.ZodError } & Source>
  | Error<"config-envar-invalid", { messages: string[]; envar: string }>
  | Error<
    "config-envars-invalid",
    { envarErrors: z.typeToFlattenedError<ConfigEnv>["fieldErrors"] }
  >;

function isNonArrayOneOrMoreSubError(error: z.ZodError): boolean {
  if (error.issues.length !== 1) return false;
  const issue = error.issues[0];
  return issue.code === z.ZodIssueCode.invalid_type &&
    issue.expected === "array";
}

function flattenOneOrMoreInvalidUnion(
  issue: z.ZodIssueOptionalMessage,
): { message: string } | undefined {
  // When oneOrMore() parses an invalid non-array we get a invalid_union
  // with an unhelpful generic error message. One branch of the union is a
  // type error saying the non-array value is not an array (duh) with the other
  // side containing the actual error. This union hides the actual error, so we
  // replace the union with the actual error.
  if (issue.code !== z.ZodIssueCode.invalid_union) return;
  if (issue.unionErrors.length !== 2) return;
  const nonArrayTypeErrors = issue.unionErrors.filter((e) =>
    !isNonArrayOneOrMoreSubError(e)
  );
  if (nonArrayTypeErrors.length !== 1) return;
  return {
    message: nonArrayTypeErrors[0].issues.map((i) => i.message).join("; "),
  };
}

/** Customise Zod error messages. */
export const customErrorMap: z.ZodErrorMap = (issue, ctx) => {
  if (issue.code === z.ZodIssueCode.invalid_type) {
    if (issue.received === "undefined") {
      return { message: "Required but not set" };
    }
  }

  // FIXME: debug this, not working
  const oneOrMoreUnionMessage = flattenOneOrMoreInvalidUnion(issue);
  if (oneOrMoreUnionMessage) return oneOrMoreUnionMessage;

  return { message: ctx.defaultError };
};

/** Read raw envar values for ConfigEnv keys. */
function getConfigEnvValues(
  env: EnvMap,
): Partial<Record<ConfigEnvName, string>> {
  const values: Partial<Record<ConfigEnvName, string>> = {};
  for (const key in _ConfigEnv.shape) {
    values[key as ConfigEnvName] = env.get(key);
  }
  return values;
}

/** Something providing access to environment variables. */
export type EnvMap = { get: (typeof Deno.env)["get"] };

/** Read and parse an envar with a zod schema. */
function parseEnvar<SchemaT extends z.ZodTypeAny>(
  env: EnvMap,
  envar: ConfigEnvars,
  schema: SchemaT,
): Result<z.infer<SchemaT>, LoadConfigError> {
  const parse = schema.safeParse(env.get(envar));
  if (!parse.success) {
    return {
      success: false,
      error: {
        name: "config-envar-invalid",
        envar,
        messages: parse.error.issues.map((i) => i.message),
      },
    };
  }
  return parse;
}

function getSource(env: EnvMap): Result<ConfigSource, LoadConfigError> {
  const configSourceParse = parseEnvar(
    env,
    ConfigEnvars.config_source,
    EnvConfigSource,
  );
  if (!configSourceParse.success) return configSourceParse;
  const source: ConfigSource = configSourceParse.data ??
    (env.get(ConfigEnvars.config)
      ? ConfigSource.Enum.json
      : env.get(ConfigEnvars.config_file)
      ? ConfigSource.Enum.file
      : ConfigSource.Enum.env);
  return { success: true, data: source };
}

export type LoadConfigOptions = { env?: EnvMap };

/** Load & validate configuration from environment variables. */
export async function loadConfig(
  { env: rawEnv = Deno.env }: LoadConfigOptions = {},
): Promise<Result<Config, LoadConfigError>> {
  const configSourceResult = getSource(rawEnv);
  if (!configSourceResult.success) return configSourceResult;
  const configSource = configSourceResult.data;
  switch (configSource) {
    case ConfigSource.Enum.env:
      return loadConfigEnv(rawEnv);
    case ConfigSource.Enum.json: {
      const envJsoncText = rawEnv.get(ConfigEnvars.config);
      if (!envJsoncText) {
        return {
          success: false,
          error: {
            name: "config-envar-invalid",
            envar: ConfigEnvars.config,
            messages: [
              `No JSON value is set but config source is '${ConfigSource.Enum.json}'`,
            ],
          },
        };
      }
      return loadConfigJsoncText(envJsoncText, {
        source: ConfigSource.Enum.json,
      });
    }
    case ConfigSource.Enum.file: {
      const path = rawEnv.get(ConfigEnvars.config_file);
      if (!path) {
        return {
          success: false,
          error: {
            name: "config-envar-invalid",
            envar: ConfigEnvars.config_file,
            messages: [
              `No file path is set but config source is '${ConfigSource.Enum.file}'`,
            ],
          },
        };
      }
      return await loadConfigJsoncFile(path);
    }
    default: {
      assertUnreachable(configSource);
    }
  }
}

async function loadConfigJsoncFile(
  path: string,
): Promise<Result<Config, LoadConfigError>> {
  let jsoncText: string;
  try {
    jsoncText = await Deno.readTextFile(path);
  } catch (e) {
    if (!(e instanceof Error)) throw e;
    return {
      success: false,
      error: {
        name: "config-file-unreadable",
        message: e.message,
        source: ConfigSource.Enum.file,
        path,
      },
    };
  }
  return loadConfigJsoncText(jsoncText, {
    source: ConfigSource.Enum.file,
    path,
  });
}

function loadConfigJsoncText(
  jsoncText: string,
  source: Source,
): Result<Config, LoadConfigError> {
  let jsonValue: JsonValue | undefined;
  try {
    jsonValue = parseJsonc(jsoncText);
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    return {
      success: false,
      error: { name: "config-jsonc-invalid", message: e.message, ...source },
    };
  }
  return loadConfigJsonValue(jsonValue, source);
}

function loadConfigJsonValue(
  jsonValue: JsonValue,
  source: Source,
): Result<Config, LoadConfigError> {
  const parseResult = Config.safeParse(jsonValue, { errorMap: customErrorMap });
  if (!parseResult.success) {
    return {
      success: false,
      error: {
        name: "config-value-invalid",
        zodError: parseResult.error,
        ...source,
      },
    };
  }
  return parseResult;
}

function loadConfigEnv(rawEnv: EnvMap): Result<Config, LoadConfigError> {
  const envResult = ConfigEnv.safeParse(getConfigEnvValues(rawEnv), {
    errorMap: customErrorMap,
  });
  if (!envResult.success) {
    const envarErrors = envResult.error.flatten().fieldErrors;
    return {
      success: false,
      error: { name: "config-envars-invalid", envarErrors },
    };
  }
  const env = envResult.data;

  const data_stream_in: z.input<typeof DataStreamCredentials> = {
    measurement_id: env.ANONYSTAT_DATA_STREAM_IN_MEASUREMENT_ID ||
      env.ANONYSTAT_DATA_STREAM_MEASUREMENT_ID || "",
    api_secret: env.ANONYSTAT_DATA_STREAM_IN_API_SECRET ||
      env.ANONYSTAT_DATA_STREAM_API_SECRET || "",
  };
  const data_stream_out: z.input<typeof DataStreamCredentials> = {
    measurement_id: env.ANONYSTAT_DATA_STREAM_OUT_MEASUREMENT_ID ||
      env.ANONYSTAT_DATA_STREAM_MEASUREMENT_ID || "",
    api_secret: env.ANONYSTAT_DATA_STREAM_OUT_API_SECRET ||
      env.ANONYSTAT_DATA_STREAM_API_SECRET || "",
  };
  const data_stream: z.input<typeof DataStreamInOut> = {
    in: data_stream_in,
    out: data_stream_out,
  };

  const listen: z.input<typeof ListenConfig> = {
    port: env.ANONYSTAT_LISTEN_PORT,
    hostname: env.ANONYSTAT_LISTEN_HOSTNAME || undefined,
  };

  const configInput: ConfigInput = {
    forward: {
      data_stream,
      secret_scrambler_key: env.ANONYSTAT_SECRET_SCRAMBLER_KEY,
      allow_debug: env.ANONYSTAT_ALLOW_DEBUG,
      destination: env.ANONYSTAT_DESTINATION || undefined,
    },
    listen: (listen.port === undefined && listen.hostname === undefined)
      ? undefined
      : listen,
  };
  return loadConfigJsonValue(configInput, { source: "env" });
}

/** Create a human-readable representation of a `LoadConfigError`. */
export function formatLoadConfigError(error: LoadConfigError): string {
  const lines = [];
  switch (error.name) {
    case "config-value-invalid":
      lines.push(
        `Failed to load configuration from ${
          formatSource(error)
        }: Config contains invalid values:`,
      );
      lines.push(
        formatZodError(error.zodError, { issuePrefix: "  " }),
      );
      break;
    case "config-file-unreadable":
      lines.push(
        `Failed to load configuration from ${
          formatSource(error)
        }: Could not read file: ${error.message}`,
      );
      break;
    case "config-jsonc-invalid":
      lines.push(
        `Failed to load configuration from ${
          formatSource(error)
        }: Config has a JSON/JSONC syntax error: ${error.message}`,
      );
      break;
    case "config-envar-invalid":
      lines.push(formatEnvarInvalid(error.envar, error.messages));
      break;
    case "config-envars-invalid": {
      const vars = Object.entries(error.envarErrors).map(([name, messages]) =>
        formatEnvarInvalid(name, messages)
      );
      assert(vars.length);
      lines.push(...vars);
      break;
    }
    default:
      assertUnreachable(error);
  }
  return lines.join("\n");
}

function formatEnvarInvalid(name: string, messages: string[]): string {
  return `Failed to read environment variable ${name}: ${
    messages.join("; ") || "Unknown error"
  }`;
}

function formatSource(options: Source): string {
  switch (options.source) {
    case ConfigSource.Enum.env:
      return "ANONYSTAT_* environment variables";
    case ConfigSource.Enum.json:
      return "ANONYSTAT_CONFIG environment variable";
    case ConfigSource.Enum.file:
      return `file '${options.path}' (via ANONYSTAT_CONFIG_FILE environment variable)`;
  }
  assertUnreachable(options);
}

function formatIssuePath(path: (string | number)[]): string {
  return path.reduce<string>(
    (prev, curr) => {
      if (typeof curr === "number") return `${prev}[${curr}]`;
      else if (prev) return `${prev}.${curr}`;
      else return curr;
    },
    "",
  );
}

function formatZodError(
  zodError: z.ZodError,
  { issuePrefix = "" }: { issuePrefix?: string } = {},
): string {
  return zodError.issues.map((issue) => {
    const path = formatIssuePath(issue.path);
    return `${issuePrefix}${path}: ${issue.message}`;
  }).join("\n");
}

export type LoadConfigOrExitOptions = LoadConfigOptions & {
  exitStatus?: number;
};

/** Load & validate a config, or log an error and terminate the process. */
export async function loadConfigOrExit(
  { exitStatus = 1, ...options }: LoadConfigOrExitOptions = {},
): Promise<Config> {
  const configLoad = await loadConfig(options);
  if (!configLoad.success) {
    console.error(formatLoadConfigError(configLoad.error));
    Deno.exit(exitStatus);
  }
  return configLoad.data;
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

function simplifyForwarderConfig(
  value: z.infer<typeof ForwarderConfig>,
): z.input<typeof ForwarderConfig> {
  const data_stream = value.data_stream.map(simplifyDataStreamConfig);
  return {
    data_stream: data_stream.length === 1 ? data_stream[0] : data_stream,
    secret_scrambler_key: value.secret_scrambler_key,
    allow_debug: value.allow_debug ? true : undefined,
    destination: value.destination,
  };
}

function simplifyListen(
  value: Config["listen"],
): z.input<typeof Config>["listen"] {
  if (
    value?.hostname === undefined &&
    value?.port === undefined
  ) {
    return undefined;
  }
  return value;
}

/** Get a simplified representation of a config.
 *
 * Lists and default values are removed where possible.
 */
export function simplifyConfig(config: Config): z.input<typeof Config> {
  const forward = config.forward.map(simplifyForwarderConfig);
  return {
    forward: forward.length === 1 ? forward[0] : forward,
    listen: simplifyListen(config.listen),
  };
}

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

  const env: ConfigEnv = {
    ANONYSTAT_SECRET_SCRAMBLER_KEY: forward.secret_scrambler_key,
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

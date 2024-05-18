import { assert, JsonValue, parseJsonc, z } from "../deps.ts";
import { assertUnreachable, type Error, type Result } from "../_misc.ts";
import {
  ConfigEnv,
  ConfigEnvars,
  ConfigValueEnvarName,
  configValueEnvarNames,
  EmptyStringAsUndefined,
} from "./env_schema.ts";
import {
  Config,
  ConfigInput,
  DataStreamCredentials,
  DataStreamInOut,
  ListenConfig,
  UserIdConfig,
} from "./json_schema.ts";

/** The symbolic names of locations a config can be loaded from. */
export const ConfigSource = z.enum(["env", "json", "file"]);
export type ConfigSource = z.infer<typeof ConfigSource>;
const EnvConfigSource = EmptyStringAsUndefined.pipe(ConfigSource.optional())
  .optional();

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
const customErrorMap: z.ZodErrorMap = (issue, ctx) => {
  if (issue.code === z.ZodIssueCode.invalid_type) {
    if (issue.received === "undefined") {
      return { message: "Required but not set" };
    }
  }

  const oneOrMoreUnionMessage = flattenOneOrMoreInvalidUnion(issue);
  if (oneOrMoreUnionMessage) return oneOrMoreUnionMessage;

  return { message: ctx.defaultError };
};

/** Read raw envar values for ConfigEnv keys. */
function getConfigEnvValues(
  env: EnvMap,
): Partial<Record<ConfigValueEnvarName, string>> {
  const values: Partial<Record<ConfigValueEnvarName, string>> = {};
  for (const key of configValueEnvarNames) {
    values[key] = env.get(key);
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
  const parseResult = Config.safeParse(jsonValue, {
    errorMap: customErrorMap,
  });
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

  const lifetime = env.ANONYSTAT_USER_ID_LIFETIME
    ? {
      count: env.ANONYSTAT_USER_ID_LIFETIME.count,
      unit: env.ANONYSTAT_USER_ID_LIFETIME.unit,
      from: env.ANONYSTAT_USER_ID_LIFETIME.from?.toISOString(),
    }
    : undefined;
  if (lifetime && "from" in lifetime && lifetime.from === undefined) {
    delete lifetime.from;
  }

  const user_id: z.input<typeof UserIdConfig> = {
    lifetime,
    existing: env.ANONYSTAT_USER_ID_EXISTING,
    scrambling_secret: env.ANONYSTAT_USER_ID_SCRAMBLING_SECRET,
  };

  const configInput: ConfigInput = {
    forward: {
      data_stream,
      user_id,
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

/** Load & validate a config, or throw {@linkcode ConfigLoadFailed}. */
export async function loadConfigOrThrow(
  options: LoadConfigOptions = {},
): Promise<Config> {
  const configLoad = await loadConfig(options);
  if (!configLoad.success) {
    throw new ConfigLoadFailed(configLoad.error);
  }
  return configLoad.data;
}

/** Thrown when {@linkcode loadConfigOrThrow} fails to load the {@linkcode Config}.  */
export class ConfigLoadFailed extends Error {
  readonly name = "ConfigLoadFailed";
  constructor(readonly loadConfigError: LoadConfigError) {
    super(formatLoadConfigError(loadConfigError));
  }
}

import { assertUnreachable, Result } from "../_misc.ts";
import {
  Config,
  ConfigLoadFailed,
  ConfigSource,
  ConfigValueEnvarName,
  configValueEnvarNames,
  DataStreamInOut,
  EnvMap,
  ForwarderConfig,
  getEnvars,
  loadConfigOrThrow,
  RawConfigEnv,
  simplifyConfig,
} from "../config.ts";
import { ConfigEnvars } from "../config.ts";
import { z } from "../deps.ts";
import { parseArgs } from "./script_deps.ts";

const usage =
  `Usage: deno run config.ts [-hc] [-f <format>] [<file>] [-e <name>[=<value>|*]]...`;
const help = `\
Validate and print anonystat config.

Usage:
  ${usage}

Configuration is read from environment variables unless <file> is provided, in
which case environment variables are ignored.

Values in the config loaded from <file> (or the environment) can be overridden
by -e <name>[=<value>|*] options naming ANONYSTAT_ environment variables. A glob
indicates all matching environment variables override.

Examples:

  # Load & validate config from env vars, print as NAME=VALUE
  config.ts

  # Load & validate config from config.json, print as NAME=VALUE
  config.ts config.json

  # Load from config.json, overriding the scrambling secret from the environment
  config.ts config.json -e ANONYSTAT_USER_ID_SCRAMBLING_SECRET

  # Load from config.json, overriding the scrambling secret to be 'foo'
  config.ts config.json -e ANONYSTAT_USER_ID_SCRAMBLING_SECRET=foo

  # Load from config.json, overriding values that are also set as env vars
  config.ts config.json -e 'ANONYSTAT_*'

  # Load from config.json, output as JSON without indentation
  config.ts config.json --format json --compact


Arguments:
  <file>:
    Path of a json[c] config file.

Options:
  -f <format>, --format <format>:
    The representation to print after validating. <format> is:
    'env', 'env-json', 'env-vars', 'json', 'markdown'.          [Default: 'env']

  -c, --compact:
    Don't indent JSON output

  -e <name>[=<value>|*], --override <name>[=<value>|*]:
    Name an ANONYSTAT_ environment variable that overrides config values
    loaded from the environment or <file>. <name> can end with a * to match
    multiple, or =<value> to use the provided value instead of the value in the
    environment.

  -h, --help:
    Show this help
`;

type ConfigEnvValue = { name: ConfigValueEnvarName; value: string | undefined };

class LiteralConfigEnvValue implements ConfigEnvValue {
  constructor(readonly name: ConfigValueEnvarName, readonly value: string) {}
}

class EnvConfigEnvValue implements ConfigEnvValue {
  constructor(
    readonly name: ConfigValueEnvarName,
    readonly env: EnvMap = Deno.env,
  ) {}

  get value(): string | undefined {
    return this.env.get(this.name);
  }
}

function isConfigValueEnvarName(value: string): value is ConfigValueEnvarName {
  return configValueEnvarNames.some((n) => n === value);
}

const EnvOverride = z.string().transform((arg, ctx): ConfigEnvValue[] => {
  type Groups =
    & { name: string }
    & ({ glob?: string; value: undefined } | {
      glob: undefined;
      value?: string;
    });

  const match = /^(?<name>\w*)(?:(?<glob>\*)|=(?<value>.*))?$/.exec(arg)
    ?.groups as Groups | undefined;

  if (!match) {
    ctx.addIssue({
      code: "custom",
      message: `Invalid -e/--override argument: ${Deno.inspect(arg)}`,
    });
    return z.NEVER;
  }

  let values: ConfigEnvValue[];
  if (match.glob) {
    values = configValueEnvarNames.filter((n) => n.startsWith(match.name))
      .map((n) => new EnvConfigEnvValue(n));

    if (values.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: `No ANONYSTAT_ config value env vars match ${match.name}*`,
      });
      return z.NEVER;
    }
  } else {
    if (!isConfigValueEnvarName(match.name)) {
      ctx.addIssue({
        code: "custom",
        message: `No ANONYSTAT_ config value env vars match ${match.name}`,
      });
      return z.NEVER;
    }
    if (match.value !== undefined) {
      values = [new LiteralConfigEnvValue(match.name, match.value)];
    } else {
      values = [new EnvConfigEnvValue(match.name)];
    }
  }
  return values;
});

const Arguments = z.object({
  format: z.enum([
    "markdown",
    "json",
    "env",
    "env-json",
    "env-vars",
  ]).default("env"),
  compact: z.boolean(),
  help: z.boolean(),
  file: z.array(z.any()).max(1, {
    message: "Received more than one <file> argument",
  }).transform((files) => files.at(0)),
  override: z.array(EnvOverride).transform((allOverrides) =>
    allOverrides.flatMap((x) => x)
  ),
});

function parseArguments(argv: string[]) {
  const stringArgs = ["format", "override"];
  const booleanArgs = ["compact", "help"];
  const alias = { "compact": "c", "format": "f", "help": "h", "override": "e" };

  const args = parseArgs(argv, {
    alias,
    boolean: booleanArgs,
    string: stringArgs,
    collect: ["override"],
  });
  const help = args.help === true;
  return { ...Arguments.safeParse({ ...args, file: args._ }), help };
}

async function loadConfigOrExit(
  { env, exitStatus }: { env?: EnvMap; exitStatus?: number } = {},
) {
  try {
    return await loadConfigOrThrow({ env });
  } catch (e) {
    if (e instanceof ConfigLoadFailed) {
      console.error(e.message);
      Deno.exit(exitStatus ?? 1);
    }
    throw e; // unexpected error
  }
}

export async function loadConfigWithOverrides(
  env: EnvMap,
  overrides: ConfigEnvValue[],
) {
  const config = await loadConfigOrExit({ env, exitStatus: 1 });

  if (overrides.length === 0) return config;

  const mergedOverrides: Partial<Record<ConfigValueEnvarName, string>> = {};
  for (const o of overrides) mergedOverrides[o.name] = o.value;

  const result = RawConfigEnv.safeParse(mergedOverrides);
  if (!result.success) {
    const errors = result.error.flatten();
    console.error("Failed to apply overrides:");
    for (const [name, messages] of Object.entries(errors.fieldErrors)) {
      console.error(`${name}: ${messages.join(";")}`);
    }
    Deno.exit(1);
  }

  const vars = result.data;
  // Set in/out values from the non in/out defaults
  vars.ANONYSTAT_DATA_STREAM_IN_MEASUREMENT_ID =
    vars.ANONYSTAT_DATA_STREAM_IN_MEASUREMENT_ID ??
      vars.ANONYSTAT_DATA_STREAM_MEASUREMENT_ID;
  vars.ANONYSTAT_DATA_STREAM_OUT_MEASUREMENT_ID =
    vars.ANONYSTAT_DATA_STREAM_OUT_MEASUREMENT_ID ??
      vars.ANONYSTAT_DATA_STREAM_MEASUREMENT_ID;
  vars.ANONYSTAT_DATA_STREAM_IN_API_SECRET =
    vars.ANONYSTAT_DATA_STREAM_IN_API_SECRET ??
      vars.ANONYSTAT_DATA_STREAM_API_SECRET;
  vars.ANONYSTAT_DATA_STREAM_OUT_API_SECRET =
    vars.ANONYSTAT_DATA_STREAM_OUT_API_SECRET ??
      vars.ANONYSTAT_DATA_STREAM_API_SECRET;

  const eachForward = (fn: (fw: ForwarderConfig) => void) => {
    config.forward.forEach(fn);
  };
  const eachDataStream = (fn: (ds: DataStreamInOut) => void) => {
    eachForward((fw) => {
      fw.data_stream.forEach(fn);
    });
  };

  for (const name of Object.keys(vars) as Iterable<ConfigValueEnvarName>) {
    if (result.data[name] === undefined) continue;
    switch (name) {
      case "ANONYSTAT_DATA_STREAM_MEASUREMENT_ID":
      case "ANONYSTAT_DATA_STREAM_API_SECRET":
        // handled above by merging as in/out values
        break;
      case "ANONYSTAT_DATA_STREAM_IN_MEASUREMENT_ID": {
        const value = vars.ANONYSTAT_DATA_STREAM_IN_MEASUREMENT_ID!;
        eachDataStream((ds) => ds.in.measurement_id = value);
        break;
      }
      case "ANONYSTAT_DATA_STREAM_OUT_MEASUREMENT_ID": {
        const value = vars.ANONYSTAT_DATA_STREAM_OUT_MEASUREMENT_ID!;
        eachDataStream((ds) => ds.out.measurement_id = value);
        break;
      }
      case "ANONYSTAT_DATA_STREAM_IN_API_SECRET": {
        const value = result.data.ANONYSTAT_DATA_STREAM_IN_API_SECRET!;
        eachDataStream((ds) => ds.in.api_secret = value);
        break;
      }
      case "ANONYSTAT_DATA_STREAM_OUT_API_SECRET": {
        const value = result.data.ANONYSTAT_DATA_STREAM_OUT_API_SECRET!;
        eachDataStream((ds) => ds.out.api_secret = value);
        break;
      }
      case "ANONYSTAT_DESTINATION": {
        eachForward((f) => f.destination = result.data.ANONYSTAT_DESTINATION!);
        break;
      }
      case "ANONYSTAT_ALLOW_DEBUG": {
        eachForward((f) => f.allow_debug = result.data.ANONYSTAT_ALLOW_DEBUG!);
        break;
      }
      case "ANONYSTAT_USER_ID_SCRAMBLING_SECRET": {
        eachForward((f) =>
          f.user_id.scrambling_secret = vars
            .ANONYSTAT_USER_ID_SCRAMBLING_SECRET!
        );
        break;
      }
      case "ANONYSTAT_USER_ID_LIFETIME": {
        eachForward(
          (f) => f.user_id.lifetime = vars.ANONYSTAT_USER_ID_LIFETIME!,
        );
        break;
      }
      case "ANONYSTAT_USER_ID_EXISTING": {
        eachForward((f) =>
          f.user_id.existing = vars.ANONYSTAT_USER_ID_EXISTING!
        );
        break;
      }
      case "ANONYSTAT_LISTEN_PORT":
        config.listen.port = result.data.ANONYSTAT_LISTEN_PORT!;
        break;
      case "ANONYSTAT_LISTEN_HOSTNAME":
        config.listen.hostname = result.data.ANONYSTAT_LISTEN_HOSTNAME!;
        break;
      case "ANONYSTAT_CORS_ALLOW_ORIGIN":
        eachForward((f) => {
          f.cors = f.cors ?? {};
          f.cors.allow_origin = result.data.ANONYSTAT_CORS_ALLOW_ORIGIN;
        });
        break;
      case "ANONYSTAT_CORS_MAX_AGE":
        eachForward((f) => {
          f.cors = f.cors ?? {};
          f.cors.max_age = result.data.ANONYSTAT_CORS_MAX_AGE;
        });
        break;
      default:
        assertUnreachable(name);
    }
  }
  return config;
}

export async function main(rawArgs: string[] = Deno.args) {
  const parse = parseArguments(rawArgs);
  if (parse.help) {
    console.log(help);
    Deno.exit(0);
  }
  if (!parse.success) {
    console.error(
      "Incorrect command-line arguments:",
      parse.error.issues.map((e) => `${e.path.join(" ")}: ${e.message}`).join(
        "; ",
      ),
      "\n",
    );
    console.error(usage);
    Deno.exit(2);
  }
  const args = parse.data;
  let env: EnvMap = Deno.env;
  if (args.file !== undefined) {
    env = new Map<string, string>([
      [ConfigEnvars.config_file, args.file],
      [ConfigEnvars.config_source, ConfigSource.Enum.file],
    ]);
  }

  const config = await loadConfigWithOverrides(env, args.override);

  switch (args.format) {
    case "markdown": {
      console.log(formatMarkdown(config));
      break;
    }
    case "json":
      console.log(
        formatJson(config, { compact: args.compact, simplify: true }),
      );
      break;
    case "env": {
      const envars = getEnvars(config);
      if (envars.success) {
        console.log(formatDotEnvFile(envars.data));
      } else {
        console.log(formatEnvJson(config));
      }
      break;
    }
    case "env-json": {
      console.log(formatEnvJson(config));
      break;
    }
    case "env-vars": {
      const format = formatEnvVars(config);
      if (!format.success) {
        console.error(format.error);
        Deno.exit(1);
      }
      console.log(`\
${formatDotEnvFile({ [ConfigEnvars.config_source]: ConfigSource.Enum.env })}
${format.data}`);
      break;
    }
    default:
      assertUnreachable(args.format);
  }
}

function formatEnvJson(config: Config): string {
  return formatDotEnvFile({
    [ConfigEnvars.config_source]: ConfigSource.Enum.json,
    [ConfigEnvars.config]: formatJson(config, {
      compact: true,
      simplify: true,
    }),
  });
}

function formatJson(
  config: Config,
  { compact = false, simplify = false }: {
    compact?: boolean;
    simplify?: boolean;
  } = {},
): string {
  return JSON.stringify(
    simplify ? simplifyConfig(config) : config,
    undefined,
    compact ? undefined : 2,
  );
}

function formatMarkdown(config: Config): string {
  const envVars = formatEnvVars(config);
  let envVarsMd: string;
  if (envVars.success) {
    envVarsMd = `\
\`\`\`console
${formatDotEnvFile({ [ConfigEnvars.config_source]: ConfigSource.Enum.env })}
${envVars.data}
\`\`\`
`;
  } else {
    envVarsMd = envVars.error;
  }

  return `\
# Anonystat Config Information

This is your currently-active configuration, validated and presented in
different ways.

## Loaded config

The config loaded from provided environment variables, normalised with defaults
applied.

\`\`\`json
${JSON.stringify(config, undefined, 2)}
\`\`\`

## Individual environment variables (\`--format env\`)

${envVarsMd}

## Single environment variable containing JSON config (\`--format env-json\`)

\`\`\`console
${
    formatDotEnvFile({
      [ConfigEnvars.config_source]: ConfigSource.Enum.json,
      [ConfigEnvars.config]: formatJson(config, {
        compact: true,
        simplify: true,
      }),
    })
  }
\`\`\`

## JSON config (\`--format json\`)

The loaded config with defaults removed and unnecessary arrays removed.

\`\`\`json
${formatJson(config, { compact: false, simplify: true })}
\`\`\`

To load configuration from a file containing the above JSON content, set these
environment variables:

\`\`\`console
${
    formatDotEnvFile({
      [ConfigEnvars.config_source]: ConfigSource.Enum.file,
      [ConfigEnvars.config_file]: "/example/path/config.json",
    })
  }
\`\`\`

`;
}

function formatEnvVars(config: Config): Result<string, string> {
  const envars = getEnvars(config);
  if (envars.success) {
    return { success: true, data: formatDotEnvFile(envars.data) };
  } else if (envars.error.name === "multiple-forward") {
    return {
      success: false,
      error:
        "Cannot represent config with individual envars: Config contains multiple forward rules",
    };
  } else if (envars.error.name === "multiple-data-stream") {
    return {
      success: false,
      error:
        "Cannot represent config with individual envars: Config contains multiple data streams",
    };
  }
  assertUnreachable(envars.error);
}

function formatDotEnvFile(
  envars: Record<string, string | undefined>,
): string {
  return Object.entries(envars).flatMap(([name, value]) => {
    if (value === undefined) return [];
    return [`${name}=${value}`];
  }).join("\n");
}

if (import.meta.main) {
  await main();
}

import { assertUnreachable, Result } from "../_misc.ts";
import {
  Config,
  ConfigSource,
  getEnvars,
  loadConfigOrExit,
  simplifyConfig,
} from "../config.ts";
import { ConfigEnvars } from "../config.ts";
import { z } from "../deps.ts";
import { marked, markedTerminal, parseArgs } from "./script_deps.ts";

const usage = `Usage: deno run config_cli.ts [-hc] [-f <format>] [<file>]`;
const help = `\
Validate and print anonystat config.

${usage}

Options:
  -f, --format: Output just this representation. <format> is: 'terminal',
                'markdown', 'json', 'env', 'env-json', 'env-vars'.
                                                           [Default: 'terminal']
  -c, --compact: Don't indent JSON
  -h, --help:    Show this help
`;

const Arguments = z.object({
  format: z.enum([
    "terminal",
    "markdown",
    "json",
    "env",
    "env-json",
    "env-vars",
  ]).default("terminal"),
  compact: z.boolean(),
  help: z.boolean(),
  file: z.array(z.any()).max(1, {
    message: "Received more than one <file> argument",
  }).transform((files) => files.at(0)),
});

function parseArguments(argv: string[]) {
  const stringArgs = ["format"];
  const booleanArgs = ["compact", "help"];
  const alias = { "compact": "c", "format": "f", "help": "h" };

  const args = parseArgs(argv, {
    alias,
    boolean: booleanArgs,
    string: stringArgs,
  });
  return Arguments.safeParse({ ...args, file: args._ });
}

async function main() {
  const parse = parseArguments(Deno.args);
  if (!parse.success) {
    console.error(
      "Incorrect command-line arguments:",
      parse.error.issues.map((e) => `${e.path}: ${e.message}`).join("; "),
      "\n",
    );
    console.error(usage);
    Deno.exit(2);
  }
  const args = parse.data;
  if (args.help) {
    console.log(help);
    Deno.exit(0);
  }
  if (args.file !== undefined) {
    Deno.env.set(ConfigEnvars.config_file, args.file);
    Deno.env.set(ConfigEnvars.config_source, ConfigSource.Enum.file);
  }

  const config = await loadConfigOrExit({ exitStatus: 1 });

  switch (args.format) {
    case "terminal": {
      marked.use(markedTerminal({}));
      console.log(marked.parse(formatMarkdown(config)));
      break;
    }
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
        console.log(
          formatDotEnvFile({
            [ConfigEnvars.config]: formatJson(config, {
              simplify: true,
              compact: args.compact,
            }),
          }),
        );
      }
      break;
    }
    case "env-json": {
      console.log(
        formatDotEnvFile({
          [ConfigEnvars.config_source]: ConfigSource.Enum.json,
          [ConfigEnvars.config]: formatJson(config, {
            compact: true,
            simplify: true,
          }),
        }),
      );
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

## Individual environment variables

${envVarsMd}

## Single environment variable containing JSON config

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

## JSON config

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
  envars: Record<string, string | boolean | number | undefined>,
): string {
  return Object.entries(envars).flatMap(([name, value]) => {
    if (value === undefined) return [];
    return [`${name}=${value}`];
  }).join("\n");
}

if (import.meta.main) {
  await main();
}

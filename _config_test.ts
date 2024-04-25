import { Config, EnvMap } from "./_config.ts";
import { customErrorMap } from "./_config.ts";
import { ConfigEnvars, loadConfig } from "./_config.ts";
import { JsonValue } from "./deps.ts";
import { z } from "./deps.ts";
import { assert, assertEquals } from "./dev_deps.ts";

// function createConfigEnvMap(
//   options: { config: z.input<typeof Config> } | { rawConfig: JsonValue },
// ): EnvMap {
//   const config = "config" in options ? options.config : options.rawConfig;
//   return new Map<string, string>([[
//     ConfigEnvars.config,
//     JSON.stringify(config),
//   ]]);
// }

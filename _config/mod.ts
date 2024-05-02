export { Config } from "./json_schema.ts";

export type { LoadConfigOptions, LoadConfigOrExitOptions } from "./loading.ts";
export { ConfigSource, loadConfig, loadConfigOrExit } from "./loading.ts";

export { ConfigEnv, ConfigEnvars } from "./env_schema.ts";

export { getEnvars } from "./get_envars.ts";
export type { GetEnvarsError } from "./get_envars.ts";

export { simplifyConfig } from "./simplify.ts";

export { createForwarder } from "./forwarding.ts";

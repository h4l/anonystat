import {
  Config,
  ConfigEnvars,
  createCollectRequestMatcherFromConfig,
  EnvBool,
  loadConfigOrThrow,
  simplifyConfig,
} from "./config.ts";
import { createRequestMatcherHandler } from "./requests.ts";

function onConfigLoaded(config: Config): void {
  if (EnvBool.parse(Deno.env.get(ConfigEnvars.show_config) ?? "")) {
    console.log("Server starting with config:");
    console.log(JSON.stringify(simplifyConfig(config), undefined, 2));
  }
}

export type LoadConfigAndServeOptions = {
  signal?: AbortSignal;
  onConfigLoaded?: (config: Config) => void;
  kv?: Deno.Kv;
};

/** Load configuration from environment variables and run the proxy server.
 *
 * The process exits if the config fails to load. (This is intended to be run
 * from the process's main entrypoint.)
 */
export async function loadConfigAndServe(
  { onConfigLoaded: onConfigLoaded_ = onConfigLoaded, signal, kv }:
    LoadConfigAndServeOptions = {},
): Promise<Deno.HttpServer<Deno.NetAddr>> {
  const config = await loadConfigOrThrow();
  onConfigLoaded_(config);

  const matcher = await createCollectRequestMatcherFromConfig(config, { kv });
  const handler = createRequestMatcherHandler(matcher);

  return Deno.serve(
    { port: config.listen.port, hostname: config.listen.hostname, signal },
    handler,
  );
}

if (import.meta.main) {
  await loadConfigAndServe();
}

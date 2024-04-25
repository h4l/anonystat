import { ConfigEnvars } from "./config.ts";
import { EnvBool } from "./_config.ts";
import { createForwarder, loadConfigOrExit } from "./config.ts";
import { createRequestMatcherHandler } from "./requests.ts";
import { simplifyConfig } from "./_config.ts";

async function main() {
  const config = await loadConfigOrExit();

  if (EnvBool.parse(Deno.env.get(ConfigEnvars.show_config) ?? "")) {
    console.log("Server starting with config:");
    console.log(JSON.stringify(simplifyConfig(config), undefined, 2));
  }

  Deno.serve({
    port: config.listen?.port,
    hostname: config.listen?.hostname,
  }, createRequestMatcherHandler(createForwarder(config)));
}

if (import.meta.main) {
  await main();
}

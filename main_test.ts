import { ConfigInput } from "./_config/json_schema.ts";
import { ConfigEnvars, ConfigSource } from "./config.ts";
import { StatusCodes } from "./deps.ts";
import { assertEquals, stub } from "./dev_deps.ts";
import { loadConfigAndServe } from "./main.ts";
import { AnyPayload } from "./payload-schemas.ts";
import { assertUuid } from "./_testing.ts";

Deno.test("main()", async () => {
  const testEnv = new Map<string, string>();
  using _envGet = stub(Deno.env, "get", testEnv.get.bind(testEnv));
  using kv = await Deno.openKv(":memory:");

  const upstreamRequests: { url: URL; payload: AnyPayload }[] = [];
  await using upstreamServer = Deno.serve(
    { port: 0, hostname: "localhost" },
    async (request): Promise<Response> => {
      upstreamRequests.push({
        url: new URL(request.url),
        payload: AnyPayload.parse(await request.json()),
      });
      return new Response(undefined, { status: StatusCodes.NO_CONTENT });
    },
  );

  const config: ConfigInput = {
    listen: {
      port: 0,
      hostname: "localhost",
    },
    forward: {
      data_stream: {
        in: { measurement_id: "abc1", api_secret: "sec1" },
        out: { measurement_id: "abc2", api_secret: "sec2" },
      },
      destination: `http://localhost:${upstreamServer.addr.port}/mp/collect`,
    },
  };
  testEnv.set(ConfigEnvars.config_source, ConfigSource.Enum.json);
  testEnv.set(ConfigEnvars.config, JSON.stringify(config));

  await using server = await loadConfigAndServe({ kv });

  const response = await fetch(
    `http://localhost:${server.addr.port}/mp/collect?measurement_id=abc1&api_secret=sec1`,
    {
      method: "POST",
      body: JSON.stringify(
        {
          client_id: "test",
          user_id: "user1",
          events: [],
        } satisfies AnyPayload,
      ),
      headers: { "content-type": "application/json" },
    },
  );

  assertEquals(response.status, StatusCodes.NO_CONTENT);
  assertEquals(upstreamRequests.length, 1);
  assertEquals(upstreamRequests[0].url.pathname, "/mp/collect");
  assertEquals(
    upstreamRequests[0].url.searchParams.get("measurement_id"),
    "abc2",
  );
  assertEquals(upstreamRequests[0].url.searchParams.get("api_secret"), "sec2");
  assertUuid(upstreamRequests[0].payload.user_id);
});

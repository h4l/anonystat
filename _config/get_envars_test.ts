import { assertSuccessful } from "../_testing.ts";
import { assertEquals } from "../dev_deps.ts";
import { ConfigValueEnvarName, configValueEnvarNames } from "./env_schema.ts";
import { getEnvars } from "./get_envars.ts";
import { Config } from "./json_schema.ts";

function getConfig({ identicalInOut }: { identicalInOut: boolean }): Config {
  const [a, b, c, d] = identicalInOut
    ? ["a", "b", "a", "b"]
    : ["a", "b", "c", "d"];
  return {
    forward: [{
      data_stream: [{
        in: {
          api_secret: a,
          measurement_id: b,
          cors: {
            allow_origin: ["https://example.com"],
            max_age: 3600,
          },
        },
        out: { api_secret: c, measurement_id: d },
      }],
      allow_debug: true,
      destination: "https://example.com/mp/collect",
      user_id: {
        existing: "keep",
        lifetime: { count: 1, unit: "weeks" },
        scrambling_secret: "foo",
      },
    }],
    listen: {
      hostname: "example",
      port: 1234,
    },
  };
}

function getEnvarNamesWithValues(
  envars: Partial<Record<ConfigValueEnvarName, string>>,
): Set<ConfigValueEnvarName> {
  return new Set(
    Object.entries(envars).filter(([_k, v]) => !!v).map(([k, _v]) =>
      k as ConfigValueEnvarName
    ),
  );
}

Deno.test("getEnvars()", async (t) => {
  await t.step("outputs all possible envars", async (t) => {
    await t.step("identical data_stream in/out", () => {
      const result = getEnvars(getConfig({ identicalInOut: true }));

      const expectedEnvars = new Set(configValueEnvarNames);
      // We use the in/out-specific data stream envars, not the shared one
      expectedEnvars.delete("ANONYSTAT_DATA_STREAM_IN_API_SECRET");
      expectedEnvars.delete("ANONYSTAT_DATA_STREAM_IN_MEASUREMENT_ID");
      expectedEnvars.delete("ANONYSTAT_DATA_STREAM_OUT_API_SECRET");
      expectedEnvars.delete("ANONYSTAT_DATA_STREAM_OUT_MEASUREMENT_ID");

      assertSuccessful(result);
      assertEquals(getEnvarNamesWithValues(result.data), expectedEnvars);
    });

    await t.step("different data_stream in/out", () => {
      const result = getEnvars(getConfig({ identicalInOut: false }));

      const expectedEnvars = new Set(configValueEnvarNames);
      // We use the shared data stream envars, not the in/out-specific ones
      expectedEnvars.delete("ANONYSTAT_DATA_STREAM_API_SECRET");
      expectedEnvars.delete("ANONYSTAT_DATA_STREAM_MEASUREMENT_ID");

      assertSuccessful(result);
      assertEquals(getEnvarNamesWithValues(result.data), expectedEnvars);
    });
  });
});

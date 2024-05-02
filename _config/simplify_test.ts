import { date } from "../_testing.ts";
import { GA4MP_URL } from "../constants.ts";
import { assertEquals, assertSnapshot } from "../dev_deps.ts";
import {
  Config,
  DEFAULT_EXISTING_POLICY,
  DEFAULT_HOSTNAME,
  DEFAULT_LIFETIME_UNIT,
  DEFAULT_PORT,
} from "./json_schema.ts";
import { simplifyConfig } from "./simplify.ts";

Deno.test("simplifyConfig()", async (t) => {
  await t.step("maintains non-defaults", async (t) => {
    const config: Config = {
      forward: [{
        data_stream: [{
          in: { measurement_id: "a", api_secret: "b" },
          out: { measurement_id: "c", api_secret: "d" },
        }],
        user_id: {
          existing: "keep",
          lifetime: {
            unit: "days",
            count: 2,
            from: date("2024-01-02T03:04:05Z"),
          },
          scrambling_secret: "foo",
        },
        allow_debug: true,
        destination: "https://example.com/",
      }],
      listen: { hostname: "example", port: 1234 },
    };
    await assertEquals(simplifyConfig(config), {
      forward: {
        data_stream: {
          in: { measurement_id: "a", api_secret: "b" },
          out: { measurement_id: "c", api_secret: "d" },
        },
        user_id: {
          existing: "keep",
          lifetime: {
            unit: "days",
            count: 2,
            from: "2024-01-02T03:04:05.000Z",
          },
          scrambling_secret: "foo",
        },
        allow_debug: true,
        destination: "https://example.com/",
      },
      listen: { hostname: "example", port: 1234 },
    });
  });

  await t.step("omits defaults", async () => {
    const config: Config = {
      forward: [{
        data_stream: [{
          in: { measurement_id: "a", api_secret: "b" },
          out: { measurement_id: "a", api_secret: "b" },
        }],
        user_id: {
          existing: DEFAULT_EXISTING_POLICY,
          lifetime: {
            unit: DEFAULT_LIFETIME_UNIT,
            count: 1,
            from: new Date(0),
          },
          scrambling_secret: null,
        },
        allow_debug: false,
        destination: GA4MP_URL,
      }],
      listen: { hostname: DEFAULT_HOSTNAME, port: DEFAULT_PORT },
    };
    await assertEquals(JSON.parse(JSON.stringify(simplifyConfig(config))), {
      forward: { data_stream: { measurement_id: "a", api_secret: "b" } },
    });
  });
});

import { date } from "../_testing.ts";
import { GA4MP_URL } from "../constants.ts";
import { assertEquals } from "../dev_deps.ts";
import {
  Config,
  DEFAULT_EXISTING_POLICY,
  DEFAULT_HOSTNAME,
  DEFAULT_LIFETIME_UNIT,
  DEFAULT_PORT,
} from "./json_schema.ts";
import { simplifyConfig } from "./simplify.ts";

Deno.test("simplifyConfig()", async (t) => {
  await t.step("maintains non-defaults", async () => {
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
    await assertEquals(removeUndefined(simplifyConfig(config)), {
      forward: { data_stream: { measurement_id: "a", api_secret: "b" } },
    });
  });

  await t.step("cors", async (t) => {
    await t.step("omits redundant data_stream cors", async () => {
      const config: Config = {
        forward: [{
          data_stream: [{
            in: {
              measurement_id: "a",
              api_secret: "b",
              cors: { allow_origin: ["https://example.com"], max_age: 3600 },
            },
            out: { measurement_id: "a", api_secret: "b" },
          }, {
            in: {
              measurement_id: "c",
              api_secret: "d",
              cors: { allow_origin: ["https://example.com"], max_age: 3600 },
            },
            out: { measurement_id: "c", api_secret: "d" },
          }],
          cors: { allow_origin: ["https://example.com"], max_age: 3600 },
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

      await assertEquals(removeUndefined(simplifyConfig(config)), {
        forward: {
          data_stream: [{ measurement_id: "a", api_secret: "b" }, {
            measurement_id: "c",
            api_secret: "d",
          }],
          cors: { allow_origin: ["example.com"], max_age: 3600 },
        },
      });
    });

    await t.step("omits redundant forward cors", async () => {
      const config: Config = {
        forward: [{
          data_stream: [{
            in: {
              measurement_id: "a",
              api_secret: "b",
              cors: { allow_origin: ["https://a.example.com"], max_age: 120 },
            },
            out: { measurement_id: "a", api_secret: "b" },
          }, {
            in: {
              measurement_id: "c",
              api_secret: "d",
              cors: { allow_origin: ["https://b.example.com"], max_age: 180 },
            },
            out: { measurement_id: "c", api_secret: "d" },
          }],
          cors: { allow_origin: ["https://example.com"], max_age: 60 },
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

      await assertEquals(removeUndefined(simplifyConfig(config)), {
        forward: {
          data_stream: [{
            measurement_id: "a",
            api_secret: "b",
            cors: { allow_origin: ["a.example.com"], max_age: 120 },
          }, {
            measurement_id: "c",
            api_secret: "d",
            cors: { allow_origin: ["b.example.com"], max_age: 180 },
          }],
        },
      });
    });

    await t.step("keeps effectual forward cors", async (t) => {
      await t.step(
        "removes redundant overrides & keeps effectual everrides",
        async () => {
          // The cors configs in the data_stream objects override one of two
          // properties of on the cors config in the forwarder object, so all 3 of
          // them are kept. But redundant properties are dropped from data_stream
          // cors.
          const config: Config = {
            forward: [{
              data_stream: [{
                in: {
                  measurement_id: "a",
                  api_secret: "b",
                  cors: { allow_origin: ["https://example.com"], max_age: 120 },
                },
                out: { measurement_id: "a", api_secret: "b" },
              }, {
                in: {
                  measurement_id: "c",
                  api_secret: "d",
                  cors: {
                    allow_origin: ["https://b.example.com"],
                    max_age: 60,
                  },
                },
                out: { measurement_id: "c", api_secret: "d" },
              }],
              cors: { allow_origin: ["https://example.com"], max_age: 60 },
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

          await assertEquals(removeUndefined(simplifyConfig(config)), {
            forward: {
              cors: { allow_origin: ["example.com"], max_age: 60 },
              data_stream: [{
                measurement_id: "a",
                api_secret: "b",
                cors: { max_age: 120 },
              }, {
                measurement_id: "c",
                api_secret: "d",
                cors: { allow_origin: ["b.example.com"] },
              }],
            },
          });
        },
      );

      await t.step(
        "keeps forwarder cors with no data_stream cors",
        async () => {
          const config: Config = {
            forward: [{
              data_stream: [{
                in: {
                  measurement_id: "a",
                  api_secret: "b",
                },
                out: { measurement_id: "a", api_secret: "b" },
              }, {
                in: {
                  measurement_id: "c",
                  api_secret: "d",
                },
                out: { measurement_id: "c", api_secret: "d" },
              }],
              cors: { allow_origin: ["https://example.com"], max_age: 60 },
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

          await assertEquals(removeUndefined(simplifyConfig(config)), {
            forward: {
              cors: { allow_origin: ["example.com"], max_age: 60 },
              data_stream: [{
                measurement_id: "a",
                api_secret: "b",
              }, {
                measurement_id: "c",
                api_secret: "d",
              }],
            },
          });
        },
      );
    });
  });
});

function removeUndefined(jsonObj: Record<string, unknown>): unknown {
  return JSON.parse(JSON.stringify(jsonObj));
}

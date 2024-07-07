import { Config, ConfigInput } from "./json_schema.ts";
import {
  ConfigEnvars,
  ConfigValueEnvarName,
  RawConfigEnv,
} from "./env_schema.ts";
import {
  ConfigLoadFailed,
  ConfigSource,
  EnvMap,
  loadConfig,
  loadConfigOrThrow,
} from "./loading.ts";

import { assertSuccessful, assertUnsuccessful } from "../_testing.ts";
import { assertSnapshot } from "../dev_deps.ts";
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertNotEquals,
  assertStringIncludes,
} from "../dev_deps.ts";
import { JsonValue } from "../deps.ts";
import { TemporaryFile } from "../_testing/tempfile.ts";
import { Wildcard } from "../_cors.ts";

// deno-lint-ignore no-explicit-any
type Broken = any;

function envMap<
  VarsT extends Record<string, string | boolean | number> = Partial<
    Record<keyof RawConfigEnv | ConfigEnvars, string>
  >,
>(
  vars: VarsT,
): Map<string, string> {
  return new Map(Object.entries(vars).map(([k, v]) => [k, `${v}`]));
}

Deno.test("loadConfig()", async (t) => {
  const minimalConfig = (): Config => ({
    forward: [{
      data_stream: [{
        in: {
          measurement_id: "abc123",
          api_secret: "hunter2",
        },
        out: {
          measurement_id: "abc123",
          api_secret: "hunter2",
        },
      }],
      destination: "https://www.google-analytics.com/mp/collect",
      allow_debug: false,
      user_id: {
        scrambling_secret: null,
        existing: "scramble",
        lifetime: {
          count: 1,
          unit: "months",
        },
      },
    }],
    listen: {
      hostname: "127.0.0.1",
      port: 8000,
    },
  });

  const fullConfig = (): Config => ({
    forward: [{
      data_stream: [{
        in: {
          measurement_id: "mIdIn",
          api_secret: "secretIn",
        },
        out: {
          measurement_id: "mIdOut",
          api_secret: "secretOut",
        },
      }],
      destination: "https://example.com/mp/collect",
      allow_debug: true,
      user_id: {
        scrambling_secret: "hunter2",
        existing: "keep",
        lifetime: {
          count: 2,
          unit: "weeks",
        },
      },
      cors: {
        allow_origin: ["https://example.com"],
        max_age: 10 * 60,
      },
    }],
    listen: {
      hostname: "1.2.3.4",
      port: 9001,
    },
  });

  await t.step("from envars", async (t) => {
    await t.step("minimal required envars", async () => {
      const configLoad = await loadConfig({
        env: envMap({
          ANONYSTAT_DATA_STREAM_MEASUREMENT_ID: "abc123",
          ANONYSTAT_DATA_STREAM_API_SECRET: "hunter2",
        }),
      });
      assert(configLoad.success);
      assertEquals(configLoad.data, minimalConfig());
    });

    await t.step("all envars", async () => {
      const configLoad = await loadConfig({
        env: envMap<Record<ConfigValueEnvarName, string>>({
          ANONYSTAT_ALLOW_DEBUG: "true",
          ANONYSTAT_DATA_STREAM_IN_API_SECRET: "secretIn",
          ANONYSTAT_DATA_STREAM_OUT_API_SECRET: "secretOut",
          ANONYSTAT_DATA_STREAM_API_SECRET: "overridden, not used",
          ANONYSTAT_DATA_STREAM_IN_MEASUREMENT_ID: "mIdIn",
          ANONYSTAT_DATA_STREAM_OUT_MEASUREMENT_ID: "mIdOut",
          ANONYSTAT_DATA_STREAM_MEASUREMENT_ID: "overridden, not used",
          ANONYSTAT_DESTINATION: "https://example.com/mp/collect",
          ANONYSTAT_LISTEN_HOSTNAME: "1.2.3.4",
          ANONYSTAT_LISTEN_PORT: "9001",
          ANONYSTAT_USER_ID_EXISTING: "keep",
          ANONYSTAT_USER_ID_LIFETIME: "2 weeks",
          ANONYSTAT_USER_ID_SCRAMBLING_SECRET: "hunter2",
          ANONYSTAT_CORS_ALLOW_ORIGIN: "example.com",
          ANONYSTAT_CORS_MAX_AGE: "10 minutes",
        }),
      });
      assertSuccessful(configLoad);
      assertEquals(configLoad.data, fullConfig());
    });

    await t.step("empty envars are undefined", async () => {
      const configLoad = await loadConfig({
        env: envMap<Record<ConfigValueEnvarName, string>>({
          ANONYSTAT_ALLOW_DEBUG: "",
          ANONYSTAT_DATA_STREAM_IN_API_SECRET: "",
          ANONYSTAT_DATA_STREAM_OUT_API_SECRET: "",
          ANONYSTAT_DATA_STREAM_API_SECRET: "hunter2",
          ANONYSTAT_DATA_STREAM_IN_MEASUREMENT_ID: "",
          ANONYSTAT_DATA_STREAM_OUT_MEASUREMENT_ID: "",
          ANONYSTAT_DATA_STREAM_MEASUREMENT_ID: "abc123",
          ANONYSTAT_DESTINATION: "",
          ANONYSTAT_LISTEN_HOSTNAME: "",
          ANONYSTAT_LISTEN_PORT: "",
          ANONYSTAT_USER_ID_EXISTING: "",
          ANONYSTAT_USER_ID_LIFETIME: "",
          ANONYSTAT_USER_ID_SCRAMBLING_SECRET: "",
          ANONYSTAT_CORS_ALLOW_ORIGIN: "",
          ANONYSTAT_CORS_MAX_AGE: "",
        }),
      });
      assertSuccessful(configLoad);
      assertEquals(configLoad.data, minimalConfig());
    });

    await t.step(
      "lifetime can be specified with an ISO interval",
      async () => {
        const configLoad = await loadConfig({
          env: envMap({
            ANONYSTAT_DATA_STREAM_MEASUREMENT_ID: "foo",
            ANONYSTAT_DATA_STREAM_API_SECRET: "bar",
            ANONYSTAT_USER_ID_LIFETIME: "R/2024-01-01/P2W",
          }),
        });
        assertSuccessful(configLoad);
        assertEquals(configLoad.data.forward[0].user_id.lifetime, {
          count: 2,
          unit: "weeks",
          from: new Date("2024-01-01T00:00:00Z"),
        });
      },
    );

    await t.step("ANONYSTAT_CORS_ALLOW_ORIGIN", async (t) => {
      await t.step("can be wildcard", async () => {
        const configLoad = await loadConfig({
          env: envMap({
            ANONYSTAT_DATA_STREAM_MEASUREMENT_ID: "foo",
            ANONYSTAT_DATA_STREAM_API_SECRET: "bar",
            ANONYSTAT_CORS_ALLOW_ORIGIN: "*",
          }),
        });
        assertSuccessful(configLoad);
        assertEquals(configLoad.data.forward[0].cors?.allow_origin, Wildcard);
      });

      await t.step("can be comma-separated list of origins", async () => {
        const configLoad = await loadConfig({
          env: envMap({
            ANONYSTAT_DATA_STREAM_MEASUREMENT_ID: "foo",
            ANONYSTAT_DATA_STREAM_API_SECRET: "bar",
            ANONYSTAT_CORS_ALLOW_ORIGIN:
              "https://foo.com,bar.com:8000,http://localhost:9000,chrome-extension://abcd",
          }),
        });
        assertSuccessful(configLoad);
        assertEquals(configLoad.data.forward[0].cors?.allow_origin, [
          "https://foo.com",
          "https://bar.com:8000",
          "http://localhost:9000",
          "chrome-extension://abcd",
        ]);
      });

      await t.step(
        "cannot be literal URL with non-origin components",
        async (t) => {
          const invalidLiteralOrigins = [
            "https://user:name@example.com",
            "https://example.com/foo",
            "chrome-extension://abcd?query",
          ];

          for (const invalidOrigin of invalidLiteralOrigins) {
            await t.step(invalidOrigin, async () => {
              const configLoad = await loadConfig({
                env: envMap({
                  ANONYSTAT_DATA_STREAM_MEASUREMENT_ID: "foo",
                  ANONYSTAT_DATA_STREAM_API_SECRET: "bar",
                  ANONYSTAT_CORS_ALLOW_ORIGIN: invalidOrigin,
                }),
              });
              assertUnsuccessful(configLoad);
              assertEquals(configLoad.error.name, "config-envars-invalid");
              assert(configLoad.error.name === "config-envars-invalid");
              assertStringIncludes(
                configLoad.error.envarErrors.ANONYSTAT_CORS_ALLOW_ORIGIN
                  ?.join() ?? "",
                "Origin values must be of the form",
              );
            });
          }
        },
      );

      await t.step("can be a slash-delimited regex", async () => {
        const configLoad = await loadConfig({
          env: envMap({
            ANONYSTAT_DATA_STREAM_MEASUREMENT_ID: "foo",
            ANONYSTAT_DATA_STREAM_API_SECRET: "bar",
            ANONYSTAT_CORS_ALLOW_ORIGIN: "/http://(\\.+\\.)localhost/",
          }),
        });
        assertSuccessful(configLoad);
        assertEquals(
          configLoad.data.forward[0].cors?.allow_origin,
          /http:\/\/(\.+\.)localhost/,
        );
      });

      await t.step("empty value is undefined", async () => {
        const configLoad = await loadConfig({
          env: envMap({
            ANONYSTAT_DATA_STREAM_MEASUREMENT_ID: "foo",
            ANONYSTAT_DATA_STREAM_API_SECRET: "bar",
            ANONYSTAT_CORS_ALLOW_ORIGIN: "",
          }),
        });
        assertSuccessful(configLoad);
        assertEquals(configLoad.data.forward[0].cors?.allow_origin, undefined);
      });
    });
  });

  await t.step("from json", async (t) => {
    await t.step("minimal fields", async () => {
      const config: ConfigInput = {
        forward: {
          data_stream: {
            measurement_id: "abc123",
            api_secret: "hunter2",
          },
        },
      };
      const configLoad = await loadConfig({
        env: envMap({
          ANONYSTAT_CONFIG: `/* JSONC can have comments */ ${
            JSON.stringify(config)
          }`,
        }),
      });
      assertSuccessful(configLoad);
      assertEquals(configLoad.data, minimalConfig());
    });

    await t.step("all fields", async () => {
      const config: ConfigInput = {
        forward: {
          data_stream: {
            in: {
              measurement_id: "mIdIn",
              api_secret: "secretIn",
            },
            out: {
              measurement_id: "mIdOut",
              api_secret: "secretOut",
            },
          },
          destination: "https://example.com/mp/collect",
          allow_debug: true,
          user_id: {
            scrambling_secret: "hunter2",
            existing: "keep",
            lifetime: {
              count: 2,
              unit: "weeks",
            },
          },
          cors: {
            allow_origin: ["example.com"],
            max_age: "10 minutes",
          },
        },
        listen: {
          hostname: "1.2.3.4",
          port: 9001,
        },
      };
      const configLoad = await loadConfig({
        env: envMap({
          ANONYSTAT_CONFIG: `/* JSONC can have comments */ ${
            JSON.stringify(config)
          }`,
        }),
      });
      assertSuccessful(configLoad);
      assertEquals(configLoad.data, fullConfig());
    });

    await t.step("multiple forward and stream configs", async () => {
      const config: ConfigInput = {
        forward: [
          {
            data_stream: [
              { measurement_id: "a", api_secret: "1" },
              { measurement_id: "b", api_secret: "2" },
            ],
          },
          {
            data_stream: [
              { measurement_id: "c", api_secret: "3" },
              { measurement_id: "d", api_secret: "4" },
            ],
          },
        ],
      };
      const configLoad = await loadConfig({
        env: envMap({
          ANONYSTAT_CONFIG: `/* JSONC can have comments */ ${
            JSON.stringify(config)
          }`,
        }),
      });
      assertSuccessful(configLoad);
      const { forward } = configLoad.data;
      assertEquals(forward.length, 2);
      assertEquals(forward[0].data_stream.length, 2);
      assertEquals(forward[1].data_stream.length, 2);

      assertEquals(forward[0].data_stream[0].in.measurement_id, "a");
      assertEquals(forward[0].data_stream[1].in.measurement_id, "b");
      assertEquals(forward[1].data_stream[0].in.measurement_id, "c");
      assertEquals(forward[1].data_stream[1].in.measurement_id, "d");
    });

    await t.step("data_stream with cors override", async () => {
      const config: ConfigInput = {
        forward: [
          {
            data_stream: [
              {
                measurement_id: "a",
                api_secret: "1",
                cors: {
                  allow_origin: "*",
                  max_age: "30 seconds",
                },
              },
              {
                in: {
                  measurement_id: "b",
                  api_secret: "2",
                  cors: {
                    allow_origin: ["b.example.com", "chrome-extension://abcd"],
                    max_age: "2 minutes",
                  },
                },
                out: {
                  measurement_id: "out-b",
                  api_secret: "out-b",
                },
              },
            ],
          },
          {
            data_stream: {
              measurement_id: "c",
              api_secret: "3",
              cors: {
                allow_origin: "/https://.*\\.example\\.com/",
                max_age: "2 hour",
              },
            },
          },
        ],
      };
      const configLoad = await loadConfig({
        env: envMap({
          ANONYSTAT_CONFIG: `/* JSONC can have comments */ ${
            JSON.stringify(config)
          }`,
        }),
      });
      assertSuccessful(configLoad);
      assertEquals(configLoad.data.forward[0].data_stream[0].in.cors, {
        allow_origin: Wildcard,
        max_age: 30,
      });
      assertEquals(configLoad.data.forward[0].data_stream[1].in.cors, {
        allow_origin: ["https://b.example.com", "chrome-extension://abcd"],
        max_age: 2 * 60,
      });
      assertEquals(configLoad.data.forward[1].data_stream[0].in.cors, {
        allow_origin: /https:\/\/.*\.example\.com/,
        max_age: 2 * 60 * 60,
      });
    });
  });

  await t.step("from file", async (t) => {
    await t.step("minimal fields", async () => {
      using temp = await TemporaryFile.create();
      const config: ConfigInput = {
        forward: {
          data_stream: {
            measurement_id: "abc123",
            api_secret: "hunter2",
          },
        },
      };
      await Deno.writeTextFile(
        temp.path,
        `/* JSONC can have comments */ ${JSON.stringify(config)}`,
      );

      const configLoad = await loadConfig({
        env: envMap({ ANONYSTAT_CONFIG_FILE: temp.path }),
      });
      assertSuccessful(configLoad);
      assertEquals(configLoad.data, minimalConfig());
    });
  });

  await t.step("source selection", async (t) => {
    await t.step("default priority is json, file, env", async () => {
      // When envars are set for multiple configuration sources, the default
      // priority is json, file, env:
      const configJson = JSON.stringify(
        {
          forward: {
            data_stream: { measurement_id: "a", api_secret: "b" },
            destination: "invalid-url-in-json",
          },
        } satisfies ConfigInput,
      );
      const missingFile = `/tmp/${crypto.randomUUID()}`;

      const env = envMap({
        ANONYSTAT_DATA_STREAM_MEASUREMENT_ID: "a",
        ANONYSTAT_DATA_STREAM_API_SECRET: "b",
        ANONYSTAT_DESTINATION: "invalid-url-in-env",
        ANONYSTAT_CONFIG: configJson,
        ANONYSTAT_CONFIG_FILE: missingFile,
      });

      let configLoad = await loadConfig({ env });
      assertUnsuccessful(configLoad);
      assert(
        configLoad.error.name === "config-value-invalid" &&
          configLoad.error.source === "json",
      );

      env.delete("ANONYSTAT_CONFIG");
      configLoad = await loadConfig({ env });
      assertUnsuccessful(configLoad);
      assert(
        configLoad.error.name === "config-file-unreadable" &&
          configLoad.error.source === "file",
      );

      env.delete("ANONYSTAT_CONFIG_FILE");
      configLoad = await loadConfig({ env });
      assertUnsuccessful(configLoad);
      assert(
        configLoad.error.name === "config-envars-invalid",
      );
    });
  });

  await t.step("config_source overrides default priority", async () => {
    // When envars are set for multiple configuration sources, the default
    // priority is json, file, env:
    const configJson = JSON.stringify(
      {
        forward: {
          data_stream: { measurement_id: "a", api_secret: "b" },
          destination: "invalid-url-in-json",
        },
      } satisfies ConfigInput,
    );
    const missingFile = `/tmp/${crypto.randomUUID()}`;

    const env = envMap({
      ANONYSTAT_DATA_STREAM_MEASUREMENT_ID: "a",
      ANONYSTAT_DATA_STREAM_API_SECRET: "b",
      ANONYSTAT_DESTINATION: "invalid-url-in-env",
      ANONYSTAT_CONFIG: configJson,
      ANONYSTAT_CONFIG_FILE: missingFile,
    });

    env.set(ConfigEnvars.config_source, ConfigSource.Enum.env);
    let configLoad = await loadConfig({ env });
    assertUnsuccessful(configLoad);
    assert(
      configLoad.error.name === "config-envars-invalid",
    );

    env.set(ConfigEnvars.config_source, ConfigSource.Enum.file);
    configLoad = await loadConfig({ env });
    assertUnsuccessful(configLoad);
    assert(
      configLoad.error.name === "config-file-unreadable" &&
        configLoad.error.source === "file",
    );

    env.set(ConfigEnvars.config_source, ConfigSource.Enum.json);
    configLoad = await loadConfig({ env });
    assertUnsuccessful(configLoad);
    assert(
      configLoad.error.name === "config-value-invalid" &&
        configLoad.error.source === "json",
    );
  });
});

Deno.test("loadConfigOrThrow()", async (t) => {
  await t.step("loads valid config", async () => {
    const config = await loadConfigOrThrow({
      env: envMap({
        ANONYSTAT_DATA_STREAM_MEASUREMENT_ID: "a",
        ANONYSTAT_DATA_STREAM_API_SECRET: "b",
      }),
    });
    assertEquals(config.forward[0].data_stream[0].in.measurement_id, "a");
  });

  await t.step("throws on invalid config", async () => {
    let error: unknown;
    try {
      await loadConfigOrThrow({ env: envMap({}) });
    } catch (e) {
      error = e;
    }
    assertInstanceOf(error, ConfigLoadFailed);
    assertStringIncludes(
      error.message,
      "Failed to read environment variable",
    );
  });

  await t.step("error message describes config error", async (t) => {
    const getDefaultConfig = () => ({
      forward: {
        data_stream: {
          in: {
            measurement_id: "a",
            api_secret: "b",
          },
          out: {
            measurement_id: "c",
            api_secret: "d",
          },
        },
        allow_debug: true,
        destination: "https://example.com/",
        user_id: {
          existing: "keep",
          lifetime: "R/2024-01-01/P3M",
          scrambling_secret: "foo",
        },
      },
      listen: {
        hostname: "example",
        port: 1234,
      },
    } satisfies ConfigInput);
    type DefaultConfig = ReturnType<typeof getDefaultConfig>;
    type MutateConfig = (config: DefaultConfig) => JsonValue | void;

    function getMutatedConfig(mutate: MutateConfig): JsonValue {
      const config = getDefaultConfig();
      const result = mutate(config);
      return result === undefined ? config : result;
    }

    const getJsonEnv = (mutate?: MutateConfig) => {
      const config = mutate ? getMutatedConfig(mutate) : getDefaultConfig();
      return envMap({
        [ConfigEnvars.config]: `${JSON.stringify(config)}`,
      });
    };

    const triggerLoadConfigError = async (env: EnvMap): Promise<string> => {
      let error: unknown;

      try {
        await loadConfigOrThrow({ env });
      } catch (e) {
        error = e;
      }

      assertInstanceOf(error, ConfigLoadFailed);
      assertNotEquals(error.message, "");
      return error.message;
    };

    await t.step("config value envars invalid", async (t) => {
      await t.step("no envars set", async (t) => {
        await assertSnapshot(t, await triggerLoadConfigError(envMap({})));
      });

      await t.step("invalid envar value", async (t) => {
        const env = envMap({
          ANONYSTAT_DATA_STREAM_MEASUREMENT_ID: "a",
          ANONYSTAT_DATA_STREAM_IN_API_SECRET: "b",
          ANONYSTAT_USER_ID_LIFETIME: "foo/bar",
        });
        await assertSnapshot(t, await triggerLoadConfigError(env));
      });
    });

    await t.step("config meta envars invalid", async (t) => {
      await t.step("invalid source", async (t) => {
        const env = envMap({ ANONYSTAT_CONFIG_SOURCE: "sfsd" });
        await assertSnapshot(t, await triggerLoadConfigError(env));
      });

      await t.step("missing source", async (t) => {
        const env = envMap({ ANONYSTAT_CONFIG_SOURCE: ConfigSource.Enum.json });
        await assertSnapshot(t, await triggerLoadConfigError(env));
      });
    });

    await t.step("invalid value in config JSON", async (t) => {
      await t.step("forward.allow_debug", async (t) => {
        const env = getJsonEnv((c) => {
          c.forward.allow_debug = "foo" as Broken;
        });
        await assertSnapshot(t, await triggerLoadConfigError(env));
      });

      await t.step("forward[].allow_debug", async (t) => {
        const env = getJsonEnv((c) => {
          const brokenForward = c.forward;
          brokenForward.allow_debug = "foo" as Broken;
          c.forward = [brokenForward] as Broken;
        });
        await assertSnapshot(t, await triggerLoadConfigError(env));
      });
    });

    await t.step("file unreadable", async (t) => {
      // ./data is not a readable file because it's a dir
      const env = envMap({ [ConfigEnvars.config_file]: "./data" });
      await assertSnapshot(t, await triggerLoadConfigError(env));
    });

    await t.step("file jsonc invalid", async (t) => {
      const env = envMap({
        [ConfigEnvars.config_file]: "./data/syntax_error.json",
      });
      await assertSnapshot(t, await triggerLoadConfigError(env));
    });
  });
});

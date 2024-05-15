import {
  assertOneFetchForMpCollectRequest,
  assertResponseOk,
  assertSuccessful,
  assertUnsuccessful,
  assertUuid,
  date,
  MpCollectRequestAttrs,
} from "../_testing.ts";
import { assertEquals, assertNotEquals, FakeTime, stub } from "../dev_deps.ts";
import { AnyPayload } from "../payload_schemas.ts";
import { HandlerRequest } from "../requests.ts";
import { createCollectRequestMatcherFromConfig } from "./from_config.ts";
import { Config } from "./json_schema.ts";

import { StatusCodes } from "../deps.ts";

Deno.test("createCollectRequestMatcherFromConfig()", async (t) => {
  const kv = await Deno.openKv(":memory:");

  function stubFetch() {
    return stub(globalThis, "fetch", () => {
      const resp = new Response(undefined, { status: StatusCodes.NO_CONTENT });
      return Promise.resolve(resp);
    });
  }

  function mpCollectUrl(
    { measurement_id, api_secret, debug }: {
      measurement_id?: string;
      api_secret?: string;
      debug?: boolean;
    },
  ): string {
    const url = new URL("https://stats.example.com/mp/collect");
    if (debug) url.pathname = "/debug/mp/collect";
    if (measurement_id !== undefined) {
      url.searchParams.append("measurement_id", measurement_id);
    }
    if (api_secret !== undefined) {
      url.searchParams.append("api_secret", api_secret);
    }
    return url.toString();
  }

  function createRequest(
    options: {
      measurement_id?: string;
      api_secret?: string;
      user_id?: string;
      debug?: boolean;
    } = {},
  ): HandlerRequest {
    const completed = Promise.reject("not used");
    completed.catch(() => {}); // ignore

    const payload: AnyPayload = {
      client_id: "test",
      user_id: options.user_id,
      events: [],
    };

    const request = new Request(mpCollectUrl(options), {
      method: "POST",
      body: JSON.stringify(payload),
      headers: [
        ["content-type", "application/json"],
        ["User-Agent", "Example/1.0"],
        ["Accept-Language", "en-GB,en;q=0.8"],
      ],
    });

    return {
      info: {
        completed,
        remoteAddr: { hostname: "1.2.3.4", port: 99999, transport: "tcp" },
      },
      request,
    };
  }

  const config: Config = {
    forward: [
      {
        data_stream: [
          {
            in: { measurement_id: "a_in", api_secret: "a_in_sec1" },
            out: { measurement_id: "a_out", api_secret: "a_out_sec" },
          },
          {
            in: { measurement_id: "b_in", api_secret: "b_in_sec" },
            out: { measurement_id: "b_out", api_secret: "b_out_sec" },
          },
        ],
        allow_debug: false,
        destination: "https://example.com/mp/collect",
        user_id: {
          existing: "keep",
          lifetime: { count: 1, unit: "months" },
          scrambling_secret: null,
        },
      },
      {
        data_stream: [
          {
            in: { measurement_id: "a_in", api_secret: "a_in_sec2" },
            out: { measurement_id: "a_out", api_secret: "a_out_sec" },
          },
          {
            in: { measurement_id: "c_in", api_secret: "c_in_sec" },
            out: { measurement_id: "c_out", api_secret: "c_out_sec" },
          },
        ],
        allow_debug: true,
        destination: "https://other.example.com/mp/collect",
        user_id: {
          existing: "scramble",
          lifetime: { count: 1, unit: "hours" },
          scrambling_secret: null,
        },
      },
    ],
    listen: { hostname: "0.0.0.0", port: 1234 },
  };
  const matcher = await createCollectRequestMatcherFromConfig(config, { kv });
  type Matcher = typeof matcher;

  await t.step("matches requests with allows-listed credentials", async (t) => {
    const allowedCredentials = [
      { measurement_id: "a_in", api_secret: "a_in_sec1" },
      { measurement_id: "a_in", api_secret: "a_in_sec2" },
      { measurement_id: "b_in", api_secret: "b_in_sec" },
      { measurement_id: "c_in", api_secret: "c_in_sec" },
    ] as const;
    for (const cred of allowedCredentials) {
      await t.step(Deno.inspect(cred), async () => {
        const result = await matcher.match(createRequest(cred));
        assertSuccessful(result);
      });
    }
  });

  await t.step("does not match non-allow-listed credentials", async (t) => {
    const nonAllowedCredentials = [
      { measurement_id: "a_in", api_secret: "foo" },
      { measurement_id: "other", api_secret: "a_in_sec2" },
    ] as const;
    for (const cred of nonAllowedCredentials) {
      await t.step(Deno.inspect(cred), async () => {
        const result = await matcher.match(createRequest(cred));
        assertUnsuccessful(result);
      });
    }
  });

  await t.step("allow_debug", async (t) => {
    await t.step("allowed requests can use debug endpoint", async () => {
      const result = await matcher.match(
        createRequest({
          measurement_id: "a_in",
          api_secret: "a_in_sec2",
          debug: true,
        }),
      );
      assertSuccessful(result);
    });

    await t.step("not-allowed requests can't use debug endpoint", async () => {
      const result = await matcher.match(
        createRequest({
          measurement_id: "a_in",
          api_secret: "a_in_sec1",
          debug: true,
        }),
      );
      assertUnsuccessful(result);
      assertEquals(result.error, { name: "not-authorised" });
    });
  });

  async function assertRequestForwarded(
    { requestIn, requestOut, matcher: matcher_ = matcher }: {
      requestIn: HandlerRequest;
      requestOut: MpCollectRequestAttrs;
      matcher?: Matcher;
    },
  ): Promise<void> {
    using fetch = stubFetch();
    const result = await matcher_.match(requestIn);
    assertSuccessful(result);
    const response = await result.data.respond();
    assertResponseOk(response);

    await assertOneFetchForMpCollectRequest(fetch, requestOut);
  }

  await t.step("destination", async (t) => {
    await t.step("requests forward to destination URL", async () => {
      await assertRequestForwarded({
        requestIn: createRequest({
          measurement_id: "a_in",
          api_secret: "a_in_sec2",
          debug: true,
        }),
        requestOut: {
          origin: "https://other.example.com",
          measurement_id: "a_out",
          api_secret: "a_out_sec",
        },
      });
    });
  });

  await t.step("user_id", async (t) => {
    await t.step("matcher uses configured existing behaviour", async (t) => {
      await t.step("keep", async () => {
        // The first config uses 'keep', so the user_id 'foo' is kept when forwarding
        await assertRequestForwarded({
          requestIn: createRequest({
            measurement_id: "a_in",
            api_secret: "a_in_sec1", // first config
            user_id: "foo",
          }),
          requestOut: {
            origin: "https://example.com",
            measurement_id: "a_out",
            api_secret: "a_out_sec",
            user_id: "foo",
          },
        });
      });

      await t.step("scramble", async () => {
        // The second config uses 'scramble', so the user_id 'foo' is scrambled when forwarding
        await assertRequestForwarded({
          requestIn: createRequest({
            measurement_id: "a_in",
            api_secret: "a_in_sec2", // second config
            user_id: "foo",
          }),
          requestOut: {
            origin: "https://other.example.com",
            measurement_id: "a_out",
            api_secret: "a_out_sec",
            user_id: assertUuid,
          },
        });
      });
    });
  });

  await t.step("matcher uses configured lifetime for user_id", async (t) => {
    type LifetimeKey = "a" | "b" | "c";
    type ForwardedId = [key: LifetimeKey, user_id: string];

    function assertSameLifetime(
      key: LifetimeKey,
      sample1: ForwardedId,
      sample2: ForwardedId,
    ) {
      assertEquals(key, sample1[0], "First sample has incorrect lifetime key");
      assertEquals(key, sample2[0], "Second sample has incorrect lifetime key");
      assertEquals(sample1[1], sample2[1], "Samples have different user_id");
    }

    await t.step("keep", async () => {
      const requestTimes: [key: LifetimeKey, date: Date][] = [
        ["a", date("2024-01-01T00:00:00Z")], // 2 requests in each hour
        ["a", date("2024-01-01T00:59:59Z")],
        ["b", date("2024-01-01T01:00:00Z")],
        ["b", date("2024-01-01T01:59:59Z")],
        ["c", date("2024-01-01T02:00:00Z")],
        ["c", date("2024-01-01T02:59:59Z")],
      ];
      const idsForwarded: ForwardedId[] = [];

      for (const [key, date] of requestTimes) {
        using _time = new FakeTime(date);

        await assertRequestForwarded({
          requestIn: createRequest({
            measurement_id: "a_in",
            api_secret: "a_in_sec2", // second config, 1 hour lifetime
            user_id: "foo",
          }),
          requestOut: {
            origin: "https://other.example.com",
            measurement_id: "a_out",
            api_secret: "a_out_sec",
            user_id: (user_id) => {
              assertUuid(user_id);
              idsForwarded.push([key, user_id]);
            },
          },
        });
      }
      assertEquals(idsForwarded.length, 6);
      assertSameLifetime("a", idsForwarded[0], idsForwarded[1]);
      assertSameLifetime("b", idsForwarded[2], idsForwarded[3]);
      assertSameLifetime("c", idsForwarded[4], idsForwarded[5]);
    });
  });

  function configWithSecret(scrambling_secret: string): Config {
    return {
      forward: [{
        ...config.forward[1],
        user_id: {
          ...config.forward[1].user_id,
          scrambling_secret,
        },
      }],
      listen: config.listen,
    };
  }

  await t.step("matcher uses configured scrambling secret", async () => {
    const userIds: [secret: string, user_id: string][] = [];

    // The two requests forwarded using the 'a' secret have user_ids scrambled
    // to the same value, whereas the request forwarded with 'b' have user_ids
    // scrambled to a different value.
    for (const secret of ["a", "a", "b"]) {
      await assertRequestForwarded({
        matcher: await createCollectRequestMatcherFromConfig(
          configWithSecret(secret),
          { kv },
        ),
        requestIn: createRequest({
          measurement_id: "a_in",
          api_secret: "a_in_sec2",
          user_id: "foo",
        }),
        requestOut: {
          origin: "https://other.example.com",
          measurement_id: "a_out",
          api_secret: "a_out_sec",
          user_id: (user_id) => {
            assertUuid(user_id);
            userIds.push([secret, user_id]);
          },
        },
      });
    }
    assertEquals(userIds.length, 3);
    const [[s0, id0], [s1, id1], [s2, id2]] = userIds;
    assertEquals(s0, "a");
    assertEquals(s1, "a");
    assertEquals(id0, id1);
    assertEquals(s2, "b");
    assertNotEquals(id0, id2);
  });

  kv.close();
});

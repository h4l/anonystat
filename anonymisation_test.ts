import {
  assertSuccessful,
  assertUnsuccessful,
  assertUuid,
  date,
  lerp,
  timestamp,
} from "./_testing.ts";
import {
  AnonymisationProvider,
  DefaultTimeBucket,
  ExistingIdPolicy,
  Lifetime,
  UserDistinctionRequestMeta,
} from "./anonymisation.ts";
import { defaultPayloadParser } from "./default.ts";
import { assert } from "./deps.ts";
import { assertEquals, assertNotEquals, FakeTime } from "./dev_deps.ts";
import {
  ApprovedCollectRequestMeta,
  CollectRequestMeta,
  RequestMeta,
  RequestName,
} from "./meta.ts";
import { AnyPayload } from "./payload-schemas.ts";
import { GA4MPPayload, PayloadParseError, PayloadParser } from "./types.ts";
import { DefaultCollectRequestForwardingRule } from "./rules.ts";

Deno.test("RequestMetaDecorator", async (t) => {
  const kv = await Deno.openKv(":memory:");

  const request = new Request("https://proxy.example.com/mp/collect", {
    headers: [
      ["User-Agent", "Example/1.0"],
      ["Accept-Language", "en-GB,en;q=0.8"],
    ],
  });

  const originalMeta = (
    options: Partial<CollectRequestMeta> = {},
  ): CollectRequestMeta => ({
    measurement_id: options.measurement_id ?? "a",
    api_secret: options.api_secret ?? "b",
    debug: options.debug ?? false,
    headers: options.headers ?? request.headers,
    name: options.name ?? RequestName.collect,
    url: options.url ?? new URL(request.url),
  });

  const approvedMeta = (
    options: Partial<ApprovedCollectRequestMeta> = {},
  ): ApprovedCollectRequestMeta => ({
    ...originalMeta(options),
    measurement_id: options.measurement_id ?? "c",
    api_secret: options.api_secret ?? "d",
    endpoint: options.endpoint ?? "https://upstream.example.com/mp/collect",
  });

  await t.step("createRequestMetaDecorator()", async (t) => {
    const anonymisation = await AnonymisationProvider.create({ kv });

    const noopDecorator = DefaultCollectRequestForwardingRule.noopDecorator;
    const decorator = anonymisation.createRequestMetaDecorator(noopDecorator);

    const completed = Promise.reject("not used");
    completed.catch(() => {}); // ignore

    await t.step("adds distinguishingFeatures to successful match", () => {
      const result = decorator({ success: true, data: approvedMeta() }, {
        requestMeta: originalMeta(),
        request,
        info: {
          completed,
          remoteAddr: { hostname: "1.2.3.4", port: 12345, transport: "tcp" },
        },
      });

      assertSuccessful(result);
      assertEquals(result.data, {
        ...approvedMeta(),
        distinguishingFeatures: {
          requestIp: "1.2.3.4",
          requestUserAgent: "Example/1.0",
          requestAcceptLanguage: "en-GB,en;q=0.8",
        },
      });
    });

    await t.step("does not modify unsuccessful match", () => {
      const result = decorator({
        success: false,
        error: { name: "not-authorised" },
      }, {
        requestMeta: originalMeta(),
        request,
        info: {
          completed,
          remoteAddr: { hostname: "1.2.3.4", port: 12345, transport: "tcp" },
        },
      });

      assertUnsuccessful(result);
      assertEquals(result.error.name, "not-authorised");
    });
  });

  await t.step("createPayloadParser()", async (t) => {
    const nextParser: PayloadParser<
      GA4MPPayload<AnyPayload>,
      GA4MPPayload<AnyPayload>,
      PayloadParseError,
      RequestMeta
    > = defaultPayloadParser;

    type DistinguishedMetaOptions =
      & Partial<ApprovedCollectRequestMeta>
      & Partial<UserDistinctionRequestMeta["distinguishingFeatures"]>;

    const distinguishedMeta = (
      options: DistinguishedMetaOptions = {},
    ): UserDistinctionRequestMeta => ({
      ...approvedMeta(options),
      distinguishingFeatures: {
        requestIp: options.requestIp ?? "1.2.3.4",
        requestUserAgent: options.requestUserAgent ?? "Example/1.0",
        requestAcceptLanguage: options.requestAcceptLanguage ??
          "en-GB,en;q=0.8",
      },
    });

    interface GetParserOptions {
      policy?: ExistingIdPolicy;
      secret?: string;
      lifetime?: Lifetime;
    }

    interface ParseOptions extends DistinguishedMetaOptions {
      user_id?: string;
    }

    interface RunOptions extends GetParserOptions, ParseOptions {}

    async function getParser(options: GetParserOptions = {}) {
      return (await AnonymisationProvider.create({
        kv,
        existingUserIdPolicy: options.policy,
        secret: options.secret,
        lifetime: options.lifetime,
      })).createPayloadParser(nextParser);
    }
    type Parser = Awaited<ReturnType<typeof getParser>>;

    async function run(options?: RunOptions): Promise<AnyPayload>;
    async function run(
      parser?: Parser,
      options?: ParseOptions,
    ): Promise<AnyPayload>;

    async function run(
      arg1?: Parser | RunOptions,
      arg2?: ParseOptions,
    ): Promise<AnyPayload> {
      let parser: Parser;
      let options: ParseOptions;
      if (typeof arg1 === "function") {
        parser = arg1 as Parser;
        options = arg2 ?? {};
      } else {
        assert(arg2 === undefined);
        options = arg1 ?? {};
        parser = await getParser(arg1 ?? {});
      }

      const result = await parser({
        payload: {
          client_id: "test",
          user_id: options.user_id,
          events: [],
        },
      }, { requestMeta: distinguishedMeta(options) });

      assertSuccessful(result);
      return result.data.payload;
    }

    await t.step("option existingUserIdPolicy", async (t) => {
      await t.step("keep", async (t) => {
        await t.step("keeps existing id", async () => {
          const result = await run({ policy: "keep", user_id: "foo" });
          assertEquals(result.user_id, "foo");
        });

        await t.step("generates missing id", async () => {
          const result = await run({ policy: "keep", user_id: undefined });
          assertUuid(result.user_id);
        });
      });

      await t.step("replace", async (t) => {
        await t.step("replaces existing id", async () => {
          const result = await run({ policy: "replace", user_id: "foo" });
          assertUuid(result.user_id);
        });

        await t.step("generates missing id", async () => {
          const result = await run({ policy: "replace", user_id: undefined });
          assertUuid(result.user_id);
        });
      });

      await t.step("scramble", async (t) => {
        await t.step("scrambles existing id", async () => {
          const options: RunOptions = { policy: "scramble", user_id: "foo" };
          const result1 = await run({ ...options, requestIp: "1.2.3.4" });
          const result2 = await run({ ...options, requestIp: "4.3.2.1" });

          assertUuid(result1.user_id);
          // Scrambled ID depends on provided user_id, not distinguishing
          // attributes, so IDs of requests from different sources are the same.
          assertEquals(result1.user_id, result2.user_id);
        });

        await t.step("generates missing id", async () => {
          const result1 = await run({ policy: "scramble", user_id: undefined });
          const result2 = await run({ policy: "replace", user_id: undefined });
          assertUuid(result1.user_id);
          // Without an existing ID to scramble, the ID is generated in the same
          // way as other policies, so they're the same.
          assertEquals(result1.user_id, result2.user_id);
        });
      });

      await t.step("default", async (t) => {
        await t.step("scramble is default", async () => {
          const options: RunOptions = { policy: undefined, user_id: "foo" };
          const result1 = await run({ ...options, requestIp: "1.2.3.4" });
          const result2 = await run({ ...options, requestIp: "4.3.2.1" });

          assertUuid(result1.user_id);
          // Scrambled ID depends on provided user_id, not distinguishing
          // attributes, so IDs of requests from different sources are the same.
          assertEquals(result1.user_id, result2.user_id);
        });
      });
    });

    await t.step("option secret", async (t) => {
      await t.step("generated ids change when secret changes", async () => {
        const result1 = await run({ secret: "a" });
        const result2 = await run({ secret: "b" });
        const result3 = await run({ secret: "a" });

        assertEquals(result1.user_id, result3.user_id);
        assertNotEquals(result1.user_id, result2.user_id);
      });

      await t.step("scrambled ids change when secret changes", async () => {
        const options: RunOptions = { policy: "scramble", user_id: "foo" };
        const result1 = await run({ ...options, secret: "a", requestIp: "1" });
        const result2 = await run({ ...options, secret: "b", requestIp: "2" });
        const result3 = await run({ ...options, secret: "a", requestIp: "3" });

        assertEquals(result1.user_id, result3.user_id);
        assertNotEquals(result1.user_id, result2.user_id);
      });
    });

    await t.step("option lifetime", async (t) => {
      type LifetimeBoundary = {
        lifetime: Lifetime;
        l1: string;
        l2: string;
      };

      const from: number = timestamp("2001-02-03T04:05:06Z");
      const params: LifetimeBoundary[] = [
        // Single units, default from (1970-00-00)
        {
          lifetime: { unit: "hours", count: 1 },
          l1: "2001-02-03T04:00:00Z",
          l2: "2001-02-03T05:00:00Z",
        },
        {
          lifetime: { unit: "days", count: 1 },
          l1: "2001-02-03T00:00:00Z",
          l2: "2001-02-04T00:00:00Z",
        },
        // 1970-01-01 was Thursday. 2001-02-01 was Thursday too.
        {
          lifetime: { unit: "weeks", count: 1 },
          l1: "2001-02-01T00:00:00Z",
          l2: "2001-02-08T00:00:00Z",
        },
        {
          lifetime: { unit: "months", count: 1 },
          l1: "2001-02-01T00:00:00Z",
          l2: "2001-03-01T00:00:00Z",
        },
        {
          lifetime: { unit: "quarters", count: 1 },
          l1: "2001-01-01T00:00:00Z",
          l2: "2001-04-01T00:00:00Z",
        },
        {
          lifetime: { unit: "years", count: 1 },
          l1: "2001-01-01T00:00:00Z",
          l2: "2002-01-01T00:00:00Z",
        },
        // Multiple units, from 2001-02-03T04:05:06Z
        {
          lifetime: { unit: "hours", count: 7, from },
          l1: "2001-02-04T01:05:06Z",
          l2: "2001-02-04T08:05:06Z",
        },
        {
          lifetime: { unit: "days", count: 3, from },
          l1: "2001-02-09T04:05:06Z",
          l2: "2001-02-12T04:05:06Z",
        },
        {
          lifetime: { unit: "weeks", count: 3, from },
          l1: "2001-02-24T04:05:06Z",
          l2: "2001-03-17T04:05:06Z",
        },
        {
          lifetime: { unit: "months", count: 3, from },
          l1: "2001-05-03T04:05:06Z",
          l2: "2001-08-03T04:05:06Z",
        },
        {
          lifetime: { unit: "quarters", count: 2, from },
          l1: "2001-08-03T04:05:06Z",
          l2: "2002-02-03T04:05:06Z",
        },
        {
          lifetime: { unit: "years", count: 2, from },
          l1: "2005-02-03T04:05:06Z",
          l2: "2007-02-03T04:05:06Z",
        },
      ];

      for (
        const { lifetime: { unit, count, from }, l1, l2, i } of params.map(
          (p, i) => ({ ...p, i }),
        )
      ) {
        await t.step(
          `lifetime boundary [${i}] ${count} ${unit} ${
            from ? "with" : "without"
          } from`,
          async () => {
            const midFirst = timestamp(l1), midLast = timestamp(l2) - 1;
            const samples = [
              { key: "before", date: date(l1, -1) },
              ...([0, 0.25, 0.5, 0.75, 1].map((t) => {
                const date = new Date(lerp(midFirst, midLast, t));
                return { key: "main", date } as const;
              })),
              { key: "after", date: date(l2) },
            ] as const;

            const results: Record<"before" | "main" | "after", string[]> = {
              before: [],
              main: [],
              after: [],
            };

            let _time: FakeTime;
            for (const sample of samples) {
              _time = new FakeTime(sample.date);

              const result = await run({ lifetime: { unit, count, from } });
              assertUuid(result.user_id);
              results[sample.key].push(result.user_id);
            }

            assertEquals(results.before.length, 1);
            assertEquals(results.main.length, 5);
            assertEquals(results.after.length, 1);
            // The lifetime expired as we moved across the two boundaries,
            // resulting in user_id changing, but remaining consistent across
            // the main lifetime.
            assertNotEquals(results.before[0], results.main[0]);
            assertEquals(new Set(results.main).size, 1);
            assertNotEquals(results.main[0], results.after[0]);
            assertNotEquals(results.before[0], results.after[0]);
          },
        );
      }

      const now = timestamp("2001-02-03T04:05:06Z");
      const nextHour = timestamp("2001-02-03T05:00:00Z");

      await t.step(
        "generated ids change when the lifetime expires",
        async () => {
          const time = new FakeTime(now);
          const options: RunOptions = { lifetime: { count: 1, unit: "hours" } };

          const result1 = await run(options);
          await time.tickAsync(nextHour - now - 1); // last ms of lifetime
          const result2 = await run(options);
          await time.tickAsync(1);
          const result3 = await run(options);

          assertEquals(result1.user_id, result2.user_id);
          assertNotEquals(result1.user_id, result3.user_id);
        },
      );

      await t.step(
        "scrambled ids change when the lifetime expires",
        async () => {
          const time = new FakeTime(now);
          const options: RunOptions = {
            user_id: "foo",
            policy: "scramble",
            lifetime: { count: 1, unit: "hours" },
          };

          const result1 = await run(options);
          await time.tickAsync(nextHour - now - 1); // last ms of lifetime
          const result2 = await run(options);
          await time.tickAsync(1);
          const result3 = await run(options);

          assertEquals(result1.user_id, result2.user_id);
          assertNotEquals(result1.user_id, result3.user_id);
        },
      );

      // todo: test all units, plus unit sizes and from
      // todo: test concurrent requests at new time
      await t.step(
        "concurrent requests at lifetime boundary are consistent",
        async () => {
          const parserA = await getParser({ lifetime: { unit: "hours" } });
          const parserB = await getParser({ lifetime: { unit: "hours" } });
          const start = timestamp("2001-02-03T04:00:00Z") - 1;
          const time = new FakeTime(start);

          // Both parsers are in-sync at the initial lifetime
          const resultA1 = await run(parserA);
          const resultB1 = await run(parserB);
          assertUuid(resultA1.user_id);
          assertEquals(resultA1.user_id, resultB1.user_id);

          // Lifetime changes, 4 concurrent requests across the 2 parsers all
          // return the same id value. (One of them successfully creates the
          // random state of the new lifetime.)
          await time.tickAsync(1);
          const results = await Promise.all(
            [run(parserA), run(parserA), run(parserB), run(parserB)],
          );
          // The lifetime changed, so ids changed
          assertNotEquals(results[0].user_id, resultA1.user_id);
          assertUuid(results[0].user_id);
          for (let i = 1; i < 4; ++i) {
            assertEquals(results[0].user_id, results[i].user_id);
          }
        },
      );

      await t.step("lifetimes are random, not deterministic", async () => {
        const options: RunOptions = { lifetime: { unit: "months", count: 1 } };
        const lifetime1 = timestamp("2002-03-04T05:00:00Z");
        const lifetime2 = timestamp("2002-04-04T05:00:00Z");
        let time = new FakeTime(lifetime1);

        const resultA1 = await run(options);
        await time.tickAsync(lifetime2);
        const resultA2 = await run(options);

        // Roll back time and repeat
        time = new FakeTime(lifetime1);

        const resultB1 = await run(options);
        await time.tickAsync(lifetime2);
        const resultB2 = await run(options);

        const results = [resultA1, resultA2, resultB1, resultB2];
        const uniqueIds = new Set(results.map((r) => r.user_id));

        // All IDs are unique, because the second time we went through the same
        // lifetime intervals we generated unique values to seed the ids with.
        assertEquals(uniqueIds.size, 4);
        for (const user_id in uniqueIds) {
          assertUuid(user_id);
        }
      });
    });

    await t.step("measurement_id affects id namespace", async (t) => {
      await t.step("generated ids are different", async () => {
        const resultA1 = await run({ measurement_id: "A" });
        const resultB1 = await run({ measurement_id: "B" });
        const resultA2 = await run({ measurement_id: "A" });
        const resultB2 = await run({ measurement_id: "B" });

        assertEquals(resultA1.user_id, resultA2.user_id);
        assertEquals(resultB1.user_id, resultB2.user_id);
        assertNotEquals(resultA1.user_id, resultB1.user_id);
      });

      await t.step("scrambled ids are different", async () => {
        const options: RunOptions = { user_id: "foo", policy: "scramble" };
        const resultA1 = await run({ ...options, measurement_id: "A" });
        const resultB1 = await run({ ...options, measurement_id: "B" });
        const resultA2 = await run({ ...options, measurement_id: "A" });
        const resultB2 = await run({ ...options, measurement_id: "B" });

        assertEquals(resultA1.user_id, resultA2.user_id);
        assertEquals(resultB1.user_id, resultB2.user_id);
        assertNotEquals(resultA1.user_id, resultB1.user_id);
      });
    });
  });

  kv.close();
});

Deno.test("DefaultTimeBucket", async (t) => {
  const bucket = new DefaultTimeBucket({
    unit: "months",
    "count": 2,
    from: date("2024-06-01"),
  });
  await t.step("getTimeBucket()", async (t) => {
    await t.step("argument time default is now", () => {
      assertEquals(bucket.getTimeBucket(), bucket.getTimeBucket(new Date()));
    });

    await t.step("buckets times before, on and after the from date", () => {
      const aStart = bucket.getTimeBucket(date("2024-04-01T00:00:00.000Z"));
      const aEnd = bucket.getTimeBucket(date("2024-06-01T00:00:00.000Z", -1));
      const bStart = bucket.getTimeBucket(bucket.from);
      const bEnd = bucket.getTimeBucket(date("2024-08-01T00:00:00.000Z", -1));
      const cStart = bucket.getTimeBucket(date("2024-08-01T00:00:00.000Z"));
      const cEnd = bucket.getTimeBucket(date("2024-10-01T00:00:00.000Z", -1));

      assertEquals(aStart, aEnd);
      assertEquals(bStart, bEnd);
      assertEquals(cStart, cEnd);

      assertEquals(new Set([aStart, bStart, cStart]).size, 3);
    });
  });
});

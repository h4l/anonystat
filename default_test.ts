import { ErrorResult } from "./_misc.ts";
import { assertSuccessful, assertUnsuccessful } from "./_testing.ts";
import {
  approvedRequestDestinationSelector,
  createPayloadParser,
  createProxySender,
  defaultPayloadParser,
  defaultProxySender,
  defaultRequestReader,
  defaultResponseWriter,
  GA4MPDestination,
  matchDefaultGA4MPUrls,
} from "./default.ts";
import { assert, StatusCodes, z } from "./deps.ts";
import { assertEquals, assertSnapshot, stub, toText } from "./dev_deps.ts";
import {
  ApprovedCollectRequestMeta,
  DebugRequestMeta,
  RequestMeta,
} from "./meta.ts";
import { RequestName } from "./meta.ts";
import { AnyPayload } from "./payload-schemas.ts";
import {
  GA4MPPayload,
  MatchedErrorNames,
  PayloadParseError,
  PayloadParser,
  ProxySender,
  ProxySendError,
  RequestReadError,
  UnknownPayload,
} from "./proxy.ts";

Deno.test("matchDefaultGA4MPUrls()", async (t) => {
  const completed = Promise.reject("not used");
  completed.catch(() => {}); // ignore

  const info: Deno.ServeHandlerInfo = {
    completed,
    remoteAddr: { hostname: "example", port: 12345, transport: "tcp" },
  };

  function req(url: string): [request: Request, info: Deno.ServeHandlerInfo] {
    return [new Request(url, { headers: { "x-foo": "bar" } }), info];
  }

  await t.step("Does not match unknown request", () => {
    const url = "https://example.com/";
    const [request, info] = req(url);
    const result = matchDefaultGA4MPUrls(request, info);

    assertEquals(result.name, null);
    assertEquals(result.url, new URL(url));
    assertEquals(result.headers, request.headers);
  });

  await t.step("Matches collect request", () => {
    const url =
      "https://example.com/mp/collect?measurement_id=foo&api_secret=bar";
    const [request, info] = req(url);
    const result = matchDefaultGA4MPUrls(request, info);

    assertEquals(result.url, new URL(url));
    assertEquals(result.headers, request.headers);
    assert(result.name === RequestName.collect);
    assertEquals(result.debug, false);
    assertEquals(result.measurement_id, "foo");
    assertEquals(result.api_secret, "bar");
  });

  await t.step("Matches debug collect request", () => {
    const url =
      "https://example.com/debug/mp/collect?measurement_id=foo&api_secret=bar";
    const [request, info] = req(url);
    const result = matchDefaultGA4MPUrls(request, info);

    assertEquals(result.url, new URL(url));
    assertEquals(result.headers, request.headers);
    assert(result.name === RequestName.debugCollect);
    assertEquals(result.debug, true);
    assertEquals(result.measurement_id, "foo");
    assertEquals(result.api_secret, "bar");
  });
});

Deno.test("defaultRequestReader()", async (t) => {
  const url =
    "https://example.com/mp/collect?measurement_id=foo&api_secret=bar";

  const payload: AnyPayload = { client_id: "test", events: [] };

  function createRequest(
    {
      method = "POST",
      contentType = "application/json",
      body = JSON.stringify(payload),
      ioError = false,
    }: {
      method?: string;
      contentType?: string;
      body?: string;
      ioError?: boolean;
    } = {},
  ): [request: Request, meta: RequestMeta] {
    const headers = new Headers({
      "content-type": contentType,
    });
    const request = new Request(url, { method, headers, body });
    if (ioError) {
      stub(request, "json", () => {
        throw new Deno.errors.ConnectionReset();
      });
    }
    return [request, { url: new URL(url), headers }];
  }

  await t.step("reads valid request", async () => {
    const [request, requestMeta] = createRequest();
    const result = await defaultRequestReader(request, { requestMeta });
    assertSuccessful(result);
    assertEquals(result.data.payload, payload);
  });

  await t.step("rejects requests with methods other than POST", async () => {
    const [request, requestMeta] = createRequest({ method: "PUT" });
    const result = await defaultRequestReader(request, { requestMeta });
    assertUnsuccessful(result);
    assertEquals(result.error.name, "incorrect-request-method");
  });

  await t.step("rejects requests without JSON content type", async () => {
    const [request, requestMeta] = createRequest({ contentType: "foo/bar" });
    const result = await defaultRequestReader(request, { requestMeta });
    assertUnsuccessful(result);
    assertEquals(result.error.name, "incorrect-content-type");
  });

  await t.step("rejects requests with syntactically-invalid JSON", async () => {
    const [request, requestMeta] = createRequest({ body: "{" });
    const result = await defaultRequestReader(request, { requestMeta });
    assertUnsuccessful(result);
    assertEquals(result.error.name, "body-not-valid-json");
  });

  await t.step("rejects requests that cannot be read", async () => {
    const [request, requestMeta] = createRequest({ ioError: true });
    const result = await defaultRequestReader(request, { requestMeta });
    assertUnsuccessful(result);
    assertEquals(result.error.name, "request-io-error");
  });
});

Deno.test("defaultResponseWriter()", async (t) => {
  const requestMeta: RequestMeta = {
    url: new URL("https://example.com/mp/collect"),
    headers: new Headers(),
  };
  const debugRequestMeta: RequestMeta & DebugRequestMeta = {
    ...requestMeta,
    debug: true,
  };

  await t.step("success sends no content", async () => {
    const response = await defaultResponseWriter({
      success: true,
      data: { payload: { payload: {} }, proxyResult: {} },
    }, { requestMeta });

    assertEquals(response.status, StatusCodes.NO_CONTENT);
    assertEquals(response.body, null);
  });

  type ForwardingError = RequestReadError | PayloadParseError | ProxySendError;

  const errorStatuses: [error: ForwardingError, status: number][] = [
    [{ name: "aborted" }, StatusCodes.INTERNAL_SERVER_ERROR],
    [{ name: "body-not-valid-json" }, StatusCodes.BAD_REQUEST],
    [{ name: "incorrect-content-type" }, StatusCodes.NOT_ACCEPTABLE],
    [{ name: "incorrect-request-method" }, StatusCodes.METHOD_NOT_ALLOWED],
    [
      { name: "invalid-ga4mp-payload", zodError: new z.ZodError([]) },
      StatusCodes.BAD_REQUEST,
    ],
    [{ name: "proxy-io-error" }, StatusCodes.BAD_GATEWAY],
    [{ name: "proxy-response-status", status: 500 }, StatusCodes.BAD_GATEWAY],
    [{ name: "request-io-error" }, StatusCodes.BAD_REQUEST],
    [{ name: "timeout" }, StatusCodes.GATEWAY_TIMEOUT],
  ];

  assertEquals(
    new Set(errorStatuses.map(([e]) => e.name)),
    new Set(Object.values(MatchedErrorNames.Enum)),
    "errors test cases don't match known error names",
  );

  for (const [error, status] of errorStatuses) {
    await t.step(
      `error ${error.name} response with status ${status}`,
      async () => {
        const response = await defaultResponseWriter(
          { success: false, error },
          { requestMeta },
        );

        assertEquals(response.status, status);
      },
    );
  }

  await t.step("invalid-ga4mp-payload response", async (t) => {
    function invalidPayloadError(): ErrorResult<PayloadParseError> {
      return {
        success: false,
        error: {
          name: "invalid-ga4mp-payload",
          zodError: new z.ZodError([{
            code: "invalid_type",
            expected: "string",
            received: "array",
            path: ["user_id"],
            message: "Must be a string",
          }]),
        },
      };
    }

    await t.step("contains details of error in debug mode", async (t) => {
      const response = await defaultResponseWriter(invalidPayloadError(), {
        requestMeta: debugRequestMeta,
      });

      assertEquals(response.status, StatusCodes.BAD_REQUEST);
      assert(response.body);
      await assertSnapshot(t, await toText(response.body));
    });

    await t.step("omits details of error in non-debug mode", async () => {
      const response = await defaultResponseWriter(invalidPayloadError(), {
        requestMeta, // non-debug
      });

      assertEquals(response.status, StatusCodes.BAD_REQUEST);
      assert(response.body);
      assertEquals(
        await toText(response.body),
        "Request body is not a valid GA4 Measurement Protocol payload",
      );
    });
  });

  await t.step("handles unexpected error values", async () => {
    const response = await defaultResponseWriter(
      // deno-lint-ignore no-explicit-any
      { success: false, error: {} as any },
      { requestMeta },
    );

    assertEquals(response.status, StatusCodes.INTERNAL_SERVER_ERROR);
    assert(response.body);
    assertEquals(
      await toText(response.body),
      "Unknown error: undefined",
    );
  });
});

Deno.test("approvedRequestDestinationSelector()", async () => {
  const payload: UnknownPayload = { payload: {} };
  const endpoint = "https://dest.example.com/mp/collect";
  const measurement_id = "exampleId";
  const api_secret = "exampleSec";
  const requestMeta: ApprovedCollectRequestMeta = {
    url: new URL("https://example.com/mp/collect"),
    headers: new Headers(),
    name: RequestName.collect,
    debug: false,
    measurement_id,
    api_secret,
    endpoint,
  };

  const destination: GA4MPDestination = approvedRequestDestinationSelector({
    payload,
    requestMeta,
  });

  assertEquals(destination, { measurement_id, api_secret, endpoint });
});

async function testPayloadParser<T>(
  t: Deno.TestContext,
  { validInput, validOutput, invalidInput, parseError, payloadParser }: {
    validInput: unknown;
    validOutput: T;
    invalidInput: unknown;
    parseError: string;
    payloadParser: PayloadParser<
      UnknownPayload,
      GA4MPPayload<T>,
      PayloadParseError,
      RequestMeta
    >;
  },
) {
  const requestMeta: RequestMeta = {
    url: new URL("https://example.com/mp/collect"),
    headers: new Headers(),
  };

  await t.step("accepts payload matching schema", async () => {
    const result = await payloadParser({ payload: validInput }, {
      requestMeta,
    });
    assertSuccessful(result);
    assertEquals(result.data, { payload: validOutput });
  });

  await t.step("rejects payload not matching schema", async () => {
    const result = await payloadParser({ payload: invalidInput }, {
      requestMeta,
    });
    assertUnsuccessful(result);
    assertEquals(result.error.name, "invalid-ga4mp-payload");

    assertEquals(result.error.zodError.issues.map((i) => i.message), [
      parseError,
    ]);
  });
}

Deno.test("createPayloadParser()", async (t) => {
  const payloadParser = createPayloadParser(
    z.object({ foo: z.string().pipe(z.coerce.number()) }),
  );

  await testPayloadParser(t, {
    payloadParser,
    validInput: { foo: "42" },
    validOutput: { foo: 42 },
    invalidInput: { foo: true },
    parseError: "Expected string, received boolean",
  });
});

Deno.test("defaultPayloadParser()", async (t) => {
  await testPayloadParser(t, {
    payloadParser: defaultPayloadParser,
    validInput: { client_id: "test", events: [], ignored: true },
    validOutput: { client_id: "test", events: [] },
    invalidInput: { client_id: "test", events: {} },
    parseError: "Expected array, received object",
  });
});

function nextAbortEvent(signal: AbortSignal): Promise<Event> {
  return new Promise((resolve) => {
    signal.addEventListener("abort", resolve);
  });
}

function stubFetchToBlockUntilAbort() {
  return stub(
    globalThis,
    "fetch",
    async (input, init = {}) => {
      const signal = input instanceof Request ? input.signal : init.signal;
      assert(signal, "fetch() called without a signal");
      await nextAbortEvent(signal);
      signal.throwIfAborted();
      assert(false, "signal did not throw");
    },
  );
}

async function testProxySender<
  PayloadT extends UnknownPayload,
  ProxySendResultT,
  ProxySendErrorT extends ProxySendError,
  RequestMetaT extends RequestMeta,
>(t: Deno.TestContext, { proxySender, validPayload, requestMeta, sendResult }: {
  proxySender: ProxySender<
    PayloadT,
    ProxySendResultT,
    ProxySendError | ProxySendErrorT,
    RequestMetaT
  >;
  validPayload: PayloadT;
  requestMeta: RequestMetaT;
  sendResult: ProxySendResultT;
}) {
  await t.step(
    "returns result from resultCreator when fetch succeeds",
    async () => {
      using fetchStub = stub(globalThis, "fetch", async () => {
        return new Response(null, { status: StatusCodes.NO_CONTENT });
      });
      const result = await proxySender(validPayload, { requestMeta });
      assertSuccessful(result);
      assertEquals(result.data, sendResult);
      assertEquals(fetchStub.calls.length, 1);
    },
  );

  await t.step(
    "cancels fetch and returns timeout when signal times out",
    async () => {
      const timeout = AbortSignal.timeout(0);
      using fetchStub = stubFetchToBlockUntilAbort();

      const resultP = proxySender(validPayload, {
        requestMeta,
        signal: timeout,
      });
      const result = await resultP;

      assertEquals(fetchStub.calls.length, 1);
      assertUnsuccessful(result);
      assertEquals(result.error.name, "timeout");
    },
  );

  await t.step(
    "cancels fetch and returns aborted error when signal aborts",
    async () => {
      const abort = new AbortController();
      using fetchStub = stubFetchToBlockUntilAbort();

      const resultP = proxySender(validPayload, {
        requestMeta,
        signal: abort.signal,
      });
      abort.abort();
      const result = await resultP;

      assertEquals(fetchStub.calls.length, 1);
      assertUnsuccessful(result);
      assertEquals(result.error.name, "aborted");
    },
  );

  await t.step(
    "returns proxy-io-error error when fetch fails",
    async () => {
      using fetchStub = stub(globalThis, "fetch", async () => {
        // fetch() is specc'd to throw TypeError for network errors:
        // See 5.6 / 12 / 3 in https://fetch.spec.whatwg.org/#fetch-method
        throw new TypeError("network error");
      });

      const result = await proxySender(validPayload, { requestMeta });

      assertEquals(fetchStub.calls.length, 1);
      assertUnsuccessful(result);
      assert(result.error.name === "proxy-io-error");
      assertEquals(result.error.message, "network error");
    },
  );

  await t.step(
    "returns proxy-response-status error when fetch response is not ok",
    async () => {
      using fetchStub = stub(globalThis, "fetch", async () => {
        return new Response(null, {
          status: StatusCodes.IM_A_TEAPOT,
        });
      });

      const result = await proxySender(validPayload, { requestMeta });

      assertEquals(fetchStub.calls.length, 1);
      assertUnsuccessful(result);
      assert(result.error.name === "proxy-response-status");
      assertEquals(result.error.status, StatusCodes.IM_A_TEAPOT);
    },
  );
}

Deno.test("createProxySender()", async (t) => {
  const payload: UnknownPayload = { payload: {} };
  const endpoint = "https://dest.example.com/mp/collect";
  const measurement_id = "exampleId";
  const api_secret = "exampleSec";
  const requestMeta: ApprovedCollectRequestMeta = {
    url: new URL("https://example.com/mp/collect"),
    headers: new Headers(),
    name: RequestName.collect,
    debug: false,
    measurement_id,
    api_secret,
    endpoint,
  };

  const proxySender = createProxySender({
    destinationSelector(options): GA4MPDestination {
      assertEquals(options.payload, payload);
      assertEquals(options.requestMeta, requestMeta);

      return {
        measurement_id: "id",
        api_secret: "sec",
        endpoint: "https://example.com/mp/collect",
      };
    },
    resultCreator({ request, response, error, ...options }) {
      assertEquals(options.payload, payload);
      assertEquals(options.requestMeta, requestMeta);

      assertEquals(
        request.url,
        "https://example.com/mp/collect?api_secret=sec&measurement_id=id",
      );

      if (error === null) {
        assertEquals(response?.status, StatusCodes.NO_CONTENT);
        return { success: true, data: "foo" };
      }

      return { success: false, error };
    },
  });

  await testProxySender(t, {
    proxySender,
    requestMeta,
    sendResult: "foo",
    validPayload: payload,
  });
});

Deno.test("defaultProxySender()", async (t) => {
  const requestMeta: ApprovedCollectRequestMeta = {
    url: new URL("https://example.com/mp/collect"),
    headers: new Headers(),
    name: RequestName.collect,
    debug: false,
    measurement_id: "exampleId",
    api_secret: "exampleSec",
    endpoint: "https://dest.example.com/mp/collect",
  };

  await testProxySender(t, {
    proxySender: defaultProxySender,
    requestMeta,
    sendResult: null,
    validPayload: {
      payload: { client_id: "test", events: [] } satisfies AnyPayload,
    },
  });
});

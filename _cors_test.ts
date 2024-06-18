import {
  CorsResponseHeader,
  DefaultCorsPolicy,
  DefaultCorsPolicyOptions,
  Wildcard,
} from "./_cors.ts";
import { assertNull } from "./_testing.ts";
import { assertEquals } from "./dev_deps.ts";

Deno.test("DefaultCorsPolicy", async (t) => {
  await t.step(CorsResponseHeader.allowOrigin, async (t) => {
    const params: [name: string, policyOptions: DefaultCorsPolicyOptions][] = [
      ["string", { allowOrigin: "https://example.com" }],
      ["regex", { allowOrigin: /^https:\/\/example.com$/ }],
      ["fn", { allowOrigin: (o) => o === "https://example.com" }],
      ["list", { allowOrigin: ["https://x.y.com", "https://example.com"] }],
    ];

    for (const [name, policyOptions] of params) {
      await t.step(`accepts origin matching ${name}`, () => {
        const responseHeaders = getCorsHeaders(policyOptions);

        assertEquals(
          responseHeaders.get(CorsResponseHeader.allowOrigin),
          "https://example.com",
        );
      });

      await t.step(`does not accept origin not matching ${name}`, () => {
        const requestHeaders = new Headers({
          origin: "https://foo.example.com",
        });
        const responseHeaders = getCorsHeaders(policyOptions, requestHeaders);

        assertNull(responseHeaders.get(CorsResponseHeader.allowOrigin));
      });
    }

    await t.step(`regex must match full origin`, () => {
      const responseHeaders = getCorsHeaders({
        allowOrigin: /example/,
      });

      assertNull(responseHeaders.get(CorsResponseHeader.allowOrigin));
    });

    await t.step(`regex is case insensitive`, () => {
      const responseHeaders = getCorsHeaders({
        allowOrigin: /https:\/\/ExAmPle\.com/,
      });

      assertEquals(
        responseHeaders.get(CorsResponseHeader.allowOrigin),
        "https://example.com",
      );
    });

    await t.step(`accepts any origin for wildcard`, () => {
      const responseHeaders = getCorsHeaders({
        allowOrigin: Wildcard,
      });

      assertEquals(responseHeaders.get(CorsResponseHeader.allowOrigin), "*");
    });

    await t.step(`accepts no origin for null allowOrigin`, () => {
      const responseHeaders = getCorsHeaders({
        allowOrigin: null,
      });

      assertNull(responseHeaders.get(CorsResponseHeader.allowOrigin));
    });

    await t.step("Vary", async (t) => {
      await t.step(`adds vary header containing origin`, () => {
        const responseHeaders = getCorsHeaders({
          allowOrigin: "https://example.com",
        });

        assertEquals(responseHeaders.get("vary"), "Origin");
      });

      await t.step(`extends vary header with origin header`, () => {
        const responseHeaders = getCorsHeaders(
          { allowOrigin: "https://example.com" },
          undefined,
          { vary: "Foo, Bar" },
        );

        assertEquals(responseHeaders.get("vary"), "Foo, Bar, Origin");
      });

      await t.step(`leaves vary header already containing origin`, () => {
        const responseHeaders = getCorsHeaders(
          { allowOrigin: "https://example.com" },
          undefined,
          { vary: "Foo, oRigIn , Bar" },
        );

        assertEquals(responseHeaders.get("vary"), "Foo, oRigIn , Bar");
      });
    });
  });

  await t.step(CorsResponseHeader.allowMethods, async (t) => {
    const params: [
      name: string,
      allowMethodsConfig: string | string[] | Wildcard,
      allowMethodsHeader: string,
    ][] = [
      ["single string", "PUT", "PUT"],
      // methods are de-duped and sorted
      ["string array", ["PUT", "DELETE", "DELETE"], "DELETE, PUT"],
      ["wildcard", Wildcard, "*"],
    ];

    for (const p of params) {
      await t.step(`includes allow methods from ${p[0]}`, () => {
        const responseHeaders = getCorsHeaders({
          allowOrigin: Wildcard,
          allowMethods: p[1],
        });

        assertEquals(
          responseHeaders.get(CorsResponseHeader.allowMethods),
          p[2],
        );
      });
    }

    await t.step(`omits when null`, () => {
      const responseHeaders = getCorsHeaders({
        allowOrigin: Wildcard,
      });

      assertNull(responseHeaders.get(CorsResponseHeader.allowMethods));
    });
  });

  await t.step(CorsResponseHeader.maxAge, async (t) => {
    await t.step(`includes max age`, () => {
      const responseHeaders = getCorsHeaders({
        allowOrigin: Wildcard,
        maxAge: 60 * 1000,
      });

      assertEquals(
        responseHeaders.get(CorsResponseHeader.maxAge),
        "60000",
      );
    });

    await t.step(`omits max age when null`, () => {
      const responseHeaders = getCorsHeaders({ allowOrigin: Wildcard });

      assertNull(responseHeaders.get(CorsResponseHeader.maxAge));
    });
  });

  await t.step(CorsResponseHeader.allowCredentials, async (t) => {
    await t.step(`includes allow credentials when true`, () => {
      const responseHeaders = getCorsHeaders({
        allowOrigin: Wildcard,
        allowCredentials: true,
      });

      assertEquals(
        responseHeaders.get(CorsResponseHeader.allowCredentials),
        "true",
      );
    });

    for (const value of [false, undefined]) {
      await t.step(`omits allow credentials when ${value}`, () => {
        const responseHeaders = getCorsHeaders({
          allowOrigin: Wildcard,
          allowCredentials: value,
        });

        assertNull(responseHeaders.get(CorsResponseHeader.allowCredentials));
      });
    }
  });

  await t.step(CorsResponseHeader.allowHeaders, async (t) => {
    const params: [
      name: string,
      allowHeadersConfig: string | string[] | Wildcard | null | undefined,
      allowHeadersHeader: string | null,
    ][] = [
      ["single string", "Content-Type", "Content-Type"],
      // methods are de-duped (keeping first) and sorted
      ["string array", ["x-bAr", "X-Foo", "X-Bar", "x-fOo"], "x-bAr, X-Foo"],
      ["wildcard", Wildcard, "*"],
      ["null", null, null],
      ["undefined", undefined, null],
    ];

    for (const p of params) {
      await t.step(`includes allowed headers from ${p[0]}`, () => {
        const responseHeaders = getCorsHeaders({
          allowOrigin: Wildcard,
          allowHeaders: p[1],
        });

        assertEquals(
          responseHeaders.get(CorsResponseHeader.allowHeaders),
          p[2],
        );
      });
    }
  });

  function getCorsHeaders(
    policyOptions: DefaultCorsPolicyOptions,
    requestHeaders: HeadersInit = { origin: "https://example.com" },
    responseHeaders: HeadersInit = {},
  ): Headers {
    const _responseHeaders = new Headers(responseHeaders);
    new DefaultCorsPolicy(policyOptions).getCorsResponseHeaders(
      new Headers(requestHeaders),
      _responseHeaders,
    );
    return _responseHeaders;
  }
});

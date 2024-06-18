import { StatusCodes } from "./deps.ts";
import { RequestMeta } from "./meta.ts";
import { ForwardAndRespondOptions, RequestForwarder } from "./types.ts";

/** HTTP request/response middleware for {@link RequestForwarder}. */
export interface RequestForwarderMiddleware<
  OuterRequestMetaT extends RequestMeta,
  InnerRequestMetaT extends RequestMeta = OuterRequestMetaT,
> extends RequestForwarder<OuterRequestMetaT> {
  readonly inner: RequestForwarder<InnerRequestMetaT>;
}

abstract class BaseRequestForwarderMiddleware<
  OuterRequestMetaT extends RequestMeta,
  InnerRequestMetaT extends RequestMeta = OuterRequestMetaT,
> implements RequestForwarder<OuterRequestMetaT> {
  constructor(readonly inner: RequestForwarder<InnerRequestMetaT>) {}

  abstract forwardAndRespond(
    options: ForwardAndRespondOptions<OuterRequestMetaT>,
  ): Promise<Response>;
}

export enum CorsResponseHeader {
  allowOrigin = "Access-Control-Allow-Origin",
  maxAge = "Access-Control-Max-Age",
  allowMethods = "Access-Control-Allow-Methods",
  allowCredentials = "Access-Control-Allow-Credentials",
  allowHeaders = "Access-Control-Allow-Headers",
}

/** Represents the `*` value used by several CORS headers. */
export const Wildcard = Symbol("Wildcard");
export type Wildcard = typeof Wildcard;

export enum HttpMethods {
  CONNECT = "CONNECT",
  DELETE = "DELETE",
  GET = "GET",
  HEAD = "HEAD",
  OPTIONS = "OPTIONS",
  PATCH = "PATCH",
  POST = "POST",
  PUT = "PUT",
  TRACE = "TRACE",
}
export type HttpMethod = HttpMethods | string;

type OriginPredicate = (origin: string) => boolean;

// Values from https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Max-Age#delta-seconds
export const CORS_MAX_AGE_FIREFOX = 24 * 60 * 60 * 1000;
export const CORS_MAX_AGE_CHROME76 = 2 * 60 * 60 * 1000;

/** Responsible for setting CORS response headers. */
export interface CorsPolicy {
  /** Set CORS headers in responseHeaders.
   *
   * @param requestHeaders The headers of the request. Not modified.
   * @param responseHeaders The headers of the response. **Modified**.
   */
  getCorsResponseHeaders(
    requestHeaders: Headers,
    responseHeaders: Headers,
  ): void | Promise<void>;
}

export type DefaultCorsPolicyOptions = {
  allowOrigin:
    | OriginPredicate
    | RegExp
    | string
    | Iterable<string>
    | Wildcard
    | null;
  maxAge?: number | null;
  allowMethods?: HttpMethod | Iterable<HttpMethod> | Wildcard | null;
  allowCredentials?: boolean;
  allowHeaders?: string | Iterable<string> | Wildcard | null;
};

const caseInsensitive = new Intl.Collator("en", { sensitivity: "base" });

/** Set CORS headers on requests whose origin matches a predicate function. */
export class DefaultCorsPolicy implements CorsPolicy {
  readonly allowOrigin: OriginPredicate | Wildcard | null;
  readonly maxAge: number | null;
  readonly allowMethods: ReadonlySet<HttpMethod> | Wildcard | null;
  readonly allowCredentials: boolean;
  readonly allowHeaders: ReadonlySet<string> | Wildcard | null;
  #allowMethodsValue: string | undefined;
  #allowHeadersValue: string | undefined;

  constructor(options: DefaultCorsPolicyOptions) {
    const allowOrigin = options?.allowOrigin ?? null;
    this.allowOrigin = (allowOrigin === null || allowOrigin === Wildcard ||
        typeof allowOrigin === "function")
      ? allowOrigin
      : DefaultCorsPolicy.getOriginPredicate(allowOrigin);

    this.maxAge = options?.maxAge ?? null;
    if (this.maxAge !== null && this.maxAge < 0) {
      throw new Error(`maxAge cannot be negative >= 0: ${this.maxAge}`);
    }

    if (options.allowMethods === Wildcard) {
      this.allowMethods = Wildcard;
      this.#allowMethodsValue = "*";
    } else if (options.allowMethods) {
      this.allowMethods = new Set(
        typeof options.allowMethods === "string"
          ? [options.allowMethods]
          : options.allowMethods,
      );
      this.#allowMethodsValue = [...this.allowMethods].toSorted().join(
        ", ",
      );
    } else {
      this.allowMethods = null;
      this.#allowMethodsValue = undefined;
    }

    this.allowCredentials = options.allowCredentials ?? false;

    const [allowHeaders, allowHeadersValue] = this.getNormalisedHeaders(
      options.allowHeaders ?? null,
    );
    this.allowHeaders = allowHeaders;
    this.#allowHeadersValue = allowHeadersValue;
  }

  private getNormalisedHeaders(
    headers: string | Iterable<string> | Wildcard | null,
  ): [ReadonlySet<string> | Wildcard | null, string | undefined] {
    if (headers === null) return [null, undefined];
    if (headers === Wildcard) return [Wildcard, "*"];

    if (typeof headers === "string") {
      headers = [headers];
    }

    // De-dupe and sort headers, using the capitalised form of the
    // first-occurring duplicate.
    const uniqueHeaders = new Map<string, string>();
    for (const header of headers) {
      if (/[\s,]/.test(header)) {
        throw new Error(`Invalid header name: ${JSON.stringify(header)}`);
      }
      const key = header.toLowerCase();
      if (uniqueHeaders.has(key)) continue;
      uniqueHeaders.set(key, header);
    }
    return [
      new Set(uniqueHeaders.keys()),
      [...uniqueHeaders.values()].toSorted((a, b) =>
        caseInsensitive.compare(a, b)
      ).join(", "),
    ];
  }

  private static getOriginPredicate(
    allowOrigin: string | Iterable<string> | RegExp,
  ): OriginPredicate {
    if (typeof allowOrigin === "string") {
      return (origin: string) => origin === allowOrigin;
    }
    if (Symbol.iterator in allowOrigin) {
      const allowOrigins = new Set(allowOrigin);
      return (origin: string) => allowOrigins.has(origin);
    }
    const fullMatch = new RegExp(`^(?:${allowOrigin.source})$`, "i");
    return (origin: string) => fullMatch.test(origin);
  }

  getCorsResponseHeaders(
    requestHeaders: Headers,
    responseHeaders: Headers,
  ): void {
    const origin = requestHeaders.get("origin");
    if (this.allowOrigin === Wildcard) {
      responseHeaders.set(CorsResponseHeader.allowOrigin, "*");
    } else if (this.allowOrigin) {
      // The response depends on the request origin, so we need to vary on Origin.
      ensureVaryHeaderExists(responseHeaders, "Origin");

      if (origin !== null && this.allowOrigin(origin)) {
        responseHeaders.set(CorsResponseHeader.allowOrigin, origin);
      }
    }

    if (this.maxAge !== null) {
      responseHeaders.set(CorsResponseHeader.maxAge, String(this.maxAge));
    }

    if (typeof this.#allowMethodsValue === "string") {
      responseHeaders.set(
        CorsResponseHeader.allowMethods,
        this.#allowMethodsValue,
      );
    }

    if (this.allowCredentials) {
      responseHeaders.set(CorsResponseHeader.allowCredentials, "true");
    }

    if (typeof this.#allowHeadersValue === "string") {
      responseHeaders.set(
        CorsResponseHeader.allowHeaders,
        this.#allowHeadersValue,
      );
    }
  }
}

/** Ensure `headers` contains a Vary header containing `varyHeader`.
 *
 * `varyHeader` is not duplicated if a Vary header already exists with it.
 */
function ensureVaryHeaderExists(headers: Headers, varyHeader: string): void {
  const vary = headers.get("vary");
  if (!vary) {
    headers.set("vary", varyHeader);
    return;
  }

  const target = varyHeader.toLowerCase();
  const varyHeaders = vary.toLowerCase().trim().split(/\s*,\s/);
  for (const vh of varyHeaders) if (vh === target) return;

  headers.set("vary", `${vary}, ${varyHeader}`);
}

/** Wrap a {@link RequestForwarder} to respond with CORS headers.
 *
 * OPTIONS requests are not passed to the inner request forwarder. Requests with
 * other methods are. Requests with methods have CORS headers added.
 */
export class CorsMiddleware<RequestMetaT extends RequestMeta>
  extends BaseRequestForwarderMiddleware<RequestMetaT> {
  readonly corsPolicy: CorsPolicy;
  constructor(
    inner: RequestForwarder<RequestMetaT>,
    options: { corsPolicy: CorsPolicy },
  ) {
    super(inner);
    this.corsPolicy = options.corsPolicy;
  }

  async forwardAndRespond(
    options: ForwardAndRespondOptions<RequestMetaT>,
  ): Promise<Response> {
    const { request } = options;

    const response = request.method === HttpMethods.OPTIONS
      ? new Response(null, { status: StatusCodes.NO_CONTENT })
      : await this.inner.forwardAndRespond(options);

    this.corsPolicy.getCorsResponseHeaders(request.headers, response.headers);

    return response;
  }
}

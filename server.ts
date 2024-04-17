import { StatusCodes, z } from "./deps.ts";

import { AnyPayload } from "./payload-schemas.ts";
import { GA4MP_URL } from "./constants.ts";

// interface CollectUrlData {
//   name: "collect" | "debug-collect";
//   measurement_id: string | null;
//   api_secret: string | null;
// }

// function parseUrl(url: URL): CollectUrlData | null {
//   if (url.pathname !== "/mp/collect") return null;

//   return {
//     name: "collect",
//     measurement_id: url.searchParams.get("measurement_id"),
//     api_secret: url.searchParams.get("api_secret"),
//   };
// }

// TODO: should requestMatcher return a result that allows selecting a body
// parser/proxier etc? This way each different request type can resolve to a
// different type-safe proxier, rather than munging multiple into one.

type EmptyObject = Record<string | number | symbol, never>;

export type Error<NameT extends string, DetailsT = unknown> =
  & { name: NameT }
  & DetailsT;
// & (DetailsT extends undefined ? { details?: undefined }
//   : { details: DetailsT });

export type SuccessResult<T> = { success: true; data: T };
export type ErrorResult<E> = { success: false; error: E };
export type Result<T, E> = SuccessResult<T> | ErrorResult<E>;

export type RequestMatchError = Error<"proxy-not-found">;

export type RequestReadError =
  | Error<"incorrect-request-method">
  | Error<"incorrect-content-type">
  | Error<"body-not-valid-json">
  | Error<"request-io-error">;

// export type RequestParseError = Error<"placeholder">; // FIXME
export type PayloadParseError = Error<
  "invalid-ga4mp-payload",
  { zodError: z.ZodError }
>; // FIXME

export type ProxySendErrorAborted = Error<"aborted", { message?: string }>;
export type ProxySendErrorTimeout = Error<"timeout", { message?: string }>;
export type ProxySendErrorIO = Error<"proxy-io-error", { message?: string }>;
export type ProxySendErrorResponseStatus = Error<
  "proxy-response-status",
  { status: number }
>;
export type ProxySendError =
  | ProxySendErrorAborted
  | ProxySendErrorTimeout
  | ProxySendErrorIO
  | ProxySendErrorResponseStatus;

/** Metadata on how an incoming Request matched a proxy route. */
export interface RequestMeta {
  url: URL;
  headers: Headers;
}

export type RequestMetaOptions<RequestMetaT> = { requestMeta: RequestMetaT };

export type UnknownProxyOptions<M extends RequestMeta> = ProxyOptions<
  UnknownPayload,
  UnknownPayload,
  unknown,
  M,
  unknown,
  unknown,
  unknown
>;

export type RequestMatcherResult<
  T extends UnknownProxyOptions<M>,
  M extends RequestMeta,
> = { proxy: T; requestMeta: M };

// FIXME: Do we need to provide a fn that receives the paired values?
//   - I think we do...
export type RequestMatcher<RequestMatchErrorT = RequestMatchError> = <
  ResultT,
>(
  options: { request: Request; info: Deno.ServeHandlerInfo },
  callback: <T extends UnknownProxyOptions<M>, M extends RequestMeta>(
    match: RequestMatcherResult<T, M>,
  ) => ResultT | Promise<ResultT>,
) =>
  | Result<ResultT, RequestMatchErrorT>
  | Promise<Result<ResultT, RequestMatchErrorT>>;

/** Called to provide an HTTP response when the request is not a collect request. */
export type FallbackHandler<RequestMatchErrorT = RequestMatchError> = (
  request: Request,
  info: Deno.ServeHandlerInfo & { requestMatchError: RequestMatchErrorT },
) => Response | Promise<Response>;

/** The result of successfully parsing the request body as JSON.
 *
 * Expected to be a GA4 mp request, but not validated, so could be any JSON
 * data.
 */
export type GA4MPPayload<T> = {
  payload: T;
};

export type UnknownPayload = GA4MPPayload<unknown>;
// export type ReadRequest<T, M> = {};

// TODO: we can use the read result to hold custom request meta if needed, don't need separate meta type
// TODO: should we pass matchinfo rather than requestmeta?
export type RequestReader<
  RawPayloadT extends UnknownPayload, // = RawPayload,
  RequestReadErrorT, // = RequestReadError,
  RequestMetaT extends RequestMeta, // = RequestMeta,
> = (
  request: Request,
  options: RequestMetaOptions<RequestMetaT>,
) => Promise<Result<RawPayloadT, RequestReadErrorT>>;

export type PayloadParser<
  RawPayloadT extends UnknownPayload,
  PayloadT extends UnknownPayload,
  PayloadParseErrorT = PayloadParseError,
  RequestMetaT extends RequestMeta = RequestMeta,
> = (
  payload: RawPayloadT,
  options: RequestMetaOptions<RequestMetaT>,
) =>
  | Result<PayloadT, PayloadParseErrorT>
  | Promise<Result<PayloadT, PayloadParseErrorT>>;

export type ProxySenderOptions<RequestMetaT> =
  & RequestMetaOptions<RequestMetaT>
  & { signal?: AbortSignal };

export type ProxySender<
  PayloadT extends UnknownPayload,
  ProxyResultT = void,
  ProxySendErrorT = ProxySendError,
  RequestMetaT extends RequestMeta = RequestMeta,
> = (
  payload: PayloadT,
  options: ProxySenderOptions<RequestMetaT>,
) => Promise<Result<ProxyResultT, ProxySendErrorT>>;

export type ResponseWriter<
  PayloadT extends UnknownPayload,
  ProxyResultT,
  ErrorT,
  RequestMetaT extends RequestMeta = RequestMeta,
> = (
  result: Result<{ payload: PayloadT; proxyResult: ProxyResultT }, ErrorT>,
  options: RequestMetaOptions<RequestMetaT>,
) => Response | Promise<Response>;

type HandlerOptions<RequestMatchErrorT = RequestMatchError> = {
  requestMatcher: RequestMatcher<RequestMatchErrorT>;
  fallbackHandler: FallbackHandler<RequestMatchErrorT>;
};

type ProxyOptions<
  RawPayloadT extends UnknownPayload, // = RawPayload,
  PayloadT extends UnknownPayload, // = GA4MPPayload<AnyPayload, string>,
  ProxyResultT, // = void,
  RequestMetaT extends RequestMeta, // = RequestMeta,
  RequestReadErrorT, // = RequestReadError,
  PayloadParseErrorT, // = PayloadParseError,
  ProxySendErrorT, // = ProxySendError,
> = {
  requestReader: RequestReader<RawPayloadT, RequestReadErrorT, RequestMetaT>;
  payloadParser: PayloadParser<
    RawPayloadT,
    PayloadT,
    PayloadParseErrorT,
    RequestMetaT
  >;
  proxySender: ProxySender<
    PayloadT,
    ProxyResultT,
    ProxySendErrorT,
    RequestMetaT
  >;
  responseWriter: ResponseWriter<
    PayloadT,
    ProxyResultT,
    RequestReadErrorT | PayloadParseErrorT | ProxySendErrorT,
    RequestMetaT
  >;
};

export function serve<HandlerOptionsT extends HandlerOptions>(
  options: HandlerOptionsT,
): Deno.HttpServer {
  return Deno.serve(createHandler(options));
}

export function createHandler<HandlerOptionsT extends HandlerOptions>(
  { requestMatcher, fallbackHandler }: HandlerOptionsT,
): Deno.ServeHandler {
  return async (request: Request, info: Deno.ServeHandlerInfo) => {
    const result = await requestMatcher(
      { request, info },
      async ({ proxy, requestMeta }) => {
        const readResult = await proxy.requestReader(request, { requestMeta });
        if (!readResult.success) {
          return await proxy.responseWriter(readResult, { requestMeta });
        }

        const parseResult = await proxy.payloadParser(
          readResult.data,
          { requestMeta },
        );
        if (!parseResult.success) {
          return await proxy.responseWriter(parseResult, { requestMeta });
        }

        const proxyResult = await proxy.proxySender(
          parseResult.data,
          { requestMeta, signal: request.signal },
        );
        if (!proxyResult.success) {
          return await proxy.responseWriter(proxyResult, { requestMeta });
        }

        return await proxy.responseWriter({
          success: true,
          data: { payload: parseResult.data, proxyResult: proxyResult.data },
        }, { requestMeta });
      },
    );

    if (!result.success) {
      return await fallbackHandler(request, {
        ...info,
        requestMatchError: result.error,
      });
    }
    return result.data;
  };
}

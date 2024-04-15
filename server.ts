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

export type Error<NameT extends string, DetailsT = never> =
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
export type ProxySendError = Error<"placeholder">; // FIXME

export enum RequestName {
  collect = "collect",
}

/** Metadata on how an incoming Request matched a proxy route. */
export interface RequestMeta {
  url: URL;
  headers: Headers;
  name: string | null;
}

export type RequestMatcherResult<
  T extends ProxyOptions<any, any, M>,
  M extends RequestMeta,
> = { proxy: T; requestMeta: M };

export type RequestMatcher<RequestMatchErrorT = RequestMatchError> = <
  T extends ProxyOptions<any, any, M>,
  M extends RequestMeta,
>(
  request: Request,
  info: Deno.ServeHandlerInfo,
) =>
  | Result<RequestMatcherResult<T, M>, RequestMatchErrorT>
  | Promise<Result<RequestMatcherResult<T, M>, RequestMatchErrorT>>;

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
export type GA4MPPayload<T, Optional = never> = {
  payload: T;
  api_secret: string | Optional;
  measurement_id: string | Optional;
};
export type RawPayload = GA4MPPayload<unknown, null>;
// export type ReadRequest<T, M> = {};

// TODO: we can use the read result to hold custom request meta if needed, don't need separate meta type
// TODO: should we pass matchinfo rather than requestmeta?
export type RequestReader<
  RawPayloadT extends GA4MPPayload<unknown, unknown> = RawPayload,
  RequestReadErrorT = RequestReadError,
  RequestMetaT extends RequestMeta = RequestMeta,
> = (
  request: Request,
  requestMeta: RequestMetaT,
) => Promise<Result<RawPayloadT, RequestReadErrorT>>;

export type PayloadParser<
  RawPayloadT extends GA4MPPayload<unknown, unknown>,
  PayloadT extends GA4MPPayload<unknown, string>,
  PayloadParseErrorT = PayloadParseError,
  RequestMetaT extends RequestMeta = RequestMeta,
> = (
  payload: RawPayloadT,
  requestMeta: RequestMetaT,
) =>
  | Result<PayloadT, PayloadParseErrorT>
  | Promise<Result<PayloadT, PayloadParseErrorT>>;

export type ProxySender<
  PayloadT extends GA4MPPayload<unknown, string>,
  ProxyResultT = void,
  ProxySendErrorT = ProxySendError,
  RequestMetaT extends RequestMeta = RequestMeta,
> = (
  payload: PayloadT,
  requestMeta: RequestMetaT,
) => Promise<Result<ProxyResultT, ProxySendErrorT>>;

export type ResponseWriter<
  PayloadT extends GA4MPPayload<unknown, string>,
  ProxyResultT,
  ErrorT,
  RequestMetaT extends RequestMeta = RequestMeta,
> = (
  result: Result<{ payload: PayloadT; proxyResult: ProxyResultT }, ErrorT>,
  requestMeta: RequestMetaT,
) => Promise<Response>;

type HandlerOptions<RequestMatchErrorT = RequestMatchError> = {
  requestMatcher: RequestMatcher<RequestMatchErrorT>;
  fallbackHandler: FallbackHandler<RequestMatchErrorT>;
};

type ProxyOptions<
  RawPayloadT extends GA4MPPayload<unknown, unknown> = RawPayload,
  PayloadT extends GA4MPPayload<unknown, string> = GA4MPPayload<
    AnyPayload,
    string
  >,
  ProxyResultT = void,
  RequestMetaT extends RequestMeta = RequestMeta,
  RequestReadErrorT = RequestReadError,
  PayloadParseErrorT = PayloadParseError,
  ProxySendErrorT = ProxySendError,
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
    const match = await requestMatcher(request, info);
    if (!match.success) {
      return await fallbackHandler(request, {
        ...info,
        requestMatchError: match.error,
      });
    }

    return (async <RP, PP, R, M extends RequestMeta, E1, E2, E3>(
      proxy: ProxyOptions<RP, PP, R, M, E1, E2, E3>,
      requestMeta: M,
    ): Promise<Response> => {
      const readResult = await proxy.requestReader(request, requestMeta);
      if (!readResult.success) {
        return await proxy.responseWriter(readResult, requestMeta);
      }

      const parseResult = await proxy.payloadParser(
        readResult.data,
        requestMeta,
      );
      if (!parseResult.success) {
        return await proxy.responseWriter(parseResult, requestMeta);
      }

      const proxyResult = await proxy.proxySender(
        parseResult.data,
        requestMeta,
      );
      if (!proxyResult.success) {
        return await proxy.responseWriter(proxyResult, requestMeta);
      }

      return await proxy.responseWriter({
        success: true,
        data: { payload: parseResult.data, proxyResult: proxyResult.data },
      }, requestMeta);
    })(match.data.proxy, match.data.requestMeta);
  };
}

//RequestResolveResult | RequestRejectionResult;

// interface RawRequest {
//   api_secret: string | null;
//   measurement_id: string | null;
//   payload: unknown;
// }

// interface ApprovedRequest {
//   api_secret: string;
//   measurement_id: string;
//   payload: AnyPayload;
//   upstreamUrl?: string;
// }

// type RequestResolveResult = { success: true; data: ApprovedRequest };
// type RequestRejection = { reason: string };
// type RequestRejectionResult = {
//   success: false;
//   error: RequestRejection;
// };

// type RequestResolveFn = (
//   rawRequest: RawRequest,
// ) => RequestResolveResult | RequestRejectionResult;

// async function handleProxyRequest({ rawRequest, resolver }: {
//   rawRequest: RawRequest;
//   resolver: RequestResolveFn;
// }): Promise<Response> {
//   const resolveResult = resolver(rawRequest);

//   if (!resolveResult.success) {
//     // TODO: define types for real error conditions
//     return new Response(
//       `Failed to proxy request: ${resolveResult.error.reason}`,
//       { status: StatusCodes.IM_A_TEAPOT },
//     );
//   }

//   await sendProxyRequest(resolveResult.data);
//   return new Response(null, { status: StatusCodes.NO_CONTENT });
// }

// async function sendProxyRequest(
//   request: ApprovedRequest,
//   { signal }: { signal?: AbortSignal } = {},
// ): Promise<void> {
//   const url = new URL(request.upstreamUrl ?? GA4MP_URL);
//   url.searchParams.set("api_secret", request.api_secret);
//   url.searchParams.set("measurement_id", request.measurement_id);

//   const body = JSON.stringify(request.payload);

//   await fetch(url, { method: "POST", keepalive: true, body, signal });
// }

// type DefaultResolverOptions = { api_secret: string; measurement_id: string };

// export function createDefaultResolver(
//   options: DefaultResolverOptions,
// ): RequestResolveFn {
//   return (rawRequest) => {
//     // TODO: pass URL and Headers in request?
//     // use auth() fn to map URL/Headers to api_secret/measurement_id ?

//     const result = AnyPayload.safeParse(rawRequest);
//     if (!result.success) {
//       return {
//         success: false,
//         error: {
//           reason:
//             `Request body is not a valid GA4 Measurement Protocol payload: ${
//               Deno.inspect(result.error.issues)
//             }`,
//         },
//       } satisfies RequestRejectionResult;
//     }
//     return {
//       success: true,
//       data: {
//         api_secret: options.api_secret,
//         measurement_id: options.measurement_id,
//         payload: result.data,
//       },
//     } satisfies RequestResolveResult;
//   };
// }

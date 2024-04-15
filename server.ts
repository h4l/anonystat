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

export interface RequestMeta {
  url: URL;
  headers: Headers;
  name: string | null;
}

export type RequestMatcher<RequestMetaT extends RequestMeta = RequestMeta> = (
  request: Request,
  info: Deno.ServeHandlerInfo,
) => RequestMetaT;

/** Called to provide an HTTP response when the request is not a collect request. */
export type FallbackHandler<RequestMetaT extends RequestMeta = RequestMeta> = (
  request: Request,
  info: Deno.ServeHandlerInfo & { requestMeta: RequestMetaT },
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

export type RequestReader<
  RequestReadErrorT extends RequestReadError = RequestReadError,
  RequestMetaT extends RequestMeta = RequestMeta,
> = (
  request: Request,
  requestMeta: RequestMetaT,
) => Promise<Result<RawPayload, RequestReadErrorT>>;

export type PayloadParser<
  PayloadT,
  PayloadParseErrorT extends PayloadParseError = PayloadParseError,
  RequestMetaT extends RequestMeta = RequestMeta,
> = (
  payload: RawPayload,
  requestMeta: RequestMetaT,
) =>
  | Result<GA4MPPayload<PayloadT>, PayloadParseErrorT>
  | Promise<Result<GA4MPPayload<PayloadT>, PayloadParseErrorT>>;

export type ProxySender<
  PayloadT,
  ProxyResultT = void,
  ProxySendErrorT extends ProxySendError = ProxySendError,
  RequestMetaT extends RequestMeta = RequestMeta,
> = (
  payload: PayloadT,
  requestMeta: RequestMetaT,
) => Promise<Result<ProxyResultT, ProxySendErrorT>>;

export type ResponseWriter<PayloadT, ProxyResultT, ErrorT> = (
  result: Result<{ payload: PayloadT; proxyResult: ProxyResultT }, ErrorT>,
) => Promise<Response>;

type HandlerOptions<
  PayloadT = AnyPayload,
  ProxyResultT = void,
  RequestMetaT extends RequestMeta = RequestMeta,
  RequestReadErrorT extends RequestReadError = RequestReadError,
  RequestParseErrorT extends RequestParseError = RequestParseError,
  ProxySendErrorT extends ProxySendError = ProxySendError,
> = {
  requestMatcher: RequestMatcher<RequestMetaT>;
  fallbackHandler: FallbackHandler<RequestMetaT>;
  requestReader: RequestReader<RequestReadErrorT>;
  payloadParser: PayloadParser<PayloadT, RequestParseErrorT, RequestMetaT>;
  proxySender: ProxySender<
    PayloadT,
    ProxyResultT,
    ProxySendErrorT,
    RequestMetaT
  >;
  responseWriter: ResponseWriter<
    PayloadT,
    ProxyResultT,
    RequestReadErrorT | RequestParseErrorT | ProxySendErrorT
  >;
};

export function serve<HandlerOptionsT extends HandlerOptions>(
  options: HandlerOptionsT,
): Deno.HttpServer {
  return Deno.serve(createHandler(options));
}

export function createHandler<HandlerOptionsT extends HandlerOptions>(
  {
    requestMatcher,
    fallbackHandler,
    requestReader,
    payloadParser,
    proxySender,
    responseWriter,
  }: HandlerOptionsT,
): Deno.ServeHandler {
  return async (request: Request, info: Deno.ServeHandlerInfo) => {
    const requestMeta = requestMatcher(request, info);
    if (requestMeta.name !== RequestName.collect) {
      return await fallbackHandler(request, { ...info, requestMeta });
    }
    const readResult = await requestReader(request, requestMeta);
    if (!readResult.success) {
      return await responseWriter(readResult);
    }

    const parseResult = await payloadParser(
      { payload: readResult.data },
      requestMeta,
    );
    if (!parseResult.success) {
      return await responseWriter(parseResult);
    }
    const proxyResult = await proxySender(parseResult.data, requestMeta);
    if (!proxyResult.success) {
      return await responseWriter(proxyResult);
    }
    return await responseWriter({
      success: true,
      data: { payload: parseResult.data, proxyResult: proxyResult.data },
    });
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

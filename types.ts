import { Error, Result } from "./_misc.ts";
import { z } from "./deps.ts";
import { RequestMeta } from "./meta.ts";

export type RequestMatchError =
  | Error<"not-known-path">
  | Error<"not-authenticated">
  | Error<"not-authorised">;

/** The names of possible errors that occur while forwarding a request after
 * it's matched. */
export const MatchedErrorNames = z.enum([
  "aborted",
  "body-not-valid-json",
  "incorrect-content-type",
  "incorrect-request-method",
  "invalid-ga4mp-payload",
  "proxy-io-error",
  "proxy-response-status",
  "request-io-error",
  "timeout",
]);

export type RequestReadError =
  | Error<"incorrect-request-method">
  | Error<"incorrect-content-type">
  | Error<"body-not-valid-json">
  | Error<"request-io-error">;

export type PayloadParseError = Error<
  "invalid-ga4mp-payload",
  { zodError: z.ZodError }
>;

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

export type RequestMetaOptions<RequestMetaT> = { requestMeta: RequestMetaT };

/** The result of successfully parsing the request body as JSON.
 *
 * Expected to be a GA4 mp request, but not validated, so could be any JSON
 * data.
 */
export type GA4MPPayload<T> = {
  payload: T;
};

export type UnknownPayload = GA4MPPayload<unknown>;

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
  result: Result<
    { payload: PayloadT; proxyResult: ProxyResultT },
    ErrorT
  >,
  options: RequestMetaOptions<RequestMetaT>,
) => Response | Promise<Response>;

export type ProxyOptions<
  RawPayloadT extends UnknownPayload,
  PayloadT extends UnknownPayload,
  ProxyResultT,
  RequestMetaT extends RequestMeta,
  RequestReadErrorT,
  PayloadParseErrorT,
  ProxySendErrorT,
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

export type ForwardAndRespondOptions<RequestMetaT> = {
  request: Request;
  requestMeta: RequestMetaT;
  info: Deno.ServeHandlerInfo;
};

/** Handle incoming GA4MP requests by */
export interface RequestForwarder<RequestMetaT extends RequestMeta> {
  forwardAndRespond(
    options: ForwardAndRespondOptions<RequestMetaT>,
  ): Promise<Response>;
}

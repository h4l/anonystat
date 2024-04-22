import { Error, Result } from "./_misc.ts";
import { z } from "./deps.ts";
import { RequestMeta } from "./meta.ts";
import { Responder } from "./requests.ts";

export type RequestMatchError =
  | Error<"not-known-path">
  | Error<"not-authenticated">
  | Error<"not-authorised">;

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
  result: Result<
    { payload: PayloadT; proxyResult: ProxyResultT },
    ErrorT
  >,
  options: RequestMetaOptions<RequestMetaT>,
) => Response | Promise<Response>;

// type HandlerOptions<RequestMatchErrorT = RequestMatchError> = {
//   requestMatcher: RequestMatcher<RequestMatchErrorT>;
//   fallbackHandler: FallbackHandler<RequestMatchErrorT>;
// };

type ProxyOptions<
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

export class GA4MPRequestForwardResponder<RequestMetaT extends RequestMeta>
  implements Responder {
  constructor(
    public readonly request: Request,
    public readonly info: Deno.ServeHandlerInfo,
    public readonly requestMeta: RequestMetaT,
    public readonly forwarder: RequestForwarder<RequestMetaT>,
  ) {}

  async respond(): Promise<Response> {
    return await this.forwarder.forwardAndRespond(this);
  }
}

type ForwardAndRespondOptions<RequestMetaT> = {
  request: Request;
  requestMeta: RequestMetaT;
  info: Deno.ServeHandlerInfo;
};

export interface RequestForwarder<RequestMetaT extends RequestMeta> {
  forwardAndRespond(
    options: ForwardAndRespondOptions<RequestMetaT>,
  ): Promise<Response>;
}

export class DefaultRequestForwarder<
  RawPayloadT extends UnknownPayload,
  PayloadT extends UnknownPayload,
  ProxyResultT,
  RequestMetaT extends RequestMeta,
  RequestReadErrorT,
  PayloadParseErrorT,
  ProxySendErrorT,
> implements RequestForwarder<RequestMetaT> {
  #proxy: ProxyOptions<
    RawPayloadT,
    PayloadT,
    ProxyResultT,
    RequestMetaT,
    RequestReadErrorT,
    PayloadParseErrorT,
    ProxySendErrorT
  >;
  constructor(
    proxy: ProxyOptions<
      RawPayloadT,
      PayloadT,
      ProxyResultT,
      RequestMetaT,
      RequestReadErrorT,
      PayloadParseErrorT,
      ProxySendErrorT
    >,
  ) {
    this.#proxy = Object.freeze({ ...proxy });
  }

  get proxy(): Readonly<
    ProxyOptions<
      RawPayloadT,
      PayloadT,
      ProxyResultT,
      RequestMetaT,
      RequestReadErrorT,
      PayloadParseErrorT,
      ProxySendErrorT
    >
  > {
    return this.#proxy;
  }

  async forwardAndRespond(
    { request, requestMeta }: ForwardAndRespondOptions<RequestMetaT>,
  ): Promise<Response> {
    const readResult = await this.proxy.requestReader(request, {
      requestMeta,
    });
    if (!readResult.success) {
      return await this.proxy.responseWriter(readResult, { requestMeta });
    }

    const parseResult = await this.proxy.payloadParser(
      readResult.data,
      { requestMeta },
    );
    if (!parseResult.success) {
      return await this.proxy.responseWriter(parseResult, { requestMeta });
    }

    const proxyResult = await this.proxy.proxySender(
      parseResult.data,
      { requestMeta, signal: request.signal },
    );
    if (!proxyResult.success) {
      return await this.proxy.responseWriter(proxyResult, { requestMeta });
    }

    return await this.proxy.responseWriter({
      success: true,
      data: { payload: parseResult.data, proxyResult: proxyResult.data },
    }, { requestMeta });
  }
}

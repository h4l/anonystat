import { hasMessage, isTimeout, unreachableAtCompileTime } from "./_misc.ts";
import { GA4MP_URL } from "./constants.ts";
import { getReasonPhrase, StatusCodes, z } from "./deps.ts";
import { AnyPayload } from "./payload-schemas.ts";
import {
  PayloadParseError,
  ProxySender,
  ProxySendError,
  ProxySendErrorAborted,
  ProxySendErrorIO,
  ProxySendErrorResponseStatus,
  ProxySendErrorTimeout,
  RequestMatcherResult,
  RequestMatchError,
  ResponseWriter,
  UnknownPayload,
  UnknownProxyOptions,
} from "./server.ts";
import {
  FallbackHandler,
  GA4MPPayload,
  PayloadParser,
  RequestMatcher,
  RequestMeta,
  RequestReader,
  RequestReadError,
  Result,
  SuccessResult,
} from "./server.ts";

/** Details of a GA4 data stream that Measurement Protocol can send events to. */
export type GA4MPDestination = {
  api_secret: string;
  measurement_id: string;
  /** The URL of the Measurement Protocol API. */
  endpoint: string | URL;
};

export enum RequestName {
  collect = "collect",
  debugCollect = "debugCollect",
}

export interface DebugRequestMeta {
  debug: boolean;
}

/** The metadata available from GA4 MP request URLs. */
export interface CollectRequestMeta extends RequestMeta, DebugRequestMeta {
  name: RequestName;
  measurement_id: string | null;
  api_secret: string | null;
}
export interface UnknownRequestMeta extends RequestMeta {
  name: null;
}
export type MaybeCollectRequestMeta = CollectRequestMeta | UnknownRequestMeta;

export type RequestMetaMatcher<RequestMetaT extends RequestMeta> = (
  request: Request,
  info: Deno.ServeHandlerInfo,
) => RequestMetaT | Promise<RequestMetaT>;

export const matchDefaultGA4MPUrls: RequestMetaMatcher<
  MaybeCollectRequestMeta
> = (
  request: Request,
): MaybeCollectRequestMeta => {
  const url = new URL(request.url);
  const headers = request.headers;

  let name: RequestName;
  if (url.pathname === "/mp/collect") name = RequestName.collect;
  else if (url.pathname === "/debug/mp/collect") {
    name = RequestName.debugCollect;
  } else return { url, headers, name: null };

  return {
    url,
    headers,
    name,
    measurement_id: url.searchParams.get("measurement_id"),
    api_secret: url.searchParams.get("api_secret"),
    debug: name === RequestName.debugCollect,
  };
};

export type CollectRequestApprover = (
  request: CollectRequestMeta,
) => ApprovedCollectRequestMeta | undefined;

export type MeasurementIDRuleResolver = (
  measurement_id: string | null,
) => AllowListRule | undefined;

export function createAllowListCollectRequestApprover(
  { defaultAllowDebug, defaultEndpoint, ...options }: AllowedRequestMetaOptions,
): CollectRequestApprover {
  let measurementIdRuleResolver: MeasurementIDRuleResolver;

  if ("allowedMeasurementIds" in options) {
    const allowedMeasurementIds = options.allowedMeasurementIds;
    measurementIdRuleResolver = (measurement_id) =>
      measurement_id === null
        ? undefined
        : allowedMeasurementIds[measurement_id];
  } else measurementIdRuleResolver = options.measurementIdRuleResolver;

  return (request): ApprovedCollectRequestMeta | undefined => {
    const rule = measurementIdRuleResolver(request.measurement_id);

    if (
      !((typeof rule?.allowedApiSecret === "string" &&
        request.api_secret === rule.allowedApiSecret) ||
        (typeof rule?.allowedApiSecret === "function" &&
          rule.allowedApiSecret(request.api_secret)))
    ) return undefined;

    return {
      url: request.url,
      headers: request.headers,
      name: request.name,
      debug: !!((rule.allowDebug ?? defaultAllowDebug) && request.debug),
      // Use Data Stream from allow list rule, not incoming request
      measurement_id: rule.destination.measurement_id,
      api_secret: rule.destination.api_secret,
      endpoint: rule.destination.endpoint ?? defaultEndpoint ?? GA4MP_URL,
    };
  };
}

type AllowListRule = {
  allowedApiSecret: string | ((api_secret: string | null) => boolean);
  destination: {
    api_secret: string;
    measurement_id: string;
    endpoint?: string;
  };
  allowDebug?: boolean;
};

export type AllowedRequestMetaOptions =
  & (
    | { allowedMeasurementIds: Record<string, AllowListRule> }
    | { measurementIdRuleResolver: MeasurementIDRuleResolver }
  )
  & {
    defaultEndpoint?: string;
    defaultAllowDebug?: boolean;
  };

/** The metadata available from GA4 MP request URLs for known, allowed Data Stream. */
export interface ApprovedCollectRequestMeta extends CollectRequestMeta {
  measurement_id: string;
  api_secret: string;
  /** The GA4 MP API URL to send the payload to. */
  endpoint: string;
}

export type MaybeAllowedCollectRequestMeta =
  | ApprovedCollectRequestMeta
  | UnknownRequestMeta;

export function createAllowListRequestMetaMatcher(
  options: AllowedRequestMetaOptions,
): RequestMetaMatcher<MaybeAllowedCollectRequestMeta> {
  const approveRequestMeta = createAllowListCollectRequestApprover(options);

  return async (request, info) => {
    const requestMeta = await matchDefaultGA4MPUrls(request, info);
    if (requestMeta.name === null) return requestMeta;

    return approveRequestMeta(requestMeta) ??
      { name: null, url: requestMeta.url, headers: requestMeta.headers };
  };
}

// TODO: need wrapper for this that validates measurement_id and api_secret and
// does not match non-allowlisted ones.

export type ProxyResolver<
  ProxyOptionsT extends UnknownProxyOptions<RequestMetaT>,
  RequestMetaT extends RequestMeta,
> = (requestMeta: RequestMetaT) => ProxyOptionsT | null;

export function createRequestMatcher<
  ProxyOptionsT extends UnknownProxyOptions<RequestMetaT>,
  RequestMetaT extends RequestMeta,
>(
  requestMetaMatcher: RequestMetaMatcher<RequestMetaT>,
  proxyResolver: ProxyResolver<ProxyOptionsT, RequestMetaT>,
): RequestMatcher<RequestMatchError> {
  return async <ResultT>(
    { request, info }: { request: Request; info: Deno.ServeHandlerInfo },
    callback: <T extends UnknownProxyOptions<M>, M extends RequestMeta>(
      match: RequestMatcherResult<T, M>,
    ) => ResultT | Promise<ResultT>,
  ): Promise<Result<ResultT, RequestMatchError>> => {
    const requestMeta = await requestMetaMatcher(request, info);
    const proxy = proxyResolver(requestMeta);
    if (proxy === null) {
      return { success: false, error: { name: "proxy-not-found" } };
    }
    return { success: true, data: await callback({ proxy, requestMeta }) };
  };
}

/** Handle requests for unknown URLs by responding with 404 Not Found. */
export const defaultFallback: FallbackHandler = (_request, _info) =>
  errorResponse(StatusCodes.NOT_FOUND);

export const defaultRequestReader: RequestReader<
  UnknownPayload,
  RequestReadError,
  RequestMeta
> = async (
  request: Request,
  _options,
): Promise<Result<UnknownPayload, RequestReadError>> => {
  if (request.method !== "POST") {
    return { success: false, error: { name: "incorrect-request-method" } };
  }
  if (!isJsonRequest(request)) {
    return { success: false, error: { name: "incorrect-content-type" } };
  }
  let bodyJSON;
  try {
    bodyJSON = await request.json();
  } catch (e) {
    if (e instanceof SyntaxError) {
      return { success: false, error: { name: "body-not-valid-json" } };
    }
    return { success: false, error: { name: "request-io-error" } };
  }
  return { success: true, data: { payload: bodyJSON } };
};

type DefaultResponseWriter = ResponseWriter<
  GA4MPPayload<unknown>,
  unknown,
  RequestReadError | PayloadParseError | ProxySendError,
  RequestMeta & Partial<DebugRequestMeta>
>;

export const defaultResponseWriter: DefaultResponseWriter = (
  result,
  { requestMeta },
): Response => {
  if (result.success) {
    return new Response(null, { status: StatusCodes.NO_CONTENT });
  }
  switch (result.error.name) {
    case "incorrect-request-method":
      return errorResponse(
        StatusCodes.METHOD_NOT_ALLOWED,
        "Method must be POST",
      );
    case "incorrect-content-type":
      return errorResponse(
        StatusCodes.NOT_ACCEPTABLE,
        "Body must be application/json; charset=utf-8",
      );
    case "body-not-valid-json":
      return errorResponse(StatusCodes.BAD_REQUEST, "Body is not valid JSON");
    case "request-io-error":
      return errorResponse(StatusCodes.BAD_REQUEST, "Could not read request");
    case "invalid-ga4mp-payload":
      if (requestMeta.debug) {
        return errorResponse(
          StatusCodes.BAD_REQUEST,
          `Request body is not a valid GA4 Measurement Protocol payload: ${
            Deno.inspect(result.error.zodError.issues)
          }`,
        );
      }
      return errorResponse(
        StatusCodes.BAD_REQUEST,
        "Request body is not a valid GA4 Measurement Protocol payload",
      );
    case "timeout":
      return errorResponse(
        StatusCodes.GATEWAY_TIMEOUT,
        "Timed out while forwarding payload",
      );
    case "aborted":
      return errorResponse(StatusCodes.INTERNAL_SERVER_ERROR, "Aborted");
    case "proxy-io-error":
    case "proxy-response-status":
      return errorResponse(
        StatusCodes.BAD_GATEWAY,
        "Unable to forward payload",
      );
    default:
      return unreachableAtCompileTime(
        result.error,
        () => {
          console.error(
            `defaultResponder: unknown error: ${Deno.inspect(result.error)}`,
          );
          return errorResponse(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Unknown error: ${result.error.name}`,
          );
        },
      );
  }
};

type DestinationSelectorOptions<
  RawPayloadT extends UnknownPayload,
  RequestMetaT extends RequestMeta,
> = { payload: RawPayloadT; requestMeta: RequestMetaT };

type DestinationSelector<
  RawPayloadT extends UnknownPayload,
  RequestMetaT extends RequestMeta,
> = (
  options: DestinationSelectorOptions<RawPayloadT, RequestMetaT>,
) => GA4MPDestination;

export const approvedRequestDestinationSelector: DestinationSelector<
  UnknownPayload,
  ApprovedCollectRequestMeta
> = ({ requestMeta: { api_secret, measurement_id, endpoint } }) => {
  return { api_secret, measurement_id, endpoint };
};

// TODO: Payload builder?
export function createPayloadParser<
  PayloadSchemaT extends z.ZodTypeAny,
>(payloadSchema: PayloadSchemaT): PayloadParser<
  UnknownPayload,
  GA4MPPayload<z.infer<PayloadSchemaT>>,
  PayloadParseError,
  RequestMeta
> {
  return (
    payload,
    _requestMeta,
  ) => {
    const result = payloadSchema.safeParse(payload);
    if (!result.success) {
      return {
        success: false,
        error: { name: "invalid-ga4mp-payload", zodError: result.error },
      };
    }
    return {
      success: true,
      data: { payload: result.data },
    } satisfies SuccessResult<GA4MPPayload<z.infer<PayloadSchemaT>>>;
  };
}

export type DefaultPayloadParser = PayloadParser<
  UnknownPayload,
  GA4MPPayload<AnyPayload>,
  PayloadParseError,
  RequestMeta
>;

export const defaultPayloadParser = createPayloadParser(AnyPayload);

export type DefaultProxySendResult = null;

export type ProxySendResultCreatorOptions<
  PayloadT,
  RequestMetaT,
> =
  & {
    payload: PayloadT;
    request: Request;
    requestMeta: RequestMetaT;
  }
  & (
    | {
      error: ProxySendErrorTimeout | ProxySendErrorAborted | ProxySendErrorIO;
      response?: undefined;
    }
    | { error: ProxySendErrorResponseStatus | null; response: Response }
  );

export type ProxySendResultCreator<
  PayloadT extends UnknownPayload,
  ProxySendResultT,
  ProxySendErrorT,
  RequestMetaT extends RequestMeta,
> = (
  options: ProxySendResultCreatorOptions<PayloadT, RequestMetaT>,
) =>
  | Result<ProxySendResultT, ProxySendErrorT>
  | Promise<Result<ProxySendResultT, ProxySendErrorT>>;

export type CreateProxySenderOptions<
  PayloadT extends UnknownPayload,
  ProxySendResultT,
  ProxySendErrorT,
  RequestMetaT extends RequestMeta,
> = {
  destinationSelector: DestinationSelector<PayloadT, RequestMetaT>;
  resultCreator: ProxySendResultCreator<
    PayloadT,
    ProxySendResultT,
    ProxySendErrorT,
    RequestMetaT
  >;
};

export const defaultProxySendResultCreator: ProxySendResultCreator<
  UnknownPayload,
  DefaultProxySendResult,
  ProxySendError,
  RequestMeta
> = ({ error }) =>
  error ? { success: false, error } : { success: true, data: null };

/** Build a GA4 MP URL from parameters. */
export function formatDestinationURL(destination: GA4MPDestination): URL {
  const url = new URL(destination.endpoint);
  url.searchParams.set("api_secret", destination.api_secret);
  url.searchParams.set("measurement_id", destination.measurement_id);
  return url;
}

export function createProxySender<
  PayloadT extends UnknownPayload,
  ProxySendResultT,
  ProxySendErrorT extends ProxySendError,
  RequestMetaT extends RequestMeta,
>(
  { destinationSelector, resultCreator }: CreateProxySenderOptions<
    PayloadT,
    ProxySendResultT,
    ProxySendErrorT,
    RequestMetaT
  >,
): ProxySender<
  PayloadT,
  ProxySendResultT,
  ProxySendError | ProxySendErrorT,
  RequestMetaT
> {
  return async (
    payload,
    { requestMeta, signal },
  ): Promise<Result<ProxySendResultT, ProxySendErrorT>> => {
    const destination = destinationSelector({ payload, requestMeta });
    const upstreamURL = formatDestinationURL(destination);
    const body = JSON.stringify(payload.payload);

    const request = new Request(upstreamURL, {
      method: "POST",
      keepalive: true,
      body,
      signal,
    });
    let response: Response;

    try {
      response = await fetch(request);
    } catch (_e) {
      const e: unknown = _e;
      const message: string | undefined = hasMessage(e) ? e.message : undefined;
      if (signal?.aborted) {
        const name = isTimeout(e) ? "timeout" : "aborted";
        return await resultCreator({
          error: { name, message },
          payload,
          request,
          requestMeta,
        });
      }
      return await resultCreator({
        error: { name: "proxy-io-error", message },
        payload,
        request,
        requestMeta,
      });
    }
    if (response.ok) {
      return await resultCreator({
        error: null,
        payload,
        request,
        response,
        requestMeta,
      });
    }
    return await resultCreator({
      error: { name: "proxy-response-status", status: response.status },
      payload,
      request,
      response,
      requestMeta,
    });
  };
}

export const defaultProxySender: ProxySender<
  UnknownPayload,
  null,
  ProxySendError,
  ApprovedCollectRequestMeta
> = createProxySender({
  destinationSelector: approvedRequestDestinationSelector,
  resultCreator: defaultProxySendResultCreator,
});

export const defaultProxyOptions = {
  requestReader: defaultRequestReader,
  payloadParser: defaultPayloadParser,
  proxySender: defaultProxySender,
  responseWriter: defaultResponseWriter,
};

export type GA4DataStream = {
  api_secret: string;
  measurement_id: string;
};

export function createSingleConfigProxyResolver<
  ProxyOptionsT extends UnknownProxyOptions<RequestMetaT>,
  RequestMetaT extends CollectRequestMeta,
>(
  ga4DataStream: GA4DataStream,
  proxyOptions: ProxyOptionsT | (() => ProxyOptionsT),
): ProxyResolver<ProxyOptionsT, RequestMetaT> {
  const callable = typeof proxyOptions === "function";
  return (requestMeta) => {
    if (
      requestMeta.api_secret !== ga4DataStream.api_secret ||
      requestMeta.measurement_id !== ga4DataStream.measurement_id
    ) {
      return null;
    }
    return callable ? proxyOptions() : proxyOptions;
  };
}

export function errorResponse(status: StatusCodes, message?: string): Response {
  return new Response(message ?? getReasonPhrase(status), { status });
}

const ContentType = z.string().transform((
  contentType: string,
  ctx: z.RefinementCtx,
): { type: string; charset: string | undefined } => {
  const parts = contentType.toLowerCase().split(";");
  const typeMatch = /^([\w_]+\/[\w_+]+)$/.exec(contentType.trim());
  if (!typeMatch) {
    ctx?.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Value does not start with type/subtype",
    });
    return z.NEVER;
  }
  const type = typeMatch[1];

  let charset = undefined;
  for (let i = 1; i < parts.length; ++i) {
    const charsetMatch = /^charset\s*=\s*(\w+)$/.exec(parts[i].trim());
    if (!charsetMatch) continue;
    charset = charsetMatch[1];
    break;
  }
  return { type, charset };
});

function isJsonRequest(request: Request): boolean {
  const contentType = ContentType.safeParse(
    request.headers.get("content-type"),
  );
  return contentType.success &&
    (contentType.data.type === "application/json") &&
    ((contentType.data.charset ?? "utf-8") === "utf-8");
}

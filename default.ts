import { getReasonPhrase, StatusCodes, z } from "./deps.ts";
import { AnyPayload } from "./payload-schemas.ts";
import {
  errorResponse,
  FallbackHandler,
  PayloadParser,
  RawPayload,
  RequestError,
  RequestMatcher,
  RequestMeta,
  RequestName,
  RequestReader,
  RequestReadError,
  Result,
} from "./server.ts";

export interface CollectRequestMeta extends RequestMeta {
  name: RequestName.collect;
  measurement_id: string | null;
  api_secret: string | null;
}
export interface UnknownRequestMeta extends RequestMeta {
  name: null;
}
export type DefaultRequestMeta = CollectRequestMeta | UnknownRequestMeta;

export const defaultRequestMatcher: RequestMatcher<DefaultRequestMeta> = (
  request: Request,
  _info: Deno.ServeHandlerInfo,
): DefaultRequestMeta => {
  const url = new URL(request.url);
  const headers = request.headers;

  if (url.pathname !== "/mp/collect") return { url, headers, name: null };

  return {
    url,
    headers,
    name: RequestName.collect,
    measurement_id: url.searchParams.get("measurement_id"),
    api_secret: url.searchParams.get("api_secret"),
  };
};

export const defaultFallback: FallbackHandler = (_request, _info) =>
  errorResponse(StatusCodes.NOT_FOUND);

export const defaultRequestReader: RequestReader = async (
  request: Request,
  _requestMeta: RequestMeta,
): Promise<Result<RawPayload, RequestReadError>> => {
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

export function defaultResponder(
  proxyResult: Result<unknown, RequestError>,
): Response {
  if (proxyResult.success) {
    return new Response(null, { status: StatusCodes.NO_CONTENT });
  }
  switch (proxyResult.error.name) {
    case "incorrect-request-method":
      return errorResponse(StatusCodes.METHOD_NOT_ALLOWED);
    case "incorrect-content-type":
      return new Response("Body must be application/json; charset=utf-8", {
        status: StatusCodes.NOT_ACCEPTABLE,
      });
    case "body-not-valid-json":
      return new Response("Body is not valid JSON\n", {
        status: StatusCodes.BAD_REQUEST,
      });
    case "request-io-error":
      return new Response("Could not read request\n", {
        status: StatusCodes.BAD_REQUEST,
      });
    default:
      console.error(
        `defaultResponder: unknown error: ${Deno.inspect(proxyResult)}`,
      );
      return errorResponse(StatusCodes.INTERNAL_SERVER_ERROR);
  }
}

export const defaultPayloadParser: PayloadParser<AnyPayload> = (
  payload,
  _requestMeta,
) => {
  const result = AnyPayload.safeParse(payload);
  if (!result.success) {
    return {
      success: false,
      error: {
        reason:
          `Request body is not a valid GA4 Measurement Protocol payload: ${
            Deno.inspect(result.error.issues)
          }`,
      },
    } satisfies Error<string>;
  }
  return {
    success: true,
    data: {
      api_secret: options.api_secret,
      measurement_id: options.measurement_id,
      payload: result.data,
    },
  } satisfies RequestResolveResult;
};

export function errorResponse(status: StatusCodes): Response {
  return new Response(getReasonPhrase(status), { status });
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

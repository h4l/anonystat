import { MaybePromise, Result } from "./_misc.ts";
import { getReasonPhrase, StatusCodes } from "./deps.ts";
import { RequestMatchError } from "./types.ts";

// TODO: could change the APi to make match return an iterator that yields 0+
// results until an error

export interface Matcher<
  SubjectT,
  MatchErrorT,
  MatchT,
> {
  match(subject: SubjectT): MaybePromise<Result<MatchT, MatchErrorT>>;
}

export interface Responder {
  request: Request;
  info: Deno.ServeHandlerInfo;
  respond(): Promise<Response>;
}

export function errorResponse(status: StatusCodes, message?: string): Response {
  return new Response(message ?? getReasonPhrase(status), { status });
}

/** Called to provide an HTTP response when the request is not a collect request. */
export type FallbackHandler<RequestMatchErrorT = RequestMatchError> = (
  request: Request,
  info: Deno.ServeHandlerInfo & { requestMatchError: RequestMatchErrorT },
) => MaybePromise<Response>;

/** Handle requests for unknown URLs by responding with 404 Not Found. */
export const defaultFallback: FallbackHandler<unknown> = (_request, _info) =>
  errorResponse(StatusCodes.NOT_FOUND);

export type HandlerRequest = { request: Request; info: Deno.ServeHandlerInfo };

export function createRequestMatcherHandler<MatchErrorT>(
  matcher: Matcher<HandlerRequest, MatchErrorT, Responder>,
  options: { fallback?: FallbackHandler<MatchErrorT> } = {},
): Deno.ServeHandler {
  return async function requestResponderMatcherHandler(request, info) {
    const matchResult = await matcher.match({ request, info });
    if (matchResult.success) return await matchResult.data.respond();
    return await (options.fallback ?? defaultFallback)(request, {
      ...info,
      requestMatchError: matchResult.error,
    });
  };
}

import {
  mapResult,
  MaybeLazy,
  MaybePromise,
  notLazy,
  Result,
} from "./_misc.ts";
import { GA4MP_URL } from "./constants.ts";
import { RequestForwarder, RequestMatchError } from "./proxy.ts";
import {
  ApprovedCollectRequestMeta,
  CollectRequestMeta,
  RequestMeta,
} from "./meta.ts";
import { Responder } from "./requests.ts";
import { HandlerRequest } from "./requests.ts";
import { Matcher } from "./requests.ts";
import { matchDefaultGA4MPUrls } from "./default.ts";
import { assert } from "./dev_deps.ts";

export type MatchedCollectRequest<RequestMetaT extends CollectRequestMeta> = {
  requestMeta: RequestMetaT;
  forwarder: RequestForwarder<RequestMetaT>;
};

export interface CollectRequestForwardingRule<
  RequestMetaT extends CollectRequestMeta,
  RequestMatchErrorT,
> {
  apply(
    requestMeta: CollectRequestMeta,
  ): Result<MatchedCollectRequest<RequestMetaT>, RequestMatchErrorT>;
}

export type CollectRequestRuleOptions<RequestMetaT extends RequestMeta> = {
  allowedApiSecret: string | ((api_secret: string | null) => boolean);
  destination: {
    api_secret: string;
    measurement_id: string;
    endpoint?: string;
  };
  allowDebug?: boolean;
  forwarder: MaybeLazy<RequestForwarder<RequestMetaT>>;
};

export abstract class AbstractCollectRequestForwardingRule<
  RequestMetaT extends CollectRequestMeta,
  RequestMatchErrorT,
> implements
  CollectRequestForwardingRule<RequestMetaT, RequestMatchErrorT>,
  Readonly<CollectRequestRuleOptions<RequestMetaT>> {
  readonly allowedApiSecret: string | ((api_secret: string | null) => boolean);
  readonly destination: {
    api_secret: string;
    measurement_id: string;
    endpoint?: string;
  };
  readonly allowDebug?: boolean;
  readonly forwarder: MaybeLazy<RequestForwarder<RequestMetaT>>;

  constructor(options: CollectRequestRuleOptions<RequestMetaT>) {
    this.allowedApiSecret = options.allowedApiSecret;
    this.destination = { ...options.destination };
    this.allowDebug = options.allowDebug;
    this.forwarder = options.forwarder;
  }

  protected abstract getMatchedRequestMeta(
    requestMeta: CollectRequestMeta,
  ): Result<RequestMetaT, RequestMatchErrorT>;

  apply(
    requestMeta: CollectRequestMeta,
  ): Result<
    MatchedCollectRequest<RequestMetaT>,
    RequestMatchErrorT
  > {
    return mapResult(
      this.getMatchedRequestMeta(requestMeta),
      (requestMeta) => ({ requestMeta, forwarder: notLazy(this.forwarder) }),
    );
  }
}

export class DefaultCollectRequestForwardingRule
  extends AbstractCollectRequestForwardingRule<
    CollectRequestMeta,
    RequestMatchError
  > {
  protected getMatchedRequestMeta(
    requestMeta: CollectRequestMeta,
  ): Result<ApprovedCollectRequestMeta, RequestMatchError> {
    if (
      !((typeof this.allowedApiSecret === "string" &&
        requestMeta.api_secret === this.allowedApiSecret) ||
        (typeof this.allowedApiSecret === "function" &&
          this.allowedApiSecret(requestMeta.api_secret)))
    ) return { success: false, error: { name: "not-authenticated" } };

    if (requestMeta.debug && !this.allowDebug) {
      return { success: false, error: { name: "not-authorised" } };
    }

    return {
      success: true,
      data: {
        url: requestMeta.url,
        headers: requestMeta.headers,
        name: requestMeta.name,
        debug: requestMeta.debug,
        // Use Data Stream from allow list rule, not incoming request
        measurement_id: this.destination.measurement_id,
        api_secret: this.destination.api_secret,
        endpoint: this.destination.endpoint ?? GA4MP_URL,
      } satisfies ApprovedCollectRequestMeta,
    };
  }
}

export type CollectRequestMatcher<
  RequestMetaT extends CollectRequestMeta,
  MatchErrorT,
> = Matcher<
  HandlerRequest,
  MatchErrorT,
  MatchedCollectRequest<RequestMetaT>
>;

export class MeasurementIdCollectRequestMatcher<
  RequestMetaT extends CollectRequestMeta,
  RuleErrorT,
  RuleT extends CollectRequestForwardingRule<
    RequestMetaT,
    RuleErrorT
  >,
> implements
  CollectRequestMatcher<CollectRequestMeta, RequestMatchError | RuleErrorT> {
  protected readonly rules: ReadonlyMap<string, readonly RuleT[]>;
  protected readonly defaultRule: RuleT | undefined;

  constructor(
    rules: Iterable<readonly [string, RuleT | [RuleT]]>,
    options: { defaultRule?: RuleT } = {},
  ) {
    const index = new Map<string, RuleT[]>();
    for (const entry of rules) {
      const [i, r] = entry;
      const indexedRules = index.get(i) ?? [];
      if (Array.isArray(r)) indexedRules.push(...r);
      else indexedRules.push(r);
      if (indexedRules.length > 0 && !index.has(i)) index.set(i, indexedRules);
    }
    this.rules = index;
    this.defaultRule = options.defaultRule;
  }

  match(
    { request, info }: HandlerRequest,
  ): MaybePromise<
    Result<
      MatchedCollectRequest<RequestMetaT>,
      RequestMatchError | RuleErrorT
    >
  > {
    const requestMeta = matchDefaultGA4MPUrls(request, info);
    if (!requestMeta.name) {
      return { success: false, error: { name: "not-known-path" } };
    }

    let lastForwarderResult:
      | Result<MatchedCollectRequest<RequestMetaT>, RuleErrorT>
      | undefined;
    for (const forwardingRule of this.getForwardingRules(requestMeta)) {
      lastForwarderResult = forwardingRule.apply(requestMeta);
      if (lastForwarderResult.success) return lastForwarderResult;
    }
    if (lastForwarderResult) {
      assert(!lastForwarderResult.success);
      return lastForwarderResult;
    }
    return { success: false, error: { name: "not-authenticated" } };
  }

  protected *getForwardingRules(
    requestMeta: CollectRequestMeta,
  ): Iterable<RuleT> {
    const rules = requestMeta.measurement_id !== null &&
      this.rules.get(requestMeta.measurement_id);
    for (const rule of rules || []) {
      yield rule;
    }
    if (this.defaultRule) yield this.defaultRule;
  }
}

export function createResponder<RequestMetaT extends CollectRequestMeta>(
  { request, info }: HandlerRequest,
  { requestMeta, forwarder }: MatchedCollectRequest<RequestMetaT>,
): Responder {
  return {
    request,
    info,
    async respond(): Promise<Response> {
      return await forwarder.forwardAndRespond({ request, info, requestMeta });
    },
  };
}

export function createCollectRequestMatcher<
  RequestMetaT extends CollectRequestMeta,
  MatchErrorT,
>(
  collectRequestMatcher: CollectRequestMatcher<RequestMetaT, MatchErrorT>,
): Matcher<HandlerRequest, MatchErrorT, Responder> {
  return {
    async match(
      handlerRequest,
    ): Promise<Result<Responder, MatchErrorT>> {
      const match = await collectRequestMatcher.match(handlerRequest);
      if (!match.success) return match;
      const matchedCollectRequest = match.data;

      const responder = createResponder(
        handlerRequest,
        matchedCollectRequest,
      );
      return { success: true, data: responder };
    },
  };
}

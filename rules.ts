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
import { ErrorResult } from "./_misc.ts";
import { maxWith } from "./deps.ts";

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
    options: HandlerRequest,
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
    options: HandlerRequest,
  ): Result<RequestMetaT, RequestMatchErrorT>;

  apply(
    requestMeta: CollectRequestMeta,
    options: HandlerRequest,
  ): Result<
    MatchedCollectRequest<RequestMetaT>,
    RequestMatchErrorT
  > {
    return mapResult(
      this.getMatchedRequestMeta(requestMeta, options),
      (requestMeta) => ({ requestMeta, forwarder: notLazy(this.forwarder) }),
    );
  }
}

export type MatchedRequestMetaDecorator<
  RequestMetaT extends ApprovedCollectRequestMeta,
  MatchErrorT = RequestMatchError,
> = (
  matchResult: Result<ApprovedCollectRequestMeta, RequestMatchError>,
  options: { requestMeta: CollectRequestMeta } & HandlerRequest,
) => Result<RequestMetaT, RequestMatchError & MatchErrorT>;

export type DefaultCollectRequestForwardingRuleOptions<
  RequestMetaT extends ApprovedCollectRequestMeta,
  MatchErrorT = RequestMatchError,
> = CollectRequestRuleOptions<CollectRequestMeta> & {
  decorator: MatchedRequestMetaDecorator<RequestMetaT, MatchErrorT>;
};

export class DefaultCollectRequestForwardingRule<
  RequestMetaT extends ApprovedCollectRequestMeta = ApprovedCollectRequestMeta,
  MatchErrorT = RequestMatchError,
> extends AbstractCollectRequestForwardingRule<
  RequestMetaT,
  RequestMatchError & MatchErrorT
> {
  private readonly decorator: MatchedRequestMetaDecorator<
    RequestMetaT,
    MatchErrorT
  >;

  constructor(
    { decorator, ...options }: DefaultCollectRequestForwardingRuleOptions<
      RequestMetaT,
      MatchErrorT
    >,
  ) {
    super(options);
    this.decorator = decorator;
  }
  static readonly noopDecorator: MatchedRequestMetaDecorator<
    ApprovedCollectRequestMeta
  > = (matchResult) => matchResult;

  static create(
    options: CollectRequestRuleOptions<CollectRequestMeta>,
  ): DefaultCollectRequestForwardingRule;
  static create<
    RequestMetaT extends ApprovedCollectRequestMeta,
    MatchErrorT = RequestMatchError,
  >(
    options: DefaultCollectRequestForwardingRuleOptions<
      RequestMetaT,
      MatchErrorT
    >,
  ): DefaultCollectRequestForwardingRule<RequestMetaT, MatchErrorT>;
  static create<
    RequestMetaT extends ApprovedCollectRequestMeta,
    MatchErrorT = RequestMatchError,
  >(
    { decorator, ...options }:
      | DefaultCollectRequestForwardingRuleOptions<
        RequestMetaT,
        MatchErrorT
      >
      | CollectRequestRuleOptions<CollectRequestMeta> & {
        decorator: undefined;
      },
  ):
    | DefaultCollectRequestForwardingRule<RequestMetaT, MatchErrorT>
    | DefaultCollectRequestForwardingRule {
    if (!decorator) {
      return new DefaultCollectRequestForwardingRule(
        {
          decorator: DefaultCollectRequestForwardingRule.noopDecorator,
          ...options,
        },
      );
    }
    return new DefaultCollectRequestForwardingRule<RequestMetaT, MatchErrorT>(
      { decorator, ...options },
    );
  }

  protected getMatchedRequestMeta(
    requestMeta: CollectRequestMeta,
    options: HandlerRequest,
  ): Result<RequestMetaT, RequestMatchError & MatchErrorT> {
    return this.decorator(
      this.getDefaultMatchedRequestMeta(requestMeta, options),
      { requestMeta, ...options },
    );
  }
  protected getDefaultMatchedRequestMeta(
    requestMeta: CollectRequestMeta,
    _options: HandlerRequest,
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

const requestMatchErrorPriority: Record<RequestMatchError["name"], number> = {
  // highest priority as we were authenticated, but not authorised, so the
  // authorisation failure is likely the most informative problem.
  "not-authorised": 2,
  "not-authenticated": 1, // mid as we were able to authenticate
  "not-known-path": 0, // lowest as this didn't try to auth
};

/** Compare errors for significance. */
export function compareRequestMatchError(
  a: RequestMatchError,
  b: RequestMatchError,
): number {
  return requestMatchErrorPriority[a.name] - requestMatchErrorPriority[b.name];
}

export type MeasurementIdCollectRequestMatcherOptions<RuleT, RuleErrorT> = {
  defaultRule?: RuleT;
  errorComparator?: (a: RuleErrorT, b: RuleErrorT) => number;
};

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
  protected readonly errorComparator: (a: RuleErrorT, b: RuleErrorT) => number;

  constructor(
    rules: Iterable<readonly [string, RuleT | [RuleT]]>,
    options: MeasurementIdCollectRequestMatcherOptions<RuleT, RuleErrorT> = {},
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
    this.errorComparator = options.errorComparator ?? (() => 0);
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

    const errors: ErrorResult<RuleErrorT>[] = [];
    for (const forwardingRule of this.getForwardingRules(requestMeta)) {
      const result = forwardingRule.apply(requestMeta, { request, info });
      if (result.success) return result;
      errors.push(result);
    }
    return maxWith(errors, (a, b) => this.errorComparator(a.error, b.error)) ??
      { success: false, error: { name: "not-authenticated" } };
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

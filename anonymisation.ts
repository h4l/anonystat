import { MatchedRequestMetaDecorator } from "./rules.ts";
import { ApprovedCollectRequestMeta } from "./meta.ts";
import { MaybePromise, Result } from "./_misc.ts";
import {
  GA4MPPayload,
  PayloadParser,
  RequestMatchError,
  UnknownPayload,
} from "./proxy.ts";
import { AnyPayload } from "./payload-schemas.ts";
import { generate } from "./deps.ts";

export interface UserDistinctionRequestMeta extends ApprovedCollectRequestMeta {
  distinguishingFeatures: {
    requestIp: string;
    requestUserAgent: string;
    requestAcceptLanguage: string;
  };
}

export const ROOT_NAMESPACE = "E0C52FDC-DE4C-408A-B03A-70BC4C836F54";

export class AnonymousUserDistinctionProvider {
  constructor(private readonly userIdAssigner: UserIdAssigner) {}

  /** Create components to create anonymous user_id values in payloads.
   *
   * The namespace value contributes to the value that is hashed to produce
   * user_id values. Its purpose is to prevent Google Analytics being able to
   * check if a given set of `distinguishingFeatures` values correspond to a
   * given `user_id`.
   *
   * @param options.namespace A value that contributes to the user_id hash.
   * @param options.userIdAssigner How to handle payloads with an existing user_id.
   */
  static async create(
    { namespace, existingUserIdPolicy }: {
      namespace: string;
      existingUserIdPolicy: ExistingIdPolicy;
    },
  ): Promise<AnonymousUserDistinctionProvider> {
    const uuidNamespace = await generate(
      ROOT_NAMESPACE,
      new TextEncoder().encode(namespace),
    );
    return new AnonymousUserDistinctionProvider(
      new DefaultUserIdAssigner({
        existingIdPolicy: existingUserIdPolicy,
        idGenerator: new UuidV5UserIdGenerator(uuidNamespace),
      }),
    );
  }

  createRequestMetaDecorator<
    RequestMetaT extends ApprovedCollectRequestMeta,
    MatchErrorT,
  >(
    next: MatchedRequestMetaDecorator<RequestMetaT, MatchErrorT>,
  ): MatchedRequestMetaDecorator<
    RequestMetaT & UserDistinctionRequestMeta,
    MatchErrorT
  > {
    return (
      matchResult,
      options,
    ): Result<
      RequestMetaT & UserDistinctionRequestMeta,
      RequestMatchError & MatchErrorT
    > => {
      const match = next(matchResult, options);
      if (!match.success) return match;

      const distinguishingFeatures = {
        requestIp: options.info.remoteAddr.hostname,
        requestUserAgent: options.request.headers.get("user-agent") ?? "",
        requestAcceptLanguage: options.request.headers.get("accept-language") ??
          "",
      };
      const meta: RequestMetaT & UserDistinctionRequestMeta = {
        ...match.data,
        distinguishingFeatures,
      };
      return { success: true, data: meta };
    };
  }

  createPayloadParser<
    RawPayloadT extends UnknownPayload,
    PayloadT extends GA4MPPayload<AnyPayload>,
    PayloadParseErrorT,
    RequestMetaT extends UserDistinctionRequestMeta,
  >(
    next: PayloadParser<
      RawPayloadT,
      PayloadT,
      PayloadParseErrorT,
      RequestMetaT
    >,
  ): PayloadParser<
    RawPayloadT,
    PayloadT,
    PayloadParseErrorT,
    RequestMetaT
  > {
    return async (payload, options) => {
      const result = await next(payload, options);
      if (!result.success) return result;
      await this.userIdAssigner.assignUserId(
        result.data.payload,
        options.requestMeta,
      );
      return result;
    };
  }
}

type UserIdPayload = { user_id?: string };

interface UserIdAssigner<
  PayloadT extends UserIdPayload = UserIdPayload,
  RequestMetaT extends UserDistinctionRequestMeta = UserDistinctionRequestMeta,
> {
  assignUserId(
    payload: PayloadT,
    requestMeta: RequestMetaT,
  ): MaybePromise<void>;
}

export enum ExistingIdPolicy {
  replace = "replace",
  keep = "keep",
}

export class DefaultUserIdAssigner<
  PayloadT extends UserIdPayload = UserIdPayload,
  RequestMetaT extends UserDistinctionRequestMeta = UserDistinctionRequestMeta,
> implements UserIdAssigner<PayloadT, RequestMetaT> {
  private readonly idGenerator: UserIdGenerator<PayloadT, RequestMetaT>;
  private readonly existingIdPolicy: ExistingIdPolicy;
  constructor(
    { idGenerator, existingIdPolicy }: {
      idGenerator: UserIdGenerator<PayloadT, RequestMetaT>;
      existingIdPolicy: ExistingIdPolicy;
    },
  ) {
    this.idGenerator = idGenerator;
    this.existingIdPolicy = existingIdPolicy;
  }
  async assignUserId(
    payload: PayloadT,
    requestMeta: RequestMetaT,
  ): Promise<void> {
    if (this.existingIdPolicy === ExistingIdPolicy.keep && payload.user_id) {
      return;
    }
    payload.user_id = await this.idGenerator.generateUserId(
      payload,
      requestMeta,
    );
  }
}

export interface UserIdGenerator<
  PayloadT extends UserIdPayload = UserIdPayload,
  RequestMetaT extends UserDistinctionRequestMeta = UserDistinctionRequestMeta,
> {
  generateUserId(
    payload: PayloadT,
    requestMeta: RequestMetaT,
  ): MaybePromise<string>;
}

export class UuidV5UserIdGenerator implements UserIdGenerator {
  constructor(private readonly namespace: string) {}
  async generateUserId(
    _payload: UserIdPayload,
    requestMeta: UserDistinctionRequestMeta,
  ): Promise<string> {
    const key = [
      requestMeta.measurement_id,
      requestMeta.distinguishingFeatures.requestIp,
      requestMeta.distinguishingFeatures.requestUserAgent,
      requestMeta.distinguishingFeatures.requestAcceptLanguage,
    ].join("\x00");
    return await generate(this.namespace, new TextEncoder().encode(key));
  }
}

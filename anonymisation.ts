import { MatchedRequestMetaDecorator } from "./rules.ts";
import { ApprovedCollectRequestMeta } from "./meta.ts";
import { MaybePromise, Result } from "./_misc.ts";
import {
  GA4MPPayload,
  PayloadParser,
  RequestMatchError,
  UnknownPayload,
} from "./types.ts";
import { AnyPayload } from "./payload-schemas.ts";
import { assert, generate, z } from "./deps.ts";
import { differenceUtc } from "./_datetime.ts";
import { getDefaultKv } from "./storage.ts";

type OneOrMore<T> = [T, ...T[]];

export interface UserDistinctionRequestMeta extends ApprovedCollectRequestMeta {
  distinguishingFeatures: {
    requestIp: string;
    requestUserAgent: string;
    requestAcceptLanguage: string;
  };
}

export const ROOT_NAMESPACE = "E0C52FDC-DE4C-408A-B03A-70BC4C836F54";

/** Responsible for creating pseudo-random, deterministic `user_id` values.
 *
 * We need to distinguish events sent from different users, without storing
 * persistent cookies in the user's browser. To do this, we take a similar
 * approach to other analytics software, such as GoatCounter, Picwik
 */
export class AnonymisationProvider {
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
    { secret, lifetime, existingUserIdPolicy, kv }: {
      secret?: string;
      lifetime?: Lifetime;
      existingUserIdPolicy?: ExistingIdPolicy;
      kv?: Deno.Kv;
    } = {},
  ): Promise<AnonymisationProvider> {
    return new AnonymisationProvider(
      DefaultUserIdAssigner.create({
        namespaceProvider: await createNamespace({ secret, lifetime, kv }),
        existingIdPolicy: existingUserIdPolicy,
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

interface NamespaceProvider<
  RequestMetaT extends UserDistinctionRequestMeta = UserDistinctionRequestMeta,
> {
  getNamespace(requestMeta: RequestMetaT): MaybePromise<string>;
}

interface NamespaceAspect<
  RequestMetaT extends UserDistinctionRequestMeta = UserDistinctionRequestMeta,
> {
  getValue(
    options: { requestMeta: RequestMetaT },
  ): MaybePromise<string>;
}

export type Lifetime = {
  unit: TimeUnit;
  count?: number;
  from?: number | Date;
};

export type CreateNamespaceOptions = {
  id?: string;
  secret?: string;
  lifetime?: Lifetime;
  kv?: Deno.Kv;
};

export async function createNamespace(
  { secret, id, ...options }: CreateNamespaceOptions = {},
): Promise<NamespaceProvider> {
  const kv = options.kv ?? await getDefaultKv();
  const lifetime = options.lifetime ?? { unit: "months", count: 1 };

  return new DefaultNamespaceProvider([
    ...(secret === undefined ? [] : [new ConstantNamespaceAspect(secret)]),
    new PeriodicallyChangingNamespaceAspect({
      kv,
      period: new DefaultTimeBucket(lifetime),
      id,
    }),
    new MeasurementIdNamespaceAspect(),
  ]);
}

export class DefaultNamespaceProvider<
  RequestMetaT extends UserDistinctionRequestMeta = UserDistinctionRequestMeta,
> implements NamespaceProvider<RequestMetaT> {
  private readonly aspects: OneOrMore<NamespaceAspect>;
  private readonly encoder: NamespacedIdEncoder;
  constructor(
    aspects: Iterable<NamespaceAspect>,
    { encoder = new UuidV5NamespacedIdEncoder() }: {
      encoder?: NamespacedIdEncoder;
    } = {},
  ) {
    this.encoder = encoder;
    this.aspects = [...aspects] as OneOrMore<NamespaceAspect>;
    if (this.aspects.length < 1) throw new Error("No aspects provided");
  }

  async getNamespace(requestMeta: RequestMetaT): Promise<string> {
    const values: string[] = await Promise.all(
      this.aspects.map((a) => a.getValue({ requestMeta })),
    );
    assert(values.length > 0);
    return await this.encoder.encodeId(
      ROOT_NAMESPACE,
      ...values as OneOrMore<string>,
    );
  }
}

export class MeasurementIdNamespaceAspect implements NamespaceAspect {
  getValue(
    { requestMeta }: { requestMeta: UserDistinctionRequestMeta },
  ): string {
    return requestMeta.measurement_id;
  }
}

export class ConstantNamespaceAspect implements NamespaceAspect {
  constructor(private readonly value: string) {}
  getValue(): string {
    return this.value;
  }
}

/** Round time datetime values into buckets. */
interface TimeBucket {
  /** Get a string representation of the TimeBucket, e.g. its period & frequency. */
  getName(): string;

  /** Get an opaque string representing the bucket `time` falls into. */
  getTimeBucket(time?: Date): string;
}

export const TimeUnit = z.enum([
  "hours",
  "days",
  "weeks",
  "months",
  "quarters",
  "years",
]);
export type TimeUnit = z.infer<typeof TimeUnit>;

export type DefaultTimeBucketOptions = Lifetime;

export class DefaultTimeBucket implements TimeBucket {
  readonly unit: TimeUnit;
  readonly count: number;
  readonly from: Date;
  private readonly name: string;

  constructor(
    { unit, count = 1, from = 0 }: DefaultTimeBucketOptions,
  ) {
    if (count < 1) throw new Error(`count must be positive: ${count}`);
    this.unit = unit;
    this.count = count;
    this.from = new Date(from);
    this.name = DefaultTimeBucket.buildName(this.from, this.unit, this.count);
  }

  static buildName(from: Date, unit: TimeUnit, count: number): string {
    return `${from.toISOString()} ${unit}/${count}`;
  }

  getName(): string {
    return this.name;
  }

  getTimeBucket(time: Date | undefined = new Date()): string {
    // We divide time into buckets of unit * count width, and map time to an
    // integer index, positive or negative. For 1 second buckets with from=0:
    // ms time interval: [-2000, -1999][-1000, -1][0, 999][1000, 1999]
    //     bucket index: [     -2     ][   -1    ][   0  ][    1     ]
    const difference = differenceUtc(this.from, time, this.unit);
    const bucketIndex = Math.floor(difference / this.count);
    return `${this.unit}/${this.count}:${bucketIndex}`;
  }
}
const TaggedUuid = z.object({
  tag: z.string(),
  value: z.string().uuid(),
});
type TaggedUuid = z.infer<typeof TaggedUuid>;

export class KvNamespaceProviderConflict extends Error {
  static NAME = "KvNamespaceProviderConflict";
  name = KvNamespaceProviderConflict.NAME;
}

export class PeriodicallyChangingNamespaceAspect implements NamespaceAspect {
  private readonly id: string;
  private readonly period: TimeBucket;
  private readonly kv: Deno.Kv;

  constructor(
    { id = "default", period, kv }: {
      id?: string;
      period: TimeBucket;
      kv: Deno.Kv;
    },
  ) {
    this.id = id;
    this.period = period;
    this.kv = kv;
  }

  private cachedNamespace: Promise<TaggedUuid> | undefined;

  private get kvKey(): Deno.KvKey {
    return ["periodic_namespace_aspect", this.period.getName(), this.id];
  }

  private async readNamespace(): Promise<
    Deno.KvEntryMaybe<TaggedUuid | null>
  > {
    const { key, versionstamp, value } = await this.kv.get(this.kvKey);
    if (versionstamp === null) return { key, versionstamp, value: null };
    const parsed = TaggedUuid.safeParse(value);
    return { key, versionstamp, value: parsed.success ? parsed.data : null };
  }

  private async getOrCreateNamespace(
    namespaceKey: string,
  ): Promise<TaggedUuid> {
    let replacedBucketKey: string | undefined;
    while (true) {
      const current = await this.readNamespace();
      if (current.value?.tag === namespaceKey) return current.value;

      // Ensure we don't fight to update the value with a conflicting
      // namespaceKey. This could conceivably occur if our clock is ahead of
      // another writer who's changing from A -> B while we change from A -> C.
      // This is unlikely to happen in practice, so it seems fine to just fail
      // in this scenario — a subsequent request should succeed.
      if (replacedBucketKey === undefined) {
        replacedBucketKey = current.value?.tag;
      } else if (replacedBucketKey !== current.value?.tag) {
        throw new KvNamespaceProviderConflict(
          `namespace key changed during write from ${replacedBucketKey} to ${current.value?.tag} while attempting to write ${namespaceKey}`,
        );
      }

      const updated: TaggedUuid = {
        tag: namespaceKey,
        value: crypto.randomUUID(),
      };
      // We need to ensure the value saved to the db is the value we return,
      // otherwise if this this server's write lost out to another concurrent
      // write, we would be running with a different namespace value to another
      // server whose write succeeded.
      const update = await this.kv.atomic().check(current).set(
        current.key,
        updated,
      ).commit();
      if (update.ok) return updated;
    }
  }

  private async getCurrentNamespace(): Promise<TaggedUuid> {
    const bucketKey = this.period.getTimeBucket();
    const initialPromise = this.cachedNamespace;
    let initial: TaggedUuid | undefined;
    try {
      initial = await initialPromise;
    } catch (_) {
      // A previous caller will have already awaited this error, so we can ignore it.
    }
    if (initial?.tag === bucketKey) return initial;
    let latest: Promise<TaggedUuid>;
    if (!this.cachedNamespace || this.cachedNamespace === initialPromise) {
      this.cachedNamespace = latest = this.getOrCreateNamespace(bucketKey);
    } else {
      // A concurrent caller already re-fetched, so use that.
      latest = this.cachedNamespace;
    }
    return await latest;
  }

  async getValue(): Promise<string> {
    return (await this.getCurrentNamespace()).value;
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

/** How to handle payloads with `user_id` already present.
 *
 * - `replace`: Ignore the existing ID and generate a new one based on request
 *    attributes.
 * - `keep`: Leave the existing ID in place, don't modify it.
 * - `scramble`: Transform the existing ID by hashing it into the request's ID
 *    namespace.
 */
export const ExistingIdPolicy = z.enum(["replace", "keep", "scramble"]);
export type ExistingIdPolicy = z.infer<typeof ExistingIdPolicy>;

export type DefaultUserIdAssignerCreateOptions<
  RequestMetaT extends UserDistinctionRequestMeta,
> = {
  namespaceProvider: NamespaceProvider<RequestMetaT>;
  existingIdPolicy?: ExistingIdPolicy;
};

/** Responsible for rewriting a payload's `user_id` with an anonymised version. */
export class DefaultUserIdAssigner<
  PayloadT extends UserIdPayload = UserIdPayload,
  RequestMetaT extends UserDistinctionRequestMeta = UserDistinctionRequestMeta,
> implements UserIdAssigner<PayloadT, RequestMetaT> {
  private readonly namespaceProvider: NamespaceProvider<RequestMetaT>;
  private readonly idComponents: UserIdComponentsProvider<
    PayloadT,
    RequestMetaT
  >;
  private readonly existingIdPolicy: ExistingIdPolicy;
  private readonly idEncoder: NamespacedIdEncoder;

  constructor(
    options: {
      existingIdPolicy: ExistingIdPolicy;
      idComponents: UserIdComponentsProvider<PayloadT, RequestMetaT>;
      idEncoder: NamespacedIdEncoder;
      namespaceProvider: NamespaceProvider<RequestMetaT>;
    },
  ) {
    this.existingIdPolicy = options.existingIdPolicy;
    this.idComponents = options.idComponents;
    this.idEncoder = options.idEncoder;
    this.namespaceProvider = options.namespaceProvider;
  }

  static create<RequestMetaT extends UserDistinctionRequestMeta>(
    { namespaceProvider, existingIdPolicy = ExistingIdPolicy.Enum.scramble }:
      DefaultUserIdAssignerCreateOptions<RequestMetaT>,
  ): DefaultUserIdAssigner<UserIdPayload, RequestMetaT> {
    return new DefaultUserIdAssigner({
      existingIdPolicy,
      idComponents: new DefaultUserIdComponentsProvider(),
      idEncoder: new UuidV5NamespacedIdEncoder(),
      namespaceProvider: namespaceProvider,
    });
  }

  async assignUserId(
    payload: PayloadT,
    requestMeta: RequestMetaT,
  ): Promise<void> {
    if (
      this.existingIdPolicy === ExistingIdPolicy.Enum.keep && payload.user_id
    ) {
      return;
    }
    const namespace = await this.namespaceProvider.getNamespace(requestMeta);

    if (
      this.existingIdPolicy === ExistingIdPolicy.Enum.scramble &&
      payload.user_id
    ) {
      // Use the provided user id, but transform it by hashing it with our
      // namespace.
      payload.user_id = await this.idEncoder.encodeId(
        namespace,
        "provided",
        payload.user_id,
      );
    } else {
      // Generate an ID for the request based on distinguishing attributes of
      // the request. These attributes are expected to be user-specific, so we
      // hash the components with a private, pseudo-random namespace value to
      // make it impractical to tie the resulting ID back to the user.
      const idComponents = this.idComponents.getIdComponents(
        payload,
        requestMeta,
      );
      if (idComponents.length === 0) {
        throw new Error("No id components provided");
      }
      payload.user_id = await this.idEncoder.encodeId(
        namespace,
        "generated",
        ...idComponents,
      );
    }
  }
}

export interface UserIdComponentsProvider<
  PayloadT extends UserIdPayload = UserIdPayload,
  RequestMetaT extends UserDistinctionRequestMeta = UserDistinctionRequestMeta,
> {
  getIdComponents(
    payload: PayloadT,
    requestMeta: RequestMetaT,
  ): string[];
}

export class DefaultUserIdComponentsProvider
  implements UserIdComponentsProvider {
  getIdComponents(
    _payload: UserIdPayload,
    requestMeta: UserDistinctionRequestMeta,
  ): string[] {
    return [
      requestMeta.distinguishingFeatures.requestIp,
      requestMeta.distinguishingFeatures.requestUserAgent,
      requestMeta.distinguishingFeatures.requestAcceptLanguage,
    ];
  }
}

export interface NamespacedIdEncoder {
  encodeId(
    namespace: string,
    component: string,
    ...components: string[]
  ): MaybePromise<string>;
}

export class UuidV5NamespacedIdEncoder implements NamespacedIdEncoder {
  #encoder = new TextEncoder();
  async encodeId(
    namespace: string,
    component: string,
    ...components: string[]
  ): Promise<string> {
    const value = JSON.stringify([component, ...components]);
    return await generate(namespace, this.#encoder.encode(value));
  }
}

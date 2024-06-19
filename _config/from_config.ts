import { HandlerRequest, Matcher, Responder } from "../requests.ts";
import {
  compareRequestMatchError,
  createCollectRequestMatcher,
  DefaultCollectRequestForwardingRule,
  MeasurementIdCollectRequestMatcher,
} from "../rules.ts";
import { RequestMatchError } from "../types.ts";
import { defaultProxyOptions, DefaultRequestForwarder } from "../default.ts";
import { Config, Cors, DEFAULT_CORS_MAX_AGE } from "./json_schema.ts";
import { AnonymisationProvider } from "../anonymisation.ts";
import {
  CorsMiddleware,
  CorsPolicy,
  DefaultCorsPolicy,
  HttpMethods,
} from "../_cors.ts";

export type CreateCollectRequestMatcherFromConfigOptions = { kv?: Deno.Kv };

function createCorsPolicy(cors: Cors): CorsPolicy | undefined {
  if (cors.allow_origin === undefined && cors.max_age === undefined) return;
  return new DefaultCorsPolicy({
    allowOrigin: cors.allow_origin ?? null,
    maxAge: cors.max_age ?? DEFAULT_CORS_MAX_AGE,
    allowMethods: HttpMethods.POST,
    // Navigator.sendBeacon() makes CORS requests with credentials mode include,
    // so we must allow credentials to make cross-origin sendBeacon() requests:
    // https://w3c.github.io/beacon/#sec-processing-model  (see step 3.2.7.1)
    // In practice we don't set any cookies, so this should have no real effect.
    allowCredentials: true,
    // Requests set Content-Type header to send JSON
    allowHeaders: ["Content-Type"],
  });
}

/** Merge two Cors configs by overriding `base` with props set in `override`.
 *
 * @return The merged config, or undefined if override has no effect.
 */
function mergeCorsConfigs(
  base: Cors | undefined,
  override: Cors | undefined,
): Cors | undefined {
  if (override?.allow_origin === undefined && override?.max_age === undefined) {
    return undefined;
  }
  return {
    ...base,
    ...(override.allow_origin && { allow_origin: override.allow_origin }),
    ...(override.max_age && { max_age: override.max_age }),
  };
}

/** Instantiate Config data into a request matcher to handle collect requests.
 */
export async function createCollectRequestMatcherFromConfig(
  config: Config,
  options: CreateCollectRequestMatcherFromConfigOptions = {},
): Promise<Matcher<HandlerRequest, RequestMatchError, Responder>> {
  // Configs can contain multiple forwarder sections, each of which defines a
  // separate set of allowed measurement_ids and rules to apply when forwarding
  // requests matching those measurement_ids.
  const ruleGroups = await Promise.all(config.forward.map(async (fwConfig) => {
    // Each forwarder block has its own anonymisation configuration.
    const anonymisation = await AnonymisationProvider.create({
      secret: fwConfig.user_id.scrambling_secret ?? undefined,
      lifetime: fwConfig.user_id.lifetime,
      existingUserIdPolicy: fwConfig.user_id.existing,
      kv: options.kv,
    });

    const requestForwarder = new DefaultRequestForwarder({
      ...defaultProxyOptions,
      // The anonymisation payload parser post-processes incoming requests to
      // anonymise their user_ids.
      payloadParser: anonymisation.createPayloadParser(
        defaultProxyOptions.payloadParser,
      ),
    });

    const corsPolicy = fwConfig.cors && createCorsPolicy(fwConfig.cors);

    // CORS is optional. If it's enabled we support it by wrapping the forwarder
    // with CorsMiddleware to set CORS headers.
    const forwarder = corsPolicy
      ? new CorsMiddleware(requestForwarder, {
        corsPolicy,
      })
      : requestForwarder;

    return fwConfig.data_stream.map((dsConfig) => {
      // Individual data streams can override the shared CORS policy, in which
      // case we merge the CORS configs and wrap the same basic requestForwarder
      // with a CORS middleware specific to this data stream.
      const dsCorsConfig = mergeCorsConfigs(fwConfig.cors, dsConfig.in.cors);
      const dsCorsPolicy = dsCorsConfig && createCorsPolicy(dsCorsConfig);
      const dsForwarder = dsCorsPolicy
        ? new CorsMiddleware(requestForwarder, {
          corsPolicy: dsCorsPolicy,
        })
        : forwarder;

      const rule = DefaultCollectRequestForwardingRule.create({
        // add extra info to request metadata needed by the anonymisation
        // payload parser when it constructs anonymous IDs.
        decorator: anonymisation.createRequestMetaDecorator(
          DefaultCollectRequestForwardingRule.noopDecorator,
        ),
        allowedApiSecret: dsConfig.in.api_secret,
        destination: {
          measurement_id: dsConfig.out.measurement_id,
          api_secret: dsConfig.out.api_secret,
          endpoint: fwConfig.destination,
        },
        allowDebug: fwConfig.allow_debug,
        forwarder: dsForwarder,
      });
      return [dsConfig.in.measurement_id, rule] as const;
    });
  }));

  const flattenedRules = ruleGroups.flatMap((forwarderRules) => forwarderRules);

  // The same measurement_id can occur multiple times in the list of rules.
  // The request matcher groups duplicates. When handling requests, it tries
  // duplicates in order until one matches or all fail.
  return createCollectRequestMatcher(
    new MeasurementIdCollectRequestMatcher(flattenedRules, {
      errorComparator: compareRequestMatchError,
    }),
  );
}

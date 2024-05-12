import { HandlerRequest, Matcher, Responder } from "../requests.ts";
import {
  compareRequestMatchError,
  createCollectRequestMatcher,
  DefaultCollectRequestForwardingRule,
  MeasurementIdCollectRequestMatcher,
} from "../rules.ts";
import { RequestMatchError } from "../proxy.ts";
import { defaultProxyOptions, DefaultRequestForwarder } from "../default.ts";
import { Config } from "./json_schema.ts";
import { AnonymisationProvider } from "../anonymisation.ts";

export type CreateCollectRequestMatcherFromConfigOptions = { kv?: Deno.Kv };

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

    return fwConfig.data_stream.map((dsConfig) => {
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
        forwarder: requestForwarder,
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

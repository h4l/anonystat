import { HandlerRequest, Matcher, Responder } from "./requests.ts";
import {
  createCollectRequestMatcher,
  DefaultCollectRequestForwardingRule,
  MeasurementIdCollectRequestMetaMatcher,
} from "./rules.ts";

import { z } from "./deps.ts";
import { matchDefaultGA4MPUrls } from "./default.ts";
import { DefaultRequestForwarder, RequestMatchError } from "./proxy.ts";
import { defaultProxyOptions } from "./default.ts";
import { GA4MP_URL } from "./constants.ts";

function normaliseToArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function oneOrMore<SchemaT extends z.ZodTypeAny>(schema: SchemaT) {
  return (schema.or(schema.array().min(1))).transform(
    normaliseToArray<z.infer<typeof schema>>,
  );
}

const DataStreamCredentials = z.object({
  measurement_id: z.string(),
  api_secret: z.string(),
});

const DataStreamInOut = z.object({
  in: DataStreamCredentials,
  out: DataStreamCredentials,
});
type DataStreamInOut = z.infer<typeof DataStreamInOut>;

export const DataStreamInOutShorthand = DataStreamCredentials.transform((
  ds,
): DataStreamInOut => ({ in: { ...ds }, out: { ...ds } }));

export const ForwarderConfig = z.object({
  data_stream: oneOrMore(DataStreamInOutShorthand),
  destination: z.string().url().optional().default(GA4MP_URL),
  allow_debug: z.boolean().optional().default(false),
  secret_scrambler_key: z.string().min(8),
});
type ForwarderConfig = z.infer<typeof ForwarderConfig>;

export const Config = z.object({ forward: oneOrMore(ForwarderConfig) });
export type Config = z.infer<typeof Config>;

// TODO: need to validate no duplicate measurement IDs, or handle duplicates

export function createForwarder(
  config: Config,
): Matcher<HandlerRequest, RequestMatchError, Responder> {
  const rules = config.forward.flatMap((forwarder) => {
    const requestForwarder = new DefaultRequestForwarder(defaultProxyOptions);
    return forwarder.data_stream.map((data_stream) => {
      const rule = new DefaultCollectRequestForwardingRule({
        allowedApiSecret: data_stream.in.api_secret,
        destination: {
          measurement_id: data_stream.out.measurement_id,
          api_secret: data_stream.out.api_secret,
          endpoint: forwarder.destination,
        },
        allowDebug: forwarder.allow_debug,
        forwarder: requestForwarder,
      });
      return [data_stream.in.measurement_id, rule] as const;
    });
  });

  const matcher = new MeasurementIdCollectRequestMetaMatcher(rules);

  return createCollectRequestMatcher({
    getRequestMeta: matchDefaultGA4MPUrls,
    collectRequestMetaMatcher: matcher,
  });
}

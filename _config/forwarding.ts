import { HandlerRequest, Matcher, Responder } from "../requests.ts";
import {
  createCollectRequestMatcher,
  DefaultCollectRequestForwardingRule,
  MeasurementIdCollectRequestMatcher,
} from "../rules.ts";
import { DefaultRequestForwarder, RequestMatchError } from "../proxy.ts";
import { defaultProxyOptions } from "../default.ts";
import { Config } from "./json_schema.ts";

// TODO: create anonymisation components
export function createForwarder(
  config: Config,
): Matcher<HandlerRequest, RequestMatchError, Responder> {
  const rules = config.forward.flatMap((forwarder) => {
    const requestForwarder = new DefaultRequestForwarder(defaultProxyOptions);
    return forwarder.data_stream.map((data_stream) => {
      const rule = DefaultCollectRequestForwardingRule.create({
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

  return createCollectRequestMatcher(
    new MeasurementIdCollectRequestMatcher(rules),
  );
}

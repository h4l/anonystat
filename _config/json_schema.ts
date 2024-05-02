import { oneOrMore } from "../_zod.ts";
import { ExistingIdPolicy, TimeUnit } from "../anonymisation.ts";
import { GA4MP_URL } from "../constants.ts";
import { z } from "../deps.ts";
import {
  DestinationUrl,
  Host,
  NonEmptyString,
  Port,
  ScramblerKey,
} from "./values_schema.ts";
import {
  EvaluatedDisambiguatedLifetimeExpression,
  LifetimeObject,
} from "./lifetimes.ts";

export const DataStreamCredentials = z.object({
  measurement_id: NonEmptyString,
  api_secret: NonEmptyString,
});

export const DataStreamInOut = z.object({
  in: DataStreamCredentials,
  out: DataStreamCredentials,
});
type DataStreamInOut = z.infer<typeof DataStreamInOut>;

export const DataStreamInOutShorthand = DataStreamCredentials.transform((
  ds,
): DataStreamInOut => ({ in: { ...ds }, out: { ...ds } })).or(DataStreamInOut);

export const DEFAULT_LIFETIME_UNIT: TimeUnit = "months";
export const DEFAULT_EXISTING_POLICY: ExistingIdPolicy =
  ExistingIdPolicy.Enum.scramble;
export const UserIdConfig = z.object({
  scrambling_secret: ScramblerKey.nullable().default(null),
  lifetime: LifetimeObject.or(EvaluatedDisambiguatedLifetimeExpression).default(
    { unit: DEFAULT_LIFETIME_UNIT },
  ),
  existing: ExistingIdPolicy.default(DEFAULT_EXISTING_POLICY),
});

export const ForwarderConfig = z.object({
  data_stream: oneOrMore(DataStreamInOutShorthand),
  destination: DestinationUrl.default(GA4MP_URL),
  allow_debug: z.boolean().default(false),
  user_id: UserIdConfig.default({}),
});
type ForwarderConfig = z.infer<typeof ForwarderConfig>;

export const DEFAULT_PORT = 8000;
export const DEFAULT_HOSTNAME = "127.0.0.1";
export const ListenConfig = z.object({
  port: Port.default(DEFAULT_PORT),
  hostname: Host.default(DEFAULT_HOSTNAME),
});

export const Config = z.object({
  forward: oneOrMore(ForwarderConfig),
  listen: ListenConfig.default({}),
});
export type Config = z.infer<typeof Config>;
export type ConfigInput = z.input<typeof Config>;

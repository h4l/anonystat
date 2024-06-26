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
import {
  formatSlashDelimitedRegexString,
  MaxAge,
  OriginShorthand,
  SlashDelimitedRegexString,
  WildcardSchema,
} from "./cors_schemas.ts";
import { Wildcard } from "../_cors.ts";

export const DEFAULT_CORS_MAX_AGE = 5 * 60;

const AllowOriginJson = z.union([
  SlashDelimitedRegexString,
  WildcardSchema,
  OriginShorthand.array(),
  z.null(),
]);

export function formatAllowOriginJson(
  value: z.infer<typeof AllowOriginJson>,
): z.input<typeof AllowOriginJson> {
  return value === Wildcard
    ? "*"
    : value instanceof RegExp
    ? formatSlashDelimitedRegexString(value)
    : value;
}

export const Cors = z.object({
  allow_origin: AllowOriginJson.optional(),
  max_age: MaxAge.optional(),
});
export type Cors = z.infer<typeof Cors>;

export const DataStreamCredentials = z.object({
  api_secret: NonEmptyString,
  measurement_id: NonEmptyString,
});

export const InDataStreamCredentials = DataStreamCredentials.extend({
  cors: Cors.optional(),
});

export const DataStreamInOut = z.object({
  in: InDataStreamCredentials,
  out: DataStreamCredentials,
});
export type DataStreamInOut = z.infer<typeof DataStreamInOut>;

export const DataStreamInOutShorthand = InDataStreamCredentials.transform((
  { cors, ...ds },
): DataStreamInOut => ({
  in: { ...ds, ...(cors && { cors }) },
  out: { ...ds },
})).or(
  DataStreamInOut,
);

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
  cors: Cors.optional(),
});
export type ForwarderConfig = z.infer<typeof ForwarderConfig>;

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

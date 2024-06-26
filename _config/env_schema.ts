import { ExistingIdPolicy } from "../anonymisation.ts";
import { DestinationUrl, Host, Port, ScramblerKey } from "./values_schema.ts";
import { EvaluatedDisambiguatedLifetimeExpression } from "./lifetimes.ts";
import { z } from "../deps.ts";
import {
  EvaluatedOriginsExpression,
  MaxAge,
  WildcardSchema,
} from "./cors_schemas.ts";

function isTrue(value: string): boolean {
  return value.toLowerCase() === "true";
}

export const EmptyStringAsUndefined = z.string().transform((s) =>
  s ? s : undefined
);
export const EnvBool = z.string().transform(isTrue);

const DecimalIntFromString = z.string().regex(/^(0|[1-9][0-9]*)$/, {
  message: "Not a decimal integer",
}).transform(
  (i) => parseInt(i),
);

const AllowOriginEnvar = z.union([WildcardSchema, EvaluatedOriginsExpression]);

/** Names of config envars used individually. */
export enum ConfigEnvars {
  show_config = "ANONYSTAT_SHOW_CONFIG",
  config_source = "ANONYSTAT_CONFIG_SOURCE",
  config = "ANONYSTAT_CONFIG",
  config_file = "ANONYSTAT_CONFIG_FILE",
}

function emptyStringAsUndefined<SchemaT extends z.ZodTypeAny>(schema: SchemaT) {
  return EmptyStringAsUndefined.pipe(schema.optional()).optional();
}

export const RawConfigEnv = z.object({
  ANONYSTAT_DATA_STREAM_MEASUREMENT_ID: EmptyStringAsUndefined.optional(),
  ANONYSTAT_DATA_STREAM_IN_MEASUREMENT_ID: EmptyStringAsUndefined.optional(),
  ANONYSTAT_DATA_STREAM_OUT_MEASUREMENT_ID: EmptyStringAsUndefined.optional(),
  ANONYSTAT_DATA_STREAM_API_SECRET: EmptyStringAsUndefined.optional(),
  ANONYSTAT_DATA_STREAM_IN_API_SECRET: EmptyStringAsUndefined.optional(),
  ANONYSTAT_DATA_STREAM_OUT_API_SECRET: EmptyStringAsUndefined.optional(),
  ANONYSTAT_DESTINATION: EmptyStringAsUndefined.pipe(DestinationUrl).optional(),
  ANONYSTAT_ALLOW_DEBUG: EmptyStringAsUndefined.pipe(EnvBool).optional(),
  ANONYSTAT_USER_ID_SCRAMBLING_SECRET: EmptyStringAsUndefined.pipe(
    ScramblerKey,
  ).optional(),
  ANONYSTAT_USER_ID_LIFETIME: EmptyStringAsUndefined.pipe(
    EvaluatedDisambiguatedLifetimeExpression,
  ).optional(),
  ANONYSTAT_USER_ID_EXISTING: EmptyStringAsUndefined.pipe(ExistingIdPolicy)
    .optional(),
  ANONYSTAT_CORS_ALLOW_ORIGIN: emptyStringAsUndefined(AllowOriginEnvar),
  ANONYSTAT_CORS_MAX_AGE: emptyStringAsUndefined(MaxAge),
  ANONYSTAT_LISTEN_PORT: EmptyStringAsUndefined.pipe(DecimalIntFromString).pipe(
    Port,
  ).optional(),
  ANONYSTAT_LISTEN_HOSTNAME: EmptyStringAsUndefined.pipe(Host).optional(),
});
export type ConfigValueEnvarName = keyof typeof RawConfigEnv.shape;
export const configValueEnvarNames = Object.keys(
  RawConfigEnv.shape,
) as readonly ConfigValueEnvarName[];

export const ConfigEnv = RawConfigEnv.superRefine((val, ctx) => {
  const ensurePresent = (name: keyof typeof val, other: keyof typeof val) => {
    if (val[other] !== undefined || val[name] !== undefined) return;
    ctx.addIssue({
      code: z.ZodIssueCode.invalid_type,
      expected: "string",
      received: "undefined",
      path: [name],
      message: `Required because ${other} is not set`,
    });
  };
  ensurePresent(
    "ANONYSTAT_DATA_STREAM_IN_MEASUREMENT_ID",
    "ANONYSTAT_DATA_STREAM_MEASUREMENT_ID",
  );
  ensurePresent(
    "ANONYSTAT_DATA_STREAM_OUT_MEASUREMENT_ID",
    "ANONYSTAT_DATA_STREAM_MEASUREMENT_ID",
  );
  ensurePresent(
    "ANONYSTAT_DATA_STREAM_IN_API_SECRET",
    "ANONYSTAT_DATA_STREAM_API_SECRET",
  );
  ensurePresent(
    "ANONYSTAT_DATA_STREAM_OUT_API_SECRET",
    "ANONYSTAT_DATA_STREAM_API_SECRET",
  );
});
export type ConfigEnv = z.infer<typeof ConfigEnv>;
export type RawConfigEnv = z.infer<typeof RawConfigEnv>;

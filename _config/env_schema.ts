import { ExistingIdPolicy } from "../anonymisation.ts";
import { DestinationUrl, Host, Port, ScramblerKey } from "./values_schema.ts";
import { ValidatedDisambiguatedLifetimeExpression } from "./lifetimes.ts";
import { z } from "../deps.ts";

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

/** Names of config envars used individually. */
export enum ConfigEnvars {
  show_config = "ANONYSTAT_SHOW_CONFIG",
  config_source = "ANONYSTAT_CONFIG_SOURCE",
  config = "ANONYSTAT_CONFIG",
  config_file = "ANONYSTAT_CONFIG_FILE",
}

const _ConfigEnv = z.object({
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
    ValidatedDisambiguatedLifetimeExpression,
  ).optional(),
  ANONYSTAT_USER_ID_EXISTING: EmptyStringAsUndefined.pipe(ExistingIdPolicy)
    .optional(),
  ANONYSTAT_LISTEN_PORT: EmptyStringAsUndefined.pipe(DecimalIntFromString).pipe(
    Port,
  ).optional(),
  ANONYSTAT_LISTEN_HOSTNAME: EmptyStringAsUndefined.pipe(Host).optional(),
});
export type ConfigValueEnvarName = keyof typeof _ConfigEnv.shape;
export const configValueEnvarNames = Object.keys(
  _ConfigEnv.shape,
) as readonly ConfigValueEnvarName[];

export const ConfigEnv = _ConfigEnv.superRefine((val, ctx) => {
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
export type RawConfigEnv = z.input<typeof ConfigEnv>;

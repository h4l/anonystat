/**
 * Zod schemas for Google Analytics 4 Measurement Protocol.
 *
 * ## Measurement Protocol Documentation
 *
 * - For reference docs, see:
 *   - Protocol data types: https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference?client_type=gtag
 *   - Event data types: https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference/events
 *   - Protocol data limits (e.g. max length of values): https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events?client_type=gtag#limitations
 *
 * - For general GA4 MP use, see: https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events?client_type=gtag
 *
 * - For useful advice on ad-hoc use, see: https://developer.chrome.com/docs/extensions/how-to/integrate/google-analytics-4#generate-client-id
 *   This example shows how to use GA4 MP from a browser extension using raw HTTP requests, without gtag.js.
 */

import { z } from "./deps.ts";

const GrantOrDeny = z.enum(["GRANTED", "DENIED"]);

export const UserPropertyName = z.string().regex(/^[a-z][a-z0-9_]{0,23}$/i);
export const UserPropertyValue = z.union([z.string().max(36), z.number()]);
export const UserProperties = z.record(
  UserPropertyName,
  z.object({ value: UserPropertyValue }),
).refine(
  (val) => Object.keys(val).length <= 25,
  { message: "At most 25 user_properties can be set" },
);

const Consent = z.object({
  ad_user_data: GrantOrDeny,
  ad_personalization: GrantOrDeny,
});

// const Event = z.object({
//   name: z.string(),
//   params: z.record(z.string(), z.any()).array(),
// });

// const Payload = z.object({
//   client_id: z.string(),
//   user_id: z.string().optional(),
//   timestamp_micros: z.number().nonnegative().optional(),
//   user_properties: UserProperties.optional(),
//   consent: Consent.optional(),
//   events: z.array(Event),
// });

// https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference?client_type=gtag#reserved_event_names
export const ReservedEventName = z.enum([
  "ad_activeview",
  "ad_click",
  "ad_exposure",
  "ad_impression",
  "ad_query",
  "ad_reward",
  "adunit_exposure",
  "app_clear_data",
  "app_exception",
  "app_install",
  "app_remove",
  "app_store_refund",
  "app_update",
  "app_upgrade",
  "dynamic_link_app_open",
  "dynamic_link_app_update",
  "dynamic_link_first_open",
  "error",
  "firebase_campaign",
  "firebase_in_app_message_action",
  "firebase_in_app_message_dismiss",
  "firebase_in_app_message_impression",
  "first_open",
  "first_visit",
  "in_app_purchase",
  "notification_dismiss",
  "notification_foreground",
  "notification_open",
  "notification_receive",
  "notification_send",
  "os_update",
  "screen_view",
  "session_start",
  "user_engagement",
]);

export const ParameterName = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/i);
export const EventName = ParameterName.refine(
  (arg) => !ReservedEventName.safeParse(arg).success,
  (arg) => ({
    message: `${arg} is a reserved name`,
  }),
);

export const ParameterValue = z.union([z.number(), z.string().max(100)]);
export const AnyItem = z.record(ParameterName, ParameterValue);
export const AnyParameters = z.record(ParameterName, z.any()).pipe(
  // 10 items is from "parameters can have a maximum of 10 custom parameters"
  // from: https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events?client_type=gtag
  z.object({ items: z.array(AnyItem).max(10).optional() }).catchall(
    ParameterValue,
  ),
);

export const AnyEvent = z.object({
  name: EventName,
  params: AnyParameters.optional(),
}).refine(
  (params) => Object.keys(params).length <= 25,
  (params) => ({
    message: `The "params" object can have at most 25 parameters, found: ${
      Object.keys(params).length
    }`,
  }),
);

const nonNegDecimalIntegerPattern = /^0|(?:[1-9][0-9]{0,15})$/; // 2**53 is 16 decimal digits
const MicrosecondTimeStamp = z.string().regex(nonNegDecimalIntegerPattern)
  .pipe(z.coerce.number().nonnegative()).or(z.number().nonnegative());

export function createPayloadSchema<EventSchema extends z.ZodTypeAny>(
  { eventSchema, maxEvents = 25 }: {
    eventSchema: EventSchema;
    maxEvents?: number;
  },
) {
  return z.object({
    client_id: z.string(),
    user_id: z.string().optional(),
    timestamp_micros: MicrosecondTimeStamp.optional(),
    user_properties: UserProperties.optional(),
    consent: Consent.optional(),
    events: z.array(eventSchema).max(maxEvents),
  });
}

export const AnyPayload = createPayloadSchema({ eventSchema: AnyEvent });
export type AnyPayload = z.infer<typeof AnyPayload>;

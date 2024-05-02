import { z } from "../deps.ts";

export const NonEmptyString = z.string().min(1);
export const DestinationUrl = z.string().url();
const DomainName = z.string().regex(
  /^(([a-z0-9]|[a-z0-9][a-z0-9\-]*[a-z0-9])\.)*([a-z0-9]|[a-z0-9][a-z0-9\-]*[a-z0-9])$/i,
  { message: "Not a valid hostname" },
);
export const Host = z.string().ip().or(DomainName);
export const Port = z.number().int().nonnegative();
export const ScramblerKey = z.string().min(1, { message: "Must not be empty" });

import {
  MatchedErrorNames,
  PayloadParseError,
  ProxySendError,
  RequestReadError,
} from "./proxy.ts";

Deno.test("DefaultErrorNames", () => {
  type ExpectedErrorName =
    (RequestReadError | PayloadParseError | ProxySendError)["name"];

  type ActualErrorName = (typeof MatchedErrorNames._def.values)[number];
  // these won't type check if the enum is out of sync with ExpectedErrorName
  const _a: ExpectedErrorName[] = [] as ActualErrorName[];
  const _b: ActualErrorName[] = [] as ExpectedErrorName[];
});

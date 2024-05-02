import { string } from "https://deno.land/x/zod@v3.22.4/types.ts";
import { ErrorResult, Result, SuccessResult } from "./_misc.ts";
import {
  assert,
  assertEquals,
  AssertionError,
  assertLess,
  assertLessOrEqual,
  Stub,
  validateUuid,
} from "./dev_deps.ts";
import { assertFalse } from "https://deno.land/std@0.221.0/assert/assert_false.ts";
import { AnyPayload } from "./payload-schemas.ts";
import { assertGreater } from "./dev_deps.ts";

/** Parse an iso date and return it as a ms timestamp, throw on invalid syntax. */
export function timestamp(isoDate: string): number {
  const timestamp = Date.parse(isoDate);
  if (Number.isNaN(timestamp)) throw new Error("Invalid date");
  return timestamp;
}

/** Parse an iso date and return it as a Date, throw on invalid syntax. */
export function date(isoDate: string, offset: number = 0): Date {
  return new Date(timestamp(isoDate) + offset);
}

export function assertSuccessful<T, E>(
  result: Result<T, E>,
): asserts result is SuccessResult<T> {
  if (result.success) return;
  assert(
    false,
    `expected result to be successful but it failed with error: ${
      Deno.inspect(result.error)
    }`,
  );
}

export function assertUnsuccessful<T, E>(
  result: Result<T, E>,
): asserts result is ErrorResult<E> {
  if (!result.success) return;
  assert(
    false,
    `result is not unsuccessful with data: ${Deno.inspect(result.data)}`,
  );
}

/** Assert that value is a valid UUID string. */
export function assertUuid(value: unknown): asserts value is string {
  if (typeof value === "string" && validateUuid(value)) return;
  assert(false, `value is not a UUID: ${Deno.inspect(value)}`);
}

/** Linearly interpolate from `a` to `b` by `t`. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function assertResponseOk(response: Response): void {
  if (response.status >= 200 && response.status < 300) return;
  assert(
    false,
    `expected response to have 2XX status but is ${response.status}: ${
      Deno.inspect(response)
    }`,
  );
}

export async function assertOneFetchForMpCollectRequest(
  fetch: Stub<
    typeof globalThis,
    [input: string | Request | URL, init?: RequestInit | undefined],
    Promise<Response>
  >,
  mpCollectRequestAttrs: MpCollectRequestAttrs,
) {
  await assertFetchForMpCollectRequest(
    fetch,
    { index: 0, maxCalls: 1 },
    mpCollectRequestAttrs,
  );
}
export async function assertFetchForMpCollectRequest(
  fetch: Stub<
    typeof globalThis,
    [input: string | Request | URL, init?: RequestInit | undefined],
    Promise<Response>
  >,
  { index, maxCalls }: { index: number; maxCalls?: number },
  mpCollectRequestAttrs: MpCollectRequestAttrs,
) {
  if (maxCalls !== undefined) {
    assertLessOrEqual(fetch.calls.length, maxCalls, "Too many fetch() calls");
  }
  assertGreater(fetch.calls.length, index, "Too few fetch() calls");

  const request = fetch.calls[index].args[0];
  if (
    !(fetch.calls[index].args.length === 1 && request instanceof Request)
  ) {
    assert(
      false,
      `expected fetch to be called with one Request argument: ${
        Deno.inspect(fetch.calls[index].args)
      }`,
    );
  }
  await assertIsMpRequest(request, mpCollectRequestAttrs);
}

export type MpCollectRequestAttrs = {
  origin: string;
  measurement_id: string;
  api_secret: string;
  user_id?: string | ((value: string | undefined) => void);
};

export async function assertIsMpRequest(
  request: Request,
  { origin, measurement_id, api_secret, user_id }: MpCollectRequestAttrs,
): Promise<void> {
  const reqUrl = new URL(request.url);
  assertEquals(reqUrl.origin, origin);
  assertEquals(reqUrl.pathname, "/mp/collect");
  assertEquals(reqUrl.searchParams.get("measurement_id"), measurement_id);
  assertEquals(reqUrl.searchParams.get("api_secret"), api_secret);

  if (user_id !== undefined) {
    const payload = await getRequestPayload(request);
    if (typeof user_id === "string") {
      assertEquals(
        payload.user_id,
        user_id,
        "Payload contains unexpected user_id",
      );
    } else {
      user_id(payload.user_id);
    }
  }
}

async function getRequestPayload(request: Request): Promise<AnyPayload> {
  try {
    return AnyPayload.parse(await request.json());
  } catch (e) {
    throw new AssertionError(
      `Request body is not readable as a collect request payload: ${
        Deno.inspect(e)
      }`,
    );
  }
}

import { unreachable } from "./deps.ts";

/** Assert that all unions of a type have been [handled in a type-safe way](https://stackoverflow.com/questions/39419170/how-do-i-check-that-a-switch-block-is-exhaustive-in-typescript/39419171#39419171). */
export function assertUnreachable(_value: never, message?: string): never {
  unreachable(message);
}

/** Type-check that an if-else handles all cases, with runtime fallback if not.
 *
 * This allows the type checker to validate that all known types in a union have
 * been handled in a switch/if-else chain, while providing a usable fallback if
 * the type constraint is violated at runtime.
 *
 * @param _value The subject of an if-else chain that is never after the if-else
 * handles all expected values.
 * @param runtimeBehaviour A function that is called at runtime if the static
 * type constraints are violated.
 * @returns The result of runtimeBehaviour.
 */
export function unreachableAtCompileTime<T>(
  _value: never,
  runtimeBehaviour: () => T,
): T {
  return runtimeBehaviour();
}

/** Check if an error is a [TimeoutError](https://developer.mozilla.org/en-US/docs/Web/API/DOMException#timeouterror), e.g. from `AbortSignal.timeout()`.
 */
export function isTimeout(e: unknown): e is DOMException {
  return e instanceof DOMException && e.name == "TimeoutError";
}

/** Check if an error has a message: string property. */
export function hasMessage<T>(e: T): e is T & { message: string } {
  type MaybeMsg = { message?: unknown };
  return e && typeof e === "object" &&
    typeof (e as MaybeMsg).message === "string";
}

export type Error<NameT extends string, DetailsT = unknown> =
  & { name: NameT }
  & DetailsT;

export type SuccessResult<T> = { success: true; data: T };
export type ErrorResult<E> = { success: false; error: E };
export type Result<T, E> = SuccessResult<T> | ErrorResult<E>;

export function mapResult<T, U, E>(
  result: Result<T, E>,
  transform: (value: T) => U,
): Result<U, E> {
  return result.success
    ? { success: true, data: transform(result.data) }
    : result;
}

export type MaybePromise<T> = T | Promise<T>;

// deno-lint-ignore no-explicit-any
export type SyncReturn<T extends (...args: any) => any> = (
  ...args: Parameters<T>
) => Awaited<ReturnType<T>>;

// deno-lint-ignore no-explicit-any
export type IfFn<T, Yes, No> = T extends ((...args: any) => any) ? Yes : No;

export type MaybeLazy<T> = IfFn<T, never, T | (() => T)>;

export function notLazy<T>(maybeLazy: MaybeLazy<T>): T {
  return typeof maybeLazy === "function" ? maybeLazy() : maybeLazy;
}

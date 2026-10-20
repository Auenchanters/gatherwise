/**
 * The success-or-error value that functions return instead of throwing, shared by browser and server.
 * Never carries behavior beyond two constructors; callers narrow on `.ok`.
 */

/** Either a success carrying `value` or a failure carrying `error`; narrow on `.ok`. */
export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** Wraps a successful value. */
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

/** Wraps a failure. */
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * A concurrency gate: at most 3 model calls in flight per warm instance.
 * Does: reject the fourth at once with `CAPACITY_LIMITED`, and free the slot whether the call
 * succeeds, fails or is cancelled.
 * Never does: queue work or hold request data; a rejected caller retries after `Retry-After`.
 */
import { AppError } from './errors.js';

const MAX_IN_FLIGHT = 3;

/** Runs `work` if a slot is free, otherwise throws `CAPACITY_LIMITED`. */
export type InferenceGate = <T>(work: () => Promise<T>) => Promise<T>;

/** A fresh gate with its own slot count. */
export function createInferenceGate(): InferenceGate {
  let inFlight = 0;
  return async (work) => {
    if (inFlight >= MAX_IN_FLIGHT) throw new AppError('CAPACITY_LIMITED');
    inFlight += 1;
    try {
      return await work();
    } finally {
      inFlight -= 1;
    }
  };
}

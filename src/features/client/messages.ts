/**
 * The one catalog of copy for client-side AI failures.
 * Does: turn a `ClientError` into one short, honest sentence that says what happened and that the
 * deterministic plan (budget, timeline, vendors, standard suggestions) still works.
 * Never does: show a server message, a status code or any detail of the failure, or promise that
 * trying again will work.
 */
import type { ClientError } from './api-client.js';

const MESSAGES: Record<Exclude<ClientError['code'], 'rate_limited'>, string> = {
  network:
    "Can't reach the AI service — check your connection. Your plan is ready with standard suggestions; try “Refresh ideas” once you're back online.",
  timeout:
    'Gemini took too long to answer — your plan is ready with standard suggestions. Try “Refresh ideas” in a moment.',
  unavailable:
    "AI ideas aren't available right now — the budget, timeline and vendors are fully usable.",
  invalid:
    "We couldn't use the AI's reply, so you're seeing standard suggestions — the budget, timeline and vendors are fully usable. Try “Refresh ideas” again.",
};

/** "a minute" without a wait, otherwise whole minutes rounded up so nobody retries too early. */
function waitPhrase(seconds: number | undefined): string {
  if (seconds === undefined) return 'a minute';
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

/** The sentence to show for a failed AI request. `retryAfterSeconds` only matters when rate limited. */
export function clientErrorMessage(error: ClientError): string {
  if (error.code !== 'rate_limited') return MESSAGES[error.code];
  return `Gemini is busy right now — your plan is ready with standard suggestions. Try “Refresh ideas” in ${waitPhrase(error.retryAfterSeconds)}.`;
}

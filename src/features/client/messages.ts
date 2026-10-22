/**
 * The one catalog of copy for client-side AI failures.
 * Does: turn a `ClientError` into one short, honest sentence that says what happened and that the
 * deterministic plan (budget, timeline, vendors) still works, with the standard suggestions, or
 * with the AI ideas from an earlier answer when an adjustment failed and they stay.
 * Never does: show a server message, a status code or any detail of the failure, or promise that
 * trying again will work.
 */
import type { ClientError } from './api-client.js';

/** "a minute" without a wait, otherwise whole minutes rounded up so nobody retries too early. */
function waitPhrase(seconds: number | undefined): string {
  if (seconds === undefined) return 'a minute';
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

/**
 * The sentence to show for a failed AI request. `ideasKept` says that an earlier AI answer stays
 * in the plan, so the copy must not claim standard suggestions. `retryAfterSeconds` only matters
 * when rate limited.
 */
export function clientErrorMessage(error: ClientError, ideasKept = false): string {
  const outcome = ideasKept
    ? 'your current ideas are unchanged'
    : 'your plan is ready with standard suggestions';
  switch (error.code) {
    case 'network':
      return `Can't reach the AI service — check your connection. ${outcome.replace(/^./u, (c) => c.toUpperCase())}; try “Adjust with AI” once you're back online.`;
    case 'timeout':
      return `The AI took too long to reply — ${outcome}. You can try again.`;
    case 'rate_limited':
      return `The AI service is busy right now — ${outcome}. Try “Adjust with AI” in ${waitPhrase(error.retryAfterSeconds)}.`;
    case 'unavailable':
      return "AI ideas aren't available right now — the budget, timeline and vendors are fully usable.";
    case 'invalid':
      return "We couldn't get usable AI ideas for this plan — your budget, timeline and vendors are unaffected.";
  }
}

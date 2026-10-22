/**
 * The one length cap for text: the sanitizer (src/shared/sanitize-text.ts) and the engine's AI
 * normalizer (src/domain/merge.ts) both cut with it, so a cap means the same everywhere.
 * Never does: import anything, so the domain may load it at runtime.
 */

// NOTE: this counts code points, not graphemes, so a cut can still split an emoji built from
// several code points (a family joined by ZWJ). Cutting with Intl.Segmenter would lift that.
/** Trims `text` and keeps at most `max` code points (never half a surrogate pair), then trims the cut. */
export const capText = (text: string, max: number): string =>
  Array.from(text.trim()).slice(0, max).join('').trimEnd();

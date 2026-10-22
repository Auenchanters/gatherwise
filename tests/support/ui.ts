/**
 * Small lookups the UI tests share.
 * Does: read what assistive technology would read for a control, and fail a test cleanly when a
 * value it needs is missing.
 * Never does: render anything, or query by anything but ids the page itself holds.
 */

/** `value`, or a failed test when it is missing. */
export function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

/** The text of every element an input's `aria-describedby` points at, joined by spaces. */
export function descriptionOf(element: HTMLElement): string {
  const ids = element.getAttribute('aria-describedby')?.split(' ') ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent ?? `#${id} missing`).join(' ');
}

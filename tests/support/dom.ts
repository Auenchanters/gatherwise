/**
 * DOM lookups the UI tests share.
 * Does: read what assistive technology would read for a control.
 * Never does: render anything, or query by anything but ids the page itself holds.
 */

/** The text of every element an input's `aria-describedby` points at, joined by spaces. */
export function descriptionOf(element: HTMLElement): string {
  const ids = element.getAttribute('aria-describedby')?.split(' ') ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent ?? `#${id} missing`).join(' ');
}

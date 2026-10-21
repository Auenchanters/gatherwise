/**
 * Small labels shared by the Timeline, Vendors and Ideas tabs.
 * Does: show a status as icon, text and colour together (the icon is decorative; the words carry
 * the meaning), and mark where a piece of text came from: Gemini or the standard template.
 * Never does: decide a status or a label (`STATUS_UI` and the engine do).
 */
import type { ReactElement } from 'react';
import { AI_LABEL } from '../../domain/merge.js';

/** The look of one chip: an icon glyph and a modifier for the `status` class. */
interface ChipUi {
  readonly icon: string;
  readonly className: string;
}

/** A pill with an `aria-hidden` icon before its text. */
export function StatusChip({
  ui,
  label,
}: {
  readonly ui: ChipUi;
  readonly label: string;
}): ReactElement {
  return (
    <span className={`status ${ui.className}`}>
      <span aria-hidden="true">{ui.icon}</span> {label}
    </span>
  );
}

/** The label every AI-written text carries. */
export function AiBadge(): ReactElement {
  return <span className="badge badge--ai">{AI_LABEL}</span>;
}

/** The label every template-written suggestion carries. */
export function StandardBadge(): ReactElement {
  return <span className="badge badge--standard">Standard suggestion</span>;
}

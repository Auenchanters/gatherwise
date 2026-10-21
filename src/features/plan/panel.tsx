/**
 * The two pieces every workspace tab repeats: the panel shell and the polite announcement.
 * Does: `Panel` is the tab's one named landmark, a section labelled by its own `<h2>`; `LiveRegion`
 * is a visually hidden `role="status"` line that screen readers announce when its message changes.
 * Never does: hold state or decide what a message says.
 */
import { useId, type ReactElement, type ReactNode } from 'react';

/** A tab's content: a section named by its h2. */
export function Panel(props: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactElement {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 className="panel-title" id={id}>
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

/** Announces `message` politely, and shows nothing. Always rendered, so changes are heard. */
export function LiveRegion({ message }: { readonly message: string }): ReactElement {
  return (
    <p className="visually-hidden" role="status">
      {message}
    </p>
  );
}

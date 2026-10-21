/**
 * The landing intro shown above the brief form while there is no plan: what Gatherwise does, for
 * which events, and two one-click samples.
 * Does: owns the page's only `<h1>` in this state and calls `onUseSample(kind)`; the parent fills
 * the form and moves focus to it.
 * Never does: hold state, fill the form itself, or call the API.
 */
import type { ReactElement } from 'react';
import type { SampleKind } from './samples.js';

const PROMISES = [
  {
    icon: '₹',
    title: 'Budgets that add up',
    text: 'Every category sums to your total, with a contingency set aside first.',
  },
  {
    icon: '✓',
    title: 'Deadlines that are honest',
    text: 'A timeline worked back from your date, with book-by dates for each vendor you need.',
  },
  {
    icon: '✦',
    title: 'AI ideas you can check',
    text: 'Ideas made for your event by Google Gemini, labeled and priced against your budget.',
  },
] as const;

/** Props for {@link Landing}. */
export interface LandingProps {
  /** Called when a sample button is pressed. */
  readonly onUseSample: (kind: SampleKind) => void;
}

/** The empty-state intro: headline, promise, three proof points and the sample buttons. */
export function Landing({ onUseSample }: LandingProps): ReactElement {
  return (
    <section className="landing" aria-labelledby="landing-title">
      <p className="landing__eyebrow">For weddings, birthdays and community events</p>
      <h1 className="landing__title" id="landing-title">
        Plan a celebration that <span className="landing__highlight">adds up</span>
      </h1>
      <p className="landing__lede">
        Gatherwise turns a few details into a budget that reconciles to the rupee, a timeline that
        respects real lead times, the vendors you&apos;ll need and ideas personalized by Google
        Gemini.
      </p>
      <ul className="landing__promises">
        {PROMISES.map((promise) => (
          <li className="promise" key={promise.title}>
            <span className="promise__icon" aria-hidden="true">
              {promise.icon}
            </span>
            <strong className="promise__title">{promise.title}</strong>
            <span className="promise__text">{promise.text}</span>
          </li>
        ))}
      </ul>
      <div className="landing__samples">
        <p className="landing__samples-intro">In a hurry? Start from an example and edit it.</p>
        <div className="landing__buttons">
          <button
            className="button button--secondary"
            type="button"
            onClick={() => {
              onUseSample('community');
            }}
          >
            Try a sample community event
          </button>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => {
              onUseSample('birthday');
            }}
          >
            Try a sample birthday
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * The banner for deadlines that cannot be met: shown whenever the timeline has infeasible or
 * overdue tasks, naming up to five of them with their status (tasks Gemini added carry the AI
 * label), and linking to the timeline.
 * Never does: soften a deadline or hide that a task cannot be done in time (Review Focus 1).
 */
import { useId, type MouseEvent, type ReactElement } from 'react';
import type { Schedule } from '../../domain/schedule.js';
import { isAiTask, STATUS_UI } from './status-ui.js';

/** How many blocked tasks the banner names before summing up the rest. */
const SHOWN = 5;

/** Props for {@link InfeasibleBanner}. */
export interface InfeasibleBannerProps {
  readonly schedule: Schedule;
  /** The timeline panel's id, for the link's target. */
  readonly timelineId: string;
  /** Switches to the timeline; the link still works as a plain anchor without it. */
  readonly onSeeTimeline: () => void;
}

/** Infeasible and overdue tasks, or nothing when every deadline can be met. */
export function InfeasibleBanner({
  schedule,
  timelineId,
  onSeeTimeline,
}: InfeasibleBannerProps): ReactElement | null {
  const titleId = useId();
  const total = schedule.infeasibleCount + schedule.overdueCount;
  if (total === 0) return null;
  const blocked = schedule.tasks.filter((t) => t.status === 'infeasible' || t.status === 'overdue');
  return (
    <section className="banner" aria-labelledby={titleId}>
      <h2 className="banner__title" id={titleId}>
        <span className="banner__icon" aria-hidden="true">
          !
        </span>
        Some deadlines can&apos;t be met
      </h2>
      <p className="banner__text">
        These tasks need more lead time than is left before your event. Start them now, scale them
        down, or move the date. Lead times are typical planning heuristics; permit processing varies
        by city, so check with your local authority.
      </p>
      <ul className="banner__list">
        {blocked.slice(0, SHOWN).map((task) => {
          const ui = STATUS_UI.task[task.status];
          return (
            <li className="banner__item" key={task.id}>
              <span className="banner__task">
                <span dir="auto">{task.title}</span>
                {isAiTask(task.id) && <span className="badge badge--ai">AI · personalized</span>}
              </span>
              <span className={`status ${ui.className}`}>
                <span aria-hidden="true">{ui.icon}</span> {ui.label}
              </span>
            </li>
          );
        })}
      </ul>
      {total > SHOWN && <p className="banner__more">and {total - SHOWN} more.</p>}
      <a
        className="banner__link"
        href={`#${timelineId}`}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          event.preventDefault();
          onSeeTimeline();
        }}
      >
        See the timeline
      </a>
    </section>
  );
}

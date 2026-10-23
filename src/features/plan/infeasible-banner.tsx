/**
 * The banner for deadlines that cannot be met: shown whenever the timeline has infeasible or
 * overdue tasks, naming up to five of them with their status (tasks Gemini added carry the AI
 * label, and their titles the plan's language), and linking to the timeline. Tasks that cannot be
 * done in time come first, then overdue ones, each group in schedule order.
 * Never does: soften a deadline or hide that a task cannot be done in time.
 */
import { useId, type MouseEvent, type ReactElement } from 'react';
import { isAiTask } from '../../domain/merge.js';
import type { Schedule } from '../../domain/schedule.js';
import { AiBadge, StatusChip } from './chips.js';
import { STATUS_UI } from './status-ui.js';

/** How many blocked tasks the banner names before summing up the rest. */
const SHOWN = 5;

/** Props for {@link InfeasibleBanner}. */
export interface InfeasibleBannerProps {
  readonly schedule: Schedule;
  /** The language tag for the titles of tasks Gemini added. */
  readonly aiLang: string;
  /** The timeline panel's id, for the link's target. */
  readonly timelineId: string;
  /** Switches to the timeline; the link still works as a plain anchor without it. */
  readonly onSeeTimeline: () => void;
}

/** Infeasible and overdue tasks, or nothing when every deadline can be met. */
export function InfeasibleBanner({
  schedule,
  aiLang,
  timelineId,
  onSeeTimeline,
}: InfeasibleBannerProps): ReactElement | null {
  const titleId = useId();
  const total = schedule.infeasibleCount + schedule.overdueCount;
  if (total === 0) return null;
  const blocked = [
    ...schedule.tasks.filter((t) => t.status === 'infeasible'),
    ...schedule.tasks.filter((t) => t.status === 'overdue'),
  ];
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
        down, or move the date. Lead times are typical planning estimates; confirm them with your
        vendors, and with your local authority for any permit.
      </p>
      <ul className="banner__list">
        {blocked.slice(0, SHOWN).map((task) => {
          const ui = STATUS_UI.task[task.status];
          return (
            <li className="banner__item" key={task.id}>
              <span className="banner__task">
                <span dir="auto" lang={isAiTask(task.id) ? aiLang : undefined}>
                  {task.title}
                </span>
                {isAiTask(task.id) && <AiBadge />}
              </span>
              <StatusChip ui={ui} label={ui.label} />
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

/**
 * The Timeline tab: the schedule's tasks grouped by the month they must start in, each with a
 * status chip, its dates and a checkbox, plus the calendar download and "Print plan".
 * Does: label every checkbox with the task's title and describe it by its status and dates; tell
 * a screen reader politely what a tick did; keep focus on a neighbouring task when "Hide done
 * tasks" removes the one just ticked; label tasks Gemini added "AI · personalized"; build the
 * calendar file from the schedule with the clock read once, at the click.
 * Never does: compute a date or status (the engine's), call the AI, or leave a task's state to
 * colour alone (every status is an icon and words too).
 */
import { useId, useRef, useState, type ReactElement } from 'react';
import type { ReadyState } from '../../domain/reducer.js';
import { toIcs } from '../../domain/ics.js';
import type { ScheduledTask } from '../../domain/schedule.js';
import { AiBadge, StatusChip } from './chips.js';
import { icsBlob, icsFilename } from './download.js';
import { categoryLabel, showDate, showMonth } from './format.js';
import type { PlannerStore } from './planner-store.js';
import { isAiTask, STATUS_UI } from './status-ui.js';
import { utcStamp } from './utc-stamp.js';

/** How long the downloaded file's URL stays valid; browsers have started the save well before. */
const RELEASE_AFTER_MS = 30_000;

/** The tasks, which the schedule has ordered by latest start, in one run per month. */
function byMonth(
  tasks: readonly ScheduledTask[],
): { readonly month: string; readonly tasks: ScheduledTask[] }[] {
  const groups: { readonly month: string; readonly tasks: ScheduledTask[] }[] = [];
  for (const task of tasks) {
    const month = showMonth(task.latestStart);
    const last = groups.at(-1);
    if (last?.month === month) last.tasks.push(task);
    else groups.push({ month, tasks: [task] });
  }
  return groups;
}

/** One task: a checkbox named by its title, then its status, category, dates and note. */
function TaskRow(props: {
  readonly task: ScheduledTask;
  readonly category: string;
  readonly onToggle: (task: ScheduledTask, input: HTMLInputElement) => void;
}): ReactElement {
  const { task, category, onToggle } = props;
  const id = useId();
  const ui = STATUS_UI.task[task.status];
  return (
    <li className="task">
      <input
        className="task__input"
        id={id}
        type="checkbox"
        checked={task.status === 'done'}
        aria-describedby={`${id}-details`}
        onChange={(event) => {
          onToggle(task, event.currentTarget);
        }}
      />
      <label className="task__title" htmlFor={id} dir="auto">
        {task.title}
      </label>
      <div className="task__details" id={`${id}-details`}>
        <p className="task__chips">
          <StatusChip ui={ui} label={ui.label} />
          {isAiTask(task.id) && <AiBadge />}
          <span className="task__category">{category}</span>
        </p>
        <p className="task__dates">
          Start by {showDate(task.latestStart)} · finish by {showDate(task.latestEnd)}
        </p>
        {task.note !== undefined && (
          <p className="task__note" dir="auto">
            {task.note}
          </p>
        )}
      </div>
    </li>
  );
}

/** Props for {@link Timeline}. */
export interface TimelineProps {
  readonly state: ReadyState;
  readonly store: PlannerStore;
}

/** The month-by-month task list with its filter and its calendar and print buttons. */
export function Timeline({ state, store }: TimelineProps): ReactElement {
  const titleId = useId();
  const filterId = useId();
  const [hideDone, setHideDone] = useState(false);
  const [message, setMessage] = useState('');
  const panelRef = useRef<HTMLElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const { brief, plan } = state;
  const { tasks } = plan.schedule;
  const doneCount = tasks.filter((task) => task.status === 'done').length;
  const shown = hideDone ? tasks.filter((task) => task.status !== 'done') : tasks;

  /** Ticks a task and says so. If the task is about to be hidden, focus moves on first. */
  const toggle = (task: ScheduledTask, input: HTMLInputElement): void => {
    const becomesDone = task.status !== 'done';
    if (hideDone && becomesDone) {
      const inputs = [
        ...(panelRef.current?.querySelectorAll<HTMLInputElement>('.task__input') ?? []),
      ];
      const at = inputs.indexOf(input);
      (inputs[at + 1] ?? inputs[at - 1] ?? filterRef.current)?.focus();
    }
    store.toggleTask(task.id);
    setMessage(`Marked '${task.title}' ${becomesDone ? 'done' : 'not done'}`);
  };

  /** Downloads the calendar: the clock is read here, once, for the file's DTSTAMP. */
  const download = (): void => {
    const text = toIcs(plan.schedule, brief, plan.eventDate, utcStamp(new Date()));
    const url = URL.createObjectURL(icsBlob(text));
    const link = document.createElement('a');
    link.href = url;
    link.download = icsFilename(brief.name, plan.eventDate);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, RELEASE_AFTER_MS);
  };

  return (
    <section className="timeline" aria-labelledby={titleId} ref={panelRef}>
      <h2 className="panel-title" id={titleId}>
        Timeline
      </h2>
      <div className="timeline__top">
        <div className="timeline__progress">
          <p className="timeline__count">{`${doneCount} of ${tasks.length} tasks done`}</p>
          <progress
            className="timeline__bar"
            max={tasks.length}
            value={doneCount}
            aria-label="Tasks done"
          />
        </div>
        <div className="timeline__tools">
          <div className="timeline__filter">
            <input
              className="timeline__filter-input"
              id={filterId}
              type="checkbox"
              ref={filterRef}
              checked={hideDone}
              onChange={(event) => {
                setHideDone(event.currentTarget.checked);
              }}
            />
            <label htmlFor={filterId}>Hide done tasks</label>
          </div>
          <button className="button button--primary" type="button" onClick={download}>
            Download calendar (.ics)
          </button>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => {
              window.print();
            }}
          >
            Print plan
          </button>
        </div>
      </div>
      <p className="panel-note">
        Lead times are typical planning heuristics; permit processing varies by city, so check with
        your local authority. The calendar lists each task you haven&apos;t finished, on the day to
        start by.
      </p>
      <p className="visually-hidden" role="status">
        {message}
      </p>
      {shown.length === 0 && <p className="timeline__empty">Every task is done.</p>}
      {byMonth(shown).map((group) => (
        <section className="timeline__month" key={group.month}>
          <h3 className="timeline__month-title">{group.month}</h3>
          <ul className="tasks">
            {group.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                category={categoryLabel(plan.budget, task.categoryId)}
                onToggle={toggle}
              />
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

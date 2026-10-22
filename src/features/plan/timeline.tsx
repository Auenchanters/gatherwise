/**
 * The Timeline tab: the schedule's tasks grouped by the month they must start in, each with a
 * status chip, its dates and a checkbox, plus the calendar download and "Print plan".
 * Does: label every checkbox with the task's title and describe it by its status and dates; tell
 * a screen reader politely what a tick did; keep focus on a neighbouring task when "Hide done
 * tasks" removes the one just ticked; label tasks Gemini added "AI · personalized"; build the
 * calendar file from the schedule with the clock read once, at the click, and let go of the file's
 * address a little later (at once if another download or the tab's end comes first).
 * Never does: compute a date or status (the engine's), call the AI, or leave a task's state to
 * colour alone (every status is an icon and words too).
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react';
import type { ReadyState } from '../../domain/reducer.js';
import { toIcs } from '../../domain/ics.js';
import { isAiTask } from '../../domain/merge.js';
import type { ScheduledTask } from '../../domain/schedule.js';
import { AiBadge, StatusChip } from './chips.js';
import { icsBlob, icsFilename } from './download.js';
import { categoryLabel, showDate, showMonth } from '../../ui/format.js';
import { LiveRegion, Panel } from './panel.js';
import type { PlannerStore } from './planner-store.js';
import { STATUS_UI } from './status-ui.js';
import { utcStamp } from './utc-stamp.js';
import './timeline.css';

/** How long the downloaded file's address stays valid; browsers have started the save well before. */
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
  /** Where the row lists its checkbox, so a neighbour can take focus when this task is hidden. */
  readonly inputs: Map<string, HTMLInputElement>;
  readonly onToggle: (task: ScheduledTask) => void;
}): ReactElement {
  const { task, category, inputs, onToggle } = props;
  const id = useId();
  const ui = STATUS_UI.task[task.status];
  // Stable between renders, so React does not detach and re-attach every row's ref each time.
  const listInput = useCallback(
    (input: HTMLInputElement) => {
      inputs.set(task.id, input);
      return () => {
        inputs.delete(task.id);
      };
    },
    [inputs, task.id],
  );
  return (
    <li className="task">
      <input
        className="task__input"
        id={id}
        ref={listInput}
        type="checkbox"
        checked={task.status === 'done'}
        aria-describedby={`${id}-details`}
        onChange={() => {
          onToggle(task);
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
  const filterId = useId();
  const [hideDone, setHideDone] = useState(false);
  const [message, setMessage] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);
  /** Each shown task's checkbox, for moving focus when a ticked task leaves the list. */
  const [inputs] = useState(() => new Map<string, HTMLInputElement>());
  /** Lets go of the last download's address now; set while one is waiting to be released. */
  const release = useRef<(() => void) | undefined>(undefined);
  const { brief, plan } = state;
  const { tasks } = plan.schedule;
  const doneCount = tasks.filter((task) => task.status === 'done').length;
  const shown = hideDone ? tasks.filter((task) => task.status !== 'done') : tasks;

  // When the tab goes away, so does its file's address.
  useEffect(
    () => () => {
      release.current?.();
    },
    [],
  );

  /** Ticks a task and says so. If the task is about to be hidden, focus moves on first. */
  const toggle = (task: ScheduledTask): void => {
    const becomesDone = task.status !== 'done';
    if (hideDone && becomesDone) {
      const at = shown.findIndex((t) => t.id === task.id);
      const next = shown[at + 1] ?? shown[at - 1];
      const input = next ? inputs.get(next.id) : undefined;
      (input ?? filterRef.current)?.focus();
    }
    store.toggleTask(task.id);
    setMessage(`Marked '${task.title}' ${becomesDone ? 'done' : 'not done'}`);
  };

  /** Downloads the calendar: the clock is read here, once, for the file's DTSTAMP. */
  const download = (): void => {
    release.current?.();
    const text = toIcs(plan.schedule, brief, plan.eventDate, utcStamp(new Date()));
    const url = URL.createObjectURL(icsBlob(text));
    const link = document.createElement('a');
    link.href = url;
    link.download = icsFilename(brief.name, plan.eventDate);
    // Some browsers only follow a link that is in the page.
    document.body.append(link);
    link.click();
    link.remove();
    const timer = setTimeout(() => release.current?.(), RELEASE_AFTER_MS);
    release.current = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      release.current = undefined;
    };
  };

  return (
    <Panel title="Timeline">
      <div className="timeline__top">
        <div>
          <p className="timeline__count">
            {doneCount} of {tasks.length} tasks done
          </p>
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
        Lead times are typical planning estimates; confirm them with your vendors, and with your
        local authority for any permit. The calendar lists each task you haven&apos;t finished, on
        the day to start by.
      </p>
      <LiveRegion message={message} />
      {shown.length === 0 && <p className="timeline__empty">Every task is done.</p>}
      {byMonth(shown).map((group) => (
        <div className="timeline__month" key={group.month}>
          <h3 className="timeline__month-title">{group.month}</h3>
          <ul className="tasks">
            {group.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                category={categoryLabel(plan.budget, task.categoryId)}
                inputs={inputs}
                onToggle={toggle}
              />
            ))}
          </ul>
        </div>
      ))}
    </Panel>
  );
}

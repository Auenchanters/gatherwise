/**
 * The Volunteers tab (community events only): how many volunteers each shift needs, how many are
 * placed, whether the event is short of people, and the roles volunteers fill.
 * Does: show the engine's shift plan as a table with a caption, say "You're short by N volunteer
 * slots" or "Fully staffed (N spare)", and list the template's roles.
 * Never does: compute a shift or a gap (the engine's `planShifts` did), or call the AI.
 */
import type { ReactElement } from 'react';
import type { ReadyState } from '../../domain/reducer.js';
import { templateFor } from '../../domain/templates/index.js';
import { StatusChip } from './chips.js';
import { countOf, showDate } from './format.js';
import { Panel } from './panel.js';
import { STATUS_UI } from './status-ui.js';

/** Props for {@link Volunteers}. */
export interface VolunteersProps {
  readonly state: ReadyState;
}

/** Shifts, staffing and roles. */
export function Volunteers({ state }: VolunteersProps): ReactElement {
  const { brief, plan } = state;
  const { shifts, shortfall, spare, needed } = plan.shifts;
  const roles = templateFor(brief.kind).volunteerRoles;
  const people = countOf(brief.volunteersAvailable, 'volunteer', 'volunteers');
  return (
    <Panel title="Volunteers">
      <p className="volunteers__lead">{countOf(needed, 'volunteer', 'volunteers')} per shift</p>
      <p className="volunteers__detail">
        You have {people} for {countOf(shifts.length, 'shift', 'shifts')}. Each volunteer works one
        shift, so a gap is the number of people still to recruit.
      </p>
      {shortfall > 0 ? (
        <p className="callout callout--risk">
          <span aria-hidden="true">▲</span>
          You&apos;re short by {countOf(shortfall, 'volunteer slot', 'volunteer slots')}
        </p>
      ) : (
        <p className="callout callout--ok">
          <span aria-hidden="true">✓</span>
          Fully staffed ({spare} spare)
        </p>
      )}
      <table className="data-table volunteers__table">
        <caption>Volunteer shifts for {showDate(plan.eventDate)}</caption>
        <thead>
          <tr>
            <th scope="col">Shift</th>
            <th scope="col" className="num">
              Needed
            </th>
            <th scope="col" className="num">
              Assigned
            </th>
            <th scope="col">Gap</th>
          </tr>
        </thead>
        <tbody>
          {shifts.map((shift) => {
            const gap = shift.needed - shift.assigned;
            return (
              <tr key={shift.start}>
                <th scope="row">
                  {shift.start}–{shift.end}
                </th>
                <td className="num">{shift.needed}</td>
                <td className="num">{shift.assigned}</td>
                <td>
                  {gap > 0 ? <StatusChip ui={STATUS_UI.fit.over} label={`${gap} short`} /> : 'None'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h3 className="volunteers__roles-title">Volunteer roles</h3>
      <dl className="roles">
        {roles.map((role) => (
          <div className="role" key={role.id}>
            <dt>{role.label}</dt>
            <dd>{role.description}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

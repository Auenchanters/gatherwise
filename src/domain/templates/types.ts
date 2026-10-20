/**
 * The shape of an event template: the domain knowledge the planning engine runs on.
 * Does: names the data (budget categories, tasks, vendor rules, volunteer roles) and the rule
 * signature that decides whether a task or vendor applies to a brief.
 * Never does: compute dates or money; templates only say what and when, the engine does the sums.
 */
import type { EventBrief } from '../../shared/schema';

/** Which kind of event a template plans. */
export type EventKind = EventBrief['kind'];

/** Identifies a task within one template. */
export type TaskId = string;

/** Decides whether a task or vendor applies to a brief. Must be pure. */
export type Condition = (b: EventBrief) => boolean;

/** A budget category. `weight` is its share of the budget (a template's weights sum to 100). */
export interface CategoryDef {
  readonly id: string;
  readonly label: string;
  readonly weight: number;
  /** Whether its cost follows the guest count or stays the same. */
  readonly scales: 'fixed' | 'per_guest';
}

/** A planning task. */
export interface TaskDef {
  readonly id: TaskId;
  readonly title: string;
  /** The budget category the task is filed under. */
  readonly categoryId: string;
  readonly durationDays: number;
  /** Days BEFORE the event by which the task must finish; negative means after the event. */
  readonly leadDays: number;
  readonly dependsOn: TaskId[];
  /** The task is planned only when this returns true; omitted means always. */
  readonly when?: Condition;
}

/** A vendor type the plan may require, with a checklist for talking to vendors. */
export interface VendorDef {
  readonly id: string;
  readonly label: string;
  readonly when: Condition;
  /** Why this vendor is needed for this brief, quoting the numbers that triggered it. */
  readonly reason: (b: EventBrief) => string;
  /** Days before the event by which the vendor should be booked. */
  readonly bookByLeadDays: number;
  readonly checklist: string[];
}

/** A volunteer role for community events. */
export interface VolunteerRole {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

/** Everything the engine knows about planning one kind of event. */
export interface EventTemplate {
  readonly kind: EventKind;
  readonly categories: CategoryDef[];
  readonly tasks: TaskDef[];
  readonly vendors: VendorDef[];
  readonly volunteerRoles: VolunteerRole[];
}

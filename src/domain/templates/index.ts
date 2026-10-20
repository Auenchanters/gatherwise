/**
 * Entry point for the event templates.
 * Does: picks the template for an event kind and lists its ids for the AI response schema.
 * Never does: compute dates or money.
 */
import type { TemplateIds } from '../../shared/schema';
import { birthdayTemplate } from './birthday';
import { communityTemplate } from './community';
import type { EventKind, EventTemplate } from './types';
import { weddingTemplate } from './wedding';

const TEMPLATES: Record<EventKind, EventTemplate> = {
  community: communityTemplate,
  wedding: weddingTemplate,
  birthday: birthdayTemplate,
};

/** The template for an event kind. */
export const templateFor = (kind: EventKind): EventTemplate => TEMPLATES[kind];

const isNonEmpty = <T>(items: readonly T[]): items is readonly [T, ...T[]] => items.length > 0;

/** Narrows a list to a non-empty tuple. Throws a RangeError when the list is empty. */
export function nonEmpty<T>(items: readonly T[]): readonly [T, ...T[]] {
  if (!isNonEmpty(items)) throw new RangeError('expected a non-empty list');
  return items;
}

/** The category, task and vendor ids of a template, in the non-empty form the AI schema needs. */
export const templateIds = (t: EventTemplate): TemplateIds => ({
  categories: nonEmpty(t.categories.map((c) => c.id)),
  tasks: nonEmpty(t.tasks.map((task) => task.id)),
  vendors: nonEmpty(t.vendors.map((v) => v.id)),
});

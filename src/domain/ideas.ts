/**
 * Ideas for an event and whether each one fits its budget category.
 * Does: checks an idea's cost against what its category has been allocated, and builds the
 * standard ideas a plan shows when there are no AI ideas, priced from their category so they
 * always fit.
 * Never does: change the budget, or pass template text off as AI text (`source` says which).
 */
import type { EventBrief } from '../shared/schema';
import type { Budget } from './budget';
import { minor, type Minor } from './money';
import { STANDARD_IDEAS } from './templates/standard-ideas';
import type { EventTemplate } from './templates/types';

/** One suggestion for the event, filed under a budget category. */
export interface Idea {
  /** `ai-idea-N` for Gemini's ideas, `std-<id>` for standard ones. */
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly categoryId: string;
  readonly estimatedCost: Minor;
  /** The brief fields an AI idea answers to. Standard ideas have none. */
  readonly personalization?: string;
  /** Who wrote it: the UI labels `ai` "AI · personalized" and `template` "Standard suggestion". */
  readonly source: 'ai' | 'template';
}

/** Whether an idea's cost fits within its category. */
export interface IdeaFit {
  readonly fits: boolean;
  /** How far the cost goes over the category; 0 when it fits. */
  readonly overBy: Minor;
}

/** What a category has been allocated; a category the budget lacks has nothing. */
const allocatedTo = (budget: Budget, categoryId: string): Minor =>
  budget.lines.find((line) => line.categoryId === categoryId)?.allocated ?? minor(0);

/** Compares an idea's cost with its category's allocation. A cost equal to it fits. */
export function ideaFit(idea: Pick<Idea, 'categoryId' | 'estimatedCost'>, budget: Budget): IdeaFit {
  const overBy = idea.estimatedCost - allocatedTo(budget, idea.categoryId);
  return overBy > 0 ? { fits: false, overBy: minor(overBy) } : { fits: true, overBy: minor(0) };
}

/**
 * The standard ideas for `template`'s kind whose condition holds for `brief`, in display order.
 * Each costs its share of the category, rounded down, so it always fits `budget`.
 */
export function standardIdeas(template: EventTemplate, brief: EventBrief, budget: Budget): Idea[] {
  return STANDARD_IDEAS[template.kind]
    .filter((def) => def.when === undefined || def.when(brief))
    .map((def): Idea => ({
      id: `std-${def.id}`,
      title: def.title,
      description: def.description,
      categoryId: def.categoryId,
      estimatedCost: minor(Math.floor(allocatedTo(budget, def.categoryId) * def.costShare)),
      source: 'template',
    }));
}

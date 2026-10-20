/**
 * The birthday template: kids' parties, adult birthdays and milestone birthdays.
 * Does: owns domain knowledge, meaning the budget categories, the task graph with lead times, and
 * the vendor rules. Birthdays use no volunteer roles.
 * Never computes dates or money. Lead times are typical planning heuristics, sized for a party
 * planned over about five weeks; a milestone party may want more time.
 */
import {
  CANCELLATION,
  ALCOHOL_LICENCE,
  DIETARY_NEEDS,
  MUSIC_LISTS,
  QUOTE,
  SOUND_CUTOFF,
} from './copy';
import { always, amplifiedSound, hostedOutsideHome, servesAlcohol, servesFood } from './conditions';
import type { CategoryDef, Condition, EventTemplate, TaskDef, VendorDef } from './types';

/** Above this many guests a non-milestone birthday is also recommended a photographer. */
export const BIRTHDAY_PHOTOGRAPHER_GUESTS = 50;

/** True for a kids' party. */
export const isKidsParty: Condition = (b) => b.kind === 'birthday' && b.subtype === 'kids';
/** True for a milestone birthday. */
export const isMilestone: Condition = (b) => b.kind === 'birthday' && b.subtype === 'milestone';
const needsPhotographer: Condition = (b) =>
  isMilestone(b) || b.guests > BIRTHDAY_PHOTOGRAPHER_GUESTS;
/** True when the guest list has any dietary need. */
export const hasDietaryNeeds: Condition = (b) => b.dietary.length > 0;

const categories: readonly CategoryDef[] = [
  { id: 'venue', label: 'Venue', weight: 18, scales: 'fixed' },
  { id: 'food_beverage', label: 'Food & beverage', weight: 32, scales: 'per_guest' },
  { id: 'cake_dessert', label: 'Cake & dessert', weight: 8, scales: 'per_guest' },
  { id: 'decor_theme', label: 'Décor & theme', weight: 12, scales: 'fixed' },
  { id: 'entertainment', label: 'Entertainment', weight: 14, scales: 'fixed' },
  { id: 'photography', label: 'Photography', weight: 5, scales: 'fixed' },
  { id: 'favours_gifts', label: 'Favours & gifts', weight: 8, scales: 'per_guest' },
  { id: 'invitations', label: 'Invitations', weight: 3, scales: 'fixed' },
];

// leadDays is days before the event by which a task finishes (negative: after it), so a
// dependency's leadDays is at least its dependent's leadDays + durationDays. Two orderings are not
// dependencies, because their first task is conditional: dietary_check finishes before order_cake
// starts, and plan_photos finishes before the photographer's book-by date.
const tasks: readonly TaskDef[] = [
  {
    id: 'set_budget',
    title: 'Agree the budget',
    categoryId: 'venue',
    durationDays: 1,
    leadDays: 37,
    dependsOn: [],
  },
  {
    id: 'choose_theme_and_guests',
    title: 'Choose a theme and draft the guest list',
    categoryId: 'decor_theme',
    durationDays: 3,
    leadDays: 33,
    dependsOn: ['set_budget'],
  },
  {
    id: 'book_venue',
    title: 'Book the venue',
    categoryId: 'venue',
    durationDays: 3,
    leadDays: 30,
    dependsOn: ['choose_theme_and_guests'],
    when: hostedOutsideHome,
  },
  {
    id: 'send_invitations',
    title: 'Send the invitations',
    categoryId: 'invitations',
    durationDays: 5,
    leadDays: 21,
    dependsOn: ['choose_theme_and_guests'],
  },
  {
    id: 'book_entertainment',
    title: 'Book entertainment or plan party activities',
    categoryId: 'entertainment',
    durationDays: 5,
    leadDays: 21,
    dependsOn: ['choose_theme_and_guests'],
  },
  {
    id: 'plan_menu',
    title: 'Plan the menu and order the food',
    categoryId: 'food_beverage',
    durationDays: 5,
    leadDays: 14,
    dependsOn: ['choose_theme_and_guests'],
    when: servesFood,
  },
  {
    id: 'buy_decor',
    title: 'Buy or order the decor',
    categoryId: 'decor_theme',
    durationDays: 5,
    leadDays: 10,
    dependsOn: ['choose_theme_and_guests'],
  },
  {
    id: 'confirm_rsvps',
    title: 'Chase RSVPs and confirm numbers',
    categoryId: 'invitations',
    durationDays: 3,
    leadDays: 12,
    dependsOn: ['send_invitations'],
  },
  {
    id: 'dietary_check',
    title: 'Check allergies and dietary needs with whoever is cooking',
    categoryId: 'food_beverage',
    durationDays: 1,
    leadDays: 10,
    dependsOn: ['confirm_rsvps'],
    when: hasDietaryNeeds,
  },
  {
    id: 'order_cake',
    title: 'Order the cake',
    categoryId: 'cake_dessert',
    durationDays: 2,
    leadDays: 7,
    dependsOn: ['confirm_rsvps'],
  },
  {
    id: 'buy_favours',
    title: 'Buy party favours and return gifts',
    categoryId: 'favours_gifts',
    durationDays: 3,
    leadDays: 4,
    dependsOn: ['confirm_rsvps'],
  },
  {
    id: 'plan_photos',
    title: 'Decide who takes the photos, or hire a photographer',
    categoryId: 'photography',
    durationDays: 1,
    leadDays: 24,
    dependsOn: ['choose_theme_and_guests'],
  },
  {
    id: 'day_before_setup',
    title: 'Set up the decor and the party space',
    categoryId: 'decor_theme',
    durationDays: 1,
    leadDays: 1,
    dependsOn: ['buy_decor'],
  },
  {
    id: 'thank_you_notes',
    title: 'Send thank-you messages',
    categoryId: 'favours_gifts',
    durationDays: 3,
    leadDays: -5,
    dependsOn: [],
  },
];

const vendors: readonly VendorDef[] = [
  {
    id: 'cake_bakery',
    label: 'Cake & bakery',
    when: always,
    reason: (b) =>
      `Recommended: a cake is the centrepiece of a birthday, sized here for ${b.guests} guests`,
    bookByLeadDays: 7,
    checklist: [
      QUOTE,
      'Confirm flavour, size and servings for your guest count',
      'Ask about egg-free, nut-free or other options for guests with allergies',
      'Agree the pick-up or delivery time and who carries it',
    ],
  },
  {
    id: 'caterer_or_snacks',
    label: 'Caterer or snacks',
    when: servesFood,
    reason: (b) =>
      `Recommended: serving food to ${b.guests} guests goes more smoothly with a caterer`,
    bookByLeadDays: 14,
    checklist: [
      QUOTE,
      DIETARY_NEEDS,
      'Ask how portions are sized for your guest count',
      CANCELLATION,
    ],
  },
  {
    id: 'decor_balloons',
    label: 'Decor & balloons',
    when: always,
    reason: (b) => `Recommended: decor and balloons set the theme for ${b.guests} guests`,
    bookByLeadDays: 14,
    checklist: [
      QUOTE,
      'Confirm what is included: balloons, backdrop, table setting and set-up',
      'Ask whether helium and delivery are part of the price',
      'Agree the set-up time with the venue',
    ],
  },
  {
    id: 'kids_entertainer',
    label: 'Kids entertainer',
    when: isKidsParty,
    reason: (b) =>
      `Recommended: a kids' party with ${b.guests} guests needs something to keep them busy`,
    bookByLeadDays: 21,
    checklist: [
      QUOTE,
      "Ask for references from recent kids' parties",
      'Confirm the activity length and the age range it suits',
      'Ask whether the staff are background-checked',
    ],
  },
  {
    id: 'music_dj',
    label: 'DJ or sound',
    when: amplifiedSound,
    reason: (b) =>
      `Recommended: amplified sound for ${b.guests} guests needs proper equipment and a sound technician`,
    bookByLeadDays: 14,
    checklist: [QUOTE, 'Confirm the equipment list and set-up time', MUSIC_LISTS, SOUND_CUTOFF],
  },
  {
    id: 'bar_service',
    label: 'Bar service',
    when: servesAlcohol,
    reason: (b) =>
      `Recommended: serving alcohol to ${b.guests} guests is best handled by trained bar staff`,
    bookByLeadDays: 14,
    checklist: [
      QUOTE,
      ALCOHOL_LICENCE,
      'Confirm the number of bartenders for your guest count',
      'Agree how age is checked',
    ],
  },
  {
    id: 'photographer',
    label: 'Photographer',
    when: needsPhotographer,
    reason: (b) =>
      isMilestone(b)
        ? 'Recommended: a milestone birthday is worth capturing properly'
        : `Recommended: ${b.guests} guests is above the ${BIRTHDAY_PHOTOGRAPHER_GUESTS}-guest rule of thumb for a photographer`,
    bookByLeadDays: 21,
    checklist: [
      QUOTE,
      'Review a full gallery from a recent party',
      'Confirm coverage hours and when edited photos will arrive',
      CANCELLATION,
    ],
  },
];

/** The template for birthdays. */
export const birthdayTemplate: EventTemplate = {
  kind: 'birthday',
  categories,
  tasks,
  vendors,
  volunteerRoles: [],
};

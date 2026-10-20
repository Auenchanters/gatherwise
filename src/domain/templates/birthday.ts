/**
 * The birthday template: kids' parties, adult birthdays and milestone birthdays.
 * Does: owns domain knowledge, meaning the budget categories, the task graph with lead times, and
 * the vendor rules. Birthdays use no volunteer roles.
 * Never computes dates or money. Lead times are typical planning heuristics, sized for a party
 * planned over about five weeks; a milestone party may want more time.
 */
import { always, amplifiedSound, servesAlcohol, servesFood } from './conditions';
import type { CategoryDef, Condition, EventTemplate, TaskDef, VendorDef } from './types';

/** Above this many guests a non-milestone birthday also gets a photographer. */
export const BIRTHDAY_PHOTOGRAPHER_GUESTS = 50;

const isKidsParty: Condition = (b) => b.kind === 'birthday' && b.subtype === 'kids';
const isMilestone: Condition = (b) => b.kind === 'birthday' && b.subtype === 'milestone';
const needsPhotographer: Condition = (b) =>
  isMilestone(b) || b.guests > BIRTHDAY_PHOTOGRAPHER_GUESTS;
const hostedOutsideHome: Condition = (b) => b.venue !== 'home';
const hasDietaryNeeds: Condition = (b) => b.dietary.length > 0;

const categories: CategoryDef[] = [
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
// dependency's leadDays is at least its dependent's leadDays + durationDays.
const tasks: TaskDef[] = [
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
    leadDays: 8,
    dependsOn: ['send_invitations'],
  },
  {
    id: 'order_cake',
    title: 'Order the cake',
    categoryId: 'cake_dessert',
    durationDays: 2,
    leadDays: 7,
    dependsOn: ['choose_theme_and_guests'],
  },
  {
    id: 'dietary_check',
    title: 'Check allergies and dietary needs with whoever is cooking',
    categoryId: 'food_beverage',
    durationDays: 1,
    leadDays: 6,
    dependsOn: ['confirm_rsvps'],
    when: hasDietaryNeeds,
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
    title: 'Choose who takes the photos',
    categoryId: 'photography',
    durationDays: 1,
    leadDays: 3,
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

const quote = 'Get a written quote including GST';
const cancellation = 'Confirm cancellation policy and refund window';

const vendors: VendorDef[] = [
  {
    id: 'cake_bakery',
    label: 'Cake & bakery',
    when: always,
    reason: (b) => `A cake is the centrepiece of a birthday, sized here for ${b.guests} guests`,
    bookByLeadDays: 7,
    checklist: [
      quote,
      'Confirm flavour, size and servings for your guest count',
      'Ask about egg-free, nut-free or other options for guests with allergies',
      'Agree the pick-up or delivery time and who carries it',
    ],
  },
  {
    id: 'caterer_or_snacks',
    label: 'Caterer or snacks',
    when: servesFood,
    reason: (b) => `Needed because food is served to ${b.guests} guests`,
    bookByLeadDays: 14,
    checklist: [
      quote,
      'Confirm the menu covers the dietary needs on your guest list',
      'Ask how portions are sized for your guest count',
      cancellation,
    ],
  },
  {
    id: 'decor_balloons',
    label: 'Decor & balloons',
    when: always,
    reason: (b) => `Decor and balloons set the theme for ${b.guests} guests`,
    bookByLeadDays: 14,
    checklist: [
      quote,
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
      `Needed because a kids' party with ${b.guests} guests needs something to keep them busy`,
    bookByLeadDays: 21,
    checklist: [
      quote,
      "Ask for references from recent kids' parties",
      'Confirm the activity length and the age range it suits',
      'Ask whether the staff are background-checked',
    ],
  },
  {
    id: 'music_dj',
    label: 'DJ or sound',
    when: amplifiedSound,
    reason: (b) => `Needed because you plan amplified sound for ${b.guests} guests`,
    bookByLeadDays: 14,
    checklist: [
      quote,
      'Confirm the equipment list and set-up time',
      'Share must-play and do-not-play lists',
      'Confirm overtime charges and the venue sound cut-off time',
    ],
  },
  {
    id: 'bar_service',
    label: 'Bar service',
    when: servesAlcohol,
    reason: (b) => `Needed because alcohol is served to ${b.guests} guests`,
    bookByLeadDays: 14,
    checklist: [
      quote,
      'Ask what licence is needed to serve alcohol (check with your local authority)',
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
        ? 'Needed because a milestone birthday is worth capturing properly'
        : `Needed because ${b.guests} guests exceeds the ${BIRTHDAY_PHOTOGRAPHER_GUESTS}-guest threshold for a photographer`,
    bookByLeadDays: 21,
    checklist: [
      quote,
      'Review a full gallery from a recent party',
      'Confirm coverage hours and when edited photos will arrive',
      cancellation,
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

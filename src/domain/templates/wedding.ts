/**
 * The wedding template: one ceremony and reception (multi-day celebrations are a known limitation).
 * Does: owns domain knowledge, meaning the budget categories, the task graph with lead times, and
 * the vendor rules. Weddings use no volunteer roles.
 * Never computes dates or money. Lead times are typical planning heuristics, not rules; a venue is
 * usually booked about six months out.
 */
import { always, amplifiedSound, isOutdoor, servesAlcohol, servesFood } from './conditions';
import type { CategoryDef, EventTemplate, TaskDef, VendorDef } from './types';

const categories: CategoryDef[] = [
  { id: 'venue', label: 'Venue', weight: 20, scales: 'fixed' },
  { id: 'catering', label: 'Catering', weight: 32, scales: 'per_guest' },
  { id: 'decor_flowers', label: 'Décor & flowers', weight: 12, scales: 'fixed' },
  { id: 'photo_video', label: 'Photo & video', weight: 9, scales: 'fixed' },
  { id: 'music_entertainment', label: 'Music & entertainment', weight: 7, scales: 'fixed' },
  { id: 'attire_beauty', label: 'Attire & beauty', weight: 8, scales: 'fixed' },
  { id: 'invitations_gifts', label: 'Invitations & gifts', weight: 5, scales: 'per_guest' },
  { id: 'transport_stay', label: 'Transport & stay', weight: 7, scales: 'per_guest' },
];

// leadDays is days before the event by which a task finishes (negative: after it), so a
// dependency's leadDays is at least its dependent's leadDays + durationDays.
const tasks: TaskDef[] = [
  {
    id: 'set_budget',
    title: 'Agree the budget and who contributes',
    categoryId: 'venue',
    durationDays: 3,
    leadDays: 205,
    dependsOn: [],
  },
  {
    id: 'draft_guest_list',
    title: 'Draft the guest list',
    categoryId: 'invitations_gifts',
    durationDays: 5,
    leadDays: 195,
    dependsOn: ['set_budget'],
  },
  {
    id: 'book_venue',
    title: 'Book the venue for the ceremony and reception',
    categoryId: 'venue',
    durationDays: 14,
    leadDays: 180,
    dependsOn: ['draft_guest_list'],
  },
  {
    id: 'book_photographer',
    title: 'Book the photographer and videographer',
    categoryId: 'photo_video',
    durationDays: 7,
    leadDays: 150,
    dependsOn: ['book_venue'],
  },
  {
    id: 'book_caterer',
    title: 'Book the caterer',
    categoryId: 'catering',
    durationDays: 14,
    leadDays: 120,
    dependsOn: ['book_venue'],
    when: servesFood,
  },
  {
    id: 'book_decor_florist',
    title: 'Book the decorator and florist',
    categoryId: 'decor_flowers',
    durationDays: 10,
    leadDays: 90,
    dependsOn: ['book_venue'],
  },
  {
    id: 'book_music_dj',
    title: 'Book the DJ or band',
    categoryId: 'music_entertainment',
    durationDays: 7,
    leadDays: 90,
    dependsOn: ['book_venue'],
    when: amplifiedSound,
  },
  {
    id: 'attire_and_beauty',
    title: 'Choose attire, jewellery and beauty bookings',
    categoryId: 'attire_beauty',
    durationDays: 30,
    leadDays: 75,
    dependsOn: ['set_budget'],
  },
  {
    id: 'send_invitations',
    title: 'Send the invitations',
    categoryId: 'invitations_gifts',
    durationDays: 14,
    leadDays: 60,
    dependsOn: ['draft_guest_list', 'book_venue'],
  },
  {
    id: 'menu_tasting',
    title: 'Taste and finalize the menu',
    categoryId: 'catering',
    durationDays: 3,
    leadDays: 45,
    dependsOn: ['book_caterer'],
    when: servesFood,
  },
  {
    id: 'arrange_transport_stay',
    title: 'Arrange transport and stays for guests',
    categoryId: 'transport_stay',
    durationDays: 14,
    leadDays: 40,
    dependsOn: ['send_invitations'],
  },
  {
    id: 'final_headcount',
    title: 'Confirm the final headcount with vendors',
    categoryId: 'catering',
    durationDays: 3,
    leadDays: 7,
    dependsOn: ['send_invitations'],
  },
  {
    id: 'rehearsal_runsheet',
    title: 'Hold a rehearsal and share the day-of timeline',
    categoryId: 'venue',
    durationDays: 1,
    leadDays: 2,
    dependsOn: ['final_headcount'],
  },
  {
    id: 'thank_you_notes',
    title: 'Send thank-you notes',
    categoryId: 'invitations_gifts',
    durationDays: 7,
    leadDays: -14,
    dependsOn: [],
  },
];

const quote = 'Get a written quote including GST';
const cancellation = 'Confirm cancellation policy and refund window';

const vendors: VendorDef[] = [
  {
    id: 'photographer_videographer',
    label: 'Photographer & videographer',
    when: always,
    reason: (b) =>
      `Photo and video coverage is a standard booking for a wedding of ${b.guests} guests`,
    bookByLeadDays: 150,
    checklist: [
      quote,
      'Review full albums from recent weddings, not just highlights',
      'Confirm coverage hours, team size and when edited photos will arrive',
      cancellation,
    ],
  },
  {
    id: 'caterer',
    label: 'Caterer',
    when: servesFood,
    reason: (b) => `Needed because food is served to ${b.guests} guests`,
    bookByLeadDays: 120,
    checklist: [
      quote,
      'Book a tasting before you confirm the menu',
      'Confirm the menu covers the dietary needs on your guest list',
      'Agree the headcount deadline and what changes to the price after it',
      cancellation,
    ],
  },
  {
    id: 'decorator_florist',
    label: 'Decorator & florist',
    when: always,
    reason: (b) => `Venue styling and flowers shape the look of the day for ${b.guests} guests`,
    bookByLeadDays: 90,
    checklist: [
      quote,
      'Ask for photos of similar set-ups at your kind of venue',
      'Confirm set-up and clear-down times with the venue',
      'Agree what is swapped in if a flower is out of season',
    ],
  },
  {
    id: 'music_dj',
    label: 'DJ or band',
    when: amplifiedSound,
    reason: (b) => `Needed because you plan amplified sound for ${b.guests} guests`,
    bookByLeadDays: 90,
    checklist: [
      quote,
      'Confirm the equipment list, a backup system and set-up time',
      'Share must-play and do-not-play lists',
      'Confirm overtime charges and the venue sound cut-off time',
    ],
  },
  {
    id: 'bar_service',
    label: 'Bar service',
    when: servesAlcohol,
    reason: (b) => `Needed because alcohol is served to ${b.guests} guests`,
    bookByLeadDays: 45,
    checklist: [
      quote,
      'Ask what licence is needed to serve alcohol (check with your local authority)',
      'Confirm the number of bartenders for your guest count',
      'Agree how last orders are called and how age is checked',
    ],
  },
  {
    id: 'marquee_tent',
    label: 'Marquee or tent',
    when: isOutdoor,
    reason: (b) =>
      `Needed because the event is outdoors for ${b.durationHours} hours and guests need cover from sun and rain`,
    bookByLeadDays: 60,
    checklist: [
      quote,
      'Confirm size, flooring and side walls for your guest count',
      'Ask about a backup plan for heavy rain or wind',
      'Confirm set-up and dismantling times',
    ],
  },
];

/** The template for weddings. */
export const weddingTemplate: EventTemplate = {
  kind: 'wedding',
  categories,
  tasks,
  vendors,
  volunteerRoles: [],
};

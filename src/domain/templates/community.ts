/**
 * The community-event template: residents' festivals, fundraisers, clean-up drives, sports days and
 * cultural nights.
 * Does: owns domain knowledge, meaning the budget categories and their weights, the task graph with
 * lead times, the vendor rules and the volunteer roles.
 * Never computes dates or money. Lead times and thresholds are typical planning heuristics, not
 * rules; permit processing varies by city, so permit tasks always point to the local authority.
 */
import type { EventBrief } from '../../shared/schema.js';
import { CANCELLATION, QUOTE, TENT_SIZE } from './copy.js';
import {
  always,
  amplifiedSound,
  endsAfter,
  isOutdoor,
  servesAlcohol,
  servesFood,
} from './conditions.js';
import type {
  CategoryDef,
  Condition,
  EventTemplate,
  TaskDef,
  VendorDef,
  VolunteerRole,
} from './types.js';

/** Above this many guests a written waste plan is recommended. */
export const WASTE_GUESTS = 50;
/** Above this many guests an outdoor event should have portable toilets. */
export const TOILET_GUESTS = 100;
/** Above this many guests trained crowd management is recommended. */
export const CROWD_SAFETY_GUESTS = 150;
/** Above this many guests first aid and an ambulance plan are recommended. */
export const FIRST_AID_GUESTS = 300;
/** An outdoor event that ends after this time (`HH:MM`) needs its own power and lighting. */
export const EVENING_CUTOFF = '18:00';

/** True for a community event that expects sponsor money. */
export const sponsorsExpected: Condition = (b) =>
  b.kind === 'community' && (b.income?.sponsors ?? 0) > 0;
const hasStalls: Condition = (b) => b.kind === 'community' && (b.income?.stallCount ?? 0) > 0;
const isSportsDay: Condition = (b) => b.kind === 'community' && b.subtype === 'sports_day';
const hasElderlyGuests: Condition = (b) => b.accessibility.includes('elderly');
const needsFirstAid: Condition = (b) =>
  b.guests > FIRST_AID_GUESTS || isSportsDay(b) || hasElderlyGuests(b);
/** True when any guest has an accessibility need. */
export const needsAccessibilityPlan: Condition = (b) => b.accessibility.length > 0;
const needsPublicSpacePermission: Condition = (b) => b.venue === 'outdoor_public';

/** Names the first-aid rule that applied: crowd size first, then sports day, then elderly guests. */
function firstAidReason(b: EventBrief): string {
  if (b.guests > FIRST_AID_GUESTS) {
    return `Recommended: ${b.guests} guests is above the ${FIRST_AID_GUESTS}-guest rule of thumb for on-site first aid`;
  }
  if (isSportsDay(b)) return 'Recommended: a sports day carries a higher risk of injuries';
  return 'Recommended: elderly guests are attending and may need medical help sooner';
}

const categories: readonly CategoryDef[] = [
  { id: 'venue_permits', label: 'Venue & permits', weight: 12, scales: 'fixed' },
  { id: 'stage_av', label: 'Stage & AV', weight: 15, scales: 'fixed' },
  { id: 'food_beverage', label: 'Food & beverage', weight: 25, scales: 'per_guest' },
  { id: 'decor', label: 'Décor', weight: 8, scales: 'fixed' },
  { id: 'safety_first_aid', label: 'Safety & first aid', weight: 6, scales: 'fixed' },
  { id: 'sanitation_waste', label: 'Sanitation & waste', weight: 6, scales: 'per_guest' },
  { id: 'marketing_printing', label: 'Marketing & printing', weight: 5, scales: 'fixed' },
  { id: 'volunteer_care', label: 'Volunteer care', weight: 4, scales: 'per_guest' },
  { id: 'rentals', label: 'Rentals', weight: 9, scales: 'per_guest' },
  {
    id: 'activities_entertainment',
    label: 'Activities & entertainment',
    weight: 10,
    scales: 'fixed',
  },
];

// Tasks are filed under the budget category they most affect; general planning steps sit under
// `venue_permits` as the admin bucket. leadDays is days before the event by which a task finishes
// (negative: after it), so a dependency's leadDays is at least its dependent's leadDays + durationDays.
const tasks: readonly TaskDef[] = [
  {
    id: 'define_goals',
    title: 'Define goals and the programme',
    categoryId: 'activities_entertainment',
    durationDays: 2,
    leadDays: 60,
    dependsOn: [],
  },
  {
    id: 'form_committee',
    title: 'Form the organizing committee',
    categoryId: 'volunteer_care',
    durationDays: 3,
    leadDays: 56,
    dependsOn: ['define_goals'],
  },
  {
    id: 'set_budget',
    title: 'Agree the budget and who approves spending',
    categoryId: 'venue_permits',
    durationDays: 2,
    leadDays: 52,
    dependsOn: ['form_committee'],
  },
  {
    id: 'book_venue',
    title: 'Book the venue',
    categoryId: 'venue_permits',
    durationDays: 5,
    leadDays: 45,
    dependsOn: ['set_budget'],
  },
  {
    id: 'public_space_permission',
    title: 'Apply for public-space permission',
    note: 'Check with your local authority — processing times vary by city',
    categoryId: 'venue_permits',
    durationDays: 21,
    leadDays: 10,
    dependsOn: ['book_venue'],
    when: needsPublicSpacePermission,
  },
  {
    id: 'sound_permission',
    title: 'Request sound permission',
    note: 'Check with your local authority — rules and timings vary',
    categoryId: 'venue_permits',
    durationDays: 10,
    leadDays: 7,
    dependsOn: ['book_venue'],
    when: amplifiedSound,
  },
  {
    id: 'sponsor_outreach',
    title: 'Reach out to sponsors',
    categoryId: 'marketing_printing',
    durationDays: 21,
    leadDays: 21,
    dependsOn: ['set_budget'],
    when: sponsorsExpected,
  },
  {
    id: 'vendor_quotes',
    title: 'Collect vendor quotes',
    categoryId: 'rentals',
    durationDays: 7,
    leadDays: 30,
    dependsOn: ['set_budget'],
  },
  {
    id: 'book_vendors',
    title: 'Confirm and book vendors',
    categoryId: 'rentals',
    durationDays: 5,
    leadDays: 21,
    dependsOn: ['vendor_quotes'],
  },
  {
    id: 'volunteer_recruitment',
    title: 'Recruit volunteers',
    categoryId: 'volunteer_care',
    durationDays: 14,
    leadDays: 14,
    dependsOn: ['form_committee'],
  },
  {
    id: 'publicity',
    title: 'Publicize the event',
    categoryId: 'marketing_printing',
    durationDays: 21,
    leadDays: 3,
    dependsOn: ['book_venue'],
  },
  {
    id: 'food_safety_check',
    title: 'Check food hygiene with caterers and stall holders',
    categoryId: 'food_beverage',
    durationDays: 7,
    leadDays: 7,
    dependsOn: ['book_vendors'],
    when: servesFood,
  },
  {
    id: 'accessibility_plan',
    title: 'Plan access for guests who need it',
    categoryId: 'venue_permits',
    durationDays: 3,
    leadDays: 10,
    dependsOn: ['book_venue'],
    when: needsAccessibilityPlan,
  },
  {
    id: 'volunteer_briefing',
    title: 'Brief the volunteers',
    categoryId: 'volunteer_care',
    durationDays: 1,
    leadDays: 1,
    dependsOn: ['volunteer_recruitment'],
  },
  {
    id: 'final_walkthrough',
    title: 'Walk the site with the committee',
    categoryId: 'venue_permits',
    durationDays: 1,
    leadDays: 1,
    dependsOn: ['book_vendors'],
  },
  {
    id: 'post_event_report',
    title: 'Write the post-event report',
    categoryId: 'venue_permits',
    durationDays: 3,
    leadDays: -3,
    dependsOn: [],
  },
  {
    id: 'safety_plan',
    title: 'Write a safety and crowd plan',
    categoryId: 'safety_first_aid',
    durationDays: 3,
    leadDays: 20,
    dependsOn: ['book_venue'],
  },
  {
    id: 'insurance_check',
    title: 'Check what insurance cover the event needs',
    note: 'Ask your insurer and the venue; do not assume you are covered',
    categoryId: 'venue_permits',
    durationDays: 3,
    leadDays: 28,
    dependsOn: ['book_venue'],
  },
  {
    id: 'book_stage_av',
    title: 'Book the stage, sound and lights',
    categoryId: 'stage_av',
    durationDays: 4,
    leadDays: 21,
    dependsOn: ['vendor_quotes'],
    when: amplifiedSound,
  },
  {
    id: 'stall_allocation',
    title: 'Allocate stalls and collect stall fees',
    categoryId: 'activities_entertainment',
    durationDays: 5,
    leadDays: 14,
    dependsOn: ['book_venue'],
    when: hasStalls,
  },
  {
    id: 'day_of_runsheet',
    title: 'Write the day-of run sheet',
    categoryId: 'activities_entertainment',
    durationDays: 2,
    leadDays: 2,
    dependsOn: ['book_vendors', 'volunteer_recruitment'],
  },
  {
    id: 'thank_sponsors_volunteers',
    title: 'Thank sponsors and volunteers',
    categoryId: 'volunteer_care',
    durationDays: 2,
    leadDays: -5,
    dependsOn: [],
  },
  {
    id: 'alcohol_licence',
    title: 'Apply for the alcohol licence',
    note: 'Check with your local authority — licence rules and processing times vary',
    categoryId: 'venue_permits',
    durationDays: 10,
    leadDays: 14,
    dependsOn: ['book_venue'],
    when: servesAlcohol,
  },
  {
    id: 'volunteer_shift_roster',
    title: 'Draw up the volunteer shift roster',
    categoryId: 'volunteer_care',
    durationDays: 2,
    leadDays: 7,
    dependsOn: ['volunteer_recruitment'],
  },
];

const vendors: readonly VendorDef[] = [
  {
    id: 'tent_shamiana',
    label: 'Tent / shamiana',
    when: isOutdoor,
    reason: (b) =>
      `Recommended: an outdoor event running ${b.durationHours} hours leaves guests exposed to sun and rain`,
    bookByLeadDays: 21,
    checklist: [
      QUOTE,
      TENT_SIZE,
      'Ask whether set-up and dismantling are included, and the set-up time',
      CANCELLATION,
    ],
  },
  {
    id: 'sound_lighting',
    label: 'Sound & lighting',
    when: amplifiedSound,
    reason: (b) =>
      `Recommended: amplified sound for ${b.guests} guests needs proper speakers and a technician`,
    bookByLeadDays: 21,
    checklist: [
      QUOTE,
      'Confirm the equipment list: speakers, microphones, mixer and a technician on site',
      'Ask what backup equipment is included',
      'Agree the sound-check time and a finish time that matches your sound permission',
    ],
  },
  {
    id: 'caterer_or_stalls',
    label: 'Caterer or food stalls',
    when: servesFood,
    reason: (b) =>
      `Recommended: serving food to ${b.guests} guests goes more smoothly with a caterer or organised stalls`,
    bookByLeadDays: 21,
    checklist: [
      QUOTE,
      'Ask for their food-safety licence or registration',
      'Confirm the menu covers the dietary needs on your list and labels allergens',
      CANCELLATION,
    ],
  },
  {
    id: 'portable_toilets',
    label: 'Portable toilets',
    when: (b) => isOutdoor(b) && b.guests > TOILET_GUESTS,
    reason: (b) =>
      `Recommended: ${b.guests} guests outdoors is above the ${TOILET_GUESTS}-guest rule of thumb for portable toilets`,
    bookByLeadDays: 14,
    checklist: [
      QUOTE,
      'Confirm the number of units for your guest count, including at least one accessible unit',
      'Ask how often units are cleaned and restocked during the event',
      'Confirm delivery, placement and pick-up times',
    ],
  },
  {
    id: 'security_crowd',
    label: 'Security & crowd management',
    when: (b) => b.guests > CROWD_SAFETY_GUESTS,
    reason: (b) =>
      `Recommended: ${b.guests} guests is above the ${CROWD_SAFETY_GUESTS}-guest rule of thumb for crowd safety`,
    bookByLeadDays: 14,
    checklist: [
      QUOTE,
      'Ask for a public-liability insurance certificate',
      'Agree the number of guards, entry points and shift hours',
      'Share your site map and agree who they report to on the day',
    ],
  },
  {
    id: 'first_aid_ambulance',
    label: 'First aid & ambulance',
    when: needsFirstAid,
    reason: firstAidReason,
    bookByLeadDays: 10,
    checklist: [
      QUOTE,
      'Confirm trained first-aid staff or a nurse on site for the whole event',
      'Agree how an ambulance would be called and which hospital is nearest',
      'Choose a signposted first-aid spot with shade and a stocked kit',
    ],
  },
  {
    id: 'waste_management',
    label: 'Waste management',
    when: (b) => b.guests > WASTE_GUESTS,
    reason: (b) =>
      `Recommended: ${b.guests} guests is above the ${WASTE_GUESTS}-guest rule of thumb for a waste plan`,
    bookByLeadDays: 10,
    checklist: [
      QUOTE,
      'Confirm the number of bins and separate wet, dry and recyclable collection',
      'Agree when waste is collected and who clears the site afterwards',
      'Ask for a receipt or confirmation of where the waste goes',
    ],
  },
  {
    id: 'generator',
    label: 'Generator',
    when: (b) => isOutdoor(b) && endsAfter(b, EVENING_CUTOFF),
    reason: (b) =>
      `Recommended: an outdoor event starting at ${b.startTime} for ${b.durationHours} hours ends after ${EVENING_CUTOFF}, when lighting and power are needed`,
    bookByLeadDays: 14,
    checklist: [
      QUOTE,
      'Confirm the capacity in kVA against your lighting and sound load',
      'Ask about fuel, a trained operator and the noise rating',
      'Agree a safe spot away from crowds and tents',
    ],
  },
  {
    // The one vendor every community plan gets, so the vendor list is never empty.
    // Booked before publicity starts, because posters have to exist before they can be put up.
    id: 'printing_signage',
    label: 'Printing & signage',
    when: always,
    reason: (b) =>
      `Recommended: signs and posters help ${b.guests} guests find the event and its facilities`,
    bookByLeadDays: 28,
    checklist: [
      QUOTE,
      'Confirm sizes and file formats for banners, posters and directional signs',
      'Proofread names, dates and times before printing',
      'Confirm delivery before publicity starts',
    ],
  },
];

const volunteerRoles: readonly VolunteerRole[] = [
  {
    id: 'registration_desk',
    label: 'Registration desk',
    description: 'Greets guests, checks tickets or sign-ups and hands out programmes.',
  },
  {
    id: 'stage_av_runner',
    label: 'Stage & AV runner',
    description: 'Keeps the programme on time and helps performers and the sound crew.',
  },
  {
    id: 'food_stalls',
    label: 'Food & stalls',
    description: 'Helps caterers and stall holders set up, queue and keep tables clean.',
  },
  {
    id: 'first_aid_liaison',
    label: 'First-aid liaison',
    description: 'Knows where the first-aid point is and calls for help when needed.',
  },
  {
    id: 'accessibility_helper',
    label: 'Accessibility helper',
    description: 'Guides guests who need step-free routes, seating or a quieter space.',
  },
  {
    id: 'cleanup_crew',
    label: 'Clean-up crew',
    description: 'Keeps bins emptied during the event and clears the site afterwards.',
  },
];

/** The template for community events. */
export const communityTemplate: EventTemplate = {
  kind: 'community',
  categories,
  tasks,
  vendors,
  volunteerRoles,
};

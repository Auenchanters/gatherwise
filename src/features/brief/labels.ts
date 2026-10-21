/**
 * The words people see for each option code in the brief: one lookup per option list, so the form
 * and the plan header name things the same way.
 * Never does: hold logic, or show a raw code such as `outdoor_public` to anyone.
 */
import type {
  ACCESSIBILITY_OPTIONS,
  Currency,
  DIETARY_OPTIONS,
  EVENT_KINDS,
  SUBTYPES,
  VENUES,
} from '../../shared/options.js';

/** Labels for event kinds. */
export const KIND_LABELS: Record<(typeof EVENT_KINDS)[number], string> = {
  community: 'Community event',
  wedding: 'Wedding',
  birthday: 'Birthday',
};

/** Labels for every subtype of every kind. */
export const SUBTYPE_LABELS: Record<(typeof SUBTYPES)[keyof typeof SUBTYPES][number], string> = {
  festival: 'Festival or fair',
  fundraiser: 'Fundraiser',
  cleanup_drive: 'Clean-up drive',
  sports_day: 'Sports day',
  cultural_night: 'Cultural night',
  kids: "Kids' party",
  adult: 'Adult',
  milestone: 'Milestone',
  ceremony_reception: 'Ceremony & reception',
};

/** Labels for venue types. */
export const VENUE_LABELS: Record<(typeof VENUES)[number], string> = {
  indoor_hall: 'Indoor hall',
  outdoor_public: 'Outdoor public space',
  outdoor_private: 'Outdoor private ground',
  home: 'Home',
  restaurant: 'Restaurant',
};

/** Labels for currencies: the code first, so typing it in the select finds it. */
export const CURRENCY_LABELS: Record<Currency, string> = {
  INR: 'INR — Indian rupee',
  USD: 'USD — US dollar',
  EUR: 'EUR — Euro',
  GBP: 'GBP — British pound',
  AED: 'AED — UAE dirham',
  SGD: 'SGD — Singapore dollar',
  AUD: 'AUD — Australian dollar',
  CAD: 'CAD — Canadian dollar',
};

/** Labels for dietary needs. */
export const DIETARY_LABELS: Record<(typeof DIETARY_OPTIONS)[number], string> = {
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  jain: 'Jain',
  halal: 'Halal',
  gluten_free: 'Gluten-free',
  nut_free: 'Nut-free',
};

/** Labels for accessibility needs. */
export const ACCESSIBILITY_LABELS: Record<(typeof ACCESSIBILITY_OPTIONS)[number], string> = {
  wheelchair: 'Wheelchair users',
  hearing: 'Deaf or hard of hearing',
  visual: 'Blind or low vision',
  neurodivergent: 'Neurodivergent guests',
  elderly: 'Older guests',
  infants: 'Infants',
};

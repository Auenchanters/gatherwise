/**
 * The option lists of an event brief (kinds, subtypes, currencies, venues, dietary and access
 * needs), defined once. schema.ts builds its enums from these and re-exports them.
 * Never imports anything, so the first-page bundle can render the brief form from these lists
 * without pulling in zod (validation loads on demand when the form is submitted).
 */

/** Event kinds a plan can be built for. */
export const EVENT_KINDS = ['community', 'wedding', 'birthday'] as const;
/** Valid subtypes for each event kind. */
export const SUBTYPES = {
  community: ['festival', 'fundraiser', 'cleanup_drive', 'sports_day', 'cultural_night'],
  wedding: ['ceremony_reception'],
  birthday: ['kids', 'adult', 'milestone'],
} as const satisfies Record<(typeof EVENT_KINDS)[number], readonly string[]>;
/** Supported currencies. */
export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD'] as const;
/** One of the supported currency codes. */
export type Currency = (typeof CURRENCIES)[number];
/** Venue types. */
export const VENUES = [
  'indoor_hall',
  'outdoor_public',
  'outdoor_private',
  'home',
  'restaurant',
] as const;
/** Dietary needs a guest list can have. */
export const DIETARY_OPTIONS = [
  'vegetarian',
  'vegan',
  'jain',
  'halal',
  'gluten_free',
  'nut_free',
] as const;
/** Accessibility needs a guest list can have. */
export const ACCESSIBILITY_OPTIONS = [
  'wheelchair',
  'hearing',
  'visual',
  'neurodivergent',
  'elderly',
  'infants',
] as const;

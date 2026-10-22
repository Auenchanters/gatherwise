/**
 * The words people see for each option code in the brief: one lookup per option list, so the form
 * and the plan header name things the same way. Also the sentences for a refused event date, which
 * the form's checker and the plan's notices both say.
 * Never does: show a raw code such as `outdoor_public` to anyone.
 */
import type {
  ACCESSIBILITY_OPTIONS,
  Currency,
  DIETARY_OPTIONS,
  EVENT_KINDS,
  Language,
  SUBTYPES,
  VENUES,
} from '../../shared/options.js';
import { LOCALE } from '../../ui/format.js';

/**
 * Why a date was refused, by `eventDateOf`'s reason. The brief form's checker and the workspace's
 * notices and Budget field use these same sentences; neither adds a full stop (the notices do).
 */
export const DATE_COPY = {
  invalid: 'Enter the event date as a real calendar date',
  past: 'Choose a date from today onwards',
  too_far: 'Choose a date within the next two years',
} as const;

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

/**
 * Labels for plan languages, by their English names: the option text stays in the interface's
 * language, so a screen reader reads every option with one voice.
 */
export const LANGUAGE_LABELS: Record<Language, string> = {
  English: 'English',
  Hindi: 'Hindi',
  Tamil: 'Tamil',
  Telugu: 'Telugu',
  Bengali: 'Bengali',
  Marathi: 'Marathi',
  Spanish: 'Spanish',
  French: 'French',
};

// One formatter call per currency, ever: a symbol never changes at runtime.
const symbols = new Map<string, string>();

/** The symbol shown before a money input, e.g. ₹ for INR or A$ for AUD (from `Intl`, in {@link LOCALE}). */
export function currencySymbol(currency: string): string {
  let symbol = symbols.get(currency);
  if (symbol === undefined) {
    symbol = new Intl.NumberFormat(LOCALE, { style: 'currency', currency })
      .formatToParts(0)
      .filter((part) => part.type === 'currency')
      .map((part) => part.value)
      .join('');
    symbols.set(currency, symbol);
  }
  return symbol;
}

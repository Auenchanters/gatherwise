/**
 * Checklist lines repeated across the templates, written once so the wording cannot drift.
 * Does: holds plain text only. Lines are currency-neutral because the currency is selectable.
 * Never does: compute dates or money, or claim legal or permit authority.
 */

/** Opens almost every vendor checklist. */
export const QUOTE = 'Get a written quote with taxes and fees itemised';
/** Closes most vendor checklists. */
export const CANCELLATION = 'Confirm cancellation policy and refund window';
/** For any vendor who serves food. */
export const DIETARY_NEEDS = 'Confirm the menu covers the dietary needs on your guest list';
/** For DJs and bands. */
export const MUSIC_LISTS = 'Share must-play and do-not-play lists';
/** For DJs and bands. */
export const SOUND_CUTOFF = 'Confirm overtime charges and the venue sound cut-off time';
/** For bars; licence rules differ by place, so it points to the local authority. */
export const ALCOHOL_LICENCE =
  'Ask what licence is needed to serve alcohol (check with your local authority)';
/** For tents and marquees. */
export const TENT_SIZE = 'Confirm size, flooring and side walls for your guest count';

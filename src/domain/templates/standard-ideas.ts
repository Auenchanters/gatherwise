/**
 * Standard ideas for each event kind: what the Ideas tab shows when there are no AI ideas.
 * Does: holds short, inclusive ideas, each filed under a budget category and priced as a share of
 * it so it always fits; some apply only when the brief calls for them.
 * Never does: compute money (ideas.ts prices them), claim legal or permit authority, or name a tax;
 * the currency is selectable.
 */
import { hasDietaryNeeds, isKidsParty, isMilestone } from './birthday';
import { needsAccessibilityPlan, sponsorsExpected } from './community';
import { amplifiedSound, servesFood } from './conditions';
import type { Condition, EventKind } from './types';

/** A ready-made idea for one event kind. */
export interface StandardIdeaDef {
  /** Unique within its kind; the plan shows it as `std-${id}`. */
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** The template budget category that pays for it. */
  readonly categoryId: string;
  /** The idea costs this share of its category's allocation, in (0, 1], so it always fits. */
  readonly costShare: number;
  /** The idea is shown only when this returns true; omitted means always. */
  readonly when?: Condition;
}

const hasInfants: Condition = (b) => b.accessibility.includes('infants');
const labelsFood: Condition = (b) => servesFood(b) && hasDietaryNeeds(b);

const community: readonly StandardIdeaDef[] = [
  {
    id: 'zero_waste_food',
    title: 'Zero-waste food stalls',
    description:
      'Ask stall holders to serve on leaf plates or steel ware and set up a washing station, so almost nothing single-use reaches the bins.',
    categoryId: 'sanitation_waste',
    costShare: 0.5,
    when: servesFood,
  },
  {
    id: 'accessible_seating',
    title: 'Accessible seating zone',
    description:
      'Reserve a shaded, step-free area near the stage and toilets with chairs and a clear view, so guests with access needs are not left at the back.',
    categoryId: 'rentals',
    costShare: 0.25,
    when: needsAccessibilityPlan,
  },
  {
    id: 'local_talent_slot',
    title: 'Local talent stage slot',
    description:
      'Open a short slot for residents, school groups or local artists to perform; it costs little and brings their families along.',
    categoryId: 'activities_entertainment',
    costShare: 0.2,
  },
  {
    id: 'sponsor_wall',
    title: 'Sponsor thank-you wall',
    description:
      'A printed board at the entrance naming every sponsor and donor thanks them in public and gives next year’s sponsors a reason to join.',
    categoryId: 'marketing_printing',
    costShare: 0.3,
    when: sponsorsExpected,
  },
  {
    id: 'volunteer_rest_corner',
    title: 'Volunteer rest corner',
    description:
      'Water, snacks and a shaded seat for volunteers between shifts, with a board showing who is on next.',
    categoryId: 'volunteer_care',
    costShare: 0.4,
  },
  {
    id: 'help_desk',
    title: 'Help and lost-and-found desk',
    description:
      'One clearly signed desk for questions, lost children and lost items, staffed by a briefed volunteer for the whole event.',
    categoryId: 'safety_first_aid',
    costShare: 0.15,
  },
  {
    id: 'water_refill',
    title: 'Free water refill points',
    description:
      'Refill stations with reusable cups keep guests hydrated without selling bottled water, and keep the bins emptier.',
    categoryId: 'food_beverage',
    costShare: 0.05,
  },
  {
    id: 'quiet_zone',
    title: 'Quiet zone',
    description:
      'A softly lit corner away from the speakers for children, older guests and anyone who needs a break from the noise.',
    categoryId: 'decor',
    costShare: 0.2,
    when: amplifiedSound,
  },
];

const wedding: readonly StandardIdeaDef[] = [
  {
    id: 'story_board',
    title: 'Welcome board with your story',
    description:
      'A board at the entrance with a few photos and how the two of you met; guests linger over it and it doubles as a photo spot.',
    categoryId: 'decor_flowers',
    costShare: 0.1,
  },
  {
    id: 'accessible_seating',
    title: 'Comfortable, accessible seating',
    description:
      'Chairs with backs near the stage and the exits, step-free routes, and one named person guests can ask for help.',
    categoryId: 'venue',
    costShare: 0.05,
    when: needsAccessibilityPlan,
  },
  {
    id: 'labelled_counters',
    title: 'Clearly labelled food counters',
    description:
      'Label every dish as vegetarian, Jain, vegan or containing common allergens, so guests with dietary needs can eat without asking at each counter.',
    categoryId: 'catering',
    costShare: 0.02,
    when: labelsFood,
  },
  {
    id: 'photo_corner',
    title: 'Guest photo corner with instant prints',
    description:
      'A simple backdrop and an instant camera let guests take a print home and leave a copy in your guest book.',
    categoryId: 'photo_video',
    costShare: 0.15,
  },
  {
    id: 'artisan_favours',
    title: 'Locally made return gifts',
    description:
      'Small gifts from local artisans, such as block-printed pouches, clay lamps or regional sweets, that guests will actually use.',
    categoryId: 'invitations_gifts',
    costShare: 0.5,
  },
  {
    id: 'guest_shuttle',
    title: 'Shared shuttle for out-of-town guests',
    description:
      'One shuttle loop between the main hotels and the venue saves guests taxi fares and gets everyone there on time.',
    categoryId: 'transport_stay',
    costShare: 0.3,
  },
  {
    id: 'family_dance',
    title: 'Family dance medley',
    description:
      'Each side of the family prepares a short dance; a choreographer for two evenings keeps it fun rather than stressful.',
    categoryId: 'music_entertainment',
    costShare: 0.3,
    when: amplifiedSound,
  },
];

const birthday: readonly StandardIdeaDef[] = [
  {
    id: 'dress_up_box',
    title: 'Theme dress-up box',
    description:
      'A box of simple costumes and props that match the theme, so every guest can join in, even those who came in everyday clothes.',
    categoryId: 'decor_theme',
    costShare: 0.15,
  },
  {
    id: 'wishes_wall',
    title: 'Wishes wall',
    description:
      'A board or jar where guests leave a wish or a memory for the birthday person: a keepsake that costs almost nothing.',
    categoryId: 'decor_theme',
    costShare: 0.05,
  },
  {
    id: 'activity_stations',
    title: 'Self-running activity stations',
    description:
      'Two or three stations, such as colouring, a craft table and a treasure hunt, keep children busy without a single performer.',
    categoryId: 'entertainment',
    costShare: 0.4,
    when: isKidsParty,
  },
  {
    id: 'photo_slideshow',
    title: 'Photos through the years',
    description:
      'Collect photos from family and friends and play them on a loop; it gets people talking and sharing stories.',
    categoryId: 'photography',
    costShare: 0.3,
    when: isMilestone,
  },
  {
    id: 'allergy_friendly_cake',
    title: 'Allergy-friendly cake option',
    description:
      'A small second cake or cupcakes that suit the dietary needs on your list, so every guest gets a slice.',
    categoryId: 'cake_dessert',
    costShare: 0.3,
    when: hasDietaryNeeds,
  },
  {
    id: 'plantable_favours',
    title: 'Return gifts that grow',
    description:
      'Seed pencils, seed-paper cards or small saplings instead of plastic toys; guests take home something that lasts.',
    categoryId: 'favours_gifts',
    costShare: 0.6,
  },
  {
    id: 'baby_care_corner',
    title: 'Baby care corner',
    description:
      'A quiet room or curtained corner with a changing mat, wipes and a comfortable chair for feeding.',
    categoryId: 'venue',
    costShare: 0.05,
    when: hasInfants,
  },
  {
    id: 'guest_playlist',
    title: 'Guest-made playlist',
    description:
      'Ask each guest for one song when they reply to the invitation; the playlist becomes part of the party.',
    categoryId: 'entertainment',
    costShare: 0.05,
  },
];

/** The standard ideas for each event kind, in display order. */
export const STANDARD_IDEAS: Readonly<Record<EventKind, readonly StandardIdeaDef[]>> = {
  community,
  wedding,
  birthday,
};

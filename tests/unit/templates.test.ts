/**
 * Integrity and truth-table tests for src/domain/templates.
 *
 * Does: runs the same structural checks on every template (unique ids, resolvable references,
 * weights, checklists, reasons, schedulable lead times), pins the community template's categories,
 * weights and scaling, and walks the `when` conditions across their thresholds.
 * Never does: build a schedule or detect cycles (schedule.test.ts covers that); it only checks the
 * data.
 */
import { describe, expect, it } from 'vitest';
import {
  birthdayTemplate,
  BIRTHDAY_PHOTOGRAPHER_GUESTS,
} from '../../src/domain/templates/birthday.js';
import {
  communityTemplate,
  CROWD_SAFETY_GUESTS,
  EVENING_CUTOFF,
  FIRST_AID_GUESTS,
  TOILET_GUESTS,
  WASTE_GUESTS,
} from '../../src/domain/templates/community.js';
import { always, endsAfter, isOutdoor } from '../../src/domain/templates/conditions.js';
import { QUOTE } from '../../src/domain/templates/copy.js';
import { nonEmpty, templateFor, templateIds } from '../../src/domain/templates/index.js';
import type { EventTemplate, TaskId } from '../../src/domain/templates/types.js';
import { weddingTemplate } from '../../src/domain/templates/wedding.js';
import type { EventBrief } from '../../src/shared/schema.js';

type Fields = Omit<Extract<EventBrief, { kind: 'wedding' }>, 'kind' | 'subtype'>;
const MINIMAL: Fields = {
  name: 'Minimal',
  date: '2026-12-01',
  startTime: '10:00',
  durationHours: 2,
  city: '',
  venue: 'indoor_hall',
  guests: 10,
  budget: 10000,
  currency: 'INR',
  dietary: [],
  accessibility: [],
  amplifiedSound: false,
  servesFood: false,
  servesAlcohol: false,
  volunteersAvailable: 0,
  vibe: '',
  notes: '',
};
const community = (over: Partial<Extract<EventBrief, { kind: 'community' }>> = {}): EventBrief => ({
  ...MINIMAL,
  kind: 'community',
  subtype: 'festival',
  ...over,
});
const wedding = (over: Partial<Fields> = {}): EventBrief => ({
  ...MINIMAL,
  kind: 'wedding',
  subtype: 'ceremony_reception',
  ...over,
});
const birthday = (over: Partial<Extract<EventBrief, { kind: 'birthday' }>> = {}): EventBrief => ({
  ...MINIMAL,
  kind: 'birthday',
  subtype: 'adult',
  ...over,
});
const income = (
  over: Partial<NonNullable<Extract<EventBrief, { kind: 'community' }>['income']>>,
) => ({
  ticketPrice: 0,
  expectedPaidAttendance: 0,
  sponsors: 0,
  donations: 0,
  stallCount: 0,
  stallFee: 0,
  ...over,
});

const byId = <T extends { id: string }>(items: readonly T[], id: string): T => {
  const found = items.find((item) => item.id === id);
  if (!found) throw new Error(`no such id: ${id}`);
  return found;
};
const included = (t: EventTemplate, taskId: string, b: EventBrief): boolean =>
  (byId(t.tasks, taskId).when ?? (() => true))(b);
const vendorOn = (t: EventTemplate, vendorId: string, b: EventBrief): boolean =>
  byId(t.vendors, vendorId).when(b);
const hasDuplicates = (ids: readonly string[]): boolean => new Set(ids).size !== ids.length;

/** Indoor, no sound, no food, no alcohol, 10 guests: the brief that triggers the fewest rules. */
const MINIMAL_BRIEF: Record<EventTemplate['kind'], EventBrief> = {
  community: community(),
  wedding: wedding(),
  birthday: birthday(),
};
const SAMPLES: Record<EventTemplate['kind'], EventBrief[]> = {
  community: [
    MINIMAL_BRIEF.community,
    community({
      guests: 250,
      subtype: 'sports_day',
      venue: 'outdoor_public',
      amplifiedSound: true,
    }),
    community({ guests: 400, accessibility: ['elderly'], startTime: '17:00', durationHours: 4 }),
  ],
  wedding: [
    MINIMAL_BRIEF.wedding,
    wedding({ guests: 300, venue: 'outdoor_private', servesFood: true }),
  ],
  birthday: [MINIMAL_BRIEF.birthday, birthday({ subtype: 'kids', servesFood: true, guests: 60 })],
};

describe.each([
  ['community', communityTemplate],
  ['wedding', weddingTemplate],
  ['birthday', birthdayTemplate],
] as const)('%s template integrity', (kind, template) => {
  it('is what templateFor returns for its kind', () => {
    expect(template.kind).toBe(kind);
    expect(templateFor(kind)).toBe(template);
  });

  it('has unique ids within categories, tasks, vendors and volunteer roles', () => {
    expect(hasDuplicates(template.categories.map((c) => c.id))).toBe(false);
    expect(hasDuplicates(template.tasks.map((t) => t.id))).toBe(false);
    expect(hasDuplicates(template.vendors.map((v) => v.id))).toBe(false);
    expect(hasDuplicates(template.volunteerRoles.map((r) => r.id))).toBe(false);
  });

  it('only depends on tasks that exist', () => {
    const ids = new Set<TaskId>(template.tasks.map((t) => t.id));
    for (const task of template.tasks) {
      for (const dep of task.dependsOn) expect(ids.has(dep), `${task.id} -> ${dep}`).toBe(true);
    }
  });

  it('only files tasks under categories that exist', () => {
    const ids = new Set(template.categories.map((c) => c.id));
    for (const task of template.tasks) expect(ids.has(task.categoryId), task.id).toBe(true);
  });

  it('has positive whole-number weights that sum to 100', () => {
    for (const c of template.categories)
      expect(Number.isInteger(c.weight) && c.weight > 0).toBe(true);
    expect(template.categories.reduce((sum, c) => sum + c.weight, 0)).toBe(100);
  });

  it('gives every task a title and whole-number durations and lead days', () => {
    for (const t of template.tasks) {
      expect(t.title.length, t.id).toBeGreaterThan(0);
      expect(Number.isInteger(t.durationDays) && t.durationDays >= 1, t.id).toBe(true);
      expect(Number.isInteger(t.leadDays), t.id).toBe(true);
    }
  });

  it('keeps titles short and puts caveats in notes', () => {
    for (const t of template.tasks) {
      expect(t.title.length, t.id).toBeLessThanOrEqual(60);
      expect(t.title, t.id).not.toMatch(/[()—]/u);
      if (t.note !== undefined) expect(t.note.trim().length, t.id).toBeGreaterThan(0);
    }
  });

  it('lets every dependency finish before its dependent starts', () => {
    // lead = days before the event by which a task FINISHES; it starts durationDays earlier.
    for (const task of template.tasks) {
      for (const dep of task.dependsOn) {
        const need = task.leadDays + task.durationDays;
        expect(
          byId(template.tasks, dep).leadDays,
          `${dep} before ${task.id}`,
        ).toBeGreaterThanOrEqual(need);
      }
    }
  });

  it('never makes an unconditional task wait on a conditional one', () => {
    for (const task of template.tasks) {
      for (const dep of task.dependsOn) {
        const { when } = byId(template.tasks, dep);
        expect(when === undefined || when === task.when, `${task.id} -> ${dep}`).toBe(true);
      }
    }
  });

  it('gives every vendor a label, a book-by lead time and at least 3 checklist items', () => {
    for (const v of template.vendors) {
      expect(v.label.length, v.id).toBeGreaterThan(0);
      expect(v.bookByLeadDays, v.id).toBeGreaterThan(0);
      expect(v.checklist.length, v.id).toBeGreaterThanOrEqual(3);
      for (const item of v.checklist) expect(item.trim().length, v.id).toBeGreaterThan(0);
    }
  });

  it('keeps checklists currency-neutral and opens quotes with the shared line', () => {
    for (const v of template.vendors) {
      for (const item of v.checklist) expect(item, v.id).not.toMatch(/GST/u);
      expect(v.checklist[0], v.id).toBe(QUOTE);
    }
  });

  it('explains every vendor with a non-empty reason that reads as a recommendation', () => {
    for (const v of template.vendors) {
      for (const b of SAMPLES[kind]) {
        expect(v.reason(b).trim().length, v.id).toBeGreaterThan(0);
        expect(v.reason(b), v.id).toMatch(/^Recommended: /u);
      }
    }
  });

  it('always has at least one vendor, even for a minimal brief', () => {
    expect(template.vendors.some((v) => v.when(MINIMAL_BRIEF[kind]))).toBe(true);
  });

  it('exposes non-empty id tuples for the AI schema', () => {
    const ids = templateIds(template);
    expect(ids.categories).toEqual(template.categories.map((c) => c.id));
    expect(ids.tasks).toEqual(template.tasks.map((t) => t.id));
    expect(ids.vendors).toEqual(template.vendors.map((v) => v.id));
  });
});

describe('template sizes', () => {
  it('keeps each template in its planned range', () => {
    expect(communityTemplate.tasks.length).toBeGreaterThanOrEqual(16);
    expect(communityTemplate.tasks.length).toBeLessThanOrEqual(24);
    expect(communityTemplate.volunteerRoles.length).toBeGreaterThanOrEqual(5);
    expect(communityTemplate.volunteerRoles.length).toBeLessThanOrEqual(7);
    for (const t of [weddingTemplate, birthdayTemplate]) {
      expect(t.tasks.length).toBeGreaterThanOrEqual(10);
      expect(t.tasks.length).toBeLessThanOrEqual(14);
      expect(t.vendors.length).toBeGreaterThanOrEqual(4);
      expect(t.vendors.length).toBeLessThanOrEqual(7);
      expect(t.volunteerRoles).toEqual([]);
    }
    expect(weddingTemplate.categories).toHaveLength(8);
    expect(birthdayTemplate.categories).toHaveLength(8);
  });
});

describe('community template', () => {
  it('pins the categories, weights and scaling', () => {
    expect(communityTemplate.categories.map((c) => [c.id, c.weight, c.scales])).toEqual([
      ['venue_permits', 12, 'fixed'],
      ['stage_av', 15, 'fixed'],
      ['food_beverage', 25, 'per_guest'],
      ['decor', 8, 'fixed'],
      ['safety_first_aid', 6, 'fixed'],
      ['sanitation_waste', 6, 'per_guest'],
      ['marketing_printing', 5, 'fixed'],
      ['volunteer_care', 4, 'per_guest'],
      ['rentals', 9, 'per_guest'],
      ['activities_entertainment', 10, 'fixed'],
    ]);
  });

  it('pins the listed tasks: duration, lead days and dependencies', () => {
    const pinned: [string, number, number, string[]][] = [
      ['define_goals', 2, 60, []],
      ['form_committee', 3, 56, ['define_goals']],
      ['set_budget', 2, 52, ['form_committee']],
      ['book_venue', 5, 45, ['set_budget']],
      ['public_space_permission', 21, 10, ['book_venue']],
      ['sound_permission', 10, 7, ['book_venue']],
      ['sponsor_outreach', 21, 21, ['set_budget']],
      ['vendor_quotes', 7, 30, ['set_budget']],
      ['book_vendors', 5, 21, ['vendor_quotes']],
      ['volunteer_recruitment', 14, 14, ['form_committee']],
      ['publicity', 21, 3, ['book_venue']],
      ['food_safety_check', 7, 7, ['book_vendors']],
      ['accessibility_plan', 3, 10, ['book_venue']],
      ['volunteer_briefing', 1, 1, ['volunteer_recruitment']],
      ['final_walkthrough', 1, 1, ['book_vendors']],
      ['post_event_report', 3, -3, []],
    ];
    for (const [id, durationDays, leadDays, dependsOn] of pinned) {
      const t = byId(communityTemplate.tasks, id);
      expect([t.durationDays, t.leadDays, [...t.dependsOn]], id).toEqual([
        durationDays,
        leadDays,
        dependsOn,
      ]);
    }
  });

  it('pins the vendors and their book-by lead days', () => {
    const pinned: [string, number][] = [
      ['tent_shamiana', 21],
      ['sound_lighting', 21],
      ['caterer_or_stalls', 21],
      ['portable_toilets', 14],
      ['security_crowd', 14],
      ['first_aid_ambulance', 10],
      ['waste_management', 10],
      ['generator', 14],
    ];
    for (const [id, lead] of pinned) {
      expect(byId(communityTemplate.vendors, id).bookByLeadDays, id).toBe(lead);
    }
  });

  it('leaves the 11 unconditional tasks without a condition and gives the other 5 one', () => {
    const unconditional = [
      'define_goals',
      'form_committee',
      'set_budget',
      'book_venue',
      'vendor_quotes',
      'book_vendors',
      'volunteer_recruitment',
      'publicity',
      'volunteer_briefing',
      'final_walkthrough',
      'post_event_report',
    ];
    const conditional = [
      'public_space_permission',
      'sound_permission',
      'sponsor_outreach',
      'food_safety_check',
      'accessibility_plan',
    ];
    expect(unconditional).toHaveLength(11);
    for (const id of unconditional)
      expect(byId(communityTemplate.tasks, id).when, id).toBeUndefined();
    for (const id of conditional) expect(byId(communityTemplate.tasks, id).when, id).toBeDefined();
  });

  it('adds exactly one always-on vendor, printing_signage, booked before publicity', () => {
    const alwaysOn = communityTemplate.vendors.filter((v) => v.when === always).map((v) => v.id);
    expect(alwaysOn).toEqual(['printing_signage']);
    const forMinimal = communityTemplate.vendors.filter((v) => v.when(MINIMAL_BRIEF.community));
    expect(forMinimal.map((v) => v.id)).toEqual(['printing_signage']);
    const posters = byId(communityTemplate.vendors, 'printing_signage');
    const publicity = byId(communityTemplate.tasks, 'publicity');
    expect(posters.bookByLeadDays).toBe(28);
    expect(posters.bookByLeadDays).toBeGreaterThanOrEqual(
      publicity.leadDays + publicity.durationDays,
    );
  });

  it('points permit tasks at the local authority through their notes', () => {
    for (const id of ['public_space_permission', 'sound_permission', 'alcohol_licence']) {
      const task = byId(communityTemplate.tasks, id);
      expect(task.note, id).toMatch(/local authority/iu);
    }
    expect(byId(communityTemplate.tasks, 'public_space_permission').title).toBe(
      'Apply for public-space permission',
    );
    expect(byId(communityTemplate.tasks, 'public_space_permission').note).toBe(
      'Check with your local authority — processing times vary by city',
    );
  });

  it('plans an alcohol licence about 14 days out, only when alcohol is served', () => {
    const licence = byId(communityTemplate.tasks, 'alcohol_licence');
    expect(licence.leadDays).toBe(14);
    expect(included(communityTemplate, 'alcohol_licence', community({ servesAlcohol: true }))).toBe(
      true,
    );
    expect(included(communityTemplate, 'alcohol_licence', community())).toBe(false);
  });

  it('rosters volunteers after recruiting them and before the briefing starts', () => {
    const roster = byId(communityTemplate.tasks, 'volunteer_shift_roster');
    const briefing = byId(communityTemplate.tasks, 'volunteer_briefing');
    expect(roster.dependsOn).toEqual(['volunteer_recruitment']);
    expect(roster.leadDays).toBeGreaterThanOrEqual(briefing.leadDays + briefing.durationDays);
    expect(included(communityTemplate, 'volunteer_shift_roster', community())).toBe(true);
  });

  it('names its thresholds', () => {
    expect([WASTE_GUESTS, TOILET_GUESTS, CROWD_SAFETY_GUESTS, FIRST_AID_GUESTS]).toEqual([
      50, 100, 150, 300,
    ]);
    expect(EVENING_CUTOFF).toBe('18:00');
  });

  it('includes the public-space permission only for a public outdoor venue', () => {
    const on = (venue: EventBrief['venue']) =>
      included(communityTemplate, 'public_space_permission', community({ venue }));
    expect(on('outdoor_public')).toBe(true);
    expect(on('outdoor_private')).toBe(false);
    expect(on('indoor_hall')).toBe(false);
    expect(on('home')).toBe(false);
    expect(on('restaurant')).toBe(false);
  });

  it('includes the permission and income tasks on their conditions', () => {
    const t = communityTemplate;
    expect(included(t, 'sound_permission', community({ amplifiedSound: true }))).toBe(true);
    expect(included(t, 'sound_permission', community())).toBe(false);
    expect(included(t, 'book_stage_av', community({ amplifiedSound: true }))).toBe(true);
    expect(included(t, 'book_stage_av', community())).toBe(false);
    expect(included(t, 'food_safety_check', community({ servesFood: true }))).toBe(true);
    expect(included(t, 'food_safety_check', community())).toBe(false);
    expect(included(t, 'accessibility_plan', community({ accessibility: ['hearing'] }))).toBe(true);
    expect(included(t, 'accessibility_plan', community())).toBe(false);
  });

  it('includes sponsor outreach and stall allocation only when income needs them', () => {
    const t = communityTemplate;
    const sponsors = (n: number) => community({ income: income({ sponsors: n }) });
    expect(included(t, 'sponsor_outreach', sponsors(1))).toBe(true);
    expect(included(t, 'sponsor_outreach', sponsors(0))).toBe(false);
    expect(included(t, 'sponsor_outreach', community())).toBe(false);
    expect(included(t, 'sponsor_outreach', wedding())).toBe(false);
    const stalls = (n: number) => community({ income: income({ stallCount: n }) });
    expect(included(t, 'stall_allocation', stalls(2))).toBe(true);
    expect(included(t, 'stall_allocation', stalls(0))).toBe(false);
    expect(included(t, 'stall_allocation', community())).toBe(false);
  });

  it('flips security_crowd at 150 versus 151 guests', () => {
    const on = (guests: number) =>
      vendorOn(communityTemplate, 'security_crowd', community({ guests }));
    expect(on(CROWD_SAFETY_GUESTS)).toBe(false);
    expect(on(CROWD_SAFETY_GUESTS + 1)).toBe(true);
  });

  it('flips waste_management at 50 versus 51 guests', () => {
    const on = (guests: number) =>
      vendorOn(communityTemplate, 'waste_management', community({ guests }));
    expect(on(WASTE_GUESTS)).toBe(false);
    expect(on(WASTE_GUESTS + 1)).toBe(true);
  });

  it('needs portable toilets only for outdoor events above 100 guests', () => {
    const on = (venue: EventBrief['venue'], guests: number) =>
      vendorOn(communityTemplate, 'portable_toilets', community({ venue, guests }));
    expect(on('outdoor_public', TOILET_GUESTS)).toBe(false);
    expect(on('outdoor_public', TOILET_GUESTS + 1)).toBe(true);
    expect(on('outdoor_private', TOILET_GUESTS + 1)).toBe(true);
    expect(on('indoor_hall', 500)).toBe(false);
  });

  it('needs a tent, sound and a caterer only for outdoors, amplified sound and food', () => {
    const t = communityTemplate;
    expect(vendorOn(t, 'tent_shamiana', community({ venue: 'outdoor_private' }))).toBe(true);
    expect(vendorOn(t, 'tent_shamiana', community({ venue: 'restaurant' }))).toBe(false);
    expect(vendorOn(t, 'sound_lighting', community({ amplifiedSound: true }))).toBe(true);
    expect(vendorOn(t, 'sound_lighting', community())).toBe(false);
    expect(vendorOn(t, 'caterer_or_stalls', community({ servesFood: true }))).toBe(true);
    expect(vendorOn(t, 'caterer_or_stalls', community())).toBe(false);
  });

  it('needs first aid for a big crowd, a sports day or elderly guests', () => {
    const on = (over: Partial<Extract<EventBrief, { kind: 'community' }>>) =>
      vendorOn(communityTemplate, 'first_aid_ambulance', community(over));
    expect(on({ guests: FIRST_AID_GUESTS })).toBe(false);
    expect(on({ guests: FIRST_AID_GUESTS + 1 })).toBe(true);
    expect(on({ subtype: 'sports_day' })).toBe(true);
    expect(on({ subtype: 'festival' })).toBe(false);
    expect(on({ accessibility: ['elderly'] })).toBe(true);
    expect(on({ accessibility: ['wheelchair'] })).toBe(false);
  });

  it('says why first aid is needed, naming the matching rule', () => {
    const reason = (over: Partial<Extract<EventBrief, { kind: 'community' }>>) =>
      byId(communityTemplate.vendors, 'first_aid_ambulance').reason(community(over));
    expect(reason({ guests: 450 })).toContain('450');
    expect(reason({ subtype: 'sports_day' })).toContain('sports day');
    expect(reason({ accessibility: ['elderly'] })).toContain('elderly');
  });

  it('needs a generator only for outdoor events ending after 18:00', () => {
    const on = (over: Partial<Extract<EventBrief, { kind: 'community' }>>) =>
      vendorOn(communityTemplate, 'generator', community({ venue: 'outdoor_public', ...over }));
    expect(on({ startTime: '16:00', durationHours: 2 })).toBe(false);
    expect(on({ startTime: '16:00', durationHours: 3 })).toBe(true);
    expect(on({ startTime: '10:00', durationHours: 4 })).toBe(false);
    expect(on({ venue: 'indoor_hall', startTime: '19:00' })).toBe(false);
  });

  it('cites the guest count when explaining security_crowd', () => {
    const reason = byId(communityTemplate.vendors, 'security_crowd').reason(
      community({ guests: 250 }),
    );
    expect(reason).toContain('250');
    expect(reason).toContain(String(CROWD_SAFETY_GUESTS));
    expect(reason).toBe(
      'Recommended: 250 guests is above the 150-guest rule of thumb for crowd safety',
    );
  });

  it('has the volunteer roles a community event needs', () => {
    const ids = communityTemplate.volunteerRoles.map((r) => r.id);
    expect(ids).toEqual([
      'registration_desk',
      'stage_av_runner',
      'food_stalls',
      'first_aid_liaison',
      'accessibility_helper',
      'cleanup_crew',
    ]);
    for (const role of communityTemplate.volunteerRoles) {
      expect(role.label.length).toBeGreaterThan(0);
      expect(role.description.length).toBeGreaterThan(0);
    }
  });
});

describe('wedding template', () => {
  it('books the big things early and settles numbers late', () => {
    const lead = (id: string) => byId(weddingTemplate.tasks, id).leadDays;
    expect(lead('book_venue')).toBe(180);
    expect(lead('send_invitations')).toBe(60);
    expect(lead('final_headcount')).toBe(7);
    expect(lead('thank_you_notes')).toBeLessThan(0);
  });

  it('always includes a photographer, and the rest on their conditions', () => {
    const t = weddingTemplate;
    expect(vendorOn(t, 'photographer_videographer', wedding())).toBe(true);
    expect(vendorOn(t, 'caterer', wedding({ servesFood: true }))).toBe(true);
    expect(vendorOn(t, 'caterer', wedding())).toBe(false);
    expect(vendorOn(t, 'music_dj', wedding({ amplifiedSound: true }))).toBe(true);
    expect(vendorOn(t, 'music_dj', wedding())).toBe(false);
    expect(vendorOn(t, 'bar_service', wedding({ servesAlcohol: true }))).toBe(true);
    expect(vendorOn(t, 'bar_service', wedding())).toBe(false);
    expect(vendorOn(t, 'marquee_tent', wedding({ venue: 'outdoor_private' }))).toBe(true);
    expect(vendorOn(t, 'marquee_tent', wedding({ venue: 'indoor_hall' }))).toBe(false);
  });

  it('only plans food and music tasks when there is food and music', () => {
    const t = weddingTemplate;
    expect(included(t, 'book_caterer', wedding({ servesFood: true }))).toBe(true);
    expect(included(t, 'book_caterer', wedding())).toBe(false);
    expect(included(t, 'menu_tasting', wedding({ servesFood: true }))).toBe(true);
    expect(included(t, 'book_music_dj', wedding({ amplifiedSound: true }))).toBe(true);
    expect(included(t, 'book_music_dj', wedding())).toBe(false);
  });

  it('skips the venue booking for a wedding at home', () => {
    const on = (venue: EventBrief['venue']) =>
      included(weddingTemplate, 'book_venue', wedding({ venue }));
    expect(on('home')).toBe(false);
    for (const venue of [
      'indoor_hall',
      'outdoor_public',
      'outdoor_private',
      'restaurant',
    ] as const) {
      expect(on(venue)).toBe(true);
    }
  });

  it('cites the brief in its reasons', () => {
    const b = wedding({ guests: 321, servesFood: true });
    expect(byId(weddingTemplate.vendors, 'caterer').reason(b)).toContain('321');
  });
});

describe('birthday template', () => {
  it('books the venue about a month out, invitations at three weeks and the cake at one', () => {
    const lead = (id: string) => byId(birthdayTemplate.tasks, id).leadDays;
    expect(lead('book_venue')).toBe(30);
    expect(lead('send_invitations')).toBe(21);
    expect(lead('order_cake')).toBe(7);
    expect(lead('thank_you_notes')).toBeLessThan(0);
  });

  it('skips the venue booking for a party at home and the menu when no food is served', () => {
    const t = birthdayTemplate;
    expect(included(t, 'book_venue', birthday({ venue: 'home' }))).toBe(false);
    expect(included(t, 'book_venue', birthday({ venue: 'restaurant' }))).toBe(true);
    expect(included(t, 'plan_menu', birthday({ servesFood: true }))).toBe(true);
    expect(included(t, 'plan_menu', birthday())).toBe(false);
    expect(included(t, 'dietary_check', birthday({ dietary: ['vegan'] }))).toBe(true);
    expect(included(t, 'dietary_check', birthday())).toBe(false);
  });

  it('decides on photos before the photographer book-by date', () => {
    const photos = byId(birthdayTemplate.tasks, 'plan_photos');
    const photographer = byId(birthdayTemplate.vendors, 'photographer');
    expect(photos.leadDays).toBeGreaterThanOrEqual(photographer.bookByLeadDays);
  });

  it('checks dietary needs before the cake is ordered', () => {
    const dietary = byId(birthdayTemplate.tasks, 'dietary_check');
    const cake = byId(birthdayTemplate.tasks, 'order_cake');
    expect(dietary.leadDays).toBeGreaterThanOrEqual(cake.leadDays + cake.durationDays);
  });

  it('always has a cake and decor, and the rest on their conditions', () => {
    const t = birthdayTemplate;
    expect(vendorOn(t, 'cake_bakery', birthday())).toBe(true);
    expect(vendorOn(t, 'decor_balloons', birthday())).toBe(true);
    expect(vendorOn(t, 'kids_entertainer', birthday({ subtype: 'kids' }))).toBe(true);
    expect(vendorOn(t, 'kids_entertainer', birthday({ subtype: 'adult' }))).toBe(false);
    expect(vendorOn(t, 'kids_entertainer', wedding())).toBe(false);
    expect(vendorOn(t, 'caterer_or_snacks', birthday({ servesFood: true }))).toBe(true);
    expect(vendorOn(t, 'caterer_or_snacks', birthday())).toBe(false);
    expect(vendorOn(t, 'music_dj', birthday({ amplifiedSound: true }))).toBe(true);
    expect(vendorOn(t, 'bar_service', birthday({ servesAlcohol: true }))).toBe(true);
    expect(vendorOn(t, 'bar_service', birthday())).toBe(false);
  });

  it('adds a photographer for milestones or bigger parties', () => {
    const on = (over: Partial<Extract<EventBrief, { kind: 'birthday' }>>) =>
      vendorOn(birthdayTemplate, 'photographer', birthday(over));
    expect(on({ guests: BIRTHDAY_PHOTOGRAPHER_GUESTS })).toBe(false);
    expect(on({ guests: BIRTHDAY_PHOTOGRAPHER_GUESTS + 1 })).toBe(true);
    expect(on({ subtype: 'milestone' })).toBe(true);
    const reason = byId(birthdayTemplate.vendors, 'photographer').reason;
    expect(reason(birthday({ guests: 77 }))).toContain('77');
    expect(reason(birthday({ subtype: 'milestone' }))).toContain('milestone');
  });
});

describe('condition helpers', () => {
  it('treats public and private outdoor venues as outdoor, and nothing else', () => {
    expect(isOutdoor(community({ venue: 'outdoor_public' }))).toBe(true);
    expect(isOutdoor(community({ venue: 'outdoor_private' }))).toBe(true);
    for (const venue of ['indoor_hall', 'home', 'restaurant'] as const) {
      expect(isOutdoor(community({ venue }))).toBe(false);
    }
  });

  it('endsAfter is true only when start plus duration is later than the cut-off', () => {
    const at = (startTime: string, durationHours: number) =>
      endsAfter(community({ startTime, durationHours }), '18:00');
    expect(at('17:00', 1)).toBe(false);
    expect(at('17:00', 2)).toBe(true);
    expect(at('17:59', 1)).toBe(true);
    expect(at('06:00', 12)).toBe(false);
    expect(at('09:00', 16)).toBe(true);
    expect(at('22:00', 8)).toBe(true);
    expect(at('00:00', 1)).toBe(false);
  });
});

describe('templateIds and nonEmpty', () => {
  it('returns non-empty tuples for all three templates', () => {
    for (const kind of ['community', 'wedding', 'birthday'] as const) {
      const ids = templateIds(templateFor(kind));
      expect(ids.categories.length).toBeGreaterThan(0);
      expect(ids.tasks.length).toBeGreaterThan(0);
      expect(ids.vendors.length).toBeGreaterThan(0);
    }
  });

  it('returns the same items it was given', () => {
    expect(nonEmpty(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('throws a RangeError on an empty list', () => {
    expect(() => nonEmpty([])).toThrow(RangeError);
  });
});

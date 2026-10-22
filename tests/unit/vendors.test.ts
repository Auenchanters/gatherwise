/**
 * Tests for src/domain/vendors.ts, the vendor checklist and booking status rules.
 *
 * Does: pins the brief's assertions (crowd-size vendors and their reasons, indoor birthdays without
 * them, book-by arithmetic), template order, the shape of every item, checklist ids unique within a
 * plan, immutability of the shared template, and every `bookingStatus` branch with its boundaries.
 * Never does: read the clock (`today` is fixed) or leave the property tests unseeded.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, isoDate } from '../../src/domain/dates.js';
import { DUE_SOON_DAYS } from '../../src/domain/schedule.js';
import { templateFor } from '../../src/domain/templates/index.js';
import { communityTemplate } from '../../src/domain/templates/community.js';
import type { EventBrief } from '../../src/shared/schema.js';
import type { EventTemplate } from '../../src/domain/templates/types.js';
import {
  bookingStatus,
  requiredVendors,
  VENDOR_STATUSES,
  type VendorItem,
  type VendorStatus,
} from '../../src/domain/vendors.js';
import { brief, briefArb, TODAY as today } from '../support/fixtures.js';

const SEED = { seed: 20261021, numRuns: 300 };

/** The vendors for a brief, using its own template and its own date (always valid in fixtures). */
const vendorsFor = (b: EventBrief): VendorItem[] =>
  requiredVendors(b, templateFor(b.kind), isoDate(b.date));

const idsOf = (items: readonly { readonly id: string }[]): string[] => items.map((i) => i.id);

/** Fails the test when a lookup comes back empty, instead of a non-null assertion. */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

const vendorOf = (items: readonly VendorItem[], id: string): VendorItem =>
  must(
    items.find((i) => i.id === id),
    id,
  );

describe('requiredVendors: which vendors apply', () => {
  it('adds crowd safety and toilets, quoting 250, for an outdoor crowd of 250', () => {
    const items = vendorsFor(brief('community', { venue: 'outdoor_public', guests: 250 }));
    expect(idsOf(items)).toEqual(expect.arrayContaining(['security_crowd', 'portable_toilets']));
    expect(vendorOf(items, 'security_crowd').reason).toContain('250');
    expect(vendorOf(items, 'portable_toilets').reason).toContain('250');
  });

  it('adds neither for an indoor birthday of 20', () => {
    const ids = idsOf(
      vendorsFor(brief('birthday', { venue: 'indoor_hall', guests: 20, subtype: 'adult' })),
    );
    expect(ids).not.toContain('security_crowd');
    expect(ids).not.toContain('portable_toilets');
  });

  it('applies the guest thresholds strictly: 150 has no crowd safety, 151 has', () => {
    const at = (guests: number) => idsOf(vendorsFor(brief('community', { guests })));
    expect(at(150)).not.toContain('security_crowd');
    expect(at(151)).toContain('security_crowd');
  });

  it('keeps toilets for outdoor venues only', () => {
    const at = (venue: EventBrief['venue']) =>
      idsOf(vendorsFor(brief('community', { guests: 250, venue })));
    expect(at('outdoor_private')).toContain('portable_toilets');
    expect(at('indoor_hall')).not.toContain('portable_toilets');
  });

  it('returns exactly the template vendors whose rule is true, in template order', () => {
    fc.assert(
      fc.property(briefArb, (b) => {
        const expected = templateFor(b.kind)
          .vendors.filter((v) => v.when(b))
          .map((v) => v.id);
        expect(idsOf(vendorsFor(b))).toEqual(expected);
      }),
      SEED,
    );
  });

  it('always has at least one vendor, whatever the kind', () => {
    fc.assert(
      fc.property(briefArb, (b) => {
        expect(vendorsFor(b).length).toBeGreaterThan(0);
      }),
      SEED,
    );
  });

  it('is deterministic: the same inputs give equal results', () => {
    const b = brief('community');
    expect(vendorsFor(b)).toEqual(vendorsFor(b));
  });
});

describe('requiredVendors: what each item carries', () => {
  it('copies label and checklist text, and gives a "Recommended: " reason built from the brief', () => {
    fc.assert(
      fc.property(briefArb, (b) => {
        const template = templateFor(b.kind);
        for (const item of vendorsFor(b)) {
          const def = must(
            template.vendors.find((v) => v.id === item.id),
            item.id,
          );
          expect(item.label).toBe(def.label);
          expect(item.reason).toBe(def.reason(b));
          expect(item.reason.startsWith('Recommended: ')).toBe(true);
          expect(item.checklist.map((c) => c.text)).toEqual(def.checklist);
        }
      }),
      SEED,
    );
  });

  it('starts every item at to_contact with every checklist box unticked', () => {
    for (const item of vendorsFor(brief('community'))) {
      expect(item.status).toBe('to_contact');
      expect(item.checklist.length).toBeGreaterThan(0);
      expect(item.checklist.every((c) => !c.done)).toBe(true);
    }
  });

  it('numbers checklist ids as vendorId:index', () => {
    const item = vendorOf(vendorsFor(brief('community')), 'security_crowd');
    expect(item.checklist.map((c) => c.id)).toEqual(
      item.checklist.map((_, i) => `${item.id}:${i}`),
    );
    expect(item.checklist[0]?.id).toBe('security_crowd:0');
  });

  it('keeps checklist ids unique across a whole plan', () => {
    fc.assert(
      fc.property(briefArb, (b) => {
        const all = vendorsFor(b).flatMap((item) => item.checklist.map((c) => c.id));
        expect(new Set(all).size).toBe(all.length);
      }),
      SEED,
    );
  });
});

describe('requiredVendors: book-by dates', () => {
  it('is the event date minus each vendor lead time', () => {
    const b = brief('community', { date: '2026-12-12', accessibility: ['elderly'] });
    const items = vendorsFor(b);
    // 28, 21 and 14 days before 12 December.
    expect(vendorOf(items, 'printing_signage').bookBy).toBe(isoDate('2026-11-14'));
    expect(vendorOf(items, 'tent_shamiana').bookBy).toBe(isoDate('2026-11-21'));
    expect(vendorOf(items, 'security_crowd').bookBy).toBe(isoDate('2026-11-28'));
    expect(vendorOf(items, 'first_aid_ambulance').bookBy).toBe(isoDate('2026-12-02'));
  });

  it('crosses month and year boundaries and leap days correctly', () => {
    const early = vendorsFor(brief('community', { date: '2027-01-05' }));
    expect(vendorOf(early, 'tent_shamiana').bookBy).toBe(isoDate('2026-12-15'));
    const leap = vendorsFor(brief('community', { date: '2028-03-10' }));
    expect(vendorOf(leap, 'printing_signage').bookBy).toBe(isoDate('2028-02-11'));
  });

  it('uses the event date it is given, not the brief date', () => {
    const b = brief('community', { date: '2026-12-12' });
    const items = requiredVendors(b, templateFor('community'), isoDate('2027-06-30'));
    expect(vendorOf(items, 'security_crowd').bookBy).toBe(isoDate('2027-06-16'));
  });

  it('matches addDays(eventDate, -lead) for every vendor of every brief', () => {
    fc.assert(
      fc.property(briefArb, (b) => {
        const template = templateFor(b.kind);
        const eventDate = isoDate(b.date);
        for (const item of requiredVendors(b, template, eventDate)) {
          const def = must(
            template.vendors.find((v) => v.id === item.id),
            item.id,
          );
          expect(item.bookBy).toBe(addDays(eventDate, -def.bookByLeadDays));
        }
      }),
      SEED,
    );
  });
});

describe('requiredVendors: the template is shared and stays untouched', () => {
  it('does not change the template, and hands out fresh arrays on every call', () => {
    const b = brief('community');
    const snapshot = JSON.stringify(
      communityTemplate.vendors.map((v) => [v.id, v.label, v.bookByLeadDays, v.checklist]),
    );
    const first = vendorsFor(b);
    const second = vendorsFor(b);
    expect(
      JSON.stringify(
        communityTemplate.vendors.map((v) => [v.id, v.label, v.bookByLeadDays, v.checklist]),
      ),
    ).toBe(snapshot);
    for (const [i, item] of first.entries()) {
      const other = must(second[i], 'second result');
      expect(item.checklist).not.toBe(other.checklist);
      expect(item).not.toBe(other);
      const def = must(
        communityTemplate.vendors.find((v) => v.id === item.id),
        item.id,
      );
      expect(item.checklist).not.toBe(def.checklist);
    }
  });

  it('works on a deeply frozen template, so it never writes to one', () => {
    const frozen: EventTemplate = Object.freeze({
      ...communityTemplate,
      vendors: Object.freeze(
        communityTemplate.vendors.map((v) =>
          Object.freeze({ ...v, checklist: Object.freeze([...v.checklist]) }),
        ),
      ),
    });
    const b = brief('community');
    expect(requiredVendors(b, frozen, isoDate(b.date))).toEqual(vendorsFor(b));
  });
});

describe('VENDOR_STATUSES', () => {
  it('lists every VendorStatus once, in the order a vendor moves through them', () => {
    const typed: readonly VendorStatus[] = VENDOR_STATUSES;
    expect(typed).toEqual(['to_contact', 'quoted', 'booked']);
  });
});

describe('bookingStatus', () => {
  const base = vendorOf(vendorsFor(brief('community')), 'security_crowd');
  const due = (offsetDays: number, status: VendorStatus = 'to_contact'): VendorItem => ({
    ...base,
    bookBy: addDays(today, offsetDays),
    status,
  });
  const statusAt = (offsetDays: number, status: VendorStatus = 'to_contact') =>
    bookingStatus(due(offsetDays, status), today);

  it('is "ok" when the book-by date is more than 7 days away', () => {
    expect(statusAt(8)).toBe('ok');
    expect(statusAt(60)).toBe('ok');
  });

  it('is "due_soon" from 7 days out, through the book-by day itself', () => {
    expect(statusAt(7)).toBe('due_soon');
    expect(statusAt(1)).toBe('due_soon');
    expect(statusAt(0)).toBe('due_soon');
  });

  it('is "overdue" the day after the book-by date, and stays so', () => {
    expect(statusAt(-1)).toBe('overdue');
    expect(statusAt(-90)).toBe('overdue');
  });

  it('is "booked" once booked, however late the date', () => {
    expect(statusAt(-30, 'booked')).toBe('booked');
    expect(statusAt(0, 'booked')).toBe('booked');
    expect(statusAt(30, 'booked')).toBe('booked');
  });

  it('treats a quote like an open task: only booking stops the clock', () => {
    expect(statusAt(-1, 'quoted')).toBe('overdue');
    expect(statusAt(3, 'quoted')).toBe('due_soon');
    expect(statusAt(20, 'quoted')).toBe('ok');
  });

  it('uses the same window as the scheduler', () => {
    expect(DUE_SOON_DAYS).toBe(7);
  });

  it('moves with the day it is asked on: the same item ages from ok to due_soon to overdue', () => {
    const item = due(10);
    expect(bookingStatus(item, today)).toBe('ok');
    expect(bookingStatus(item, addDays(today, 3))).toBe('due_soon');
    expect(bookingStatus(item, addDays(today, 10))).toBe('due_soon');
    expect(bookingStatus(item, addDays(today, 11))).toBe('overdue');
  });
});

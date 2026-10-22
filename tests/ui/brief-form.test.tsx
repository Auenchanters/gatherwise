/**
 * RTL tests for the brief form (src/features/brief/brief-form.tsx) in jsdom.
 *
 * Does: checks that every control has an accessible name and optional fields say so; the GOV.UK
 * error summary (focus, links, aria-invalid and aria-describedby); the kind-dependent subtype and
 * community extras; the throttled counter announcements; `dir="auto"` on free text; sample briefs
 * submitting unchanged; unreadable numbers; and a keyboard-only completion. The checker loads on
 * demand, so it also covers the busy button, the slow-load notice, a failed load, a submit made
 * stale by an unmount, and StrictMode (loads are gated with `vi.doMock`).
 * Never does: read the clock (`today` is fixed), call the network, or sleep for a fixed time.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays } from '../../src/domain/dates.js';
import { BriefForm } from '../../src/features/brief/brief-form.js';
import { ChoiceGroup } from '../../src/features/brief/fields.js';
import { sampleBrief } from '../../src/features/brief/samples.js';
import { eventBriefSchema, type EventBrief } from '../../src/shared/schema.js';
import { descriptionOf } from '../support/ui.js';
import { TODAY as today } from '../support/fixtures.js';

const VALIDATE = '../../src/features/brief/validate.js';
const FAILED_LOAD =
  "We couldn't check your details — check your connection, then try again or reload the page.";

const submitButton = () => screen.getByRole('button', { name: 'Generate my plan' });
/** Waits until the on-demand checker has loaded and the submit has been handled. */
const settled = () =>
  waitFor(() => {
    expect(submitButton().getAttribute('aria-disabled')).toBeNull();
  });
/** Lets every pending dynamic import, and the code awaiting it, run to the end. */
const drained = async () => {
  await vi.dynamicImportSettled();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

function setup(initial?: EventBrief, { strict = false } = {}) {
  const onSubmit = vi.fn<(brief: EventBrief) => void>();
  const user = userEvent.setup();
  const form = <BriefForm initial={initial} today={today} onSubmit={onSubmit} />;
  const { unmount } = render(strict ? <StrictMode>{form}</StrictMode> : form);
  const submit = async () => {
    await user.click(submitButton());
    await settled();
  };
  /**
   * Submits with Enter from the name field, which does not warm the checker. A gated mock needs
   * exactly one import in flight: Vitest serves a second, concurrent import of a module whose mock
   * factory is still pending from the real module (browsers share one promise instead).
   */
  const submitWithEnter = async () => {
    await user.click(screen.getByRole('textbox', { name: 'Event name' }));
    await user.keyboard('{Enter}');
  };
  return { user, onSubmit, submit, submitWithEnter, unmount };
}

/** A checker load that waits for `release`; `loaded` settles once the module is ready. */
function gateChecker() {
  let release = (): void => undefined;
  let markLoaded = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const loaded = new Promise<void>((resolve) => {
    markLoaded = resolve;
  });
  vi.doMock(VALIDATE, async (importOriginal) => {
    await gate;
    const original = await importOriginal();
    markLoaded();
    return original;
  });
  return { release, loaded };
}

/** The polite live region that announces a field's character count, found by its id. */
function liveRegionOf(control: HTMLElement): HTMLElement {
  const region = document.getElementById(`${control.id}-announce`);
  if (region?.getAttribute('aria-live') !== 'polite')
    throw new Error(`No live count: ${control.id}`);
  return region;
}

afterEach(() => {
  vi.doUnmock(VALIDATE);
});

describe('BriefForm: structure', () => {
  it('gives every control an accessible name, community extras included', () => {
    setup(sampleBrief('community', today));
    const form = screen.getByRole('form', { name: 'Tell us about your event' });
    const roles = ['radio', 'checkbox', 'textbox', 'spinbutton', 'combobox'] as const;
    let named = 0;
    for (const role of roles) {
      const all = within(form).getAllByRole(role);
      expect(within(form).getAllByRole(role, { name: /\S/u }), role).toHaveLength(all.length);
      named += all.length;
    }
    // Date and time inputs have no ARIA role; they are found through their labels instead.
    expect(screen.getByLabelText('Date')).toBeTruthy();
    expect(screen.getByLabelText('Start time')).toBeTruthy();
    expect(form.querySelectorAll('input, select, textarea')).toHaveLength(named + 2);
  });

  it('says which fields are optional, and marks the rest required', () => {
    setup();
    const optional = [
      screen.getByRole('textbox', { name: 'City or town (optional)' }),
      screen.getByRole('textbox', { name: 'Vibe (optional)' }),
      screen.getByRole('textbox', { name: 'Notes (optional)' }),
      screen.getByRole('spinbutton', { name: 'Volunteers available (optional)' }),
    ];
    expect(optional.map((control) => control.hasAttribute('required'))).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(screen.getByRole('group', { name: 'Expected income (optional)' })).toBeTruthy();
    const required = [
      screen.getByRole('textbox', { name: 'Event name' }),
      screen.getByRole('spinbutton', { name: 'Guests' }),
      screen.getByRole('spinbutton', { name: 'Total budget' }),
      screen.getByRole('spinbutton', { name: 'Duration (hours)' }),
    ];
    expect(required.every((control) => control.hasAttribute('required'))).toBe(true);
  });

  it('groups the form into four sections named by their legends', () => {
    setup();
    for (const name of ['Your event', 'People and money', 'Preferences', 'Community extras']) {
      expect(screen.getByRole('group', { name })).toBeTruthy();
    }
  });

  it('bounds the native inputs with the schema limits and the planning window', () => {
    setup();
    const date = screen.getByLabelText('Date');
    expect(date.getAttribute('min')).toBe(today);
    expect(date.getAttribute('max')).toBe(addDays(today, 730));
    const guests = screen.getByRole('spinbutton', { name: 'Guests' });
    expect([guests.getAttribute('min'), guests.getAttribute('max')]).toEqual(['1', '5000']);
    const hours = screen.getByRole('spinbutton', { name: 'Duration (hours)' });
    expect([hours.getAttribute('min'), hours.getAttribute('max')]).toEqual(['1', '16']);
    expect(screen.getByRole('textbox', { name: 'Event name' }).getAttribute('maxlength')).toBe(
      '80',
    );
  });

  it('keeps dir="auto" on Hindi, Arabic and emoji text in every free-text field', async () => {
    const { user } = setup();
    const name = screen.getByRole('textbox', { name: 'Event name' });
    for (const text of ['दिवाली मेला 🎉', 'حفلة الحي']) {
      await user.clear(name);
      await user.type(name, text);
      expect(name).toHaveProperty('value', text);
      expect(name.getAttribute('dir')).toBe('auto');
    }
    for (const label of ['Vibe (optional)', 'Notes (optional)', 'City or town (optional)']) {
      expect(screen.getByRole('textbox', { name: label }).getAttribute('dir')).toBe('auto');
    }
  });

  it('tells money fields to use digits only', () => {
    setup();
    expect(descriptionOf(screen.getByRole('spinbutton', { name: 'Total budget' }))).toContain(
      'Digits only, like 150000.',
    );
    expect(descriptionOf(screen.getByRole('spinbutton', { name: 'Sponsorship' }))).toContain(
      'Digits only',
    );
  });
});

describe('BriefForm: kind-dependent fields', () => {
  it('shows community extras, including income, only for community events', async () => {
    const { user } = setup();
    expect(screen.getByRole('spinbutton', { name: 'Ticket price' })).toBeTruthy();
    for (const kind of ['Wedding', 'Birthday']) {
      await user.click(screen.getByRole('radio', { name: kind }));
      expect(screen.queryByRole('group', { name: 'Community extras' })).toBeNull();
      expect(screen.queryByRole('spinbutton', { name: 'Ticket price' })).toBeNull();
    }
    await user.click(screen.getByRole('radio', { name: 'Community event' }));
    const income = screen.getByRole('group', { name: 'Expected income (optional)' });
    expect(descriptionOf(income)).toContain('blanks count as 0');
    expect(within(income).getByRole('spinbutton', { name: 'Sponsorship' })).toBeTruthy();
  });

  it('resets the subtype to a valid one when the kind changes', async () => {
    const { user } = setup();
    const subtypes = () => within(screen.getByRole('group', { name: 'Type of event' }));
    expect(subtypes().getByRole('radio', { name: 'Festival or fair' })).toHaveProperty(
      'checked',
      true,
    );
    await user.click(screen.getByRole('radio', { name: 'Birthday' }));
    const values = subtypes()
      .getAllByRole('radio')
      .map((r) => r.getAttribute('value'));
    expect(values).toEqual(['kids', 'adult', 'milestone']);
    expect(subtypes().getByRole('radio', { name: "Kids' party" })).toHaveProperty('checked', true);
    // A wedding has one type, so it is stated rather than offered as a group of one radio.
    await user.click(screen.getByRole('radio', { name: 'Wedding' }));
    expect(screen.queryByRole('group', { name: 'Type of event' })).toBeNull();
    expect(screen.getByText('Type of event: Ceremony & reception')).toBeTruthy();
  });

  it('changes the venue and the currency from their lists', async () => {
    const { user, submit, onSubmit } = setup(sampleBrief('birthday', today));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Venue' }), 'restaurant');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Currency/u }), 'USD');
    await submit();
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ venue: 'restaurant', currency: 'USD' });
  });

  it('sets the language the AI writes in, says the labels stay English, and defaults to English', async () => {
    const { user, submit, onSubmit } = setup(sampleBrief('birthday', today));
    const language = screen.getByRole('combobox', { name: 'Language for AI suggestions' });
    expect(language).toHaveProperty('value', 'English');
    expect(descriptionOf(language)).toContain("The app's own labels stay in English.");
    await user.selectOptions(language, 'Hindi');
    await submit();
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ language: 'Hindi' });
  });

  it('keeps ticks in the options order, whatever order they were ticked in', async () => {
    const { user, submit, onSubmit } = setup(sampleBrief('birthday', today));
    await user.click(screen.getByRole('checkbox', { name: 'Vegan' }));
    await user.click(screen.getByRole('checkbox', { name: 'Halal' }));
    await submit();
    expect(onSubmit.mock.calls[0]?.[0].dietary).toEqual(['vegan', 'halal', 'nut_free']);
  });
});

describe('ChoiceGroup', () => {
  it('ties an error to the group, as the form does for any field it flags', () => {
    render(
      <ChoiceGroup
        legend="Kind of event"
        type="radio"
        name="kind"
        field="kind"
        error="Choose the kind of event"
        choices={[
          {
            id: 'kind-wedding',
            value: 'wedding',
            label: 'Wedding',
            checked: false,
            onChange: vi.fn(),
          },
        ]}
      />,
    );
    const group = screen.getByRole('group', { name: 'Kind of event' });
    expect(group.classList).toContain('field--error');
    expect(descriptionOf(group)).toBe('Error: Choose the kind of event');
    expect(within(group).getByRole('radio', { name: 'Wedding' })).toBeTruthy();
  });
});

describe('BriefForm: character counters', () => {
  it('describes the notes with a visible count and announces only at 20, 10 and 0 left', async () => {
    const { user } = setup();
    const notes = screen.getByRole('textbox', { name: 'Notes (optional)' });
    const live = liveRegionOf(notes);
    expect(descriptionOf(notes)).toContain('500 characters left');
    expect(live.textContent).toBe('');

    await user.click(notes);
    await user.paste('x'.repeat(479));
    expect(descriptionOf(notes)).toContain('21 characters left');
    expect(live.textContent).toBe('');
    await user.keyboard('x');
    expect(live.textContent).toBe('20 characters left');
    await user.keyboard('x');
    expect(live.textContent).toBe('');
    await user.paste('x'.repeat(9));
    expect(live.textContent).toBe('10 characters left');
    await user.paste('x'.repeat(10));
    expect(live.textContent).toBe('0 characters left');
    expect(descriptionOf(notes)).toContain('0 characters left');
  });

  it('counts the name and the vibe too, and says "1 character left" in the singular', async () => {
    const { user } = setup();
    const vibe = screen.getByRole('textbox', { name: 'Vibe (optional)' });
    await user.click(vibe);
    await user.paste('y'.repeat(119));
    expect(descriptionOf(vibe)).toContain('1 character left');
    expect(liveRegionOf(vibe).textContent).toBe('');
    expect(descriptionOf(screen.getByRole('textbox', { name: 'Event name' }))).toContain(
      '80 characters left',
    );
  });
});

describe('BriefForm: validation on submit', () => {
  it('does not validate until the form is submitted', async () => {
    const { user } = setup();
    await user.type(screen.getByRole('spinbutton', { name: 'Guests' }), '0');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('links a past date to its inline error through aria-describedby', async () => {
    const { submit, onSubmit } = setup({
      ...sampleBrief('community', today),
      date: addDays(today, -1),
    });
    await submit();
    const date = screen.getByLabelText('Date');
    expect(date.getAttribute('aria-invalid')).toBe('true');
    expect(descriptionOf(date)).toContain('Choose a date from today onwards');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects a budget of 0 with a specific message', async () => {
    const { user, submit, onSubmit } = setup(sampleBrief('birthday', today));
    const budget = screen.getByRole('spinbutton', { name: 'Total budget' });
    await user.clear(budget);
    await user.type(budget, '0');
    await submit();
    expect(budget.getAttribute('aria-invalid')).toBe('true');
    expect(descriptionOf(budget)).toContain('Enter a budget of at least 1');
    const summary = screen.getByRole('alert');
    expect(
      within(summary).getByRole('link', { name: 'Enter a budget of at least 1' }),
    ).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('says to use digits when the browser could not read a number', async () => {
    const { submit, onSubmit } = setup(sampleBrief('community', today));
    const sponsors = screen.getByRole('spinbutton', { name: 'Sponsorship' });
    // jsdom cannot type unreadable text into a number input, so report it as Chrome would.
    Object.defineProperty(sponsors, 'validity', { value: { badInput: true } });
    await submit();
    expect(descriptionOf(sponsors)).toContain('Enter the amount as digits only, like 150000');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('moves focus to the error summary, whose links focus the matching fields', async () => {
    const { user, submit } = setup();
    await submit();
    const summary = screen.getByRole('alert');
    expect(document.activeElement).toBe(summary);
    expect(within(summary).getByRole('heading', { name: "There's a problem" })).toBeTruthy();
    const links = within(summary).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual([
      'Enter the event name',
      'Enter the event date',
      'Enter the number of guests',
      'Enter a budget of at least 1',
    ]);
    for (const link of links) {
      await user.click(link);
      const target = link.getAttribute('href')?.slice(1) ?? '';
      expect(document.activeElement?.id).toBe(target);
      expect(document.activeElement?.getAttribute('aria-invalid')).toBe('true');
    }
  });

  it('clears the summary once a corrected form is submitted', async () => {
    const { user, submit, onSubmit } = setup({ ...sampleBrief('birthday', today), budget: 0 });
    await submit();
    expect(screen.getByRole('alert')).toBeTruthy();
    const budget = screen.getByRole('spinbutton', { name: 'Total budget' });
    await user.clear(budget);
    await user.type(budget, '15000');
    await submit();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(budget.getAttribute('aria-invalid')).toBeNull();
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

describe('BriefForm: samples', () => {
  it.each(['community', 'wedding', 'birthday'] as const)(
    'the %s sample fills a valid form that submits the same brief',
    async (kind) => {
      const sample = sampleBrief(kind, today);
      const { submit, onSubmit } = setup(sample);
      expect(screen.getByRole('textbox', { name: 'Event name' })).toHaveProperty(
        'value',
        sample.name,
      );
      await submit();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(onSubmit).toHaveBeenCalledExactlyOnceWith(sample);
      expect(eventBriefSchema.safeParse(onSubmit.mock.calls[0]?.[0]).success).toBe(true);
    },
  );
});

describe('BriefForm: keyboard only', () => {
  it('can be completed with Tab, arrow keys, Space and Enter', async () => {
    const { user, onSubmit } = setup();
    const tabTo = async (target: HTMLElement) => {
      for (let i = 0; i < 80 && document.activeElement !== target; i += 1) await user.tab();
      expect(document.activeElement).toBe(target);
    };

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Community event' }));
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Birthday' })).toHaveProperty('checked', true);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: "Kids' party" }));
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Adult' })).toHaveProperty('checked', true);

    await tabTo(screen.getByRole('textbox', { name: 'Event name' }));
    await user.keyboard('Mira turns 30');
    await tabTo(screen.getByLabelText('Date'));
    await user.keyboard('2026-12-05');
    await tabTo(screen.getByRole('spinbutton', { name: 'Guests' }));
    await user.keyboard('40');
    await tabTo(screen.getByRole('spinbutton', { name: 'Total budget' }));
    await user.keyboard('60000');
    await tabTo(screen.getByRole('checkbox', { name: 'Vegetarian' }));
    await user.keyboard(' ');
    await tabTo(screen.getByRole('checkbox', { name: 'Serving food' }));
    await user.keyboard(' ');
    await tabTo(submitButton());
    await user.keyboard('{Enter}');
    await settled();

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        kind: 'birthday',
        subtype: 'adult',
        name: 'Mira turns 30',
        date: '2026-12-05',
        guests: 40,
        budget: 60_000,
        dietary: ['vegetarian'],
        servesFood: true,
        volunteersAvailable: 0,
      }),
    );
  });
});

describe('BriefForm: loading the checker on demand', () => {
  it('marks the button busy, says it is checking when the load is slow, and submits once', async () => {
    const { release, loaded } = gateChecker();
    const { user, onSubmit, submitWithEnter } = setup(sampleBrief('birthday', today));
    await submitWithEnter();
    expect(submitButton().getAttribute('aria-disabled')).toBe('true');
    const status = screen.getByRole('status');
    await waitFor(() => {
      expect(status.textContent).toBe('Checking your details…');
    });
    await user.keyboard('{Enter}'); // a second submit while busy is ignored
    release();
    await loaded;
    await settled();
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(status.textContent).toBe('');
    expect(submitButton().getAttribute('aria-disabled')).toBeNull();
  });

  it('drops a submit whose form was unmounted while the checker loaded', async () => {
    const { release, loaded } = gateChecker();
    const { onSubmit, submitWithEnter, unmount } = setup(sampleBrief('community', today));
    await submitWithEnter();
    unmount();
    release();
    await loaded;
    await drained();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('says so when the checker cannot load, never throws, and works on a retry', async () => {
    vi.doMock(VALIDATE, () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    const { submit, submitWithEnter, onSubmit } = setup(sampleBrief('community', today));
    await submitWithEnter();
    await settled();
    const status = screen.getByRole('status');
    expect(status.textContent).toContain(FAILED_LOAD);
    expect(status.querySelector('[aria-hidden="true"]')?.textContent).toContain('⚠');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();

    vi.doUnmock(VALIDATE);
    await submit();
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(status.textContent).toBe('');
  });

  it('still submits under StrictMode, which mounts effects twice', async () => {
    const { submit, onSubmit } = setup(sampleBrief('birthday', today), { strict: true });
    await submit();
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

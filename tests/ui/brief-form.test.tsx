/**
 * RTL tests for the brief form (src/features/brief/brief-form.tsx) in jsdom.
 *
 * Does: checks every control is named, the GOV.UK error summary (focus, links, aria-invalid and
 * aria-describedby), the kind-dependent subtype and community extras, the throttled counter
 * announcements, `dir="auto"` on free text, sample briefs submitting unchanged, and a keyboard-only
 * completion with Tab, Space and arrow keys. The checker loads on demand, so it also covers the
 * slow-load notice, the busy button and a failed load (mocked with `vi.doMock`).
 * Never does: read the clock (`today` is fixed) or call the network.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, isoDate } from '../../src/domain/dates.js';
import { BriefForm } from '../../src/features/brief/brief-form.js';
import { sampleBrief } from '../../src/features/brief/samples.js';
import { eventBriefSchema, type EventBrief } from '../../src/shared/schema.js';

const today = isoDate('2026-10-21');
const VALIDATE = '../../src/features/brief/validate.js';

const submitButton = () => screen.getByRole('button', { name: 'Generate my plan' });
/** Waits until the on-demand checker has loaded and the submit has been handled. */
const settled = () =>
  waitFor(() => {
    expect(submitButton().getAttribute('aria-disabled')).toBeNull();
  });

function setup(initial?: EventBrief) {
  const onSubmit = vi.fn<(brief: EventBrief) => void>();
  const user = userEvent.setup();
  render(<BriefForm initial={initial} today={today} onSubmit={onSubmit} />);
  const form = screen.getByRole('form', { name: 'Tell us about your event' });
  const submit = async () => {
    await user.click(submitButton());
    await settled();
  };
  return { user, form, onSubmit, submit };
}

/** The text of every element an input's aria-describedby points at. */
function descriptionOf(element: HTMLElement): string {
  const ids = element.getAttribute('aria-describedby')?.split(' ') ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent ?? `#${id} missing`).join(' | ');
}

/** The polite live region that announces a field's character count. */
const liveRegionOf = (control: HTMLElement): HTMLElement => {
  const region = control.closest('.field')?.querySelector<HTMLElement>('[aria-live="polite"]');
  if (!region) throw new Error(`No live counter for ${control.id}`);
  return region;
};

describe('BriefForm: structure', () => {
  it('names every input, select and textarea, for the community form with its extras', () => {
    const { form } = setup(sampleBrief('community', today));
    const controls = form.querySelectorAll<HTMLInputElement>('input, select, textarea');
    expect(controls.length).toBeGreaterThan(40);
    for (const control of controls) {
      const label = control.labels?.[0]?.textContent.trim() ?? '';
      expect(label, control.outerHTML).not.toBe('');
    }
  });

  it('groups the form into four labelled sections', () => {
    const { form } = setup();
    const legends = [...form.querySelectorAll(':scope fieldset > legend')].map((l) =>
      l.textContent.trim(),
    );
    expect(legends).toEqual(
      expect.arrayContaining(['Your event', 'People and money', 'Preferences', 'Community extras']),
    );
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

  it('keeps dir="auto" on Hindi and emoji text in the name, vibe and notes', async () => {
    const { user } = setup();
    const name = screen.getByRole('textbox', { name: 'Event name' });
    await user.type(name, 'दिवाली मेला 🎉');
    expect(name).toHaveProperty('value', 'दिवाली मेला 🎉');
    expect(name.getAttribute('dir')).toBe('auto');
    for (const label of ['Vibe', 'Notes', 'City or town']) {
      expect(screen.getByRole('textbox', { name: label }).getAttribute('dir')).toBe('auto');
    }
  });
});

describe('BriefForm: kind-dependent fields', () => {
  it('shows community extras, including income, only for community events', async () => {
    const { user } = setup();
    expect(screen.getByRole('spinbutton', { name: 'Ticket price' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'Volunteers available' })).toBeTruthy();
    for (const kind of ['Wedding', 'Birthday']) {
      await user.click(screen.getByRole('radio', { name: kind }));
      expect(screen.queryByRole('group', { name: 'Community extras' })).toBeNull();
      expect(screen.queryByRole('spinbutton', { name: 'Ticket price' })).toBeNull();
    }
    await user.click(screen.getByRole('radio', { name: 'Community event' }));
    const income = screen.getByRole('group', { name: 'Expected income' });
    expect(descriptionOf(income)).toContain('blanks count as 0');
    expect(within(income).getByRole('spinbutton', { name: 'Sponsorship' })).toBeTruthy();
  });

  it('resets the subtype to a valid one when the kind changes', async () => {
    const { user } = setup();
    const subtypes = () => screen.getByRole('group', { name: 'Type of event' });
    expect(within(subtypes()).getByRole('radio', { name: 'Festival or fair' })).toHaveProperty(
      'checked',
      true,
    );
    await user.click(screen.getByRole('radio', { name: 'Birthday' }));
    const birthday = within(subtypes()).getAllByRole('radio');
    expect(birthday.map((r) => r.getAttribute('value'))).toEqual(['kids', 'adult', 'milestone']);
    expect(within(subtypes()).getByRole('radio', { name: "Kids' party" })).toHaveProperty(
      'checked',
      true,
    );
    await user.click(screen.getByRole('radio', { name: 'Wedding' }));
    expect(within(subtypes()).getByRole('radio', { name: 'Ceremony & reception' })).toHaveProperty(
      'checked',
      true,
    );
  });
});

describe('BriefForm: character counters', () => {
  it('describes the notes field with a visible count and announces only at 20, 10 and 0 left', async () => {
    const { user } = setup();
    const notes = screen.getByRole('textbox', { name: 'Notes' });
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
    const vibe = screen.getByRole('textbox', { name: 'Vibe' });
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
  it.each(['community', 'birthday'] as const)(
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
      const submitted = onSubmit.mock.calls[0]?.[0];
      expect(eventBriefSchema.safeParse(submitted).success).toBe(true);
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
  afterEach(() => {
    vi.doUnmock(VALIDATE);
  });

  it('marks the button busy, says it is checking when the load is slow, and submits once', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.doMock(VALIDATE, async (importOriginal) => {
      await gate;
      return importOriginal();
    });
    const { user, onSubmit } = setup(sampleBrief('birthday', today));
    await user.click(submitButton());
    expect(submitButton().getAttribute('aria-disabled')).toBe('true');
    const status = await screen.findByRole('status');
    await waitFor(() => {
      expect(status.textContent).toBe('Checking your details…');
    });
    await user.click(submitButton()); // ignored while busy
    release();
    await settled();
    // Give a second, unguarded check time to land before asserting there was only one.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(status.textContent).toBe('');
  });

  it('says so when the checker cannot load, never throws, and works on a retry', async () => {
    vi.doMock(VALIDATE, () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    const { submit, onSubmit } = setup(sampleBrief('community', today));
    await submit();
    expect(screen.getByRole('status').textContent).toBe(
      "We couldn't load the form checker — check your connection and try again.",
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();

    vi.doUnmock(VALIDATE);
    await submit();
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toBe('');
  });
});

/**
 * Contract tests for src/shared/result.ts.
 *
 * Does: checks both constructors and that the `ok` discriminant narrows to `value` or `error`.
 * Never does: exercise anything beyond the two constructors; the module owns nothing else.
 */
import { describe, expect, it } from 'vitest';
import { err, ok, type Result } from '../../src/shared/result';

/** Reads each branch through the discriminant, so a broken union fails to compile. */
const show = (result: Result<number, string>): string =>
  result.ok ? `value:${result.value}` : `error:${result.error}`;

describe('Result', () => {
  it('ok wraps a value', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('err wraps an error', () => {
    expect(err('boom')).toEqual({ ok: false, error: 'boom' });
  });

  it('narrows on .ok', () => {
    expect(show(ok(1))).toBe('value:1');
    expect(show(err('nope'))).toBe('error:nope');
  });
});

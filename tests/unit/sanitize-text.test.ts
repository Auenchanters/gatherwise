/**
 * Text sanitizing for brief text going into the prompt and model text coming out.
 * Does: pins the tag, control-character, whitespace and code-point-cap rules.
 */
import { describe, expect, it } from 'vitest';
import { sanitizeText } from '../../src/shared/sanitize-text.js';

describe('sanitizeText', () => {
  it('strips an HTML payload and a bell character', () => {
    expect(sanitizeText('<img src=x onerror=alert(1)>Hi\u0007', 50)).toBe('Hi');
  });

  it('replaces whole tags with a space and drops any stray angle bracket', () => {
    expect(sanitizeText('<script>alert(1)</script>Party', 50)).toBe('alert(1) Party');
    expect(sanitizeText('a < b > c', 50)).toBe('a b c');
    expect(sanitizeText('<b unterminated', 50)).toBe('b unterminated');
  });

  it('removes control, lone-surrogate and bidi-override characters but keeps newlines', () => {
    expect(sanitizeText('a\u0000b\u001b[31mc\u007f\u0085d', 50)).toBe('ab[31mcd');
    expect(sanitizeText('line one\nline two', 50)).toBe('line one\nline two');
    expect(sanitizeText('\u202Egnp.exe\u202C', 50)).toBe('gnp.exe');
    expect(sanitizeText('x\uD800y', 50)).toBe('xy');
  });

  it('removes invisible Unicode tag characters (ASCII smuggling), even inside a flag emoji', () => {
    const smuggled = `Hi${String.fromCodePoint(0xe0049, 0xe0047, 0xe004e, 0xe007f)} there`;
    expect(sanitizeText(smuggled, 50)).toBe('Hi there');
    // The cost: a subdivision flag (England = black flag + tag letters) degrades to a plain black flag.
    const england = String.fromCodePoint(
      0x1f3f4,
      0xe0067,
      0xe0062,
      0xe0065,
      0xe006e,
      0xe0067,
      0xe007f,
    );
    expect(sanitizeText(england, 50)).toBe(String.fromCodePoint(0x1f3f4));
  });

  it('collapses whitespace runs, keeping one newline where a run contained one', () => {
    expect(sanitizeText('  many   spaces\t\there  ', 50)).toBe('many spaces here');
    expect(sanitizeText('first \r\n\n\n  second', 50)).toBe('first\nsecond');
  });

  it('caps by code points, never splitting a surrogate pair', () => {
    expect(sanitizeText('abcdef', 3)).toBe('abc');
    expect(sanitizeText('🎉🎂🎈🎁', 2)).toBe('🎉🎂');
    expect(Array.from(sanitizeText('x'.repeat(500), 80))).toHaveLength(80);
    expect(sanitizeText('ab   cd', 3)).toBe('ab');
  });

  it('keeps emoji, joiners and non-Latin scripts intact', () => {
    const text = 'दिवाली मेला 🎉 حفلة 👩‍👩‍👧 தீபாவளி';
    expect(sanitizeText(text, 100)).toBe(text);
  });
});

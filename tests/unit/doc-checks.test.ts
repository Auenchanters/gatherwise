/**
 * Tests for scripts/doc-checks.ts, the documentation checks behind `npm run preflight`.
 * Does: pin which inline-code spans and link targets count as repo paths (and which are skipped:
 * URLs, anchors, routes, globs, fenced code, generated folders), how a path is matched against the
 * git index, the README's four headings and the live-link test.
 * Never does: read files or run git; every input is a literal.
 */
import { describe, expect, it } from 'vitest';
import {
  docPaths,
  hasLiveUrl,
  missingHeadings,
  missingPaths,
  REQUIRED_HEADINGS,
} from '../../scripts/doc-checks.js';

describe('docPaths: inline code', () => {
  it('takes file paths and folders written with a trailing slash, from the repo root', () => {
    const md = 'See `src/domain/merge.ts`, `docs/adr/`, `vercel.json` and `./README.md`.';
    expect(docPaths(md, 'docs/TESTING.md')).toEqual([
      'src/domain/merge.ts',
      'docs/adr',
      'vercel.json',
      'README.md',
    ]);
  });

  it.each([
    ['a command', '`npm run dev`'],
    ['an environment variable', '`GEMINI_API_KEY`'],
    ['a MIME type', '`text/calendar`'],
    ['a route', '`/api/plan`'],
    ['a glob', '`api/*.ts`'],
    ['a method call', '`crypto.randomUUID`'],
    ['a bare extension', '`.ics`'],
    ['a URL', '`https://example.com/a.md`'],
    ['a folder without a trailing slash', '`src/domain`'],
    ['an unknown extension', '`.env.local`'],
    ['a model id', '`gemini-3.5-flash-lite`'],
  ])('skips %s', (_name, md) => {
    expect(docPaths(md, 'README.md')).toEqual([]);
  });
});

describe('docPaths: links', () => {
  it('resolves relative targets from the Markdown file and strips anchors and queries', () => {
    const md = [
      '[merge](../../src/domain/merge.ts)',
      '[layers](../TESTING.md#layers)',
      '[query](./0002-x.md?plain=1)',
      '![diagram](img/flow.svg "A title")',
      '[wrapped](<../KNOWN-LIMITATIONS.md>)',
    ].join('\n');
    expect(docPaths(md, 'docs/adr/0001-x.md')).toEqual([
      'src/domain/merge.ts',
      'docs/TESTING.md',
      'docs/adr/0002-x.md',
      'docs/adr/img/flow.svg',
      'docs/KNOWN-LIMITATIONS.md',
    ]);
  });

  it('keeps a target that climbs out of the repo, so it is reported missing', () => {
    expect(docPaths('[out](../../outside.md)', 'docs/a.md')).toEqual(['../outside.md']);
  });

  it.each([
    ['an https URL', '[site](https://gatherwise.vercel.app)'],
    ['a mailto link', '[mail](mailto:someone@example.com)'],
    ['a protocol-relative URL', '[cdn](//cdn.example.com/x.js)'],
    ['a site-root link', '[route](/api/health)'],
    ['a bare anchor', '[top](#top)'],
    ['a glob', '[all](src/*.ts)'],
  ])('skips %s', (_name, md) => {
    expect(docPaths(md, 'README.md')).toEqual([]);
  });
});

describe('docPaths: what is never read', () => {
  it('skips fenced code blocks, backticks and tildes alike', () => {
    const md = [
      '```sh',
      'cat `missing/one.ts`',
      '[two](missing/two.md)',
      '```',
      '~~~',
      '`missing/three.ts`',
      '~~~',
      'After: `src/app.tsx`',
    ].join('\n');
    expect(docPaths(md, 'README.md')).toEqual(['src/app.tsx']);
  });

  it('skips generated folders and lists each path once', () => {
    const md = '`dist/robots.txt` `coverage/` [x](dist/index.html) `api/plan.ts` `api/plan.ts`';
    expect(docPaths(md, 'README.md')).toEqual(['api/plan.ts']);
  });
});

describe('missingPaths', () => {
  const tracked = ['README.md', 'src/domain/merge.ts', 'docs/adr/0001-x.md'];

  it('accepts tracked files and folders that hold one', () => {
    expect(missingPaths(['README.md', 'src/domain/merge.ts', 'src', 'docs/adr'], tracked)).toEqual(
      [],
    );
  });

  it('reports files and folders the index does not hold', () => {
    expect(missingPaths(['src/domain/merged.ts', 'docs/ad', '../outside.md'], tracked)).toEqual([
      'src/domain/merged.ts',
      'docs/ad',
      '../outside.md',
    ]);
  });
});

describe('missingHeadings', () => {
  it('passes a README with all four headings, CRLF and trailing spaces included', () => {
    const readme = ['# Title', ...REQUIRED_HEADINGS.map((h) => `${h}  `), ''].join('\r\n');
    expect(missingHeadings(readme)).toEqual([]);
  });

  it('names each heading that is missing or at the wrong level', () => {
    const readme = '## Chosen Vertical\n### Approach and Logic\n## How the solution works\n';
    expect(missingHeadings(readme)).toEqual([
      '## Approach and Logic',
      '## How the Solution Works',
      '## Assumptions Made',
    ]);
  });
});

describe('hasLiveUrl', () => {
  it.each([
    ['**Live demo:** https://gatherwise.vercel.app', true],
    ['[Live demo](https://gatherwise-abc123.vercel.app/)', true],
    ['**Live demo:** _link added after the first deploy_', false],
    ['http://gatherwise.vercel.app', false],
    ['https://gatherwise.vercel.app.example.com', false],
    ['https://example.com/gatherwise.vercel.app', false],
  ])('%s → %s', (readme, expected) => {
    expect(hasLiveUrl(readme)).toBe(expected);
  });
});

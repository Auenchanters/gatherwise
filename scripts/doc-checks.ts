/**
 * The documentation checks behind `npm run preflight` (scripts/preflight.mjs), kept free of git and
 * the console so tests/unit/doc-checks.test.ts can pin them. Node runs this file directly (type
 * stripping), so it uses only erasable TypeScript.
 * Does: list the repo paths a Markdown file names, report the ones the git index does not hold,
 * check the README's four required headings and look for a live deployment link.
 * Never does: read files, run git or print.
 *
 * What counts as a path, kept small so prose never trips it:
 * - a relative link or image target, resolved from the Markdown file's folder, without its
 *   `#anchor` or `?query`. URLs (any `scheme:`), `//host` and site-root `/…` links, bare `#anchors`
 *   and globs are skipped;
 * - an inline-code span that is path-shaped (only letters, digits, `_`, `.`, `-` and `/`, so URLs,
 *   globs, `/api/…` routes and anything with a space are skipped) and either ends in a known file
 *   extension or ends with `/` (a folder). Inline-code paths are read from the repo root.
 * Fenced code blocks are skipped, and so are paths under generated folders such as `dist/`.
 */
import { posix } from 'node:path';

/** The headings the README must carry, word for word. */
export const REQUIRED_HEADINGS = [
  '## Chosen Vertical',
  '## Approach and Logic',
  '## How the Solution Works',
  '## Assumptions Made',
] as const;

const FENCE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gmu;
const INLINE_CODE = /`([^`\n]+)`/gu;
/** `[text](target)` or `![alt](target)`; the target may be `<wrapped>` and followed by a title. */
const LINK = /!?\[[^\]\n]*\]\(\s*(<[^>\n]*>|[^)\s]+)[^)\n]*\)/gu;
const SCHEME = /^[a-z][a-z\d+.-]*:/iu;
const GLOB = /[*{}[\]]/u;
const PATH_SHAPED = /^[\w.-]+(?:\/[\w.-]+)*\/?$/u;
const FILE_NAME = /\w\.(?:ts|tsx|mts|js|mjs|cjs|json|md|html|css|yml|yaml|toml|txt|ics|svg)$/u;
const GENERATED =
  /^(?:node_modules|dist|coverage|artifacts|test-results|playwright-report|\.vercel)\//u;
const LIVE_URL = /https:\/\/(?:[a-z\d-]+\.)+vercel\.app(?![\w.-])/iu;

/** A link target as a repo path from `file`'s folder, or `undefined` when it is not a file link. */
function linkPath(target: string, file: string): string | undefined {
  const unwrapped = target.replace(/^<|>$/gu, '');
  const bare = unwrapped.replace(/[#?].*$/u, '');
  if (bare === '' || GLOB.test(bare) || SCHEME.test(unwrapped) || unwrapped.startsWith('/')) {
    return undefined;
  }
  return posix.normalize(posix.join(posix.dirname(file), bare));
}

/** Whether an inline-code span names a repo file or folder rather than a command, route or word. */
const isCodePath = (span: string): boolean =>
  PATH_SHAPED.test(span) && (FILE_NAME.test(span) || span.endsWith('/'));

/**
 * The repo-relative paths `markdown` names, in order and without repeats. `file` is the Markdown
 * file's own repo path, which relative links are resolved from.
 */
export function docPaths(markdown: string, file: string): string[] {
  const text = markdown.replace(FENCE, '');
  const fromLinks = [...text.matchAll(LINK)].flatMap(([, target = '']) => {
    const path = linkPath(target, file);
    return path === undefined ? [] : [path];
  });
  const fromCode = [...text.matchAll(INLINE_CODE)].flatMap(([, span = '']) =>
    isCodePath(span) ? [posix.normalize(span)] : [],
  );
  const paths = [...fromLinks, ...fromCode].map((path) => path.replace(/\/$/u, ''));
  return [...new Set(paths)].filter((path) => !GENERATED.test(`${path}/`));
}

/** The paths in `paths` that are neither a tracked file nor a folder holding one. */
export function missingPaths(paths: readonly string[], tracked: readonly string[]): string[] {
  const files = new Set(tracked);
  return paths.filter(
    (path) => !files.has(path) && !tracked.some((file) => file.startsWith(`${path}/`)),
  );
}

/** The required headings `readme` does not have as a line of its own. */
export function missingHeadings(readme: string): string[] {
  const lines = new Set(readme.split(/\r?\n/u).map((line) => line.trimEnd()));
  return REQUIRED_HEADINGS.filter((heading) => !lines.has(heading));
}

/** Whether `readme` links a live deployment at `https://….vercel.app`. */
export const hasLiveUrl = (readme: string): boolean => LIVE_URL.test(readme);

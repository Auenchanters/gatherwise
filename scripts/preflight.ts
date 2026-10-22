/**
 * Verify the size, branch, file-hygiene and documentation gates before publishing.
 * The Markdown checks are pure functions in doc-checks.ts (unit-tested).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { docPaths, hasLiveUrl, missingHeadings, missingPaths } from './doc-checks.js';

const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf8' });
const split = (text: string, separator: string): string[] => text.split(separator).filter(Boolean);

// git commands are relative to the working directory, so cover the whole repo from anywhere.
process.chdir(git('rev-parse', '--show-toplevel').trim());

// Everything below inspects the git index (what would be committed), never the working tree,
// so a file staged and then deleted or edited on disk cannot slip past a check. -z keeps
// non-ASCII paths unquoted.
const tracked = split(git('ls-files', '-z'), '\0');
if (tracked.length === 0) {
  throw new Error('No tracked project files. Stage the project files before preflight.');
}

const checks: { readonly name: string; readonly passed: boolean }[] = [];
const verify = (name: string, passed: boolean): void => {
  checks.push({ name, passed });
  process.stdout.write(`${passed ? 'PASS' : 'FAIL'} ${name}\n`);
};

// Gitlinks and unmerged entries report "-" instead of a size, which counts as 0.
const totalBytes = split(git('ls-files', '--format=%(objectsize)'), '\n')
  .map(Number)
  .reduce((sum, size) => sum + (Number.isInteger(size) ? size : 0), 0);
verify(
  `Tracked repository files under 10 MB (${totalBytes.toLocaleString('en-US')} bytes)`,
  totalBytes < 10_000_000,
);

verify(
  'Generated assets and credentials are not tracked',
  !tracked.some(
    (file) =>
      /^(node_modules|dist|coverage|\.vercel|test-results|playwright-report)\//u.test(file) ||
      (/(^|\/)\.env/u.test(file) && file.split('/').at(-1) !== '.env.example'),
  ),
);

// POSIX ERE for `git grep`. -a scans binary blobs too (a key can hide in a .wasm or SQLite
// file) and -l prints file names only, so a leaked key is never echoed here.
// git grep exits 1 when nothing matches; any other status (a match, or git failing) fails.
const secretPattern = 'AIza[0-9A-Za-z_-]{35}|AQ[.][A-Za-z0-9_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY';
const grepArgs = ['-c', 'core.quotepath=false', 'grep', '--cached', '-a', '-l', '-E', '-e'];
const secretScan = spawnSync('git', [...grepArgs, secretPattern], { encoding: 'utf8' });
verify('No known credential signatures in tracked files', secretScan.status === 1);
if (secretScan.status === 0) {
  process.stdout.write(`  matched in: ${secretScan.stdout.trim()}\n`);
} else if (secretScan.status !== 1) {
  const reason = secretScan.error?.message ?? secretScan.stderr.trim();
  process.stdout.write(`  git grep failed (status ${String(secretScan.status)}): ${reason}\n`);
}

// Remote-tracking refs are what this clone knows about; run `git fetch --prune` first.
// Full ref names are used because `--format=%(refname:short)` prints a bare remote name for
// refs/remotes/<remote>/HEAD.
const remotes = split(git('remote'), '\n');
if (remotes.length > 0) {
  const remoteRefs = split(git('for-each-ref', '--format=%(refname)', 'refs/remotes'), '\n');
  const isRemoteRef = (ref: string, name: string): boolean =>
    remotes.some((remote) => ref === `refs/remotes/${remote}/${name}`);
  verify(
    'No remote branches other than main',
    remoteRefs.every((ref) => isRemoteRef(ref, 'HEAD') || isRemoteRef(ref, 'main')),
  );
}

// The docs as staged: every path they name must exist, and the README needs its four headings.
const staged = (file: string): string => git('show', `:${file}`);
const docs = tracked.filter((file) => file.endsWith('.md'));
const missing = docs.flatMap((file) =>
  missingPaths(docPaths(staged(file), file), tracked).map((path) => `${file}: ${path}`),
);
verify(
  `Every repo path named in the ${String(docs.length)} tracked Markdown files exists`,
  missing.length === 0,
);
for (const line of missing) process.stdout.write(`  missing ${line}\n`);

const readme = tracked.includes('README.md') ? staged('README.md') : '';
const headings = missingHeadings(readme);
verify('README has the four required headings', headings.length === 0);
for (const heading of headings) process.stdout.write(`  missing heading: ${heading}\n`);

verify('README links the live demo (https://….vercel.app)', hasLiveUrl(readme));

if (checks.some((check) => !check.passed)) process.exitCode = 1;

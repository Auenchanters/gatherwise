/** Verify the public-submission size, branch and file-hygiene gates before publishing. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const split = (text, separator) => text.split(separator).filter(Boolean);

// -z keeps non-ASCII paths unquoted. Files deleted from the working tree are still tracked by
// name but have no content to measure or scan.
const tracked = split(git('ls-files', '-z'), '\0');
if (tracked.length === 0) {
  throw new Error('No tracked project files. Stage the submission before preflight.');
}
const present = tracked.filter((file) => existsSync(file));

const checks = [];
const verify = (name, passed) => {
  checks.push({ name, passed });
  process.stdout.write(`${passed ? 'PASS' : 'FAIL'} ${name}\n`);
};

const totalBytes = present.reduce((sum, file) => sum + statSync(file).size, 0);
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

const secretPattern =
  /(?:AIza[0-9A-Za-z_-]{35}|AQ\.[A-Za-z0-9_-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/u;
verify(
  'No known credential signatures in tracked files',
  present.every((file) => !secretPattern.test(readFileSync(file, 'utf8'))),
);

// Remote-tracking refs are what this clone knows about; run `git fetch --prune` first.
// Full ref names are used because `--format=%(refname:short)` prints a bare remote name for
// refs/remotes/<remote>/HEAD.
const remotes = split(git('remote'), '\n');
if (remotes.length > 0) {
  const remoteRefs = split(git('for-each-ref', '--format=%(refname)', 'refs/remotes'), '\n');
  const isRemoteRef = (ref, name) =>
    remotes.some((remote) => ref === `refs/remotes/${remote}/${name}`);
  verify(
    'No remote branches other than main',
    remoteRefs.every((ref) => isRemoteRef(ref, 'HEAD') || isRemoteRef(ref, 'main')),
  );
}

if (checks.some((check) => !check.passed)) process.exitCode = 1;

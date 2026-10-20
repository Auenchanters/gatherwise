/** Verify the public-submission size, branch and file-hygiene gates before publishing. */
import { execFileSync, spawnSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const split = (text, separator) => text.split(separator).filter(Boolean);

// Everything below inspects the git index (what would be committed), never the working tree,
// so a file staged and then deleted or edited on disk cannot slip past a check. -z keeps
// non-ASCII paths unquoted.
const tracked = split(git('ls-files', '-z'), '\0');
if (tracked.length === 0) {
  throw new Error('No tracked project files. Stage the submission before preflight.');
}

const checks = [];
const verify = (name, passed) => {
  checks.push({ name, passed });
  process.stdout.write(`${passed ? 'PASS' : 'FAIL'} ${name}\n`);
};

// Gitlinks and unmerged entries report "-" instead of a size.
const totalBytes = split(git('ls-files', '--format=%(objectsize)'), '\n').reduce(
  (sum, size) => sum + (Number(size) || 0),
  0,
);
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

// POSIX ERE for `git grep`. -l prints file names only, so a leaked key is never echoed here.
// git grep exits 1 when nothing matches; any other status (a match, or git failing) fails.
const secretPattern =
  'AIza[0-9A-Za-z_-]{35}|AQ[.][A-Za-z0-9_-]{30,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----';
const grepArgs = ['-c', 'core.quotepath=false', 'grep', '--cached', '-I', '-l', '-E', '-e'];
const secretScan = spawnSync('git', [...grepArgs, secretPattern], { encoding: 'utf8' });
verify('No known credential signatures in tracked files', secretScan.status === 1);
if (secretScan.status === 0) process.stdout.write(`  matched in: ${secretScan.stdout.trim()}\n`);

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

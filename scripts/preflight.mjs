/** Verify the public-submission size, branch and file-hygiene gates before publishing. */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const lines = (text) => text.split('\n').filter(Boolean);

const tracked = lines(git('ls-files'));
if (tracked.length === 0) {
  throw new Error('No tracked project files. Stage the submission before preflight.');
}

const checks = [];
const verify = (name, passed) => {
  checks.push({ name, passed });
  process.stdout.write(`${passed ? 'PASS' : 'FAIL'} ${name}\n`);
};

const totalBytes = tracked.reduce((sum, file) => sum + statSync(file).size, 0);
verify(
  `Tracked repository files under 10 MB (${totalBytes.toLocaleString('en-US')} bytes)`,
  totalBytes < 10_000_000,
);

verify(
  'Generated assets and credentials are not tracked',
  !tracked.some(
    (file) =>
      /^(node_modules|dist|coverage|\.vercel|test-results|playwright-report)\//u.test(file) ||
      (/^\.env/u.test(file) && file !== '.env.example'),
  ),
);

const secretPattern =
  /(?:AIza[0-9A-Za-z_-]{35}|AQ\.[A-Za-z0-9_-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/u;
verify(
  'No known credential signatures in tracked files',
  tracked.every((file) => !secretPattern.test(readFileSync(file, 'utf8'))),
);

// Remote-tracking refs are what this clone knows about; run `git fetch --prune` first.
if (lines(git('remote')).length > 0) {
  const remoteBranches = lines(git('branch', '--remotes', '--format=%(refname:short)')).filter(
    (name) => !name.endsWith('/HEAD'),
  );
  verify(
    'No remote branches other than main',
    remoteBranches.every((name) => name.endsWith('/main')),
  );
}

if (checks.some((check) => !check.passed)) process.exitCode = 1;

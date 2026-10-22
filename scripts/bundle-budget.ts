/**
 * First-page weight gate, run by `npm run build` after `vite build`.
 * Does: finds the entry chunk named by dist/index.html, lists every JS chunk with its raw and gzip
 * size, and fails when the entry exceeds 250 kB raw or 80 kB gzip (kB = 1000 bytes, as Vite
 * prints). Lazy chunks (validation, the plan workspace) are listed but not limited.
 * Never does: build anything or change files.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

/** A chunk's size in bytes, as served and as gzipped. */
interface Size {
  readonly raw: number;
  readonly gzip: number;
}

const LIMITS: Size = { raw: 250_000, gzip: 80_000 };
const kB = (bytes: number): string => `${(bytes / 1000).toFixed(2)} kB`;
const fail = (reason: string): never => {
  process.stderr.write(`FAIL bundle budget: ${reason}\n`);
  process.exit(1);
};

const entry =
  /<script\b[^>]*\bsrc="\/?(assets\/[^"]+\.js)"/u.exec(
    readFileSync('dist/index.html', 'utf8'),
  )?.[1] ?? fail('no entry <script src="assets/….js"> in dist/index.html');

let entrySize: Size | undefined;
const chunks = readdirSync('dist/assets').filter((file) => file.endsWith('.js'));
for (const name of chunks.sort()) {
  const code = readFileSync(`dist/assets/${name}`);
  const size: Size = { raw: code.length, gzip: gzipSync(code).length };
  const isEntry = `assets/${name}` === entry;
  if (isEntry) entrySize = size;
  process.stdout.write(
    `${isEntry ? 'entry' : 'lazy '}  ${name}  ${kB(size.raw)} raw  ${kB(size.gzip)} gzip\n`,
  );
}
const { raw, gzip } = entrySize ?? fail(`${entry} is named by dist/index.html but missing`);

const summary =
  `entry ${kB(raw)} raw (limit ${kB(LIMITS.raw)}), ` +
  `${kB(gzip)} gzip (limit ${kB(LIMITS.gzip)})`;
if (raw > LIMITS.raw || gzip > LIMITS.gzip) fail(summary);
process.stdout.write(`PASS bundle budget: ${summary}\n`);

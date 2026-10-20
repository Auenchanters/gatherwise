/**
 * Architecture boundary for the pure domain engine (src/domain).
 *
 * Does: asserts domain files import only from inside src/domain (plus `import type` from
 * src/shared, and runtime imports of the import-free modules on RUNTIME_SHARED_ALLOWLIST) and never
 * mention non-deterministic or I/O APIs. The checkers are pure functions over (path, source) so
 * they are themselves tested against synthetic bad input.
 * Never does: parse anything but imports and forbidden tokens; those rules live in ESLint/tsc.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { posix, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const DOMAIN_DIR = 'src/domain';
const SHARED_DIR = 'src/shared';
/** Shared modules domain code may import at runtime; both must stay free of imports. */
const RUNTIME_SHARED_ALLOWLIST = ['src/shared/limits', 'src/shared/result'];
const FORBIDDEN_TOKENS = ['Date.now', 'Math.random', 'fetch(', 'localStorage'];

/** Repo-relative POSIX paths of every .ts/.tsx file under `dir` (empty if it does not exist). */
function sourceFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .map((entry) => posix.join(dir, entry.split(sep).join('/')))
      .filter((file) => /\.tsx?$/u.test(file));
  } catch {
    return [];
  }
}

/** Every module specifier a file loads, flagged when the statement is purely type-level. */
function moduleReferences(source: string): { specifier: string; typeOnly: boolean }[] {
  const refs: { specifier: string; typeOnly: boolean }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      refs.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword,
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      refs.push({ specifier: node.moduleSpecifier.text, typeOnly: node.isTypeOnly });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      refs.push({ specifier: node.arguments[0].text, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true));
  return refs;
}

const isInside = (dir: string, path: string): boolean => path === dir || path.startsWith(`${dir}/`);

/**
 * Imports in `file` (repo-relative) that leave src/domain, excluding type imports from src/shared and allowlisted modules.
 * A trailing `.js` is dropped first: Node ESM needs it on disk, but it names the same module.
 */
function boundaryViolations(file: string, source: string): string[] {
  return moduleReferences(source)
    .filter(({ specifier, typeOnly }) => {
      if (!specifier.startsWith('.')) return true;
      const target = posix
        .normalize(posix.join(posix.dirname(file), specifier))
        .replace(/\.js$/u, '');
      return !(
        isInside(DOMAIN_DIR, target) ||
        (typeOnly && isInside(SHARED_DIR, target)) ||
        RUNTIME_SHARED_ALLOWLIST.includes(target)
      );
    })
    .map(({ specifier }) => specifier);
}

/** Forbidden tokens present anywhere in the text, comments included. */
const forbiddenTokens = (source: string): string[] =>
  FORBIDDEN_TOKENS.filter((token) => source.includes(token));

describe('domain boundary', () => {
  const files = sourceFiles(DOMAIN_DIR);

  it('has no runtime imports outside src/domain', () => {
    for (const file of files) {
      expect(boundaryViolations(file, readFileSync(file, 'utf8')), file).toEqual([]);
    }
  });

  it('never touches Date.now, Math.random, fetch or localStorage', () => {
    for (const file of files) {
      expect(forbiddenTokens(readFileSync(file, 'utf8')), file).toEqual([]);
    }
  });
});

describe('runtime allowlist for src/shared', () => {
  it.each(RUNTIME_SHARED_ALLOWLIST)(
    '%s has no imports, so it cannot be a back door to zod',
    (module) => {
      expect(moduleReferences(readFileSync(`${module}.ts`, 'utf8')), module).toEqual([]);
    },
  );
});

describe('boundary checker', () => {
  const file = 'src/domain/templates/community.ts';

  it('allows imports that stay inside src/domain and type-only imports from src/shared', () => {
    const source = [
      "import { addMinor } from '../money';",
      "import './sibling';",
      "import type { EventBrief } from '../../shared/schema';",
      "export type { Result } from '../../shared/result';",
    ].join('\n');
    expect(boundaryViolations(file, source)).toEqual([]);
  });

  it.each([
    ['a package', "import { z } from 'zod';", 'zod'],
    ['a node builtin', "import { readFileSync } from 'node:fs';", 'node:fs'],
    [
      'a runtime import from shared',
      "import { schema } from '../../shared/schema';",
      '../../shared/schema',
    ],
    [
      'an inline type modifier (still a runtime import)',
      "import { type X } from '../../shared/schema';",
      '../../shared/schema',
    ],
    ['a type import from a package', "import type { ZodType } from 'zod';", 'zod'],
    [
      'a type import from the server',
      "import type { Handler } from '../../../server/handler';",
      '../../../server/handler',
    ],
    [
      'a runtime re-export from shared',
      "export * from '../../shared/schema';",
      '../../shared/schema',
    ],
    ['a dynamic import', "const m = await import('../../features/ui');", '../../features/ui'],
    ['a require call', "const fs = require('fs');", 'fs'],
    [
      'a path that climbs out of the domain',
      "import { a } from '../../../outside';",
      '../../../outside',
    ],
  ])('flags %s', (_name, source, specifier) => {
    expect(boundaryViolations(file, source)).toEqual([specifier]);
  });

  it('allows runtime imports of the dependency-free shared modules, and flags the rest', () => {
    const domainFile = 'src/domain/budget.ts';
    expect(boundaryViolations(domainFile, "import { LIMITS } from '../shared/limits';")).toEqual(
      [],
    );
    expect(boundaryViolations(domainFile, "import { ok } from '../shared/result';")).toEqual([]);
    expect(
      boundaryViolations(domainFile, "import { eventBriefSchema } from '../shared/schema';"),
    ).toEqual(['../shared/schema']);
    expect(
      boundaryViolations(domainFile, "import type { EventBrief } from '../shared/schema';"),
    ).toEqual([]);
  });

  it('treats explicit .js specifiers (Node ESM) exactly like extensionless ones', () => {
    const domainFile = 'src/domain/plan.ts';
    const allowed = [
      "import { minor } from './money.js';",
      "import { templateFor } from './templates/index.js';",
      "import { LIMITS } from '../shared/limits.js';",
      "import { ok } from '../shared/result.js';",
      "import type { EventBrief } from '../shared/schema.js';",
    ].join('\n');
    expect(boundaryViolations(domainFile, allowed)).toEqual([]);
    const flagged = [
      "import { eventBriefSchema } from '../shared/schema.js';",
      "import type { Handler } from '../../server/handler.js';",
      "import { z } from 'zod';",
    ].join('\n');
    expect(boundaryViolations(domainFile, flagged)).toEqual([
      '../shared/schema.js',
      '../../server/handler.js',
      'zod',
    ]);
  });

  it.each(FORBIDDEN_TOKENS)('flags %s even inside a comment', (token) => {
    expect(forbiddenTokens(`// do not use ${token}`)).toEqual([token]);
  });

  it('passes clean source', () => {
    expect(forbiddenTokens('export const add = (a: number, b: number): number => a + b;')).toEqual(
      [],
    );
  });

  it('finds source files recursively and tolerates a missing directory', () => {
    expect(sourceFiles('tests/unit')).toContain('tests/unit/architecture.test.ts');
    expect(sourceFiles('does/not/exist')).toEqual([]);
  });
});

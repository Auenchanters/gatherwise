/**
 * Architecture boundaries: the layer order of the whole codebase, and the stricter rule for the
 * pure domain engine (src/domain).
 *
 * Does: asserts every layer imports only from itself and the layers below it (LAYERS), so the
 * import graph between folders has no cycles; asserts domain files import only from inside
 * src/domain (plus `import type` from src/shared, and runtime imports of the import-free modules on
 * RUNTIME_SHARED_ALLOWLIST) and never mention non-deterministic or I/O APIs. The checkers are pure
 * functions over (path, source) so they are themselves tested against synthetic bad input.
 * Never does: parse anything but imports and forbidden tokens; those rules live in ESLint/tsc.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { posix, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const DOMAIN_DIR = 'src/domain';
const SHARED_DIR = 'src/shared';
/** Shared modules domain code may import at runtime; both must stay free of imports. */
const RUNTIME_SHARED_ALLOWLIST = ['src/shared/limits', 'src/shared/result', 'src/shared/cap-text'];
/**
 * The layers, lowest first, and the folders each may import from besides itself. Nothing imports
 * upwards: shared, then the domain engine, then the AI prompt and the UI wording, then the
 * features, with the server beside them. The domain's finer rule is checked separately below.
 */
const LAYERS = {
  'src/shared': [],
  'src/domain': ['src/shared'],
  'src/ai': ['src/shared', 'src/domain'],
  'src/ui': ['src/shared', 'src/domain'],
  'src/features/client': ['src/shared', 'src/domain', 'src/ai'],
  'src/features/brief': ['src/shared', 'src/domain', 'src/ui'],
  'src/features/plan': [
    'src/shared',
    'src/domain',
    'src/ai',
    'src/ui',
    'src/features/brief',
    'src/features/client',
  ],
  server: ['src/shared', 'src/domain', 'src/ai'],
} as const satisfies Record<string, readonly string[]>;
/** What domain code may not mention, by name: the clock, randomness, I/O and storage. */
const FORBIDDEN_TOKENS = new Map([
  ['Date.now', /Date\.now/u],
  ['Math.random', /Math\.random/u],
  ['fetch(', /fetch\(/u],
  ['localStorage', /localStorage/u],
  // `new Date(x)` parses or formats a given value; with no argument it reads the clock.
  ['new Date()', /new Date\(\s*\)/u],
]);

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
 * Imports in `file` (repo-relative) that leave src/domain, excluding type imports from src/shared
 * and allowlisted modules.
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

/** Relative imports in `file`, which belongs to `layer`, that reach a folder it may not use. */
function layerViolations(
  file: string,
  source: string,
  layer: string,
  allowed: readonly string[],
): string[] {
  return moduleReferences(source)
    .filter(({ specifier }) => {
      if (!specifier.startsWith('.')) return false;
      const target = posix.normalize(posix.join(posix.dirname(file), specifier));
      return !isInside(layer, target) && !allowed.some((dir) => isInside(dir, target));
    })
    .map(({ specifier }) => specifier);
}

/** Forbidden tokens present anywhere in the text, comments included. */
const forbiddenTokens = (source: string): string[] =>
  [...FORBIDDEN_TOKENS].filter(([, pattern]) => pattern.test(source)).map(([name]) => name);

describe('layer order', () => {
  it.each(Object.entries(LAYERS))('%s imports only from itself and %j', (layer, allowed) => {
    const files = sourceFiles(layer);
    expect(files.length, layer).toBeGreaterThan(0);
    for (const file of files) {
      expect(layerViolations(file, readFileSync(file, 'utf8'), layer, allowed), file).toEqual([]);
    }
  });

  it('flags an import that climbs to a higher layer, type-only or not', () => {
    const brief = 'src/features/brief';
    expect(
      layerViolations(
        `${brief}/validate.ts`,
        "import { formatCount } from '../plan/format.js';",
        brief,
        LAYERS[brief],
      ),
    ).toEqual(['../plan/format.js']);
    expect(
      layerViolations(
        'src/shared/prompt.ts',
        "import type { Plan } from '../domain/plan.js';",
        'src/shared',
        LAYERS['src/shared'],
      ),
    ).toEqual(['../domain/plan.js']);
  });

  it('allows packages, the layer itself and the layers below it', () => {
    const source = [
      "import { z } from 'zod';",
      "import { a } from './sibling.js';",
      "import { b } from '../../ui/format.js';",
      "import type { Plan } from '../../domain/plan.js';",
    ].join('\n');
    const brief = 'src/features/brief';
    expect(layerViolations(`${brief}/form.tsx`, source, brief, LAYERS[brief])).toEqual([]);
  });
});

describe('domain boundary', () => {
  const files = sourceFiles(DOMAIN_DIR);

  it('scans the domain files, so the checks below cannot pass on an empty list', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('has no runtime imports outside src/domain', () => {
    for (const file of files) {
      expect(boundaryViolations(file, readFileSync(file, 'utf8')), file).toEqual([]);
    }
  });

  it('never reads the clock, randomness, the network or storage', () => {
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

  it.each([...FORBIDDEN_TOKENS.keys()])('flags %s even inside a comment', (token) => {
    expect(forbiddenTokens(`// do not use ${token}`)).toEqual([token]);
  });

  it('flags an argument-less Date however it is spaced, and allows one given a value', () => {
    expect(forbiddenTokens('const now = new Date(  );')).toEqual(['new Date()']);
    expect(forbiddenTokens('const day = new Date(0); const t = new Date(time);')).toEqual([]);
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

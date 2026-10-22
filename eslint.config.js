/** Strict typed linting, accessible JSX and hook rules are enforced for application code. */
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';

export default defineConfig(
  {
    // Suppression comments are banned outright: they are ignored and reported if present.
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
  },
  {
    ignores: [
      'dist/**',
      'coverage/**',
      '.vercel/**',
      'artifacts/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      jsxA11y.flatConfigs.strict,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': true, 'ts-ignore': true, 'ts-nocheck': true, 'ts-check': true },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // The strict preset allows no exceptions here. The WAI-ARIA tabs pattern makes each tabpanel
    // focusable (jsx-a11y's recommended preset allows that role too), and a scrollable <pre>
    // must be focusable so keyboard users can scroll it (axe: scrollable-region-focusable).
    files: ['src/**/*.tsx'],
    rules: {
      'jsx-a11y/no-noninteractive-tabindex': ['error', { tags: ['pre'], roles: ['tabpanel'] }],
    },
  },
  {
    // No type assertions anywhere, tests included; `as const` stays allowed by this rule.
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    },
  },
  {
    // The request log is the one place server code writes routine lines, at info level.
    files: ['server/log.ts'],
    rules: { 'no-console': ['error', { allow: ['info', 'warn', 'error'] }] },
  },
  {
    // Plain Node scripts have no type information; only the baseline rules apply.
    files: ['scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { process: 'readonly', Request: 'readonly' } },
  },
);

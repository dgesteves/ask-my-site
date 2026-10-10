import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// The example app is linted by its own `lint` script, after it is built: type-aware rules need
// the package's dist types, the generated index and Next's route types, which a fresh clone lacks.
// It reuses this file, and from its directory the `examples/**` ignore no longer matches.
export default defineConfig(
  globalIgnores([
    '**/dist',
    '**/coverage',
    '**/.next',
    '**/next-env.d.ts',
    'bench/results',
    'test/fixtures',
    'examples/**',
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            '*.js',
            '*.mjs',
            'bench/*.mjs',
            'scripts/*.mjs',
            'scripts/assets/*.mjs',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // An empty string means "missing" wherever `||` is used on strings here.
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        { ignorePrimitives: { string: true } },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // packages/ only re-exports entries of the package, whose types exist once it is built.
    files: ['**/*.{js,mjs}', 'packages/*/index.d.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['**/*.tsx', 'src/react/**/*.ts'],
    extends: [reactHooks.configs.flat['recommended-latest']],
  },
  {
    files: ['test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  prettier,
);

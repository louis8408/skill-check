import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';

export default defineConfig(
  { ignores: ['plugin/dist/**', 'dist-test/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  sonarjs.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['*.js', '*.cjs', 'scripts/*.mjs', 'bin/*.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'sonarjs/cognitive-complexity': ['error', 15],
      // Mirror SonarCloud rules that eslint-plugin-sonarjs doesn't include, so they fail locally first.
      'no-await-in-loop': 'error', // S9382
      '@typescript-eslint/prefer-optional-chain': 'error', // S6582
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: { module: 'writable', require: 'readonly', process: 'readonly', console: 'readonly' } },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      'sonarjs/no-hardcoded-ip': 'off',
      'sonarjs/publicly-writable-directories': 'off',
      'sonarjs/no-clear-text-protocols': 'off',
    },
  },
);

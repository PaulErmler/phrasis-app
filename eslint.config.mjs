import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginReact from 'eslint-plugin-react';
import { defineConfig } from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import convexPlugin from '@convex-dev/eslint-plugin';
// Disables every stylistic rule Prettier owns; formatting is enforced
// separately via `pnpm format:check` (CI) and lint-staged.
import eslintConfigPrettier from 'eslint-config-prettier';

export default defineConfig([
  ...nextTypescript,
  ...nextCoreWebVitals,
  ...convexPlugin.configs.recommended,

  // Global ignores - separate block
  {
    ignores: [
      'node_modules/**',
      'convex/_generated/**',
      '.next/**',
      '.convex/**',
      '.claude/worktrees/**',
      'dist/**',
      'build/**',
      'out/**',
      'public/**',
      '*.min.js',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },

  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    plugins: { js },
    extends: ['js/recommended'],
    languageOptions: {
      globals: {
        ...globals.browser,
        React: 'readonly',
      },
    },
  },

  // Backend files (Convex)
  {
    files: ['convex/**/*.{js,ts}'],
    languageOptions: {
      globals: {
        ...globals.node,
        process: 'readonly',
      },
    },
  },

  tseslint.configs.recommended,

  {
    plugins: { react: pluginReact },
    rules: {
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'import/no-anonymous-default-export': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },

  // Tests and vendored AI-SDK UI scaffolding: `any` and plain `<img>` are
  // acceptable there.
  {
    files: [
      'tests/**',
      'convex/tests/**',
      '**/*.test.{ts,tsx,js,jsx}',
      'components/ai-elements/**',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@next/next/no-img-element': 'off',
    },
  },

  // Last on purpose: turns off every stylistic rule Prettier owns, so lint
  // and formatter can't disagree.
  eslintConfigPrettier,
]);

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginReact from 'eslint-plugin-react';
import { defineConfig } from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import convexPlugin from '@convex-dev/eslint-plugin';

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
      'dist/**',
      'build/**',
      'out/**',
      'public/**',
      '*.min.js',
      'coverage/**',
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
      'import/no-anonymous-default-export': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      // Add indentation rules
      indent: ['error', 2], // 2-space indentation for all files
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
]);

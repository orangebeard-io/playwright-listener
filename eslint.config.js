const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const importX = require('eslint-plugin-import-x');
const { createTypeScriptImportResolver } = require('eslint-import-resolver-typescript');
const prettierRecommended = require('eslint-plugin-prettier/recommended');
const globals = require('globals');

// Flat config for ESLint 9 (replaces .eslintrc/.eslintignore, which ESLint 9 no longer reads).
// Same rule set as @orangebeard-io/javascript-client; Prettier formatting is enforced through
// eslint-plugin-prettier, so `npm run format:js` fixes it.
module.exports = tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'eslint.config.js', 'jest.config.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  prettierRecommended,
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver()],
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-redeclare': 'off',
    },
  },
  {
    files: ['**/*.test.ts'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
);

// Lives at the repo root, not in web/, so graphql-eslint can see the
// operations in both web/ and shared/ and check them against the backend
// schema (see graphql.config.yml).
import js from '@eslint/js'
import graphql from '@graphql-eslint/eslint-plugin'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', 'web/src/generated/**', '.claude/worktrees/**'],
  },

  {
    files: ['web/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: globals.browser,
    },
    // Only the classic hook rules. The plugin's recommended set also turns on
    // React Compiler diagnostics, which misfire on refs read inside callbacks
    // (AuthProvider) and only matter once the compiler is adopted.
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    files: ['*.{js,ts}', 'web/*.{js,ts}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Client operations: must be valid against backend/graphql/schema.graphql.
  {
    files: ['web/src/**/*.graphql', 'shared/src/**/*.graphql'],
    languageOptions: { parser: graphql.parser },
    plugins: { '@graphql-eslint': graphql },
    rules: graphql.configs['flat/operations-recommended'].rules,
  },

  // The schema itself: correctness only, not the opinionated style rules.
  {
    files: ['backend/graphql/schema.graphql'],
    languageOptions: { parser: graphql.parser },
    plugins: { '@graphql-eslint': graphql },
    rules: {
      '@graphql-eslint/known-type-names': 'error',
      '@graphql-eslint/unique-field-definition-names': 'error',
      '@graphql-eslint/unique-operation-types': 'error',
      '@graphql-eslint/unique-type-names': 'error',
      '@graphql-eslint/unique-enum-value-names': 'error',
      '@graphql-eslint/known-directives': 'error',
      '@graphql-eslint/known-argument-names': 'error',
      '@graphql-eslint/provided-required-arguments': 'error',
    },
  },

  // Last, so Prettier owns formatting and ESLint only reports bugs.
  prettier,
)

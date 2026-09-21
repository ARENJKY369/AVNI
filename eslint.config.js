// The repo shipped `npm run lint` with no config and no eslint dependency, so
// the command could not run and nothing was checking for the class of bug that
// undefined identifiers belong to — an unimported helper reached the browser as
// a ReferenceError instead of failing on the bench. This config is deliberately
// about correctness, not style: rules that find real defects, warnings that are
// worth reading.
import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**', 'coverage/**', 'shots/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    settings: { react: { version: 'detect' } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      // correctness
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-cond-assign': ['error', 'except-parens'],
      'no-self-assign': 'error',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-fallthrough': 'error',
      'no-useless-escape': 'warn',
      'no-prototype-builtins': 'warn',
      'no-unsafe-negation': 'error',
      'no-async-promise-executor': 'error',
      // second wave: rules that find defects rather than style. All of these are
      // silent on the current tree, so anything they report from here on is new.
      'array-callback-return': 'error',
      'no-unsafe-optional-chaining': 'error',
      'no-constant-binary-expression': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'error',
      'no-unmodified-loop-condition': 'error',
      'radix': 'error',
      'default-param-last': 'error',
      'no-useless-catch': 'error',
      'no-duplicate-imports': 'error',
      'no-loss-of-precision': 'error',
      'no-loop-func': 'warn',
      'require-atomic-updates': 'off',
      'react/jsx-no-duplicate-props': 'error',
      'react/jsx-key': 'warn',
      // JSX usage counts as usage, or every component import reads as dead code
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'off',
      'react/jsx-no-undef': 'error',
      'react/no-children-prop': 'error',
      'react/no-unescaped-entities': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    files: ['**/*.test.js', 'src/test/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  }
];

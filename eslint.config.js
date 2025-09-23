/* ESLint configuration for drunk-pulumi-azure-components */
module.exports = {
  root: true,
  ignorePatterns: [
    'node_modules/',
    'bin/',
    'coverage/',
    'dist/',
    '*.d.ts',
    'pulumi-test/node_modules/',
    'pulumi-test/coverage/',
  ],
  env: {
    es2022: true,
    node: true,
    jest: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: ['./tsconfig.json', './pulumi-test/tsconfig.json'],
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint', 'import', 'jest', 'unused-imports'],
  settings: {
    'import/resolver': {
      typescript: {
        project: ['./tsconfig.json', './pulumi-test/tsconfig.json'],
      },
    },
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'plugin:jest/recommended',
  ],
  rules: {
    'no-console': 'off',
    eqeqeq: ['error', 'smart'],
    curly: ['error', 'all'],
    'object-shorthand': ['error', 'always'],
    'prefer-const': ['error', { destructuring: 'all' }],
    'no-trailing-spaces': 'error',
    'eol-last': ['error', 'always'],
    'spaced-comment': ['error', 'always', { markers: ['/'] }],

    'import/order': [
      'error',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
    'import/no-unresolved': 'error',
    'import/newline-after-import': ['error', { count: 1 }],

    'unused-imports/no-unused-imports': 'error',
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],

    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
    '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/restrict-template-expressions': [
      'warn',
      { allowAny: true, allowBoolean: true, allowNumber: true },
    ],

    '@typescript-eslint/member-delimiter-style': [
      'error',
      {
        multiline: { delimiter: 'semi', requireLast: true },
        singleline: { delimiter: 'semi', requireLast: false },
      },
    ],
  },
  overrides: [
    {
      files: ['**/__tests__/**', 'pulumi-test/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-floating-promises': 'off',
      },
    },
    {
      files: ['bin/**/*.js'],
      env: { node: true },
      rules: {
        'import/no-unresolved': 'off',
        'unused-imports/no-unused-imports': 'off',
      },
    },
  ],
};

/* eslint-env node */
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2022
  },
  rules: {
    'no-empty': ['error', { allowEmptyCatch: true }],
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
  },
  ignorePatterns: ['node_modules/', 'database/', 'public/uploads/', 'public/js/**'],
  overrides: [
    {
      files: ['public/**/*.js'],
      env: {
        browser: true,
        node: false
      },
      parserOptions: {
        sourceType: 'script'
      },
      globals: {
        IntersectionObserver: 'readonly'
      }
    }
  ]
};

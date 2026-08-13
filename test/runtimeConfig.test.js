const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRuntimeConfig } = require('../lib/runtimeConfig');

const validProduction = {
  NODE_ENV: 'production',
  BASE_URL: 'https://blog.example.com',
  SESSION_SECRET: 'a-secure-random-session-secret-123',
  ADMIN_PASSWORD: 'a-secure-admin-password',
  SESSION_COOKIE_SECURE: 'true',
  TRUST_PROXY: '1'
};

test('accepts a complete production configuration', () => {
  assert.deepEqual(validateRuntimeConfig(validProduction), {
    isProd: true,
    baseUrl: 'https://blog.example.com',
    trustProxy: 1
  });
});

test('rejects insecure or placeholder production configuration', () => {
  assert.throws(() => validateRuntimeConfig({
    ...validProduction,
    BASE_URL: 'http://blog.example.com',
    SESSION_SECRET: 'change-this-to-a-long-random-string',
    SESSION_COOKIE_SECURE: 'false'
  }), /BASE_URL must use HTTPS[\s\S]*SESSION_SECRET[\s\S]*SESSION_COOKIE_SECURE/);
});

test('allows development without production-only values', () => {
  assert.deepEqual(validateRuntimeConfig({ NODE_ENV: 'development' }), {
    isProd: false,
    baseUrl: '',
    trustProxy: false
  });
});

test('requires an explicit bounded proxy setting in production', () => {
  assert.throws(() => validateRuntimeConfig({
    ...validProduction,
    TRUST_PROXY: 'true'
  }), /TRUST_PROXY/);
});

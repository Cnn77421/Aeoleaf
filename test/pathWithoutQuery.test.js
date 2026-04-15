const { test } = require('node:test');
const assert = require('node:assert');
const { pathWithoutQuery } = require('../lib/pathWithoutQuery');

test('removes query string', () => {
  assert.strictEqual(
    pathWithoutQuery({ originalUrl: '/blog?page=2', url: '' }),
    '/blog'
  );
});

test('removes trailing slash except root', () => {
  assert.strictEqual(
    pathWithoutQuery({ originalUrl: '/works/', url: '' }),
    '/works'
  );
  assert.strictEqual(pathWithoutQuery({ originalUrl: '/', url: '' }), '/');
});

test('falls back to url', () => {
  assert.strictEqual(
    pathWithoutQuery({ originalUrl: undefined, url: '/api/search?q=a' }),
    '/api/search'
  );
});

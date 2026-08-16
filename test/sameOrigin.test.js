const test = require('node:test');
const assert = require('node:assert/strict');
const { requireSameOrigin } = require('../middleware/sameOrigin');

function invoke({
  method = 'POST',
  origin = '',
  referer = '',
  fetchSite = '',
  csrfToken = '',
  sessionToken = ''
} = {}) {
  const req = {
    method,
    protocol: 'https',
    body: { _csrf: csrfToken },
    session: sessionToken ? { csrfToken: sessionToken } : {},
    get(name) {
      return {
        origin,
        referer,
        host: 'blog.example.com',
        'sec-fetch-site': fetchSite
      }[name.toLowerCase()] || '';
    }
  };
  let statusCode = 200;
  let body = null;
  let nextCalled = false;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; }
  };
  requireSameOrigin(req, res, () => { nextCalled = true; });
  return { statusCode, body, nextCalled };
}

test('allows same-origin writes and rejects cross-site or originless writes', () => {
  assert.equal(invoke({ origin: 'https://blog.example.com' }).nextCalled, true);
  assert.equal(invoke({ referer: 'https://blog.example.com/admin/posts' }).nextCalled, true);
  assert.equal(invoke({ origin: 'https://evil.example' }).statusCode, 403);
  assert.equal(invoke().statusCode, 403);
});

test('uses browser fetch metadata only when origin headers are absent', () => {
  assert.equal(invoke({ fetchSite: 'same-origin' }).nextCalled, true);
  assert.equal(invoke({ fetchSite: 'same-site' }).statusCode, 403);
  assert.equal(invoke({ fetchSite: 'cross-site' }).statusCode, 403);
  assert.equal(invoke({
    origin: 'https://evil.example',
    fetchSite: 'same-origin'
  }).statusCode, 403);
});

test('allows a valid CSRF token when browser origin metadata is unavailable', () => {
  const token = 'test-session-token';
  assert.equal(invoke({ csrfToken: token, sessionToken: token }).nextCalled, true);
  assert.equal(invoke({ csrfToken: 'wrong', sessionToken: token }).statusCode, 403);
  assert.equal(invoke({ csrfToken: token }).statusCode, 403);
});

test('does not require origin validation for safe methods', () => {
  assert.equal(invoke({ method: 'GET' }).nextCalled, true);
});

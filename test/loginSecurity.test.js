const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { getLoginState, recordFailure, clearFailures, initializeSession, MAX_FAILURES } = require('../lib/loginSecurity');

function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('CREATE TABLE admin_login_attempts (ip TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, last_failure_at INTEGER NOT NULL DEFAULT 0)');
  const db = { prepare(sql) { const statement = raw.prepare(sql); return { get: (...args) => statement.get(...args), run: (...args) => statement.run(...args) }; } };
  const req = { ip: '127.0.0.1', get: (name) => name === 'user-agent' ? 'Test Browser' : '', session: {} };
  return { raw, db, req };
}

test('locks repeated login failures and clears state after success', () => {
  const { raw, db, req } = setup();
  const now = 1_000_000;
  for (let i = 0; i < MAX_FAILURES; i += 1) recordFailure(db, req, now + i);
  assert.equal(getLoginState(db, req, now + MAX_FAILURES).locked, true);
  clearFailures(db, req);
  assert.equal(getLoginState(db, req, now + MAX_FAILURES).failures, 0);
  raw.close();
});

test('initializes traceable session security metadata', () => {
  const { raw, req } = setup();
  initializeSession(req);
  assert.equal(req.session.admin, true);
  assert.equal(req.session.security.ip, '127.0.0.1');
  assert.equal(req.session.security.userAgent, 'Test Browser');
  assert.ok(req.session.security.authenticatedAt > 0);
  raw.close();
});

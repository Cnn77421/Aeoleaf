const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

function getLoginState(db, req, now = Date.now()) {
  const ip = clientIp(req);
  const row = db.prepare('SELECT * FROM admin_login_attempts WHERE ip = ?').get(ip);
  return { ip, failures: Number(row?.failures) || 0, lockedUntil: Number(row?.locked_until) || 0, locked: Number(row?.locked_until) > now };
}

function recordFailure(db, req, now = Date.now()) {
  const state = getLoginState(db, req, now);
  const failures = state.failures + 1;
  const lockedUntil = failures >= MAX_FAILURES ? now + LOCK_MS : 0;
  db.prepare(`INSERT INTO admin_login_attempts (ip, failures, locked_until, last_failure_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(ip) DO UPDATE SET failures=excluded.failures, locked_until=excluded.locked_until, last_failure_at=excluded.last_failure_at`)
    .run(state.ip, failures, lockedUntil, now);
  return { ...state, failures, lockedUntil, locked: lockedUntil > now };
}

function clearFailures(db, req) {
  db.prepare('DELETE FROM admin_login_attempts WHERE ip = ?').run(clientIp(req));
}

function initializeSession(req) {
  const now = Date.now();
  req.session.admin = true;
  req.session.security = {
    createdAt: now,
    lastSeenAt: now,
    authenticatedAt: now,
    ip: clientIp(req),
    userAgent: String(req.get('user-agent') || '').slice(0, 1000)
  };
}

module.exports = { MAX_FAILURES, LOCK_MS, clientIp, getLoginState, recordFailure, clearFailures, initializeSession };

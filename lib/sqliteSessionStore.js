const session = require('express-session');

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function expiresAt(sessionData, now = Date.now()) {
  const expires = sessionData?.cookie?.expires;
  if (expires) {
    const timestamp = new Date(expires).getTime();
    if (Number.isFinite(timestamp)) return timestamp;
  }
  const maxAge = Number(sessionData?.cookie?.maxAge);
  return now + (Number.isFinite(maxAge) && maxAge > 0 ? maxAge : DEFAULT_TTL_MS);
}

class SQLiteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this.cleanupTimer = setInterval(() => this.clearExpired(), 15 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  get(sid, callback) {
    try {
      const row = this.db.prepare('SELECT data, expires_at FROM admin_sessions WHERE sid = ?').get(sid);
      if (!row) return callback(null, null);
      if (Number(row.expires_at) <= Date.now()) {
        this.db.prepare('DELETE FROM admin_sessions WHERE sid = ?').run(sid);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.data));
    } catch (err) {
      return callback(err);
    }
  }

  set(sid, sessionData, callback = () => {}) {
    try {
      const now = Date.now();
      const security = sessionData?.security || {};
      this.db.prepare(`
        INSERT INTO admin_sessions (sid, data, expires_at, created_at, last_seen_at, ip, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET
          data = excluded.data, expires_at = excluded.expires_at,
          last_seen_at = excluded.last_seen_at, ip = excluded.ip, user_agent = excluded.user_agent
      `).run(sid, JSON.stringify(sessionData), expiresAt(sessionData), Number(security.createdAt) || now,
        Number(security.lastSeenAt) || now, String(security.ip || ''), String(security.userAgent || '').slice(0, 1000));
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      this.db.prepare('DELETE FROM admin_sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  touch(sid, sessionData, callback = () => {}) {
    try {
      const security = sessionData?.security || {};
      this.db.prepare('UPDATE admin_sessions SET expires_at = ?, last_seen_at = ?, ip = ?, user_agent = ? WHERE sid = ?')
        .run(expiresAt(sessionData), Number(security.lastSeenAt) || Date.now(), String(security.ip || ''), String(security.userAgent || '').slice(0, 1000), sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  clearExpired(callback = () => {}) {
    try {
      this.db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(Date.now());
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  close() {
    clearInterval(this.cleanupTimer);
  }
}

module.exports = { SQLiteSessionStore, expiresAt };

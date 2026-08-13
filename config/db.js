// Database layer backed by Node's built-in node:sqlite (Node >= 22.5).
// Replaces the previous sql.js (in-memory + debounced full-file dump) engine:
// writes now persist immediately via WAL, survive crashes, and no longer hold
// the whole database in JS memory. The public surface of this module is
// unchanged — callers still use `db.prepare(sql).get/all/run(...params)`,
// `db.transaction(fn)`, and the visitor-analytics helpers below.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const defaultDbPath = path.join(__dirname, '../database', 'aeoleaf.db');
const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : defaultDbPath;
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

// `rawDb` is the native DatabaseSync handle. We keep a separate `dbWrapper`
// (exported as `db`) so the rest of the codebase keeps the old call style.
let rawDb = null;

// Back-compat no-ops. The sql.js engine needed explicit dumps to disk; the
// native engine persists on every write, so these just resolve/return.
function saveDBSync() { /* native engine persists immediately */ }
async function flushDB() {
  if (rawDb) rawDb.exec('PRAGMA wal_checkpoint(PASSIVE)');
}

function closeDB() {
  if (!rawDb) return;
  rawDb.close();
  rawDb = null;
}

function initDB() {
  rawDb = new DatabaseSync(dbPath);

  // WAL gives durable, concurrent-reader-friendly writes. NORMAL sync is the
  // standard WAL pairing: safe across app crashes, only at risk on OS/power
  // loss (acceptable for a blog; bump to FULL if you want maximum safety).
  rawDb.exec('PRAGMA journal_mode = WAL');
  rawDb.exec('PRAGMA synchronous = NORMAL');
  rawDb.exec('PRAGMA foreign_keys = ON');

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      excerpt TEXT DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      cover_image TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published')),
      views INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
    CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);

    CREATE TABLE IF NOT EXISTS works (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      content TEXT DEFAULT '',
      cover_image TEXT DEFAULT '',
      images TEXT DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      url TEXT DEFAULT '',
      year INTEGER,
      date TEXT DEFAULT '',
      featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_works_slug ON works(slug);
    CREATE INDEX IF NOT EXISTS idx_works_featured ON works(featured);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      sid TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS visitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint_id TEXT NOT NULL,
      session_id TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      tracked_at INTEGER NOT NULL,
      full_url TEXT DEFAULT '',
      path TEXT DEFAULT '',
      query_string TEXT DEFAULT '',
      referer TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      device_type TEXT DEFAULT '',
      os_name TEXT DEFAULT '',
      os_version TEXT DEFAULT '',
      browser_name TEXT DEFAULT '',
      browser_version TEXT DEFAULT '',
      country TEXT DEFAULT '',
      province TEXT DEFAULT '',
      city TEXT DEFAULT '',
      isp TEXT DEFAULT '',
      screen_resolution TEXT DEFAULT '',
      viewport_size TEXT DEFAULT '',
      device_pixel_ratio REAL DEFAULT 1,
      language TEXT DEFAULT '',
      timezone TEXT DEFAULT '',
      cookie_enabled INTEGER NOT NULL DEFAULT 0,
      incognito INTEGER NOT NULL DEFAULT 0,
      network_type TEXT DEFAULT '',
      device_memory REAL DEFAULT 0,
      cpu_cores INTEGER DEFAULT 0,
      canvas_fp TEXT DEFAULT '',
      webgl_fp TEXT DEFAULT '',
      page_enter_at INTEGER DEFAULT 0,
      page_leave_at INTEGER DEFAULT 0,
      stay_duration_ms INTEGER DEFAULT 0,
      max_scroll_depth REAL DEFAULT 0,
      visit_path_json TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS visitor_paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_id INTEGER,
      fingerprint_id TEXT NOT NULL,
      path TEXT DEFAULT '',
      full_url TEXT DEFAULT '',
      ts INTEGER NOT NULL,
      sequence_no INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_visitors_tracked_at ON visitors(tracked_at);
    CREATE INDEX IF NOT EXISTS idx_visitors_fingerprint ON visitors(fingerprint_id);
    CREATE INDEX IF NOT EXISTS idx_visitors_ip ON visitors(ip);
    CREATE INDEX IF NOT EXISTS idx_visitors_city ON visitors(city);
    CREATE INDEX IF NOT EXISTS idx_visitors_device_type ON visitors(device_type);
    CREATE INDEX IF NOT EXISTS idx_visitor_paths_visitor_id ON visitor_paths(visitor_id);
    CREATE INDEX IF NOT EXISTS idx_visitor_paths_fingerprint ON visitor_paths(fingerprint_id);

    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('site_title', 'aeoleaf'),
      ('site_subtitle', '风叶'),
      ('about_text', ''),
      ('about_image', ''),
      ('about_tagline', ''),
      ('about_meta', ''),
      ('home_hero_image', ''),
      ('home_hero_image_mobile', ''),
      ('home_hero_position', 'center center'),
      ('home_hero_position_mobile', 'center center'),
      ('contact_email', ''),
      ('contact_qq', ''),
      ('social_links', '[]');
  `);

  // Add views column if it doesn't exist
  try {
    rawDb.exec('ALTER TABLE posts ADD COLUMN views INTEGER NOT NULL DEFAULT 0');
  } catch (e) {
    // Column already exists, ignore error
  }

  // Add date column to works if it doesn't exist
  try {
    rawDb.exec('ALTER TABLE works ADD COLUMN date TEXT DEFAULT \'\'');
  } catch (e) {
    // Column already exists, ignore error
  }

  // Visitor table incremental columns (ALTER only, keep backward compatible)
  try { rawDb.exec('ALTER TABLE visitors ADD COLUMN request_id TEXT DEFAULT \'\''); } catch (e) {}
  try { rawDb.exec('ALTER TABLE visitors ADD COLUMN event_type TEXT DEFAULT \'\''); } catch (e) {}
  try { rawDb.exec('ALTER TABLE visitors ADD COLUMN user_agent_raw TEXT DEFAULT \'\''); } catch (e) {}
  try { rawDb.exec('ALTER TABLE visitors ADD COLUMN http_status INTEGER DEFAULT 200'); } catch (e) {}
  try { rawDb.exec('ALTER TABLE visitors ADD COLUMN request_method TEXT DEFAULT \'POST\''); } catch (e) {}
  try { rawDb.exec('ALTER TABLE visitors ADD COLUMN utm_source TEXT DEFAULT \'\''); } catch (e) {}
  try { rawDb.exec('ALTER TABLE visitors ADD COLUMN utm_medium TEXT DEFAULT \'\''); } catch (e) {}
  try { rawDb.exec('ALTER TABLE visitors ADD COLUMN utm_campaign TEXT DEFAULT \'\''); } catch (e) {}
  try { rawDb.exec('ALTER TABLE visitors ADD COLUMN search_keyword TEXT DEFAULT \'\''); } catch (e) {}
  try { rawDb.exec('ALTER TABLE visitors ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0'); } catch (e) {}
  try { rawDb.exec('ALTER TABLE visitors ADD COLUMN visitor_session_id INTEGER'); } catch (e) {}
  try { rawDb.exec('ALTER TABLE visitors ADD COLUMN country TEXT DEFAULT \'\''); } catch (e) {}
  try { rawDb.exec('ALTER TABLE visitors ADD COLUMN province TEXT DEFAULT \'\''); } catch (e) {}
  try { rawDb.exec('ALTER TABLE visitors ADD COLUMN city TEXT DEFAULT \'\''); } catch (e) {}
  try { rawDb.exec('ALTER TABLE visitors ADD COLUMN isp TEXT DEFAULT \'\''); } catch (e) {}
  try { rawDb.exec('ALTER TABLE visitors ADD COLUMN page_view_id TEXT DEFAULT \'\''); } catch (e) {}
  try { rawDb.exec('ALTER TABLE visitors ADD COLUMN downlink REAL DEFAULT 0'); } catch (e) {}
  try { rawDb.exec('ALTER TABLE visitors ADD COLUMN rtt REAL DEFAULT 0'); } catch (e) {}

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS visitor_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint_id TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL DEFAULT 0,
      page_count INTEGER NOT NULL DEFAULT 0,
      total_duration INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // idx_visitors_tracked_at / idx_visitors_fingerprint / idx_visitors_ip
  // already created above; avoid duplicates. Only add the new columns' indexes.
  rawDb.exec('CREATE INDEX IF NOT EXISTS idx_visitors_url_search ON visitors(full_url)');
  rawDb.exec('CREATE INDEX IF NOT EXISTS idx_visitors_request_id ON visitors(request_id)');
  rawDb.exec('CREATE INDEX IF NOT EXISTS idx_visitors_session_id ON visitors(visitor_session_id)');
  rawDb.exec('CREATE INDEX IF NOT EXISTS idx_visitors_page_view_id ON visitors(page_view_id)');
  rawDb.exec('CREATE INDEX IF NOT EXISTS idx_visitor_sessions_fingerprint ON visitor_sessions(fingerprint_id)');
  // Drop legacy duplicates introduced by earlier versions.
  try { rawDb.exec('DROP INDEX IF EXISTS idx_visitors_time'); } catch (e) {}
  try { rawDb.exec('DROP INDEX IF EXISTS idx_visitors_ip_search'); } catch (e) {}
  try { rawDb.exec('DROP INDEX IF EXISTS idx_visitors_fp_search'); } catch (e) {}

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS ip_blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL UNIQUE,
      reason TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  rawDb.exec('CREATE INDEX IF NOT EXISTS idx_blacklist_ip ON ip_blacklist(ip)');

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS guestbook (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      message TEXT NOT NULL,
      avatar TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
  `);

  refreshBlacklistCache();
  return rawDb;
}

// Thin wrapper preserving the historical `prepare(sql).get/all/run(...params)`
// shape used throughout routes/. node:sqlite already supports positional
// params and returns { lastInsertRowid, changes } from run(), so this is mostly
// a pass-through. The 60s query cache from the sql.js era is intentionally gone:
// native prepared statements are fast enough and the cache caused stale reads.
const dbWrapper = {
  prepare: (sql) => {
    const stmt = rawDb.prepare(sql);
    return {
      get: (...params) => stmt.get(...params) ?? null,
      all: (...params) => stmt.all(...params),
      run: (...params) => {
        const r = stmt.run(...params);
        return { lastInsertRowid: r.lastInsertRowid, changes: r.changes };
      }
    };
  },
  // Mirrors the better-sqlite3 / old wrapper contract: returns a function that
  // runs `fn` inside a single transaction. node:sqlite has no transaction()
  // helper, so we drive BEGIN/COMMIT/ROLLBACK manually.
  transaction: (fn) => (...args) => {
    rawDb.exec('BEGIN');
    try {
      const out = fn(...args);
      rawDb.exec('COMMIT');
      return out;
    } catch (e) {
      try { rawDb.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
      throw e;
    }
  }
};
function buildVisitorFilter({ startTime, endTime, ip, city, deviceType, fingerprint }) {
  let where = ' WHERE 1=1';
  const params = [];

  if (startTime) {
    where += ' AND tracked_at >= ?';
    params.push(startTime);
  }
  if (endTime) {
    where += ' AND tracked_at <= ?';
    params.push(endTime);
  }
  if (ip) {
    where += ' AND ip LIKE ?';
    params.push(`%${ip}%`);
  }
  if (city) {
    where += ' AND city LIKE ?';
    params.push(`%${city}%`);
  }
  if (deviceType) {
    where += ' AND device_type = ?';
    params.push(deviceType);
  }
  if (fingerprint) {
    where += ' AND fingerprint_id LIKE ?';
    params.push(`%${fingerprint}%`);
  }

  return { where, params };
}

function getVisitorOverview() {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const ydayStart = dayStart - 24 * 60 * 60 * 1000;

  const todayPV = dbWrapper.prepare('SELECT COUNT(*) as cnt FROM visitors WHERE tracked_at >= ?').get(dayStart)?.cnt || 0;
  const todayUV = dbWrapper.prepare('SELECT COUNT(DISTINCT fingerprint_id) as cnt FROM visitors WHERE tracked_at >= ?').get(dayStart)?.cnt || 0;
  const yesterdayPV = dbWrapper.prepare('SELECT COUNT(*) as cnt FROM visitors WHERE tracked_at >= ? AND tracked_at < ?').get(ydayStart, dayStart)?.cnt || 0;
  const totalPV = dbWrapper.prepare('SELECT COUNT(*) as cnt FROM visitors').get()?.cnt || 0;
  const totalUV = dbWrapper.prepare('SELECT COUNT(DISTINCT fingerprint_id) as cnt FROM visitors').get()?.cnt || 0;

  return { todayPV, todayUV, yesterdayPV, totalPV, totalUV };
}

function getVisitorTrend(days = 7) {
  const from = Date.now() - days * 24 * 60 * 60 * 1000;
  const rows = dbWrapper.prepare(`
    SELECT
      date(datetime(tracked_at / 1000, 'unixepoch', 'localtime')) as d,
      COUNT(*) as pv,
      COUNT(DISTINCT fingerprint_id) as uv
    FROM visitors
    WHERE tracked_at >= ?
    GROUP BY d
    ORDER BY d ASC
  `).all(from);
  return rows;
}

function getRegionDistribution(limit = 20) {
  return dbWrapper.prepare(`
    SELECT
      CASE
        WHEN country != '' THEN country || ' / ' || province || ' / ' || city
        WHEN province != '' THEN province || ' / ' || city
        WHEN city != '' THEN city
        ELSE 'Unknown'
      END as region,
      COUNT(*) as pv,
      COUNT(DISTINCT fingerprint_id) as uv
    FROM visitors
    GROUP BY region
    ORDER BY pv DESC
    LIMIT ?
  `).all(limit);
}

function getTopPages(limit = 10) {
  return dbWrapper.prepare(`
    SELECT path, COUNT(*) as pv, COUNT(DISTINCT fingerprint_id) as uv
    FROM visitors
    GROUP BY path
    ORDER BY pv DESC
    LIMIT ?
  `).all(limit);
}

function getVisitorsPage(filters, page = 1, _limit = 20, sortBy = 'tracked_at', sortDir = 'desc') {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = 20;
  const offset = (safePage - 1) * safeLimit;
  const { where, params } = buildVisitorFilter(filters || {});

  const allowedSort = { tracked_at: 1, ip: 1, stay_duration_ms: 1 };
  const col = allowedSort[sortBy] ? sortBy : 'tracked_at';
  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';

  const total = dbWrapper.prepare(`SELECT COUNT(*) as cnt FROM visitors${where}`).get(...params)?.cnt || 0;
  const rows = dbWrapper.prepare(`
    SELECT * FROM visitors
    ${where}
    ORDER BY ${col} ${dir}
    LIMIT ? OFFSET ?
  `).all(...params, safeLimit, offset);

  return { rows, total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) };
}

function getVisitorsByFilter(filters, limit = 5000) {
  const safeLimit = Math.max(1, Math.min(10000, Number(limit) || 5000));
  const { where, params } = buildVisitorFilter(filters || {});
  return dbWrapper.prepare(`
    SELECT * FROM visitors
    ${where}
    ORDER BY tracked_at DESC
    LIMIT ?
  `).all(...params, safeLimit);
}

function getVisitorDetail(id) {
  const numericId = Number.parseInt(String(id), 10);
  if (!Number.isFinite(numericId) || numericId < 1) return null;
  return dbWrapper.prepare('SELECT * FROM visitors WHERE id = ?').get(numericId);
}

function getVisitorSessionById(sessionId) {
  return dbWrapper.prepare('SELECT * FROM visitor_sessions WHERE id = ?').get(sessionId);
}

function getVisitorPathBySession(sessionId) {
  return dbWrapper.prepare(`
    SELECT *
    FROM visitors
    WHERE visitor_session_id = ?
    ORDER BY tracked_at ASC
  `).all(sessionId);
}

function getVisitorsByFingerprint(fingerprintId, limit = 500) {
  const fp = String(fingerprintId || '').trim();
  if (!fp) return [];
  const cap = Math.max(1, Math.min(1000, Number(limit) || 500));
  return dbWrapper.prepare(`
    SELECT * FROM visitors
    WHERE fingerprint_id = ?
    ORDER BY tracked_at ASC
    LIMIT ?
  `).all(fp, cap);
}

function getSessionsPage(filters, page = 1, _limit = 20) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = 20;
  const offset = (safePage - 1) * safeLimit;

  let where = ' WHERE 1=1';
  const params = [];

  if (filters && filters.fingerprint) {
    where += ' AND vs.fingerprint_id LIKE ?';
    params.push(`%${filters.fingerprint}%`);
  }
  if (filters && filters.startTime) {
    where += ' AND vs.start_time >= ?';
    params.push(filters.startTime);
  }
  if (filters && filters.endTime) {
    where += ' AND vs.start_time <= ?';
    params.push(filters.endTime);
  }

  const total = dbWrapper.prepare(`SELECT COUNT(*) as cnt FROM visitor_sessions vs${where}`).get(...params)?.cnt || 0;
  const rows = dbWrapper.prepare(`
    SELECT vs.*,
      (SELECT GROUP_CONCAT(DISTINCT path) FROM visitors WHERE visitor_session_id = vs.id) as paths
    FROM visitor_sessions vs
    ${where}
    ORDER BY vs.start_time DESC
    LIMIT ? OFFSET ?
  `).all(...params, safeLimit, offset);

  return { rows, total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) };
}

let blacklistSet = new Set();

function refreshBlacklistCache() {
  blacklistSet = new Set();
  try {
    const rows = dbWrapper.prepare('SELECT ip FROM ip_blacklist').all();
    rows.forEach(r => blacklistSet.add(r.ip));
  } catch (e) {}
}

function isBlacklisted(ip) {
  return blacklistSet.has(ip);
}

function getBlacklistIps() {
  return dbWrapper.prepare('SELECT * FROM ip_blacklist ORDER BY created_at DESC').all();
}

function addToBlacklist(ip, reason) {
  dbWrapper.prepare('INSERT OR IGNORE INTO ip_blacklist (ip, reason) VALUES (?, ?)').run(ip, reason || '');
  refreshBlacklistCache();
}

function removeFromBlacklist(ip) {
  dbWrapper.prepare('DELETE FROM ip_blacklist WHERE ip = ?').run(ip);
  refreshBlacklistCache();
}

module.exports = {
  initDB,
  flushDB,
  closeDB,
  saveDBSync,
  db: dbWrapper,
  getVisitorOverview,
  getVisitorTrend,
  getRegionDistribution,
  getTopPages,
  getVisitorsPage,
  getVisitorsByFilter,
  getVisitorDetail,
  getVisitorSessionById,
  getVisitorPathBySession,
  getVisitorsByFingerprint,
  getSessionsPage,
  isBlacklisted,
  getBlacklistIps,
  addToBlacklist,
  removeFromBlacklist
};

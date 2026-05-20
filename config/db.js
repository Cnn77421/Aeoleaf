const initSqlJs = require('sql.js');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const defaultDbPath = path.join(__dirname, '../database', 'aeoleaf.db');
const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : defaultDbPath;
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const SAVE_DEBOUNCE_MS = 400;
let saveDebounceTimer = null;

function exportDbBuffer() {
  return Buffer.from(db.export());
}

function atomicWriteSync(target, buf) {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, target);
}

async function atomicWrite(target, buf) {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, buf);
  await fsp.rename(tmp, target);
}

function saveDBSync() {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
  }
  if (!db) return;
  atomicWriteSync(dbPath, exportDbBuffer());
}

let db;
const queryCache = new Map();
const CACHE_TTL = 60000; // 1 分钟缓存
const CACHE_MAX_ENTRIES = 500;

/** COUNT(...) 等聚合读不应缓存，避免多进程/写入后长时间读到旧的 0 */
function skipResultCacheForSql(sql) {
  return typeof sql === 'string' && /\bCOUNT\s*\(/i.test(sql);
}

function cacheSet(key, value) {
  // Simple LRU-ish cap: when exceeded, drop the oldest entry (Map keeps insertion order).
  if (queryCache.size >= CACHE_MAX_ENTRIES) {
    const firstKey = queryCache.keys().next().value;
    if (firstKey !== undefined) queryCache.delete(firstKey);
  }
  queryCache.set(key, value);
}

async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
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
      ('contact_email', ''),
      ('contact_qq', ''),
      ('social_links', '[]');
  `);

  // Add views column if it doesn't exist
  try {
    db.run('ALTER TABLE posts ADD COLUMN views INTEGER NOT NULL DEFAULT 0');
  } catch (e) {
    // Column already exists, ignore error
  }

  // Add date column to works if it doesn't exist
  try {
    db.run('ALTER TABLE works ADD COLUMN date TEXT DEFAULT \'\'');
  } catch (e) {
    // Column already exists, ignore error
  }

  // Visitor table incremental columns (ALTER only, keep backward compatible)
  try { db.run('ALTER TABLE visitors ADD COLUMN request_id TEXT DEFAULT \'\''); } catch (e) {}
  try { db.run('ALTER TABLE visitors ADD COLUMN event_type TEXT DEFAULT \'\''); } catch (e) {}
  try { db.run('ALTER TABLE visitors ADD COLUMN user_agent_raw TEXT DEFAULT \'\''); } catch (e) {}
  try { db.run('ALTER TABLE visitors ADD COLUMN http_status INTEGER DEFAULT 200'); } catch (e) {}
  try { db.run('ALTER TABLE visitors ADD COLUMN request_method TEXT DEFAULT \'POST\''); } catch (e) {}
  try { db.run('ALTER TABLE visitors ADD COLUMN utm_source TEXT DEFAULT \'\''); } catch (e) {}
  try { db.run('ALTER TABLE visitors ADD COLUMN utm_medium TEXT DEFAULT \'\''); } catch (e) {}
  try { db.run('ALTER TABLE visitors ADD COLUMN utm_campaign TEXT DEFAULT \'\''); } catch (e) {}
  try { db.run('ALTER TABLE visitors ADD COLUMN search_keyword TEXT DEFAULT \'\''); } catch (e) {}
  try { db.run('ALTER TABLE visitors ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0'); } catch (e) {}
  try { db.run('ALTER TABLE visitors ADD COLUMN visitor_session_id INTEGER'); } catch (e) {}
  try { db.run('ALTER TABLE visitors ADD COLUMN country TEXT DEFAULT \'\''); } catch (e) {}
  try { db.run('ALTER TABLE visitors ADD COLUMN province TEXT DEFAULT \'\''); } catch (e) {}
  try { db.run('ALTER TABLE visitors ADD COLUMN city TEXT DEFAULT \'\''); } catch (e) {}
  try { db.run('ALTER TABLE visitors ADD COLUMN isp TEXT DEFAULT \'\''); } catch (e) {}
  try { db.run('ALTER TABLE visitors ADD COLUMN page_view_id TEXT DEFAULT \'\''); } catch (e) {}
  try { db.run('ALTER TABLE visitors ADD COLUMN downlink REAL DEFAULT 0'); } catch (e) {}
  try { db.run('ALTER TABLE visitors ADD COLUMN rtt REAL DEFAULT 0'); } catch (e) {}

  db.run(`
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
  db.run('CREATE INDEX IF NOT EXISTS idx_visitors_url_search ON visitors(full_url)');
  db.run('CREATE INDEX IF NOT EXISTS idx_visitors_request_id ON visitors(request_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_visitors_session_id ON visitors(visitor_session_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_visitors_page_view_id ON visitors(page_view_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_visitor_sessions_fingerprint ON visitor_sessions(fingerprint_id)');
  // Drop legacy duplicates introduced by earlier versions.
  try { db.run('DROP INDEX IF EXISTS idx_visitors_time'); } catch (e) {}
  try { db.run('DROP INDEX IF EXISTS idx_visitors_ip_search'); } catch (e) {}
  try { db.run('DROP INDEX IF EXISTS idx_visitors_fp_search'); } catch (e) {}

  db.run(`
    CREATE TABLE IF NOT EXISTS ip_blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL UNIQUE,
      reason TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_blacklist_ip ON ip_blacklist(ip)');

  db.run(`
    CREATE TABLE IF NOT EXISTS guestbook (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      message TEXT NOT NULL,
      avatar TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
  `);

  refreshBlacklistCache();
  saveDBSync();
  return db;
}

function saveDB() {
  if (!db) return;
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    saveDebounceTimer = null;
    const buf = exportDbBuffer();
    atomicWrite(dbPath, buf).catch((err) => {
      console.error('Database write failed:', err);
    });
  }, SAVE_DEBOUNCE_MS);
}

async function flushDB() {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
  }
  if (!db) return;
  await atomicWrite(dbPath, exportDbBuffer());
}

const dbWrapper = {
  prepare: (sql) => {
    return {
      get: (...params) => {
        const noCache = skipResultCacheForSql(sql);
        const cacheKey = sql + JSON.stringify(params);
        if (!noCache) {
          const cached = queryCache.get(cacheKey);
          if (cached && Date.now() - cached.time < CACHE_TTL) {
            return cached.data;
          }
        }

        const stmt = db.prepare(sql);
        stmt.bind(params);
        const result = stmt.step() ? stmt.getAsObject() : null;
        stmt.free();

        if (!noCache) {
          cacheSet(cacheKey, { data: result, time: Date.now() });
        }
        return result;
      },
      all: (...params) => {
        const noCache = skipResultCacheForSql(sql);
        const cacheKey = sql + JSON.stringify(params);
        if (!noCache) {
          const cached = queryCache.get(cacheKey);
          if (cached && Date.now() - cached.time < CACHE_TTL) {
            return cached.data;
          }
        }

        const stmt = db.prepare(sql);
        stmt.bind(params);
        const results = [];
        while (stmt.step()) results.push(stmt.getAsObject());
        stmt.free();

        if (!noCache) {
          cacheSet(cacheKey, { data: results, time: Date.now() });
        }
        return results;
      },
      run: (...params) => {
        queryCache.clear();
        const stmt = db.prepare(sql);
        stmt.bind(params);
        stmt.step();
        const lastID = db.exec('SELECT last_insert_rowid() as id')[0]?.values[0]?.[0];
        stmt.free();
        saveDB();
        return { lastInsertRowid: lastID };
      }
    };
  },
  transaction: (fn) => () => {
    queryCache.clear();
    fn();
    saveDB();
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
  // Bypass queryCache: by-id lookups must never serve stale null after inserts.
  const stmt = db.prepare('SELECT * FROM visitors WHERE id = ?');
  stmt.bind([numericId]);
  const result = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return result;
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
    const stmt = db.prepare('SELECT ip FROM ip_blacklist');
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
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

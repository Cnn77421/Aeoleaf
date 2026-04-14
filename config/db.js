const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbDir = path.join(__dirname, '../database');
const dbPath = path.join(dbDir, 'aeoleaf.db');

if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

let db;
const queryCache = new Map();
const CACHE_TTL = 60000; // 1分钟缓存

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
      ('about_image', '');
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

  saveDB();
  return db;
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync(dbPath, data);
}

const dbWrapper = {
  prepare: (sql) => {
    return {
      get: (...params) => {
        const cacheKey = sql + JSON.stringify(params);
        const cached = queryCache.get(cacheKey);
        if (cached && Date.now() - cached.time < CACHE_TTL) {
          return cached.data;
        }

        const stmt = db.prepare(sql);
        stmt.bind(params);
        const result = stmt.step() ? stmt.getAsObject() : null;
        stmt.free();

        queryCache.set(cacheKey, { data: result, time: Date.now() });
        return result;
      },
      all: (...params) => {
        const cacheKey = sql + JSON.stringify(params);
        const cached = queryCache.get(cacheKey);
        if (cached && Date.now() - cached.time < CACHE_TTL) {
          return cached.data;
        }

        const stmt = db.prepare(sql);
        stmt.bind(params);
        const results = [];
        while (stmt.step()) results.push(stmt.getAsObject());
        stmt.free();

        queryCache.set(cacheKey, { data: results, time: Date.now() });
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

function buildVisitorFilter({ startTime, endTime, ip, city, deviceType }) {
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

function getVisitorTrend(days = 14) {
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

function getVisitorsPage(filters, page = 1, limit = 20) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 20));
  const offset = (safePage - 1) * safeLimit;
  const { where, params } = buildVisitorFilter(filters || {});

  const total = dbWrapper.prepare(`SELECT COUNT(*) as cnt FROM visitors${where}`).get(...params)?.cnt || 0;
  const rows = dbWrapper.prepare(`
    SELECT * FROM visitors
    ${where}
    ORDER BY tracked_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, safeLimit, offset);

  return { rows, total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) };
}

module.exports = {
  initDB,
  db: dbWrapper,
  getVisitorOverview,
  getVisitorTrend,
  getRegionDistribution,
  getTopPages,
  getVisitorsPage
};

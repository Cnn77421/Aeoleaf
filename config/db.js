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

module.exports = { initDB, db: dbWrapper };

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { getAdvancedAnalytics, delta } = require('../lib/advancedAnalytics');

function wrapper(raw) {
  return { prepare(sql) { const statement = raw.prepare(sql); return { get: (...args) => statement.get(...args), all: (...args) => statement.all(...args) }; } };
}

test('advanced analytics computes attribution, retention, paths, and engagement', () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE visitors(id INTEGER PRIMARY KEY,fingerprint_id TEXT,tracked_at INTEGER,path TEXT,ip TEXT DEFAULT '',referer TEXT,utm_source TEXT,utm_medium TEXT,utm_campaign TEXT,is_bot INTEGER DEFAULT 0,stay_duration_ms INTEGER,max_scroll_depth REAL,visitor_session_id INTEGER); CREATE TABLE visitor_sessions(id INTEGER PRIMARY KEY,start_time INTEGER,end_time INTEGER,page_count INTEGER,total_duration INTEGER);`);
  const now = Date.UTC(2026, 7, 20, 12);
  const first = now - 3 * 86400000;
  raw.prepare("INSERT INTO visitor_sessions VALUES(1,?,?,2,50000)").run(first, first + 50000);
  const insert = raw.prepare('INSERT INTO visitors(fingerprint_id,tracked_at,path,referer,utm_source,utm_medium,utm_campaign,stay_duration_ms,max_scroll_depth,visitor_session_id) VALUES(?,?,?,?,?,?,?,?,?,?)');
  insert.run('fp1', first, '/', 'https://google.com/', '', '', '', 10000, 20, 1);
  insert.run('fp1', first + 1000, '/blog/story', '', '', '', '', 40000, 80, 1);
  insert.run('fp1', first + 2 * 86400000, '/blog/story', '', 'newsletter', 'email', 'launch', 35000, 70, null);
  raw.prepare("INSERT INTO visitors(fingerprint_id,tracked_at,path,ip,stay_duration_ms,max_scroll_depth) VALUES(?,?,?,?,?,?)").run('admin', first + 2000, '/admin/security', '203.0.113.5', 5000, 10);
  raw.prepare("INSERT INTO visitors(fingerprint_id,tracked_at,path,ip,stay_duration_ms,max_scroll_depth) VALUES(?,?,?,?,?,?)").run('local', first + 3000, '/guestbook', '::1', 5000, 10);
  const result = getAdvancedAnalytics(wrapper(raw), 30, now);
  assert.equal(result.current.pv, 3);
  assert.ok(result.sources.some((row) => row.source === 'organic search'));
  assert.ok(result.sources.some((row) => row.source === 'newsletter'));
  assert.deepEqual(result.transitions.map((row) => [row.from_path, row.to_path]), [['/', '/blog/story']]);
  assert.equal(result.content[0].engagementRate, 100);
  assert.equal(result.retention[0].rate, 100);
  assert.deepEqual(result.funnel.map((step) => step.visitors), [1, 1, 1]);
  assert.deepEqual(result.funnel.map((step) => step.rate), [100, 100, 100]);
  assert.equal(delta(15, 10), 50);
  raw.close();
});

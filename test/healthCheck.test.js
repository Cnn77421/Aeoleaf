const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { recordHealthSnapshot } = require('../lib/healthCheck');

function wrapper(raw) {
  return {
    prepare(sql) {
      const statement = raw.prepare(sql);
      return {
        get: (...args) => statement.get(...args),
        run: (...args) => statement.run(...args)
      };
    }
  };
}

test('health snapshots detect transitions and retain bounded history', () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE health_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,status TEXT,ok_count INTEGER,warning_count INTEGER,error_count INTEGER,details_json TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  const db = wrapper(raw);
  const healthy = { summary: { ok: 7, warning: 0, error: 0 }, checks: [] };
  const warning = { summary: { ok: 6, warning: 1, error: 0 }, checks: [{ id: 'disk', status: 'warning' }] };
  assert.deepEqual(recordHealthSnapshot(db, healthy), { status: 'ok', previousStatus: '', changed: true });
  assert.deepEqual(recordHealthSnapshot(db, healthy), { status: 'ok', previousStatus: 'ok', changed: false });
  assert.deepEqual(recordHealthSnapshot(db, warning), { status: 'warning', previousStatus: 'ok', changed: true });
  assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM health_snapshots').get().count, 3);
  raw.close();
});

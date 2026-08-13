const test = require('node:test');
const assert = require('node:assert/strict');
const { SQLiteSessionStore } = require('../lib/sqliteSessionStore');

function memoryDb() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      return {
        get(sid) {
          const row = rows.get(sid);
          return row ? { ...row } : null;
        },
        run(...params) {
          if (sql.includes('INSERT INTO admin_sessions')) {
            const [sid, data, expiresAt] = params;
            rows.set(sid, { data, expires_at: expiresAt });
          } else if (sql.includes('SET expires_at')) {
            const [expiresAt, sid] = params;
            const row = rows.get(sid);
            if (row) row.expires_at = expiresAt;
          } else if (sql.includes('WHERE sid = ?')) {
            rows.delete(params[0]);
          } else if (sql.includes('expires_at <= ?')) {
            for (const [sid, row] of rows) if (row.expires_at <= params[0]) rows.delete(sid);
          }
          return { changes: 1 };
        }
      };
    }
  };
}

function call(store, method, ...args) {
  return new Promise((resolve, reject) => {
    store[method](...args, (err, value) => err ? reject(err) : resolve(value));
  });
}

test('persists, reads, touches, expires, and destroys sessions', async (t) => {
  const db = memoryDb();
  const store = new SQLiteSessionStore(db);
  t.after(() => store.close());

  const sessionData = { admin: true, cookie: { maxAge: 60_000 } };
  await call(store, 'set', 'active', sessionData);
  assert.deepEqual(await call(store, 'get', 'active'), sessionData);

  const beforeTouch = db.rows.get('active').expires_at;
  await call(store, 'touch', 'active', { cookie: { maxAge: 120_000 } });
  assert.ok(db.rows.get('active').expires_at >= beforeTouch);

  db.rows.set('expired', { data: JSON.stringify(sessionData), expires_at: Date.now() - 1 });
  assert.equal(await call(store, 'get', 'expired'), null);
  assert.equal(db.rows.has('expired'), false);

  await call(store, 'destroy', 'active');
  assert.equal(await call(store, 'get', 'active'), null);
});

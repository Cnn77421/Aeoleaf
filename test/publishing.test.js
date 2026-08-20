const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createPreviewToken, verifyPreviewToken } = require('../lib/previewToken');
const { runPublishSchedule } = require('../lib/publishScheduler');

function testDb() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY, title TEXT, status TEXT, scheduled_at TEXT DEFAULT '',
      unpublish_at TEXT DEFAULT '', published_at TEXT DEFAULT '', deleted_at TEXT DEFAULT '',
      content_revision INTEGER DEFAULT 1, updated_at TEXT DEFAULT ''
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY, action TEXT, entity_type TEXT, entity_id TEXT,
      outcome TEXT, summary_json TEXT, ip TEXT, user_agent TEXT, request_id TEXT
    );
  `);
  return {
    raw,
    db: {
      prepare(sql) {
        const statement = raw.prepare(sql);
        return {
          all: (...args) => statement.all(...args),
          run: (...args) => statement.run(...args)
        };
      },
      transaction(fn) {
        return (...args) => {
          raw.exec('BEGIN');
          try { const result = fn(...args); raw.exec('COMMIT'); return result; }
          catch (error) { raw.exec('ROLLBACK'); throw error; }
        };
      }
    }
  };
}

test('preview tokens are scoped, signed, and expire', () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'publishing-test-secret-with-enough-entropy';
  try {
    const token = createPreviewToken(7, 60, 1_000_000);
    assert.equal(verifyPreviewToken(token, 7, 1_030_000), true);
    assert.equal(verifyPreviewToken(token, 8, 1_030_000), false);
    assert.equal(verifyPreviewToken(token + 'x', 7, 1_030_000), false);
    assert.equal(verifyPreviewToken(token, 7, 1_061_000), false);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test('scheduler publishes and unpublishes only due posts', () => {
  const { raw, db } = testDb();
  raw.prepare("INSERT INTO posts VALUES (1,'due draft','draft','2026-08-20 09:00:00','','','',1,'')").run();
  raw.prepare("INSERT INTO posts VALUES (2,'future draft','draft','2026-08-20 11:00:00','','','',1,'')").run();
  raw.prepare("INSERT INTO posts VALUES (3,'due public','published','','2026-08-20 09:30:00','2026-08-19 10:00:00','',1,'')").run();
  const result = runPublishSchedule(db, '2026-08-20 10:00:00');
  assert.deepEqual(result, { published: 1, unpublished: 1 });
  assert.equal(raw.prepare('SELECT status FROM posts WHERE id=1').get().status, 'published');
  assert.equal(raw.prepare('SELECT status FROM posts WHERE id=2').get().status, 'draft');
  assert.equal(raw.prepare('SELECT status FROM posts WHERE id=3').get().status, 'draft');
  assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 2);
  raw.close();
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('media quarantine restores safely when the original path is occupied', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeoleaf-media-trash-'));
  process.env.MEDIA_TRASH_DIR = tempDir;
  const safeFsPath = require.resolve('../lib/safeFs');
  delete require.cache[safeFsPath];
  const { quarantinePublicUpload, restoreQuarantinedUpload } = require('../lib/safeFs');
  const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'general');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const unique = `trash-test-${process.pid}-${Date.now()}.png`;
  const original = path.join(uploadsDir, unique);
  const originalUrl = `/uploads/general/${unique}`;
  let restoredPath = '';
  t.after(() => {
    for (const target of [original, restoredPath]) {
      try { if (target && fs.existsSync(target)) fs.unlinkSync(target); } catch {}
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.MEDIA_TRASH_DIR;
  });

  fs.writeFileSync(original, 'recoverable');
  const quarantined = quarantinePublicUpload(originalUrl);
  assert.ok(quarantined);
  assert.equal(fs.existsSync(original), false);
  fs.writeFileSync(original, 'new occupant');

  const restored = restoreQuarantinedUpload(quarantined.quarantineName, originalUrl);
  assert.equal(restored.renamed, true);
  restoredPath = path.join(__dirname, '..', 'public', restored.url.replace(/^\//, ''));
  assert.equal(fs.readFileSync(original, 'utf8'), 'new occupant');
  assert.equal(fs.readFileSync(restoredPath, 'utf8'), 'recoverable');
});

test('enabled retention cleanup removes only expired soft-deleted content', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeoleaf-trash-cleanup-'));
  process.env.DATABASE_PATH = path.join(tempDir, 'test.sqlite');
  const dbPath = require.resolve('../config/db');
  delete require.cache[dbPath];
  const { initDB, closeDB, db } = require('../config/db');
  const { runTrashCleanup } = require('../lib/trashCleanup');
  t.after(() => {
    closeDB();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
  });
  initDB();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('trash_retention_enabled', '1')").run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('trash_retention_days', '30')").run();
  const old = db.prepare("INSERT INTO posts (title, slug, deleted_at, deleted_slug) VALUES ('Old', '__trash_old', datetime('now', '-31 days', 'localtime'), 'old')").run().lastInsertRowid;
  const recent = db.prepare("INSERT INTO posts (title, slug, deleted_at, deleted_slug) VALUES ('Recent', '__trash_recent', datetime('now', '-2 days', 'localtime'), 'recent')").run().lastInsertRowid;

  const result = runTrashCleanup(db);
  assert.equal(result.removed, 1);
  assert.equal(db.prepare('SELECT id FROM posts WHERE id = ?').get(old), null);
  assert.equal(db.prepare('SELECT id FROM posts WHERE id = ?').get(recent).id, recent);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('creates, verifies, extracts, and restores a complete backup in temporary directories', { timeout: 30_000 }, async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aeoleaf-backup-test-'));
  const runtimePublic = path.join(tempRoot, 'runtime-public');
  const runtimeUploads = path.join(runtimePublic, 'uploads');
  const runtimeTrash = path.join(tempRoot, 'runtime-trash');
  const backupDir = path.join(tempRoot, 'backups');
  const databasePath = path.join(tempRoot, 'runtime-db', 'aeoleaf.db');
  process.env.DATABASE_PATH = databasePath;
  process.env.PUBLIC_DIR = runtimePublic;
  process.env.MEDIA_TRASH_DIR = runtimeTrash;
  process.env.BACKUP_DIR = backupDir;
  for (const modulePath of ['../config/db', '../lib/backupService']) delete require.cache[require.resolve(modulePath)];
  const database = require('../config/db');
  const backups = require('../lib/backupService');
  t.after(() => {
    database.closeDB();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    for (const key of ['DATABASE_PATH', 'PUBLIC_DIR', 'MEDIA_TRASH_DIR', 'BACKUP_DIR']) delete process.env[key];
  });

  database.initDB();
  fs.mkdirSync(path.join(runtimeUploads, 'general'), { recursive: true });
  fs.mkdirSync(runtimeTrash, { recursive: true });
  fs.writeFileSync(path.join(runtimeUploads, 'general', 'asset.txt'), 'original asset');
  fs.writeFileSync(path.join(runtimeTrash, 'quarantined.bin'), 'recoverable media');
  database.db.prepare("INSERT INTO posts (title, slug, content, status) VALUES ('Backup Original', 'backup-original', 'body', 'published')").run();
  database.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_retention_count', '1')").run();

  const created = await backups.createBackup({ trigger: 'manual' });
  assert.equal(created.databaseIntegrity, 'ok');
  assert.ok(created.fileCount >= 5);
  assert.match(created.sha256, /^[a-f0-9]{64}$/);
  const selected = backups.getBackup(created.id);
  assert.ok(selected);

  const drillRoot = path.join(tempRoot, 'drill');
  const drill = await backups.extractBackup(selected.archive, drillRoot, created.sha256);
  assert.equal(drill.integrity, 'ok');
  assert.equal(fs.readFileSync(path.join(drillRoot, 'public', 'uploads', 'general', 'asset.txt'), 'utf8'), 'original asset');
  const { DatabaseSync } = require('node:sqlite');
  const drillDb = new DatabaseSync(path.join(drillRoot, 'database', 'aeoleaf.db'), { readOnly: true });
  assert.equal(drillDb.prepare("SELECT title FROM posts WHERE slug = 'backup-original'").get().title, 'Backup Original');
  drillDb.close();

  const tampered = path.join(tempRoot, 'tampered.aebak');
  fs.copyFileSync(selected.archive, tampered);
  fs.appendFileSync(tampered, 'tamper');
  await assert.rejects(() => backups.extractBackup(tampered, path.join(tempRoot, 'tampered-out'), created.sha256), /checksum mismatch/);

  database.db.prepare("UPDATE posts SET title = 'Changed After Backup' WHERE slug = 'backup-original'").run();
  fs.writeFileSync(path.join(runtimeUploads, 'general', 'asset.txt'), 'changed asset');
  fs.writeFileSync(path.join(runtimeUploads, 'general', 'new-after-backup.txt'), 'must disappear');
  const restored = await backups.restoreBackup(created.id);
  assert.equal(restored.restored.id, created.id);
  assert.notEqual(restored.safety.id, created.id);
  assert.equal(database.db.prepare("SELECT title FROM posts WHERE slug = 'backup-original'").get().title, 'Backup Original');
  assert.equal(fs.readFileSync(path.join(runtimeUploads, 'general', 'asset.txt'), 'utf8'), 'original asset');
  assert.equal(fs.existsSync(path.join(runtimeUploads, 'general', 'new-after-backup.txt')), false);
  assert.ok(backups.getBackup(restored.safety.id));
  assert.equal(backups.getBackup(created.id), null);
});

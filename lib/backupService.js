const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { DatabaseSync } = require('node:sqlite');
const {
  db, dbPath, snapshotDatabase, flushDB, closeDB, initDB
} = require('../config/db');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const UPLOADS_ROOT = path.resolve(process.env.PUBLIC_DIR || path.join(PROJECT_ROOT, 'public'), 'uploads');
const MEDIA_TRASH_ROOT = path.resolve(process.env.MEDIA_TRASH_DIR || path.join(PROJECT_ROOT, 'database', 'media-trash'));
const BACKUP_ROOT = path.resolve(process.env.BACKUP_DIR || path.join(PROJECT_ROOT, 'database', 'backups'));
const MAGIC = Buffer.from('AEOLEAF_BACKUP_V1\n', 'ascii');
const MAX_MANIFEST_SIZE = 10 * 1024 * 1024;
const ALLOWED_PATH = /^(?:database\/aeoleaf\.db|public\/uploads(?:\/[^/]+)*|database\/media-trash(?:\/[^/]+)*|config\/runtime\.json|package\.json)$/;

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes;
    do {
      bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytes) hash.update(buffer.subarray(0, bytes));
    } while (bytes);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function safeBackupId(value) {
  const id = String(value || '');
  return /^[a-z0-9][a-z0-9-]{10,100}$/i.test(id) ? id : '';
}

function recordEvent(backupId, trigger, outcome, message = '') {
  try {
    db.prepare('INSERT INTO backup_events (backup_id, trigger_type, outcome, message) VALUES (?, ?, ?, ?)')
      .run(String(backupId || ''), String(trigger || 'manual'), outcome, String(message || '').slice(0, 2000));
  } catch {}
}

function collectTree(root, archivePrefix, output) {
  if (!fs.existsSync(root)) return;
  const walk = (dir, relative = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`Backup refuses symbolic link: ${path.join(dir, entry.name)}`);
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute, nextRelative);
      else if (entry.isFile()) output.push({ absolute, archivePath: `${archivePrefix}/${nextRelative}` });
    }
  };
  walk(root);
}

function runtimeConfigSnapshot() {
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    baseUrl: process.env.BASE_URL || '',
    trustProxy: process.env.TRUST_PROXY || 'false',
    sessionCookieSecure: process.env.SESSION_COOKIE_SECURE || 'false',
    databaseFilename: path.basename(dbPath),
    backupFormat: 1
  };
}

function backupPaths(id) {
  return {
    archive: path.join(BACKUP_ROOT, `${id}.aebak`),
    metadata: path.join(BACKUP_ROOT, `${id}.json`)
  };
}

async function createBackup({ trigger = 'manual', applyRetention = true } = {}) {
  fs.mkdirSync(BACKUP_ROOT, { recursive: true });
  const id = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(6).toString('hex')}`;
  const paths = backupPaths(id);
  const partial = `${paths.archive}.partial`;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aeoleaf-backup-create-'));
  try {
    const snapshotPath = path.join(tempRoot, 'aeoleaf.db');
    const { checkpoint } = snapshotDatabase(snapshotPath);
    const dbCheck = new DatabaseSync(snapshotPath, { readOnly: true });
    const integrity = dbCheck.prepare('PRAGMA integrity_check').get()?.integrity_check;
    dbCheck.close();
    if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity || 'unknown'}`);

    const runtimePath = path.join(tempRoot, 'runtime.json');
    fs.writeFileSync(runtimePath, JSON.stringify(runtimeConfigSnapshot(), null, 2));
    const files = [
      { absolute: snapshotPath, archivePath: 'database/aeoleaf.db' },
      { absolute: runtimePath, archivePath: 'config/runtime.json' },
      { absolute: path.join(PROJECT_ROOT, 'package.json'), archivePath: 'package.json' }
    ];
    collectTree(UPLOADS_ROOT, 'public/uploads', files);
    collectTree(MEDIA_TRASH_ROOT, 'database/media-trash', files);
    files.sort((a, b) => a.archivePath.localeCompare(b.archivePath));

    const fileRecords = files.map((file) => {
      const stat = fs.statSync(file.absolute);
      return { path: file.archivePath, size: stat.size, sha256: sha256File(file.absolute) };
    });
    const packageInfo = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    const manifest = {
      format: 'aeoleaf-backup', version: 1, id,
      appVersion: String(packageInfo.version || '0.0.0'),
      createdAt: new Date().toISOString(), trigger,
      checkpoint: { busy: Number(checkpoint?.busy || 0), log: Number(checkpoint?.log || 0), checkpointed: Number(checkpoint?.checkpointed || 0) },
      config: runtimeConfigSnapshot(), files: fileRecords
    };
    const manifestBuffer = Buffer.from(JSON.stringify(manifest), 'utf8');
    if (manifestBuffer.length > MAX_MANIFEST_SIZE) throw new Error('Backup manifest is too large');
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(manifestBuffer.length);

    const archiveChunks = async function* () {
      yield MAGIC;
      yield lengthBuffer;
      yield manifestBuffer;
      for (const file of files) {
        for await (const chunk of fs.createReadStream(file.absolute)) yield chunk;
      }
    };
    await pipeline(Readable.from(archiveChunks()), zlib.createGzip({ level: 6 }), fs.createWriteStream(partial, { flags: 'wx' }));
    fs.renameSync(partial, paths.archive);
    const archiveStat = fs.statSync(paths.archive);
    const metadata = {
      id, appVersion: manifest.appVersion, createdAt: manifest.createdAt, trigger,
      size: archiveStat.size, sha256: sha256File(paths.archive), fileCount: files.length,
      databaseIntegrity: 'ok', checkpoint: manifest.checkpoint
    };
    fs.writeFileSync(`${paths.metadata}.partial`, JSON.stringify(metadata, null, 2), { flag: 'wx' });
    fs.renameSync(`${paths.metadata}.partial`, paths.metadata);
    recordEvent(id, trigger, 'success');
    if (applyRetention) pruneBackups();
    return metadata;
  } catch (error) {
    for (const file of [partial, `${paths.metadata}.partial`]) {
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
    }
    if (!fs.existsSync(paths.metadata)) {
      try { if (fs.existsSync(paths.archive)) fs.unlinkSync(paths.archive); } catch {}
    }
    recordEvent(id, trigger, 'failure', error.message);
    throw error;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function listBackups() {
  fs.mkdirSync(BACKUP_ROOT, { recursive: true });
  return fs.readdirSync(BACKUP_ROOT)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(BACKUP_ROOT, name), 'utf8'));
        const paths = backupPaths(data.id);
        if (!safeBackupId(data.id) || !fs.existsSync(paths.archive)) return null;
        return { ...data, exists: true };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function getBackup(id) {
  const safeId = safeBackupId(id);
  if (!safeId) return null;
  const paths = backupPaths(safeId);
  if (!fs.existsSync(paths.archive) || !fs.existsSync(paths.metadata)) return null;
  try {
    return {
      metadata: JSON.parse(fs.readFileSync(paths.metadata, 'utf8')),
      archive: paths.archive,
      metadataPath: paths.metadata
    };
  }
  catch { return null; }
}

function deleteBackup(id) {
  const backup = getBackup(id);
  if (!backup) return false;
  fs.unlinkSync(backup.archive);
  fs.unlinkSync(backup.metadataPath);
  return true;
}

function pruneBackups() {
  const configured = Number(db.prepare("SELECT value FROM settings WHERE key = 'backup_retention_count'").get()?.value);
  const keep = Number.isInteger(configured) ? Math.min(100, Math.max(1, configured)) : 10;
  listBackups().slice(keep).forEach((backup) => deleteBackup(backup.id));
}

async function extractBackup(archivePath, targetRoot, expectedSha256 = '') {
  if (expectedSha256 && sha256File(archivePath) !== expectedSha256) throw new Error('Backup archive checksum mismatch');
  const tempContainer = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aeoleaf-backup-read-')), 'container.bin');
  const tempDir = path.dirname(tempContainer);
  try {
    await pipeline(fs.createReadStream(archivePath), zlib.createGunzip(), fs.createWriteStream(tempContainer, { flags: 'wx' }));
    const fd = fs.openSync(tempContainer, 'r');
    try {
      const prefix = Buffer.alloc(MAGIC.length + 4);
      if (fs.readSync(fd, prefix, 0, prefix.length, 0) !== prefix.length || !prefix.subarray(0, MAGIC.length).equals(MAGIC)) {
        throw new Error('Unsupported backup format');
      }
      const manifestLength = prefix.readUInt32BE(MAGIC.length);
      if (!manifestLength || manifestLength > MAX_MANIFEST_SIZE) throw new Error('Invalid backup manifest length');
      const manifestBuffer = Buffer.alloc(manifestLength);
      if (fs.readSync(fd, manifestBuffer, 0, manifestLength, prefix.length) !== manifestLength) throw new Error('Truncated backup manifest');
      let manifest;
      try { manifest = JSON.parse(manifestBuffer.toString('utf8')); } catch { throw new Error('Invalid backup manifest JSON'); }
      if (manifest.format !== 'aeoleaf-backup' || manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('Unsupported backup manifest');
      fs.mkdirSync(targetRoot, { recursive: true });
      let offset = prefix.length + manifestLength;
      const containerSize = fs.statSync(tempContainer).size;
      const seen = new Set();
      for (const file of manifest.files) {
        const relative = String(file.path || '').replace(/\\/g, '/');
        if (!ALLOWED_PATH.test(relative) || relative.includes('..') || seen.has(relative)) throw new Error(`Unsafe backup path: ${relative}`);
        seen.add(relative);
        const size = Number(file.size);
        if (!Number.isSafeInteger(size) || size < 0 || offset + size > containerSize) throw new Error(`Invalid backup file size: ${relative}`);
        const target = path.resolve(targetRoot, ...relative.split('/'));
        if (target !== path.resolve(targetRoot) && !target.startsWith(path.resolve(targetRoot) + path.sep)) throw new Error(`Backup path escaped target: ${relative}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const out = fs.openSync(target, 'wx');
        const hash = crypto.createHash('sha256');
        const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(1, size)));
        let remaining = size;
        try {
          while (remaining > 0) {
            const wanted = Math.min(buffer.length, remaining);
            const read = fs.readSync(fd, buffer, 0, wanted, offset);
            if (!read) throw new Error(`Truncated backup file: ${relative}`);
            fs.writeSync(out, buffer, 0, read);
            hash.update(buffer.subarray(0, read));
            offset += read;
            remaining -= read;
          }
        } finally { fs.closeSync(out); }
        if (hash.digest('hex') !== file.sha256) throw new Error(`Backup file checksum mismatch: ${relative}`);
      }
      if (offset !== containerSize) throw new Error('Backup contains unexpected trailing data');
      const restoredDb = path.join(targetRoot, 'database', 'aeoleaf.db');
      if (!fs.existsSync(restoredDb)) throw new Error('Backup does not contain a database');
      const checkDb = new DatabaseSync(restoredDb, { readOnly: true });
      const integrity = checkDb.prepare('PRAGMA integrity_check').get()?.integrity_check;
      checkDb.close();
      if (integrity !== 'ok') throw new Error(`Restored database integrity check failed: ${integrity || 'unknown'}`);
      return { manifest, integrity };
    } finally { fs.closeSync(fd); }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function movePath(source, target) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try { fs.renameSync(source, target); }
  catch (error) {
    if (error.code !== 'EXDEV') throw error;
    fs.cpSync(source, target, { recursive: true, errorOnExist: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
}

async function restoreBackup(id) {
  const selected = getBackup(id);
  if (!selected) throw new Error('Backup not found');
  const safety = await createBackup({ trigger: 'pre_restore', applyRetention: false });
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'aeoleaf-restore-stage-'));
  const rollback = fs.mkdtempSync(path.join(path.dirname(dbPath), 'aeoleaf-restore-rollback-'));
  let databaseClosed = false;
  try {
    const verified = await extractBackup(selected.archive, staged, selected.metadata.sha256);
    await flushDB();
    closeDB();
    databaseClosed = true;
    const stagedDb = path.join(staged, 'database', 'aeoleaf.db');
    const stagedUploads = path.join(staged, 'public', 'uploads');
    const stagedTrash = path.join(staged, 'database', 'media-trash');
    movePath(dbPath, path.join(rollback, 'aeoleaf.db'));
    movePath(`${dbPath}-wal`, path.join(rollback, 'aeoleaf.db-wal'));
    movePath(`${dbPath}-shm`, path.join(rollback, 'aeoleaf.db-shm'));
    movePath(UPLOADS_ROOT, path.join(rollback, 'uploads'));
    movePath(MEDIA_TRASH_ROOT, path.join(rollback, 'media-trash'));
    try {
      movePath(stagedDb, dbPath);
      if (fs.existsSync(stagedUploads)) movePath(stagedUploads, UPLOADS_ROOT); else fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
      if (fs.existsSync(stagedTrash)) movePath(stagedTrash, MEDIA_TRASH_ROOT); else fs.mkdirSync(MEDIA_TRASH_ROOT, { recursive: true });
      initDB();
      databaseClosed = false;
    } catch (error) {
      for (const currentDbFile of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
        try { if (fs.existsSync(currentDbFile)) fs.unlinkSync(currentDbFile); } catch {}
      }
      try { if (fs.existsSync(UPLOADS_ROOT)) fs.rmSync(UPLOADS_ROOT, { recursive: true, force: true }); } catch {}
      try { if (fs.existsSync(MEDIA_TRASH_ROOT)) fs.rmSync(MEDIA_TRASH_ROOT, { recursive: true, force: true }); } catch {}
      movePath(path.join(rollback, 'aeoleaf.db'), dbPath);
      movePath(path.join(rollback, 'aeoleaf.db-wal'), `${dbPath}-wal`);
      movePath(path.join(rollback, 'aeoleaf.db-shm'), `${dbPath}-shm`);
      movePath(path.join(rollback, 'uploads'), UPLOADS_ROOT);
      movePath(path.join(rollback, 'media-trash'), MEDIA_TRASH_ROOT);
      initDB();
      databaseClosed = false;
      throw error;
    }
    recordEvent(id, 'restore', 'success', `Safety backup: ${safety.id}`);
    pruneBackups();
    return { restored: selected.metadata, safety, manifest: verified.manifest };
  } catch (error) {
    if (databaseClosed) {
      try { initDB(); } catch {}
    }
    recordEvent(id, 'restore', 'failure', error.message);
    throw error;
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
    fs.rmSync(rollback, { recursive: true, force: true });
  }
}

function recentEvents(limit = 50) {
  return db.prepare('SELECT * FROM backup_events ORDER BY id DESC LIMIT ?').all(Math.min(200, Math.max(1, limit)));
}

function scheduleDue() {
  const enabled = db.prepare("SELECT value FROM settings WHERE key = 'backup_schedule_enabled'").get()?.value === '1';
  if (!enabled) return false;
  const hoursRaw = Number(db.prepare("SELECT value FROM settings WHERE key = 'backup_interval_hours'").get()?.value);
  const hours = Number.isInteger(hoursRaw) ? Math.min(720, Math.max(1, hoursRaw)) : 24;
  const latest = listBackups().find((item) => item.trigger === 'scheduled');
  return !latest || Date.now() - new Date(latest.createdAt).getTime() >= hours * 60 * 60 * 1000;
}

module.exports = {
  BACKUP_ROOT,
  createBackup,
  listBackups,
  getBackup,
  deleteBackup,
  extractBackup,
  restoreBackup,
  recentEvents,
  scheduleDue,
  sha256File
};

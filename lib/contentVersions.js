const crypto = require('crypto');

const FIELDS = {
  post: ['title', 'slug', 'excerpt', 'content', 'cover_image', 'tags', 'status', 'scheduled_at', 'unpublish_at', 'published_at', 'seo_title', 'seo_description', 'canonical_url', 'og_image', 'noindex'],
  work: ['title', 'slug', 'description', 'content', 'cover_image', 'images', 'tags', 'url', 'year', 'date', 'featured', 'sort_order']
};

function snapshotFor(entityType, row) {
  if (!FIELDS[entityType] || !row) throw new Error('Unsupported version entity');
  const snapshot = {};
  FIELDS[entityType].forEach((field) => { snapshot[field] = row[field] ?? null; });
  return snapshot;
}

function normalizeSnapshot(entityType, input) {
  const snapshot = {};
  FIELDS[entityType].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(input || {}, field)) snapshot[field] = input[field];
  });
  return snapshot;
}

function hashSnapshot(snapshot) {
  return crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function saveVersion(db, entityType, entityId, snapshot, source = 'save', actorId = '') {
  const normalized = normalizeSnapshot(entityType, snapshot);
  const json = JSON.stringify(normalized);
  const hash = hashSnapshot(normalized);
  const result = db.prepare(`
    INSERT OR IGNORE INTO content_versions
      (entity_type, entity_id, source, actor_id, snapshot_json, content_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(entityType, entityId, source, String(actorId || ''), json, hash);
  return { created: result.changes > 0, hash };
}

function listVersions(db, entityType, entityId, limit = 50) {
  const cap = Math.max(1, Math.min(100, Number(limit) || 50));
  return db.prepare(`
    SELECT id, entity_type, entity_id, source, actor_id, snapshot_json, content_hash, created_at
    FROM content_versions
    WHERE entity_type = ? AND entity_id = ?
    ORDER BY id DESC LIMIT ?
  `).all(entityType, entityId, cap).map((row) => ({
    ...row,
    snapshot: JSON.parse(row.snapshot_json)
  }));
}

function getVersion(db, entityType, entityId, versionId) {
  const row = db.prepare(`
    SELECT * FROM content_versions
    WHERE id = ? AND entity_type = ? AND entity_id = ?
  `).get(versionId, entityType, entityId);
  return row ? { ...row, snapshot: JSON.parse(row.snapshot_json) } : null;
}

module.exports = { FIELDS, snapshotFor, normalizeSnapshot, saveVersion, listVersions, getVersion };

const { destroyQuarantinedUpload } = require('./safeFs');
const { logAudit } = require('./auditLog');

function runTrashCleanup(db) {
  const enabled = db.prepare("SELECT value FROM settings WHERE key = 'trash_retention_enabled'").get()?.value === '1';
  if (!enabled) return { enabled: false, removed: 0 };
  const configuredDays = Number(db.prepare("SELECT value FROM settings WHERE key = 'trash_retention_days'").get()?.value);
  const days = Number.isInteger(configuredDays) ? Math.min(3650, Math.max(1, configuredDays)) : 30;
  const modifier = `-${days} days`;
  let removed = 0;

  const removeContent = db.transaction(() => {
    for (const type of ['post', 'work']) {
      const table = type === 'post' ? 'posts' : 'works';
      const rows = db.prepare(`SELECT id FROM ${table} WHERE deleted_at != '' AND deleted_at <= datetime('now', 'localtime', ?)`).all(modifier);
      rows.forEach((row) => {
        db.prepare('DELETE FROM content_versions WHERE entity_type = ? AND entity_id = ?').run(type, row.id);
        db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(row.id);
        removed += 1;
      });
    }
    removed += db.prepare("DELETE FROM guestbook WHERE deleted_at != '' AND deleted_at <= datetime('now', 'localtime', ?)").run(modifier).changes;
  });
  removeContent();

  const media = db.prepare("SELECT * FROM media_trash WHERE deleted_at <= datetime('now', 'localtime', ?)").all(modifier);
  media.forEach((row) => {
    if (!destroyQuarantinedUpload(row.quarantine_name)) return;
    db.prepare('DELETE FROM media_trash WHERE id = ?').run(row.id);
    removed += 1;
  });
  if (removed) logAudit(db, null, { action: 'trash.cleanup', entityType: 'trash', summary: { days, removed } });
  return { enabled: true, days, removed };
}

module.exports = { runTrashCleanup };

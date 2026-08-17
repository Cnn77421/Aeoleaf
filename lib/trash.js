const { quarantinePublicUpload, restoreQuarantinedUpload } = require('./safeFs');
const { logAudit } = require('./auditLog');

function trashMedia(db, req, url, summary = {}) {
  const moved = quarantinePublicUpload(url);
  if (!moved) return null;
  let result;
  try {
    result = db.prepare(`
      INSERT INTO media_trash (original_url, quarantine_name, original_size)
      VALUES (?, ?, ?)
    `).run(url, moved.quarantineName, moved.size);
  } catch (error) {
    restoreQuarantinedUpload(moved.quarantineName, url);
    throw error;
  }
  logAudit(db, req, {
    action: 'media.delete', entityType: 'media', entityId: result.lastInsertRowid,
    summary: { url, ...summary }
  });
  return { id: result.lastInsertRowid, ...moved };
}

module.exports = { trashMedia };

const { logAudit } = require('./auditLog');

function localTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function runPublishSchedule(db, now = new Date()) {
  const timestamp = typeof now === 'string' ? now : localTimestamp(now);
  const dueToPublish = db.prepare(`
    SELECT id, title, scheduled_at FROM posts
    WHERE deleted_at = '' AND status = 'draft' AND scheduled_at != '' AND scheduled_at <= ?
  `).all(timestamp);
  const dueToUnpublish = db.prepare(`
    SELECT id, title, unpublish_at FROM posts
    WHERE deleted_at = '' AND status = 'published' AND unpublish_at != '' AND unpublish_at <= ?
  `).all(timestamp);

  const apply = db.transaction(() => {
    dueToPublish.forEach((post) => {
      db.prepare(`
        UPDATE posts SET status='published', published_at=?, scheduled_at='',
          content_revision=content_revision+1, updated_at=? WHERE id=?
      `).run(post.scheduled_at || timestamp, timestamp, post.id);
      logAudit(db, null, {
        action: 'post.schedule_publish', entityType: 'post', entityId: post.id,
        summary: { title: post.title, scheduledAt: post.scheduled_at }
      });
    });
    dueToUnpublish.forEach((post) => {
      db.prepare(`
        UPDATE posts SET status='draft', unpublish_at='',
          content_revision=content_revision+1, updated_at=? WHERE id=?
      `).run(timestamp, post.id);
      logAudit(db, null, {
        action: 'post.schedule_unpublish', entityType: 'post', entityId: post.id,
        summary: { title: post.title, unpublishAt: post.unpublish_at }
      });
    });
  });
  if (dueToPublish.length || dueToUnpublish.length) apply();
  return { published: dueToPublish.length, unpublished: dueToUnpublish.length };
}

module.exports = { localTimestamp, runPublishSchedule };

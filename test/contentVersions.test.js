const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitize, notificationForAudit } = require('../lib/auditLog');
const { snapshotFor, normalizeSnapshot, hashSnapshot } = (() => {
  const versions = require('../lib/contentVersions');
  return { ...versions, hashSnapshot: (value) => require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex') };
})();

test('content snapshots keep only supported fields', () => {
  const snapshot = snapshotFor('post', {
    title: 'Title', slug: 'slug', content: 'Body', status: 'draft', password: 'must-not-leak'
  });
  assert.equal(snapshot.title, 'Title');
  assert.equal(snapshot.password, undefined);
  assert.equal(normalizeSnapshot('post', { title: 'Draft', unknown: 'x' }).unknown, undefined);
  assert.equal(hashSnapshot(snapshot).length, 64);
});

test('audit events map only actionable events to notifications', () => {
  assert.equal(notificationForAudit({ action: 'post.update', outcome: 'success' }), null);
  assert.deepEqual(notificationForAudit({ action: 'post.schedule_publish', entityId: 9, summary: { title: 'Scheduled' } }), {
    severity: 'success', title: '预约文章已发布', message: 'Scheduled 已按计划公开', actionUrl: '/admin/posts/9/edit'
  });
  assert.equal(notificationForAudit({ action: 'backup.create', outcome: 'failure', summary: { reason: 'disk full' } }).severity, 'error');
  assert.deepEqual(notificationForAudit({ action: 'health.degraded', outcome: 'failure', summary: { message: '磁盘空间' } }), {
    severity: 'error', title: '系统健康状态异常', message: '磁盘空间', actionUrl: '/admin/health'
  });
});

test('audit summaries redact secrets and bound long values', () => {
  const clean = sanitize({ password: 'secret', nested: { sessionToken: 'token' }, title: 'x'.repeat(2500) });
  assert.equal(clean.password, '[redacted]');
  assert.equal(clean.nested.sessionToken, '[redacted]');
  assert.ok(clean.title.length < 2100);
});

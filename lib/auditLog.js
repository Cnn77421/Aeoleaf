const SECRET_KEY = /(password|secret|token|cookie|authorization|session)/i;

function sanitize(value, depth = 0) {
  if (depth > 4) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    const clean = {};
    Object.entries(value).slice(0, 100).forEach(([key, item]) => {
      clean[key] = SECRET_KEY.test(key) ? '[redacted]' : sanitize(item, depth + 1);
    });
    return clean;
  }
  const text = typeof value === 'string' ? value : String(value);
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : value;
}

function clientIp(req) {
  return String(req?.ip || req?.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

function notificationForAudit(event) {
  const action = String(event?.action || '');
  const outcome = String(event?.outcome || 'success');
  const summary = event?.summary || {};
  const entityId = String(event?.entityId ?? '');
  if (action === 'health.degraded') return { severity: outcome === 'failure' ? 'error' : 'warning', title: '系统健康状态异常', message: String(summary.message || '健康检查发现异常，请及时处理'), actionUrl: '/admin/health' };
  if (action === 'health.recovered') return { severity: 'success', title: '系统健康状态已恢复', message: '自动健康检查已恢复正常', actionUrl: '/admin/health' };
  if (outcome === 'failure') {
    if (action.startsWith('backup.')) return { severity: 'error', title: '备份操作失败', message: String(summary.reason || summary.message || '请检查备份配置和磁盘状态'), actionUrl: '/admin/backups' };
    if (action.startsWith('auth.')) return { severity: 'warning', title: summary.reason === 'temporarily_locked' ? '登录尝试已被锁定' : '后台认证失败', message: String(summary.reason || '检测到一次失败的认证尝试'), actionUrl: '/admin/security' };
    return { severity: 'error', title: '后台操作失败', message: action || '未知操作', actionUrl: '/admin/audit?outcome=failure' };
  }
  if (action === 'guestbook.create' && summary.status === 'pending') return { severity: 'info', title: '有新的待审核留言', message: String(summary.name || '访客') + ' 提交了留言', actionUrl: '/admin/guestbook' };
  if (action === 'post.schedule_publish') return { severity: 'success', title: '预约文章已发布', message: String(summary.title || '文章') + ' 已按计划公开', actionUrl: entityId ? `/admin/posts/${entityId}/edit` : '/admin/posts' };
  if (action === 'post.schedule_unpublish') return { severity: 'warning', title: '文章已自动下线', message: String(summary.title || '文章') + ' 已按计划转为草稿', actionUrl: entityId ? `/admin/posts/${entityId}/edit` : '/admin/posts' };
  return null;
}

function createNotification(db, event) {
  const notification = notificationForAudit(event);
  if (!notification) return null;
  try {
    const duplicate = db.prepare(`
      SELECT id FROM notifications WHERE read_at='' AND source_action=? AND source_id=? AND title=?
        AND created_at>=datetime('now','-10 minutes','localtime') ORDER BY id DESC LIMIT 1
    `).get(String(event.action || ''), String(event.entityId ?? ''), notification.title);
    if (duplicate) return null;
    return db.prepare(`
      INSERT INTO notifications (severity, title, message, action_url, source_action, source_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(notification.severity, notification.title, notification.message.slice(0, 1000), notification.actionUrl, String(event.action || ''), String(event.entityId ?? ''));
  } catch (_error) {
    return null;
  }
}

function logAudit(db, req, event) {
  const safe = event || {};
  const result = db.prepare(`
    INSERT INTO audit_log
      (action, entity_type, entity_id, outcome, summary_json, ip, user_agent, request_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(safe.action || 'unknown'),
    String(safe.entityType || ''),
    String(safe.entityId ?? ''),
    String(safe.outcome || 'success'),
    JSON.stringify(sanitize(safe.summary || {})),
    clientIp(req),
    String(req?.get?.('user-agent') || '').slice(0, 1000),
    String(req?.id || req?.get?.('x-request-id') || '').slice(0, 200)
  );
  createNotification(db, safe);
  return result;
}

module.exports = { logAudit, sanitize, notificationForAudit, createNotification };

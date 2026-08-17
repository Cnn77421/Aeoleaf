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

function logAudit(db, req, event) {
  const safe = event || {};
  db.prepare(`
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
    String(req?.get?.('x-request-id') || '').slice(0, 200)
  );
}

module.exports = { logAudit, sanitize };

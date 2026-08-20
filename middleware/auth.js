function requireAdmin(req, res, next) {
  if (req.session && req.session.admin === true) {
    return next();
  }
  // Inside mounted routers `req.path` is relative to the mount (e.g. "/1"),
  // so checking `req.baseUrl` and `req.originalUrl` is more reliable.
  const base = req.baseUrl || '';
  const orig = req.originalUrl || req.url || '';
  const wantsJson = base.startsWith('/api/')
    || orig.startsWith('/api/')
    || (req.get && (req.get('accept') || '').includes('application/json'))
    || req.xhr;
  if (wantsJson) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect('/admin/login');
}

function isRecentlyAuthenticated(req, maxAgeMs = 30 * 60 * 1000) {
  const authenticatedAt = Number(req.session?.security?.authenticatedAt || 0);
  return authenticatedAt > 0 && Date.now() - authenticatedAt <= maxAgeMs;
}

function requireRecentAuth(req, res, next) {
  if (isRecentlyAuthenticated(req)) return next();
  const wantsJson = String(req.get?.('accept') || '').includes('application/json') || req.xhr;
  if (wantsJson) return res.status(403).json({ error: '需要重新验证管理员身份', code: 'REAUTH_REQUIRED' });
  return res.redirect('/admin/security?err=reauth');
}

module.exports = { requireAdmin, requireRecentAuth, isRecentlyAuthenticated };

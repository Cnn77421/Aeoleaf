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

module.exports = { requireAdmin };

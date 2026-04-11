function requireAdmin(req, res, next) {
  if (req.session && req.session.admin === true) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect('/admin/login');
}

module.exports = { requireAdmin };

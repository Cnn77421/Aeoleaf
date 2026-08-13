const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function requestOrigin(req) {
  const origin = req.get('origin');
  if (origin) return origin;
  const referer = req.get('referer');
  if (!referer) return '';
  try { return new URL(referer).origin; } catch { return ''; }
}

function expectedOrigin(req) {
  const configured = String(process.env.BASE_URL || '').trim();
  if (configured) {
    try { return new URL(configured).origin; } catch { /* validated at startup */ }
  }
  return `${req.protocol}://${req.get('host')}`;
}

function requireSameOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const actual = requestOrigin(req);
  if (actual && actual === expectedOrigin(req)) return next();
  return res.status(403).json({ error: 'Cross-site request rejected' });
}

module.exports = { requireSameOrigin, requestOrigin, expectedOrigin };

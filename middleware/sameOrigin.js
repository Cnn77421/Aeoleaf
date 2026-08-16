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
  if (actual) {
    if (actual === expectedOrigin(req)) return next();
  } else if (req.get('sec-fetch-site') === 'same-origin') {
    // Origin/Referer can be removed by privacy software. Sec-Fetch-Site is a
    // browser-controlled forbidden request header, so it is a safe fallback
    // for a genuinely same-origin form submission.
    return next();
  }
  return res.status(403).json({ error: 'Cross-site request rejected' });
}

module.exports = { requireSameOrigin, requestOrigin, expectedOrigin };

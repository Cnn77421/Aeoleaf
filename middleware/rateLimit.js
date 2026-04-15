const buckets = new Map();

/**
 * Simple fixed-window rate limiter by IP.
 * @param {{ windowMs: number; max: number; message?: string }} opts
 */
function rateLimit(opts) {
  const windowMs = opts.windowMs;
  const max = opts.max;
  const message = opts.message || 'Too many requests';

  return function rateLimitMiddleware(req, res, next) {
    const ip = (req.ip || req.socket.remoteAddress || 'unknown').replace('::ffff:', '');
    const now = Date.now();
    let b = buckets.get(ip);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, b);
    }
    b.count += 1;
    if (b.count > max) {
      const retrySec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
      res.set('Retry-After', String(retrySec));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = { rateLimit };

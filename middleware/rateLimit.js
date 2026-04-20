const buckets = new Map();
const MAX_BUCKETS = 10000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

let lastSweep = Date.now();
function sweep(now) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(key);
  }
  if (buckets.size > MAX_BUCKETS) {
    const keep = Array.from(buckets.entries())
      .sort((a, b) => b[1].resetAt - a[1].resetAt)
      .slice(0, MAX_BUCKETS);
    buckets.clear();
    keep.forEach(([k, v]) => buckets.set(k, v));
  }
}

/**
 * Simple fixed-window rate limiter by IP.
 * Accepts `keyPrefix` so different routes can share or segregate counters.
 * @param {{ windowMs: number; max: number; message?: string; keyPrefix?: string }} opts
 */
function rateLimit(opts) {
  const windowMs = opts.windowMs;
  const max = opts.max;
  const message = opts.message || 'Too many requests';
  const keyPrefix = opts.keyPrefix || '';

  return function rateLimitMiddleware(req, res, next) {
    const ip = (req.ip || req.socket.remoteAddress || 'unknown').replace('::ffff:', '');
    const key = keyPrefix + ip;
    const now = Date.now();
    sweep(now);
    let b = buckets.get(key);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > max) {
      const retrySec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
      res.set('Retry-After', String(retrySec));
      const wantsJson = req.path.startsWith('/api/')
        || (req.get('accept') || '').includes('application/json')
        || req.xhr;
      if (wantsJson) {
        return res.status(429).json({ error: message });
      }
      return res.status(429).type('text/plain').send(`${message} (retry in ${retrySec}s)`);
    }
    next();
  };
}

module.exports = { rateLimit };

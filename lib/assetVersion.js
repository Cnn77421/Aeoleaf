// Automatic cache-busting for static assets under /public.
// Appends ?v=<mtimeHash> so the URL changes whenever the file changes,
// which makes stale browser caches impossible without hand-bumping.
//
// Usage (in EJS templates, via app.locals):
//   <link rel="stylesheet" href="<%= asset('/css/main.css') %>">
//   <script src="<%= asset('/js/main.js') %>"></script>
//
// In production, versions are memoized after the first lookup per path.
// In development, mtime is re-read on each call so edits show up immediately.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const isProd = process.env.NODE_ENV === 'production';
const cache = new Map();

function computeVersion(relPath) {
  try {
    const abs = path.join(PUBLIC_DIR, relPath.replace(/^\//, '').split('?')[0]);
    const stat = fs.statSync(abs);
    const raw = String(stat.mtimeMs) + ':' + stat.size;
    return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 10);
  } catch (e) {
    // File missing — fall back to a stable token so links still render.
    return '0';
  }
}

function asset(relPath) {
  if (!relPath || typeof relPath !== 'string') return relPath;
  // External URLs are returned unchanged.
  if (/^(?:[a-z]+:)?\/\//i.test(relPath)) return relPath;

  const [pathOnly, queryFragment = ''] = relPath.split('?');

  if (isProd && cache.has(pathOnly)) {
    const v = cache.get(pathOnly);
    return appendVersion(pathOnly, queryFragment, v);
  }

  const v = computeVersion(pathOnly);
  if (isProd) cache.set(pathOnly, v);
  return appendVersion(pathOnly, queryFragment, v);
}

function appendVersion(pathOnly, queryFragment, v) {
  const existing = queryFragment
    ? queryFragment.split('&').filter((p) => p && !/^v=/.test(p))
    : [];
  existing.push('v=' + v);
  return pathOnly + '?' + existing.join('&');
}

module.exports = { asset };

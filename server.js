require('dotenv').config();
const express = require('express');
const session = require('express-session');
const compression = require('compression');
const helmet = require('helmet');
const path = require('path');
const { pathWithoutQuery } = require('./lib/pathWithoutQuery');
const { asset } = require('./lib/assetVersion');
const { validateRuntimeConfig } = require('./lib/runtimeConfig');
const { SQLiteSessionStore } = require('./lib/sqliteSessionStore');
const { initDB, flushDB, closeDB, db, isBlacklisted } = require('./config/db');
const { runTrashCleanup } = require('./lib/trashCleanup');
const { createBackup, scheduleDue } = require('./lib/backupService');

const app = express();
const PORT = process.env.PORT || 3000;
let runtimeConfig;
try {
  runtimeConfig = validateRuntimeConfig(process.env);
} catch (err) {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
}
const isProd = runtimeConfig.isProd;
app.set('trust proxy', runtimeConfig.trustProxy);

function resolveBaseUrl(req) {
  const configured = String(process.env.BASE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

if (!isProd && !process.env.ADMIN_PASSWORD) {
  console.warn('[warn] ADMIN_PASSWORD is empty; admin login is disabled.');
}

let httpServer = null;
let sessionStore = null;
let shuttingDown = false;
let trashCleanupTimer = null;
let backupScheduleTimer = null;
let scheduledBackupRunning = false;

async function shutdown(exitCode, reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (reason) console.error(reason);

  const forceExit = setTimeout(() => {
    console.error('FATAL: Graceful shutdown timed out.');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }
    if (sessionStore) sessionStore.close();
    if (trashCleanupTimer) clearInterval(trashCleanupTimer);
    if (backupScheduleTimer) clearInterval(backupScheduleTimer);
    await flushDB();
    closeDB();
  } catch (err) {
    console.error('Error during shutdown:', err && err.stack || err);
    exitCode = 1;
  } finally {
    clearTimeout(forceExit);
    process.exit(exitCode);
  }
}

process.once('unhandledRejection', (reason) => {
  void shutdown(1, `[unhandledRejection] ${reason && reason.stack || reason}`);
});
process.once('uncaughtException', (err) => {
  void shutdown(1, `[uncaughtException] ${err && err.stack || err}`);
});
process.once('SIGINT', () => { void shutdown(0); });
process.once('SIGTERM', () => { void shutdown(0); });

(async () => {
  await initDB();
  runTrashCleanup(db);
  trashCleanupTimer = setInterval(() => runTrashCleanup(db), 6 * 60 * 60 * 1000);
  trashCleanupTimer.unref();
  const runScheduledBackup = async () => {
    if (scheduledBackupRunning || !scheduleDue()) return;
    scheduledBackupRunning = true;
    try { await createBackup({ trigger: 'scheduled' }); }
    catch (error) { console.error('[backup] scheduled backup failed:', error.message); }
    finally { scheduledBackupRunning = false; }
  };
  backupScheduleTimer = setInterval(() => { void runScheduledBackup(); }, 15 * 60 * 1000);
  backupScheduleTimer.unref();
  void runScheduledBackup();

// Only compress text-like payloads; skip images, fonts, video where the
// bytes are already compressed (compression wastes CPU for no gain).
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    const type = String(res.getHeader('Content-Type') || '').toLowerCase();
    if (!type) return compression.filter(req, res);
    if (/^(image|video|audio|font)\//.test(type)) return false;
    if (/application\/(zip|gzip|x-bzip2|x-7z|pdf|octet-stream)/.test(type)) return false;
    return compression.filter(req, res);
  }
}));

// Content Security Policy. Admin editor loads EasyMDE from unpkg, so we
// allow that origin explicitly. Disable with HELMET_CSP=off if something
// breaks in production; switch to report-only with HELMET_CSP_REPORT_ONLY=1.
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://cdn.jsdelivr.net'],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
  imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'https://ui-avatars.com'],
  connectSrc: ["'self'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  objectSrc: ["'none'"],
  upgradeInsecureRequests: []
};

const helmetOpts = {};
const cspMode = String(process.env.HELMET_CSP || '').toLowerCase();
if (cspMode === 'off') {
  helmetOpts.contentSecurityPolicy = false;
} else if (process.env.HELMET_CSP_REPORT_ONLY === '1' || cspMode === 'report') {
  helmetOpts.contentSecurityPolicy = {
    useDefaults: false,
    reportOnly: true,
    directives: cspDirectives
  };
} else if (isProd || cspMode === 'on') {
  helmetOpts.contentSecurityPolicy = {
    useDefaults: false,
    directives: cspDirectives
  };
} else {
  // Local dev: disabled by default to keep the feedback loop fast.
  helmetOpts.contentSecurityPolicy = false;
}
app.use(helmet(helmetOpts));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.locals.asset = asset;
app.use((req, res, next) => {
  res.locals.baseUrl = resolveBaseUrl(req);
  const now = new Date();
  res.locals.isBirthday = (now.getMonth() === 4 && now.getDate() === 21);
  next();
});

// Size-appropriate body parsers: keep tracker tiny (beacons should never
// exceed a few KB) and cap JSON by route family. Content endpoints that
// accept long markdown (posts / works) get a larger envelope via
// `largeJsonParser`; everything else uses a tight default.
const defaultJsonParser = express.json({ limit: '256kb' });
const largeJsonParser = express.json({ limit: '2mb' });
const trackRawParser = express.raw({ type: '*/*', limit: '128kb' });

app.use((req, res, next) => {
  const p = pathWithoutQuery(req);
  if (req.method === 'POST' && p === '/api/track') {
    return trackRawParser(req, res, (err) => {
      if (err) return next(err);
      try {
        if (Buffer.isBuffer(req.body) && req.body.length) {
          const text = req.body.toString('utf8');
          req.body = text ? JSON.parse(text) : {};
        } else {
          req.body = {};
        }
      } catch (e) {
        req.body = {};
      }
      return next();
    });
  }
  // Markdown bodies can be meaningful; give them headroom.
  const needsLarge = /^\/api\/(posts|works)/.test(p);
  return (needsLarge ? largeJsonParser : defaultJsonParser)(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.get('/robots.txt', (req, res) => {
  const base = resolveBaseUrl(req);
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`
  );
});

// Fallback for legacy /favicon.ico. The canonical asset is /images/favicon.svg.
// NOTE: We intentionally do NOT rewrite /images/logo.png — a real PNG exists at
// that path and social crawlers (og:image) rely on correct MIME. The static
// middleware below serves it as-is. If the file is missing, 404 is correct.
const faviconSvgPath = path.join(__dirname, 'public', 'images', 'favicon.svg');
app.get('/favicon.ico', (req, res) => {
  res.type('image/svg+xml').setHeader('Cache-Control', 'public, max-age=604800');
  res.sendFile(faviconSvgPath, (err) => { if (err) res.status(204).end(); });
});

app.use((req, res, next) => {
  const clientIp = (req.ip || req.socket.remoteAddress || '').replace('::ffff:', '');
  if (isBlacklisted(clientIp)) {
    return res.status(403).send('Access Denied');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  setHeaders: (res, filePath) => {
    // Fingerprinted assets (rendered with ?v=<hash>) are safe to cache long-term.
    // When the file changes, the URL changes, and the browser re-fetches.
    // Everything still returns ETag so un-fingerprinted requests revalidate fast.
    const ext = path.extname(filePath).toLowerCase();
    const longLived = ['.css', '.js', '.woff', '.woff2', '.ttf', '.otf', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.ico', '.gif'];
    if (longLived.includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    }
  }
}));

// HTML responses must always revalidate so every page load picks up the
// latest rendered `?v=<hash>` for CSS / JS. ETag keeps this cheap (304s).
app.use((req, res, next) => {
  const accept = req.headers.accept || '';
  const looksHtml = (req.method === 'GET' || req.method === 'HEAD')
    && !req.path.startsWith('/api/')
    && !/\.[a-z0-9]{2,5}$/i.test(req.path)
    && accept.indexOf('text/html') !== -1;
  if (looksHtml) {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  }
  next();
});

const sessionCookieSecure = process.env.SESSION_COOKIE_SECURE === 'true'
  || (isProd && String(process.env.BASE_URL || '').startsWith('https://'));

// Session only applies to dynamic routes below this point; static files
// above never allocate or decode session cookies.
const sessionMiddleware = session({
  store: (sessionStore = new SQLiteSessionStore(db)),
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: sessionCookieSecure,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
});
app.use((req, res, next) => {
  // Skip sessions for pure tracker beacons: tracking is anonymous and should
  // never depend on a session cookie.
  if (req.path === '/api/track') return next();
  return sessionMiddleware(req, res, next);
});

const { requireSameOrigin } = require('./middleware/sameOrigin');
const protectedWritePaths = /^\/(admin(?:\/|$)|api\/(?:auth|posts|works)(?:\/|$))/;
app.use((req, res, next) => {
  if (!protectedWritePaths.test(req.path)) return next();
  return requireSameOrigin(req, res, next);
});

app.use('/api/auth', require('./routes/api/auth'));
app.use('/api/posts', require('./routes/api/posts'));
app.use('/api/works', require('./routes/api/works'));
app.use('/api/search', require('./routes/api/search'));
app.use('/api/track', require('./routes/api/track'));
app.use('/api/guestbook', require('./routes/api/guestbook'));
app.use('/', require('./routes/api/sitemap'));
app.use('/', require('./routes/api/rss'));
app.use('/admin', require('./routes/admin'));
app.use('/', require('./routes/pages'));

app.use((req, res) => {
  res.status(404).render('404', {
    title: 'Not Found',
    errorCode: 404,
    errorTitle: '风把你带到了没有文字的地方',
    errorMessage: '这页可能从未生长，也可能已随时节凋落。你可以从首页重新出发，或去搜索一下。'
  });
});

app.use((err, req, res, _next) => {
  console.error(err.stack);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: isProd ? 'Internal server error' : err.message });
  }
  res.status(500).render('404', {
    title: 'Server Error',
    errorCode: 500,
    errorTitle: '服务器此刻有些迷失',
    errorMessage: '后台出了点小状况。稍后再试，或回到首页走走。'
  });
});

  httpServer = app.listen(PORT, () => {
    console.log(`aeoleaf running on http://localhost:${PORT}`);
  });
  httpServer.once('error', (err) => {
    void shutdown(1, `[listen] ${err && err.stack || err}`);
  });
})();

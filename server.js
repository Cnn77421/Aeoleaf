require('dotenv').config();
const express = require('express');
const session = require('express-session');
const compression = require('compression');
const helmet = require('helmet');
const path = require('path');
const { pathWithoutQuery } = require('./lib/pathWithoutQuery');
const { initDB, flushDB, isBlacklisted } = require('./config/db');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

if (isProd) {
  const sec = process.env.SESSION_SECRET;
  if (!sec || sec === 'change-this-secret' || sec.length < 24) {
    console.error('FATAL: Set SESSION_SECRET to a random string of at least 24 characters in production.');
    process.exit(1);
  }
}

(async () => {
  await initDB();

app.use(compression());

const helmetOpts = { contentSecurityPolicy: false };
if (process.env.HELMET_CSP_REPORT_ONLY === '1') {
  helmetOpts.contentSecurityPolicy = {
    useDefaults: false,
    reportOnly: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:', 'http:', 'blob:'],
      connectSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  };
}
app.use(helmet(helmetOpts));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.locals.baseUrl = process.env.BASE_URL || 'http://localhost:3000';

const jsonParser = express.json({ limit: '5mb' });
const trackRawParser = express.raw({ type: '*/*', limit: '512kb' });

app.use((req, res, next) => {
  if (req.method === 'POST' && pathWithoutQuery(req) === '/api/track') {
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
  return jsonParser(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.get('/robots.txt', (req, res) => {
  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`
  );
});

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true
}));

app.use((req, res, next) => {
  const clientIp = (req.ip || req.socket.remoteAddress || '').replace('::ffff:', '');
  if (isBlacklisted(clientIp)) {
    return res.status(403).send('Access Denied');
  }
  next();
});

const sessionCookieSecure = process.env.SESSION_COOKIE_SECURE === 'true'
  || (isProd && String(process.env.BASE_URL || '').startsWith('https://'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: sessionCookieSecure,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use('/api/auth', require('./routes/api/auth'));
app.use('/api/posts', require('./routes/api/posts'));
app.use('/api/works', require('./routes/api/works'));
app.use('/api/search', require('./routes/api/search'));
app.use('/api/track', require('./routes/api/track'));
app.use('/', require('./routes/api/sitemap'));
app.use('/', require('./routes/api/rss'));
app.use('/', require('./routes/pages'));

app.use((req, res) => {
  res.status(404).render('404', { title: 'Not Found' });
});

app.use((err, req, res, _next) => {
  console.error(err.stack);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: err.message });
  }
  res.status(500).render('404', { title: 'Error' });
});

  async function shutdown() {
    try {
      await flushDB();
    } catch (e) {
      console.error('flushDB on shutdown:', e);
    }
    process.exit(0);
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  app.listen(PORT, () => {
    console.log(`aeoleaf running on http://localhost:${PORT}`);
  });
})();

// Admin backend routes — the authenticated dashboard, content CRUD entry
// pages, settings, and the visitor-analytics console. Split out of pages.js so
// the public SSR routes and the admin surface live in separate files. Every
// route here except the login GET/POST requires an authenticated admin session.
const router = require('express').Router();
const {
  db,
  saveDBSync,
  getVisitorOverview,
  getVisitorTrend,
  getRegionDistribution,
  getTopPages,
  getVisitorsPage,
  getVisitorsByFilter,
  getVisitorDetail,
  getVisitorSessionById,
  getVisitorPathBySession,
  getVisitorsByFingerprint,
  getSessionsPage,
  addToBlacklist,
  removeFromBlacklist,
  getBlacklistIps
} = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { uploadGeneral, validateUploadedFiles } = require('../middleware/upload');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  message: 'Too many login attempts, try again later',
  keyPrefix: 'login:'
});

const settingsUpload = uploadGeneral.fields([
  { name: 'home_hero_desktop_file', maxCount: 1 },
  { name: 'home_hero_mobile_file', maxCount: 1 }
]);

function parseSettingsUpload(req, res, next) {
  settingsUpload(req, res, async (err) => {
    if (err) return res.redirect('/admin/settings?err=upload');
    try {
      await validateUploadedFiles(req);
      return next();
    } catch {
      return res.redirect('/admin/settings?err=upload');
    }
  });
}

function normalizeHeroPosition(value) {
  const allowed = new Set([
    'left top', 'center top', 'right top',
    'left center', 'center center', 'right center',
    'left bottom', 'center bottom', 'right bottom'
  ]);
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.has(normalized) ? normalized : 'center center';
}

function renderPublic404(res) {
  return res.status(404).render('404', {
    title: 'Not Found',
    errorCode: 404,
    errorTitle: '风把你带到了没有文字的地方',
    errorMessage: '这页可能从未生长，也可能已随时节凋落。你可以从首页重新出发，或去搜索一下。'
  });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

router.get('/', (req, res) => res.redirect('/admin/dashboard'));

router.get('/login', (req, res) => {
  if (req.session && req.session.admin) return res.redirect('/admin/dashboard');
  res.render('admin/login', { title: 'Login — aeoleaf', error: null });
});

router.post('/login', loginLimiter, (req, res, next) => {
  const crypto = require('crypto');
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const adminPass = process.env.ADMIN_PASSWORD || '';

  const renderFail = () =>
    res.status(401).render('admin/login', { title: 'Login — aeoleaf', error: 'Incorrect password' });

  if (!password || !adminPass) return renderFail();

  let match = false;
  try {
    const a = Buffer.from(password, 'utf8');
    const b = Buffer.from(adminPass, 'utf8');
    if (a.length !== b.length) {
      const filler = Buffer.alloc(b.length);
      crypto.timingSafeEqual(filler, b);
      match = false;
    } else {
      match = crypto.timingSafeEqual(a, b);
    }
  } catch { match = false; }

  if (!match) return renderFail();

  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.admin = true;
    req.session.save((err2) => {
      if (err2) return next(err2);
      res.redirect('/admin/dashboard');
    });
  });
});

router.post('/logout', requireAdmin, (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

router.get('/dashboard', requireAdmin, (req, res) => {
  const stats = {
    postsPublished: db.prepare("SELECT COUNT(*) as cnt FROM posts WHERE status='published'").get().cnt,
    postsDraft: db.prepare("SELECT COUNT(*) as cnt FROM posts WHERE status='draft'").get().cnt,
    worksTotal: db.prepare('SELECT COUNT(*) as cnt FROM works').get().cnt
  };
  const recentPosts = db.prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT 5').all();
  const recentWorks = db.prepare('SELECT * FROM works ORDER BY created_at DESC LIMIT 5').all();

  res.render('admin/dashboard', { title: 'Dashboard — aeoleaf', stats, recentPosts, recentWorks });
});

// ─── Posts (edit pages; JSON CRUD lives in routes/api/posts.js) ────────────────

router.get('/posts', requireAdmin, (req, res) => {
  const posts = db.prepare('SELECT * FROM posts ORDER BY created_at DESC').all()
    .map(p => ({ ...p, tags: JSON.parse(p.tags || '[]') }));
  res.render('admin/posts-list', { title: 'Posts — aeoleaf', posts });
});

router.get('/posts/new', requireAdmin, (req, res) => {
  res.render('admin/post-edit', { title: 'New Post — aeoleaf', post: null });
});

router.get('/posts/:id/edit', requireAdmin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return renderPublic404(res);
  res.render('admin/post-edit', {
    title: 'Edit Post — aeoleaf',
    post: { ...post, tags: JSON.parse(post.tags || '[]') }
  });
});

// ─── Works (edit pages; JSON CRUD lives in routes/api/works.js) ────────────────

router.get('/works', requireAdmin, (req, res) => {
  const works = db.prepare('SELECT * FROM works ORDER BY sort_order ASC, created_at DESC').all()
    .map(w => ({ ...w, tags: JSON.parse(w.tags || '[]') }));
  res.render('admin/works-list', { title: 'Works — aeoleaf', works });
});

router.get('/works/new', requireAdmin, (req, res) => {
  res.render('admin/work-edit', { title: 'New Work — aeoleaf', work: null });
});

router.get('/works/:id/edit', requireAdmin, (req, res) => {
  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id);
  if (!work) return renderPublic404(res);
  res.render('admin/work-edit', {
    title: 'Edit Work — aeoleaf',
    work: { ...work, tags: JSON.parse(work.tags || '[]'), images: JSON.parse(work.images || '[]') }
  });
});

// ─── Settings ─────────────────────────────────────────────────────────────────

function loadSettingsMap() {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  rows.forEach((r) => { settings[r.key] = r.value; });
  return settings;
}

router.get('/settings', requireAdmin, (req, res) => {
  const settings = loadSettingsMap();
  const notice = req.query.ok === '1' ? '已保存' : null;
  const saveError = req.query.err === 'social_json'
    ? '社交链接 JSON 格式无效，请检查括号与引号后重试。'
    : req.query.err === 'upload'
      ? '背景图片上传失败，仅支持 8MB 以内的常见图片格式。'
    : req.query.err === 'body'
      ? '未收到表单数据（可能被代理截断或请求过大）。'
      : null;
  res.render('admin/settings', { title: 'Settings — aeoleaf', settings, notice, saveError });
});

router.post('/settings', requireAdmin, parseSettingsUpload, (req, res, next) => {
  try {
    const b = req.body;
    if (!b || typeof b !== 'object') {
      return res.redirect('/admin/settings?err=body');
    }

    const keys = [
      'site_title',
      'site_subtitle',
      'about_text',
      'about_image',
      'about_tagline',
      'about_meta',
      'home_hero_image',
      'home_hero_image_mobile',
      'home_hero_position',
      'home_hero_position_mobile',
      'contact_email',
      'contact_qq',
      'social_links'
    ];
    const hasAnyField = keys.some((k) => Object.prototype.hasOwnProperty.call(b, k));
    if (!hasAnyField) {
      return res.redirect('/admin/settings?err=body');
    }

    let socialVal = b.social_links;
    if (Object.prototype.hasOwnProperty.call(b, 'social_links')) {
      const raw = socialVal == null ? '' : String(socialVal);
      if (raw.trim() === '') {
        socialVal = '[]';
      } else {
        try {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) {
            return res.redirect('/admin/settings?err=social_json');
          }
          socialVal = JSON.stringify(parsed);
        } catch {
          return res.redirect('/admin/settings?err=social_json');
        }
      }
    }

    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    const update = db.transaction(() => {
      const desktopUpload = req.files?.home_hero_desktop_file?.[0];
      const mobileUpload = req.files?.home_hero_mobile_file?.[0];
      if (Object.prototype.hasOwnProperty.call(b, 'site_title')) stmt.run('site_title', b.site_title ?? '');
      if (Object.prototype.hasOwnProperty.call(b, 'site_subtitle')) stmt.run('site_subtitle', b.site_subtitle ?? '');
      if (Object.prototype.hasOwnProperty.call(b, 'about_text')) stmt.run('about_text', b.about_text ?? '');
      if (Object.prototype.hasOwnProperty.call(b, 'about_image')) stmt.run('about_image', b.about_image ?? '');
      if (Object.prototype.hasOwnProperty.call(b, 'about_tagline')) stmt.run('about_tagline', b.about_tagline ?? '');
      if (Object.prototype.hasOwnProperty.call(b, 'about_meta')) stmt.run('about_meta', b.about_meta ?? '');
      if (Object.prototype.hasOwnProperty.call(b, 'home_hero_image') || desktopUpload) {
        stmt.run('home_hero_image', desktopUpload ? `/uploads/general/${desktopUpload.filename}` : (b.home_hero_image ?? ''));
      }
      if (Object.prototype.hasOwnProperty.call(b, 'home_hero_image_mobile') || mobileUpload) {
        stmt.run('home_hero_image_mobile', mobileUpload ? `/uploads/general/${mobileUpload.filename}` : (b.home_hero_image_mobile ?? ''));
      }
      if (Object.prototype.hasOwnProperty.call(b, 'home_hero_position')) {
        stmt.run('home_hero_position', normalizeHeroPosition(b.home_hero_position));
      }
      if (Object.prototype.hasOwnProperty.call(b, 'home_hero_position_mobile')) {
        stmt.run('home_hero_position_mobile', normalizeHeroPosition(b.home_hero_position_mobile));
      }
      if (Object.prototype.hasOwnProperty.call(b, 'contact_email')) stmt.run('contact_email', b.contact_email ?? '');
      if (Object.prototype.hasOwnProperty.call(b, 'contact_qq')) stmt.run('contact_qq', b.contact_qq ?? '');
      if (Object.prototype.hasOwnProperty.call(b, 'social_links')) stmt.run('social_links', socialVal);
    });
    update();
    saveDBSync();
    return res.redirect('/admin/settings?ok=1');
  } catch (e) {
    return next(e);
  }
});

// ─── Visitor analytics console ─────────────────────────────────────────────────

function parseDatetimeParam(val) {
  if (!val) return null;
  var n = Number(val);
  if (Number.isFinite(n) && n > 1e12) return n;
  var d = new Date(val);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function visitorFiltersFromQuery(req) {
  return {
    startTime: parseDatetimeParam(req.query.startTime),
    endTime: parseDatetimeParam(req.query.endTime),
    ip: (req.query.ip || '').trim(),
    city: (req.query.city || '').trim(),
    deviceType: (req.query.deviceType || '').trim(),
    fingerprint: (req.query.fingerprint || '').trim()
  };
}

function renderAdminVisitorsList(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 20;
    const filters = visitorFiltersFromQuery(req);
    const view = req.query.view === 'sessions' ? 'sessions' : 'detail';

    const allowedSortCols = ['tracked_at', 'ip', 'stay_duration_ms'];
    const sortBy = allowedSortCols.includes(req.query.sortBy) ? req.query.sortBy : 'tracked_at';
    const sortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc';

    const overview = getVisitorOverview();
    const trendRows = getVisitorTrend(7);
    const regionRows = getRegionDistribution(20);
    const topPages = getTopPages(10);

    let visitorsPage = null;
    let sessionsPage = null;

    if (view === 'sessions') {
      sessionsPage = getSessionsPage(filters, page, limit);
    } else {
      visitorsPage = getVisitorsPage(filters, page, limit, sortBy, sortDir);
    }

    res.render('admin/visitors', {
      title: 'Visitors — aeoleaf',
      overview,
      trendRows,
      regionRows,
      topPages,
      visitorsPage,
      sessionsPage,
      filters,
      view,
      sortBy,
      sortDir
    });
  } catch (err) {
    next(err);
  }
}

router.get('/visitors', requireAdmin, renderAdminVisitorsList);

function renderVisitorFingerprint(req, res, next) {
  try {
    const fp = String(req.query.fp || '').trim();
    if (!fp) return res.redirect('/admin/visitors');
    const rows = getVisitorsByFingerprint(fp, 500);
    res.render('admin/visitor-fingerprint', {
      title: '访客路径 — aeoleaf',
      fingerprint: fp,
      rows
    });
  } catch (err) {
    next(err);
  }
}

router.get('/visitors/fingerprint', requireAdmin, renderVisitorFingerprint);

function renderVisitorsExportCsv(req, res, next) {
  try {
    const startTime = req.query.startTime ? Number(req.query.startTime) : null;
    const endTime = req.query.endTime ? Number(req.query.endTime) : null;
    const filters = {
      startTime: Number.isFinite(startTime) ? startTime : null,
      endTime: Number.isFinite(endTime) ? endTime : null,
      ip: (req.query.ip || '').trim(),
      city: (req.query.city || '').trim(),
      deviceType: (req.query.deviceType || '').trim(),
      fingerprint: (req.query.fingerprint || '').trim()
    };

    const rows = getVisitorsByFilter(filters, 10000);
    const headers = [
      'id', 'tracked_at', 'ip', 'full_url', 'path', 'referer', 'device_type', 'os_name', 'browser_name',
      'country', 'province', 'city', 'isp', 'network_type', 'stay_duration_ms', 'max_scroll_depth',
      'fingerprint_id', 'request_id', 'utm_source', 'utm_medium', 'utm_campaign', 'search_keyword', 'is_bot'
    ];

    const escapeCsv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [headers.join(',')]
      .concat(rows.map((row) => headers.map((h) => escapeCsv(row[h])).join(',')))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="visitors-${Date.now()}.csv"`);
    res.send('﻿' + csv);
  } catch (err) {
    next(err);
  }
}

router.get('/visitors/export.csv', requireAdmin, renderVisitorsExportCsv);

function renderVisitorDetail(req, res, next) {
  try {
    const visitor = getVisitorDetail(req.params.id);
    if (!visitor) return renderPublic404(res);
    const session = visitor.visitor_session_id ? getVisitorSessionById(visitor.visitor_session_id) : null;
    const pathRows = visitor.visitor_session_id ? getVisitorPathBySession(visitor.visitor_session_id) : [visitor];

    res.render('admin/visitor-detail', {
      title: `Visitor #${visitor.id} — aeoleaf`,
      visitor,
      session,
      pathRows
    });
  } catch (err) {
    next(err);
  }
}

router.get('/visitor/:id', requireAdmin, renderVisitorDetail);

router.post('/visitors/blacklist', requireAdmin, (req, res) => {
  try {
    const ip = (req.body.ip || '').trim();
    const reason = (req.body.reason || '').trim();
    if (!ip) return res.status(400).json({ error: 'IP is required' });
    addToBlacklist(ip, reason);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/visitors/blacklist/remove', requireAdmin, (req, res) => {
  try {
    const ip = (req.body.ip || '').trim();
    if (!ip) return res.status(400).json({ error: 'IP is required' });
    removeFromBlacklist(ip);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/visitors/blacklist', requireAdmin, (req, res) => {
  try {
    const list = getBlacklistIps();
    res.render('admin/visitors-blacklist', {
      title: 'IP Blacklist — aeoleaf',
      list
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const router = require('express').Router();
const {
  db,
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
const { marked } = require('marked');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

marked.use({ gfm: true, breaks: false });

function render(md) {
  if (!md) return '';
  return DOMPurify.sanitize(marked.parse(md));
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : '';
}

// ─── Public Pages ────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const featuredWorks = db.prepare(
    'SELECT * FROM works WHERE featured = 1 ORDER BY sort_order ASC, created_at DESC LIMIT 3'
  ).all().map(w => ({ ...w, tags: JSON.parse(w.tags || '[]') }));

  const recentPosts = db.prepare(
    "SELECT * FROM posts WHERE status = 'published' ORDER BY created_at DESC LIMIT 5"
  ).all().map(p => ({ ...p, tags: JSON.parse(p.tags || '[]') }));

  const featuredPostRow = db.prepare(
    "SELECT * FROM posts WHERE status='published' AND cover_image != '' ORDER BY created_at DESC LIMIT 1"
  ).get();
  const featuredPost = featuredPostRow
    ? { ...featuredPostRow, tags: JSON.parse(featuredPostRow.tags || '[]') }
    : null;

  const statsData = {
    postsCount: db.prepare("SELECT COUNT(*) as cnt FROM posts WHERE status='published'").get()?.cnt || 0,
    worksCount: db.prepare("SELECT COUNT(*) as cnt FROM works").get()?.cnt || 0,
    totalPV: db.prepare("SELECT COUNT(*) as cnt FROM visitors").get()?.cnt || 0
  };

  res.render('index', {
    title: getSetting('site_title'),
    subtitle: getSetting('site_subtitle'),
    featuredWorks,
    recentPosts,
    featuredPost,
    statsData,
    aboutText: getSetting('about_text') || '',
    aboutImage: getSetting('about_image') || ''
  });
});

router.get('/blog', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 10;
  const offset = (page - 1) * limit;

  const total = db.prepare("SELECT COUNT(*) as cnt FROM posts WHERE status = 'published'").get().cnt;
  const posts = db.prepare(
    "SELECT * FROM posts WHERE status = 'published' ORDER BY created_at DESC LIMIT ? OFFSET ?"
  ).all(limit, offset).map(p => ({ ...p, tags: JSON.parse(p.tags || '[]') }));

  res.render('blog', {
    title: 'Blog — ' + getSetting('site_title'),
    posts,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  });
});

router.get('/blog/:slug', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE slug = ? AND status = ?')
    .get(req.params.slug, 'published');
  if (!post) return res.status(404).render('404', { title: 'Not Found' });

  db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(post.id);

  res.render('post', {
    title: post.title + ' — ' + getSetting('site_title'),
    post: { ...post, tags: JSON.parse(post.tags || '[]'), html: render(post.content) }
  });
});

router.get('/works', (req, res) => {
  const works = db.prepare('SELECT * FROM works ORDER BY sort_order ASC, created_at DESC').all()
    .map(w => ({ ...w, tags: JSON.parse(w.tags || '[]') }));

  const allTags = [...new Set(works.flatMap(w => w.tags))].sort();

  res.render('works', {
    title: 'Works — ' + getSetting('site_title'),
    works,
    allTags
  });
});

router.get('/works/:slug', (req, res) => {
  const work = db.prepare('SELECT * FROM works WHERE slug = ?').get(req.params.slug);
  if (!work) return res.status(404).render('404', { title: 'Not Found' });

  res.render('work-detail', {
    title: work.title + ' — ' + getSetting('site_title'),
    work: {
      ...work,
      tags: JSON.parse(work.tags || '[]'),
      images: JSON.parse(work.images || '[]'),
      html: render(work.content)
    }
  });
});

router.get('/about', (req, res) => {
  res.render('about', {
    title: 'About — ' + getSetting('site_title'),
    aboutText: render(getSetting('about_text')),
    aboutImage: getSetting('about_image')
  });
});

router.get('/search', (req, res) => {
  res.render('search', {
    title: '搜索 — ' + getSetting('site_title'),
    query: req.query.q || ''
  });
});

// ─── Admin Pages ──────────────────────────────────────────────────────────────

router.get('/admin', (req, res) => res.redirect('/admin/dashboard'));

router.get('/admin/login', (req, res) => {
  if (req.session && req.session.admin) return res.redirect('/admin/dashboard');
  res.render('admin/login', { title: 'Login — aeoleaf', error: null });
});

router.post('/admin/login', (req, res) => {
  const crypto = require('crypto');
  const { password } = req.body;
  const adminPass = process.env.ADMIN_PASSWORD || '';

  let match = false;
  try {
    const len = Math.max(password.length, adminPass.length);
    const ba = Buffer.alloc(len); Buffer.from(password).copy(ba);
    const bb = Buffer.alloc(len); Buffer.from(adminPass).copy(bb);
    match = crypto.timingSafeEqual(ba, bb) && password.length === adminPass.length;
  } catch { match = false; }

  if (match) {
    req.session.admin = true;
    return res.redirect('/admin/dashboard');
  }
  res.render('admin/login', { title: 'Login — aeoleaf', error: 'Incorrect password' });
});

router.post('/admin/logout', requireAdmin, (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

router.get('/admin/dashboard', requireAdmin, (req, res) => {
  const stats = {
    postsPublished: db.prepare("SELECT COUNT(*) as cnt FROM posts WHERE status='published'").get().cnt,
    postsDraft: db.prepare("SELECT COUNT(*) as cnt FROM posts WHERE status='draft'").get().cnt,
    worksTotal: db.prepare('SELECT COUNT(*) as cnt FROM works').get().cnt
  };
  const recentPosts = db.prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT 5').all();
  const recentWorks = db.prepare('SELECT * FROM works ORDER BY created_at DESC LIMIT 5').all();

  res.render('admin/dashboard', { title: 'Dashboard — aeoleaf', stats, recentPosts, recentWorks });
});

router.get('/admin/posts', requireAdmin, (req, res) => {
  const posts = db.prepare('SELECT * FROM posts ORDER BY created_at DESC').all()
    .map(p => ({ ...p, tags: JSON.parse(p.tags || '[]') }));
  res.render('admin/posts-list', { title: 'Posts — aeoleaf', posts });
});

router.get('/admin/posts/new', requireAdmin, (req, res) => {
  res.render('admin/post-edit', { title: 'New Post — aeoleaf', post: null });
});

router.get('/admin/posts/:id/edit', requireAdmin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).render('404', { title: 'Not Found' });
  res.render('admin/post-edit', {
    title: 'Edit Post — aeoleaf',
    post: { ...post, tags: JSON.parse(post.tags || '[]') }
  });
});

router.get('/admin/works', requireAdmin, (req, res) => {
  const works = db.prepare('SELECT * FROM works ORDER BY sort_order ASC, created_at DESC').all()
    .map(w => ({ ...w, tags: JSON.parse(w.tags || '[]') }));
  res.render('admin/works-list', { title: 'Works — aeoleaf', works });
});

router.get('/admin/works/new', requireAdmin, (req, res) => {
  res.render('admin/work-edit', { title: 'New Work — aeoleaf', work: null });
});

router.get('/admin/works/:id/edit', requireAdmin, (req, res) => {
  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id);
  if (!work) return res.status(404).render('404', { title: 'Not Found' });
  res.render('admin/work-edit', {
    title: 'Edit Work — aeoleaf',
    work: { ...work, tags: JSON.parse(work.tags || '[]'), images: JSON.parse(work.images || '[]') }
  });
});

// Settings page
router.get('/admin/settings', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  res.render('admin/settings', { title: 'Settings — aeoleaf', settings });
});

router.post('/admin/settings', requireAdmin, (req, res) => {
  const { site_title, site_subtitle, about_text, about_image } = req.body;
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const update = db.transaction(() => {
    if (site_title !== undefined) stmt.run('site_title', site_title);
    if (site_subtitle !== undefined) stmt.run('site_subtitle', site_subtitle);
    if (about_text !== undefined) stmt.run('about_text', about_text);
    if (about_image !== undefined) stmt.run('about_image', about_image);
  });
  update();
  res.redirect('/admin/settings');
});

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

router.get('/admin/visitors', requireAdmin, renderAdminVisitorsList);

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

router.get('/admin/visitors/fingerprint', requireAdmin, renderVisitorFingerprint);

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
    res.send('\uFEFF' + csv);
  } catch (err) {
    next(err);
  }
}

router.get('/admin/visitors/export.csv', requireAdmin, renderVisitorsExportCsv);

function renderVisitorDetail(req, res, next) {
  try {
    const visitor = getVisitorDetail(req.params.id);
    if (!visitor) return res.status(404).render('404', { title: 'Not Found' });
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

router.get('/admin/visitor/:id', requireAdmin, renderVisitorDetail);

router.post('/admin/visitors/blacklist', requireAdmin, (req, res) => {
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

router.post('/admin/visitors/blacklist/remove', requireAdmin, (req, res) => {
  try {
    const ip = (req.body.ip || '').trim();
    if (!ip) return res.status(400).json({ error: 'IP is required' });
    removeFromBlacklist(ip);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/visitors/blacklist', requireAdmin, (req, res) => {
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

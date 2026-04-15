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

function safeSocialUrl(u) {
  const s = String(u || '').trim();
  if (!s) return null;
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  const lower = s.toLowerCase();
  if (lower.startsWith('mailto:') && s.length > 7) return s;
  try {
    const p = new URL(s);
    if (p.protocol === 'http:' || p.protocol === 'https:') return p.href;
  } catch {
    /* ignore */
  }
  return null;
}

function parseSocialLinks(raw) {
  if (!raw || !String(raw).trim()) return [];
  try {
    const a = JSON.parse(raw);
    if (!Array.isArray(a)) return [];
    return a
      .map((x) => {
        if (!x || typeof x !== 'object') return null;
        const label = typeof x.label === 'string' ? x.label.trim() : '';
        const url = safeSocialUrl(x.url);
        if (!label || !url) return null;
        return { label, url };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function plainTextFromMarkdown(md, maxLen) {
  if (!md) return '';
  const t = String(md)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, ' ')
    .replace(/\*\*?|__|\[|\]|\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
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
  const aboutTextRaw = getSetting('about_text');
  const aboutMeta = (getSetting('about_meta') || '').trim();
  const ogDescription = aboutMeta || plainTextFromMarkdown(aboutTextRaw, 160)
    || '关于我 — 个人博客与作品集';

  const featuredWorks = db.prepare(
    'SELECT * FROM works WHERE featured = 1 ORDER BY sort_order ASC, created_at DESC LIMIT 3'
  ).all().map((w) => ({ ...w, tags: JSON.parse(w.tags || '[]') }));

  const recentPosts = db.prepare(
    "SELECT * FROM posts WHERE status = 'published' ORDER BY created_at DESC LIMIT 5"
  ).all().map((p) => ({ ...p, tags: JSON.parse(p.tags || '[]') }));

  const statsData = {
    postsCount: db.prepare("SELECT COUNT(*) as cnt FROM posts WHERE status='published'").get()?.cnt || 0,
    worksCount: db.prepare('SELECT COUNT(*) as cnt FROM works').get()?.cnt || 0,
    totalPV: db.prepare('SELECT COUNT(*) as cnt FROM visitors').get()?.cnt || 0
  };

  const aboutTagline = getSetting('about_tagline');
  const siteSubtitle = getSetting('site_subtitle');
  const aboutHeroLine = (aboutTagline && aboutTagline.trim())
    || (siteSubtitle && siteSubtitle.trim())
    || '个人博客与作品集';

  const contactEmail = getSetting('contact_email');
  const contactQq = getSetting('contact_qq');
  const socialLinks = parseSocialLinks(getSetting('social_links'));
  const hasContact = Boolean(
    (contactEmail && String(contactEmail).trim())
      || (contactQq && String(contactQq).trim())
      || (socialLinks && socialLinks.length)
  );

  res.render('about', {
    title: 'About — ' + getSetting('site_title'),
    aboutText: render(aboutTextRaw),
    aboutImage: getSetting('about_image'),
    aboutHeroLine,
    ogDescription,
    contactEmail,
    contactQq,
    socialLinks,
    hasContact,
    statsData,
    featuredWorks,
    recentPosts
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
function loadSettingsMap() {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  rows.forEach((r) => { settings[r.key] = r.value; });
  return settings;
}

router.get('/admin/settings', requireAdmin, (req, res) => {
  const settings = loadSettingsMap();
  const notice = req.query.ok === '1' ? '已保存' : null;
  const saveError = req.query.err === 'social_json'
    ? '社交链接 JSON 格式无效，请检查括号与引号后重试。'
    : req.query.err === 'body'
      ? '未收到表单数据（可能被代理截断或请求过大）。'
      : null;
  res.render('admin/settings', { title: 'Settings — aeoleaf', settings, notice, saveError });
});

router.post('/admin/settings', requireAdmin, (req, res, next) => {
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
      if (Object.prototype.hasOwnProperty.call(b, 'site_title')) stmt.run('site_title', b.site_title ?? '');
      if (Object.prototype.hasOwnProperty.call(b, 'site_subtitle')) stmt.run('site_subtitle', b.site_subtitle ?? '');
      if (Object.prototype.hasOwnProperty.call(b, 'about_text')) stmt.run('about_text', b.about_text ?? '');
      if (Object.prototype.hasOwnProperty.call(b, 'about_image')) stmt.run('about_image', b.about_image ?? '');
      if (Object.prototype.hasOwnProperty.call(b, 'about_tagline')) stmt.run('about_tagline', b.about_tagline ?? '');
      if (Object.prototype.hasOwnProperty.call(b, 'about_meta')) stmt.run('about_meta', b.about_meta ?? '');
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

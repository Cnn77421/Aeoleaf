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
const { marked } = require('marked');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  message: 'Too many login attempts, try again later',
  keyPrefix: 'login:'
});
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

marked.use({ gfm: true, breaks: false });

function render(md) {
  if (!md) return '';
  return DOMPurify.sanitize(marked.parse(md));
}

// ── Heading-id + TOC extraction for post detail pages ────────────────────────
// Walks the sanitized HTML, assigns unique id= to each h2/h3, returns
// { html, toc } where toc is a flat array of { level, text, id }.
function slugifyHeading(text, fallbackIdx) {
  const raw = String(text || '').trim();
  const ascii = raw
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^-$/, '');
  return ascii || ('section-' + fallbackIdx);
}

// Reading time estimate — mixed CN/EN content: CN at ~400 chars/min, EN at ~250 words/min.
function estimateReadMinutes(rawContent) {
  if (!rawContent) return 1;
  const plain = String(rawContent)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]\(([^)]*)\)/g, '$1')
    .replace(/[#*_>~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cjk = (plain.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) || []).length;
  const en = plain.replace(/[\u4e00-\u9fff\u3040-\u30ff]/g, '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(cjk / 400 + en / 250));
}

function extractHeadings(html) {
  if (!html) return { html: '', toc: [] };
  const dom = new JSDOM('<!doctype html><body>' + html + '</body>');
  const doc = dom.window.document;
  const headings = Array.from(doc.querySelectorAll('h2, h3'));
  const toc = [];
  const seen = new Map();
  headings.forEach((el, idx) => {
    const text = (el.textContent || '').trim();
    let base = slugifyHeading(text, idx + 1);
    let id = base;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    if (count > 1) id = base + '-' + count;
    el.setAttribute('id', id);
    toc.push({
      level: el.tagName === 'H2' ? 2 : 3,
      text,
      id
    });
  });
  return { html: doc.body.innerHTML, toc };
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

/** Split site_title so the hero never repeats a trailing 「风叶」 in both lines. */
function parseHeroTitle(siteTitle) {
  const raw = String(siteTitle || 'Aeoleaf').trim();
  const accent = '风叶';
  const trailing = /\s*风叶\s*$/u;
  if (trailing.test(raw)) {
    const main = raw.replace(trailing, '').trim();
    return { heroTitleMain: main || 'Aeoleaf', heroTitleAccent: accent };
  }
  if (raw.includes(accent)) {
    return { heroTitleMain: raw, heroTitleAccent: null };
  }
  return { heroTitleMain: raw, heroTitleAccent: accent };
}

function renderPublic404(res) {
  return res.status(404).render('404', {
    title: 'Not Found',
    errorCode: 404,
    errorTitle: '风把你带到了没有文字的地方',
    errorMessage: '这页可能从未生长，也可能已随时节凋落。你可以从首页重新出发，或去搜索一下。'
  });
}

/**
 * Blog list pagination: ordered parts are either a page number or the string
 * 'gap' for an ellipsis (when there is a hole in the sequence).
 */
function buildBlogPagination(page, totalPages, neighborRadius = 2) {
  if (totalPages <= 1) return null;
  const nums = new Set([1, totalPages]);
  for (let i = page - neighborRadius; i <= page + neighborRadius; i += 1) {
    if (i >= 1 && i <= totalPages) nums.add(i);
  }
  const sorted = [...nums].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; i += 1) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) parts.push('gap');
    parts.push(sorted[i]);
  }
  return {
    prev: page > 1 ? page - 1 : null,
    next: page < totalPages ? page + 1 : null,
    parts
  };
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

  const { heroTitleMain, heroTitleAccent } = parseHeroTitle(getSetting('site_title'));

  const carouselWorks = db.prepare(
    "SELECT * FROM works WHERE cover_image IS NOT NULL AND cover_image != '' ORDER BY sort_order ASC, created_at DESC LIMIT 3"
  ).all().map((w) => ({ ...w, tags: JSON.parse(w.tags || '[]') }));

  // Contact details for the home-page Bento card. Mirrors /about so that
  // admin-side settings are the single source of truth; the template falls
  // back to the old hard-coded values when a field is empty.
  const contactEmail = (getSetting('contact_email') || '').trim();
  const contactQq = (getSetting('contact_qq') || '').trim();
  const socialLinks = parseSocialLinks(getSetting('social_links'));

  res.render('index', {
    title: getSetting('site_title'),
    subtitle: getSetting('site_subtitle'),
    heroTitleMain,
    heroTitleAccent,
    featuredWorks,
    carouselWorks,
    recentPosts,
    featuredPost,
    statsData,
    aboutText: getSetting('about_text') || '',
    aboutSummary: plainTextFromMarkdown(getSetting('about_text') || '', 220),
    aboutImage: getSetting('about_image') || '',
    contactEmail,
    contactQq,
    socialLinks
  });
});

router.get('/blog', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 10;
  const activeTag = (req.query.tag || '').trim();

  // Published posts are small enough that loading + filtering in-memory
  // stays cheap; tags are JSON-encoded so a SQL LIKE would be fragile.
  const allPosts = db.prepare(
    "SELECT * FROM posts WHERE status = 'published' ORDER BY created_at DESC"
  ).all().map(p => ({
    ...p,
    tags: JSON.parse(p.tags || '[]'),
    readMinutes: estimateReadMinutes(p.content)
  }));

  const filtered = activeTag
    ? allPosts.filter(p => p.tags.includes(activeTag))
    : allPosts;
  const total = filtered.length;
  const offset = (page - 1) * limit;
  const posts = filtered.slice(offset, offset + limit);

  const blogDesc = activeTag
    ? `按标签「${activeTag}」筛选的博客文章。`
    : '浏览所有博客文章，分享技术见解和创意思考';

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const allTags = [...new Set(allPosts.flatMap(p => p.tags))].sort();

  res.render('blog', {
    title: (activeTag ? '#' + activeTag + ' — ' : '') + 'Blog — ' + getSetting('site_title'),
    description: blogDesc,
    posts,
    total,
    page,
    limit,
    totalPages,
    pagination: buildBlogPagination(page, totalPages),
    activeTag,
    allTags
  });
});

router.get('/blog/:slug', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE slug = ? AND status = ?')
    .get(req.params.slug, 'published');
  if (!post) return renderPublic404(res);

  db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(post.id);

  const readMinutes = estimateReadMinutes(post.content);
  const { html: postHtml, toc } = extractHeadings(render(post.content));
  // Only show TOC when there are at least 3 top-level (h2) sections;
  // anything shorter feels like visual clutter next to the article.
  const h2Count = toc.filter(h => h.level === 2).length;
  const tocVisible = h2Count >= 3;

  res.render('post', {
    title: post.title + ' — ' + getSetting('site_title'),
    post: { ...post, tags: JSON.parse(post.tags || '[]'), html: postHtml },
    readMinutes,
    toc,
    tocVisible
  });
});

router.get('/works', (req, res) => {
  const works = db.prepare('SELECT * FROM works ORDER BY sort_order ASC, created_at DESC').all()
    .map(w => ({ ...w, tags: JSON.parse(w.tags || '[]') }));

  const firstFeaturedIdx = works.findIndex((w) => Number(w.featured) === 1);
  const spanIdx = firstFeaturedIdx >= 0 ? firstFeaturedIdx : 0;
  const worksLayout = works.map((w, i) => ({
    ...w,
    spanFeature: i === spanIdx
  }));

  const allTags = [...new Set(works.flatMap(w => w.tags))].sort();
  // Tag frequency map for the filter bar count badges. "All" is rendered
  // separately from this map using works.length.
  const tagCounts = {};
  works.forEach(w => w.tags.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));

  res.render('works', {
    title: 'Works — ' + getSetting('site_title'),
    works: worksLayout,
    allTags,
    tagCounts
  });
});

router.get('/works/:slug', (req, res) => {
  const work = db.prepare('SELECT * FROM works WHERE slug = ?').get(req.params.slug);
  if (!work) return renderPublic404(res);

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
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const qs = new URLSearchParams();
  qs.set('openSearch', '1');
  if (q) qs.set('q', q);
  res.redirect(302, '/?' + qs.toString());
});

// ─── Admin Pages ──────────────────────────────────────────────────────────────

router.get('/admin', (req, res) => res.redirect('/admin/dashboard'));

router.get('/admin/login', (req, res) => {
  if (req.session && req.session.admin) return res.redirect('/admin/dashboard');
  res.render('admin/login', { title: 'Login — aeoleaf', error: null });
});

router.post('/admin/login', loginLimiter, (req, res, next) => {
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
  if (!post) return renderPublic404(res);
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
  if (!work) return renderPublic404(res);
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
